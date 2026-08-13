import { buildImagesRequestBody } from "./requestPayloads.ts";
import {
  normalizeAPIKeyForHeader,
  nowSeconds,
  registerRawText,
  resolveSourceDataURLs,
  shouldUseAndroidNativeHTTP,
} from "./common.ts";
import { nativeHttpRequestText } from "./nativeHttp.ts";
import { runtimeClearInterval, runtimeSetInterval } from "../../../lib/runtimeCompat.ts";
import {
  MAX_ATTEMPTS,
  RemoteKernelError,
  STATUS_INTERVAL_MS,
  type ExtractedImageResult,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

function parseSSEEvent(line: string): any | null {
  const stripped = line.trim();
  if (!stripped.startsWith("data: ")) return null;
  const payload = stripped.slice(6).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function parseImagesStreamEvent(
  event: any,
  callbacks: RemoteJobCallbacks,
): ExtractedImageResult | null {
  const type = event?.type;
  if (type === "image_generation.partial_image" || type === "image_edit.partial_image") {
    if (event.b64_json) {
      callbacks.onPartialImage?.({
        imageB64: event.b64_json,
        partialImageIndex: typeof event.partial_image_index === "number" ? event.partial_image_index : undefined,
        sourceEvent: "images_partial",
      });
    }
    return null;
  }
  if (type === "image_generation.completed" || type === "image_edit.completed") {
    if (event.b64_json) {
      return {
        imageB64: event.b64_json,
        revisedPrompt: "",
        sourceEvent: "images_api",
      };
    }
  }
  if (event?.object === "image.generation.result" || event?.object === "image.edit.result") {
    return parseImagesResponse(JSON.stringify(event), 200);
  }
  return null;
}

function parseImagesResponse(raw: string, status: number): ExtractedImageResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (status >= 400) {
      throw new RemoteKernelError(`上游返回 HTTP ${status}: ${raw.slice(0, 400)}`);
    }
    throw new RemoteKernelError(`解析 Images API 响应失败:${(error as any)?.message || error}`);
  }
  if (status >= 400) {
    if (parsed?.error?.message) {
      throw new RemoteKernelError(`上游返回 ${status}:${parsed.error.message}`);
    }
    throw new RemoteKernelError(`上游返回 HTTP ${status}`);
  }
  if (parsed?.error?.message) {
    throw new RemoteKernelError(`上游返回错误:${parsed.error.message}`);
  }
  const first = Array.isArray(parsed?.data) ? parsed.data[0] : null;
  if (!first?.b64_json) {
    if (first?.url) {
      throw new RemoteKernelError("上游返回 URL 而非 b64_json(不支持 response_format),请联系中转站启用 b64_json");
    }
    throw new RemoteKernelError("上游没有返回可用图片");
  }
  return {
    imageB64: first.b64_json,
    revisedPrompt: first.revised_prompt || "",
    sourceEvent: "images_api",
  };
}

function parseImagesStreamRaw(
  raw: string,
  callbacks: RemoteJobCallbacks,
  emitPartials = false,
): ExtractedImageResult | null {
  let fallbackPartial = "";
  const partialCallbacks = emitPartials ? callbacks : { signal: callbacks.signal };
  for (const line of raw.split(/\r?\n/)) {
    const event = parseSSEEvent(line);
    if (!event) continue;
    if ((event.type === "image_generation.partial_image" || event.type === "image_edit.partial_image") && event.b64_json) {
      fallbackPartial = event.b64_json;
    }
    const result = parseImagesStreamEvent(event, partialCallbacks);
    if (result) return result;
  }
  if (fallbackPartial) {
    return { imageB64: fallbackPartial, revisedPrompt: "", sourceEvent: "images_api_partial" };
  }
  return null;
}

export async function requestImagesOnce(
  request: RemoteJobRequest,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  const sourceDataURLs = await resolveSourceDataURLs(request.sourceImages, request.payload);
  const built = await buildImagesRequestBody(request, sourceDataURLs);
  const apiKey = normalizeAPIKeyForHeader(request.payload.apiKey);
  const startedAt = Date.now();
  callbacks.onLog?.(`[Images API] 第 ${attempt}/${MAX_ATTEMPTS} 次请求...`);
  callbacks.onProgress?.("等待 Images API 返回(无 SSE 保活)", 0, 0);
  const ticker = runtimeSetInterval(() => {
    callbacks.onProgress?.("等待 Images API 返回(无 SSE 保活)", nowSeconds(startedAt), 0);
  }, STATUS_INTERVAL_MS);
  try {
    const proxyMode = request.payload.proxyMode === "none" || request.payload.proxyMode === "custom" ? request.payload.proxyMode : "system";
    if (shouldUseAndroidNativeHTTP()) {
      let rawFromLines = "";
      let nativeStreamResult: ExtractedImageResult | null = null;
      let nativeBytesReceived = 0;
      const consumeNativeLine = (line: string) => {
        rawFromLines += `${line}\n`;
        nativeBytesReceived += line.length + 1;
        const event = parseSSEEvent(line);
        const parsed = event ? parseImagesStreamEvent(event, callbacks) : null;
        if (parsed) nativeStreamResult = parsed;
        callbacks.onProgress?.("已收到 Images API 流式事件", nowSeconds(startedAt), nativeBytesReceived);
      };
      const response = await nativeHttpRequestText(
        built.url,
        "POST",
        {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream, application/json",
          ...(built.headers ?? {}),
        },
        built.body,
        callbacks.signal,
        consumeNativeLine,
        { proxyMode, proxyURL: request.payload.proxyURL || "" },
      );
      const rawBody = response.body || rawFromLines;
      const rawPath = registerRawText("images", attempt, rawBody);
      const isStream = String(response.contentType || "").toLowerCase().includes("text/event-stream");
      const result = isStream
        ? nativeStreamResult ?? parseImagesStreamRaw(rawBody, callbacks)
        : parseImagesResponse(rawBody, response.status);
      if (!result) throw new RemoteKernelError("上游没有返回可用图片", rawPath);
      return { ...result, rawPath, prompt: request.payload.prompt, mode: request.payload.mode };
    }
    if (proxyMode !== "system") {
      throw new RemoteKernelError("当前远程内核不能控制代理,请切回本地内核或使用 Android 原生运行");
    }
    const response = await fetch(built.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream, application/json",
        ...(built.headers ?? {}),
      },
      body: built.body,
      signal: callbacks.signal,
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (response.body && contentType.includes("text/event-stream")) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      let pending = "";
      let result: ExtractedImageResult | null = null;
      let bytesReceived = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytesReceived += value.byteLength;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          pending += chunk;
          let newline = pending.indexOf("\n");
          while (newline >= 0) {
            const line = pending.slice(0, newline).replace(/\r$/, "");
            pending = pending.slice(newline + 1);
            const event = parseSSEEvent(line);
            const parsed = event ? parseImagesStreamEvent(event, callbacks) : null;
            if (parsed) result = parsed;
            callbacks.onProgress?.("已收到 Images API 流式事件", nowSeconds(startedAt), bytesReceived);
            newline = pending.indexOf("\n");
          }
        }
        raw += decoder.decode();
        if (pending.trim()) {
          const event = parseSSEEvent(pending);
          const parsed = event ? parseImagesStreamEvent(event, callbacks) : null;
          if (parsed) result = parsed;
        }
      } catch (error) {
        const fallback = parseImagesStreamRaw(raw, callbacks);
        if (fallback?.imageB64) {
          const rawPath = registerRawText("images", attempt, raw);
          return { ...fallback, rawPath, prompt: request.payload.prompt, mode: request.payload.mode };
        }
        throw error;
      }
      const rawPath = registerRawText("images", attempt, raw);
      if (!response.ok) {
        throw new RemoteKernelError(`上游返回 HTTP ${response.status}`, rawPath);
      }
      result ??= parseImagesStreamRaw(raw, callbacks);
      if (!result) throw new RemoteKernelError("上游没有返回可用图片", rawPath);
      return { ...result, rawPath, prompt: request.payload.prompt, mode: request.payload.mode };
    }
    const raw = await response.text();
    const rawPath = registerRawText("images", attempt, raw);
    const result = parseImagesResponse(raw, response.status);
    return { ...result, rawPath, prompt: request.payload.prompt, mode: request.payload.mode };
  } catch (error) {
    if (error instanceof RemoteKernelError) throw error;
    throw new RemoteKernelError(String((error as any)?.message || error));
  } finally {
    runtimeClearInterval(ticker);
  }
}
