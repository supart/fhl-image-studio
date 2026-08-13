import { buildPromptOptimizePayload } from "../../../../../../shared/kernel/requestModel.js";
import { buildPromptReversePayload } from "../../../../../../shared/kernel/requestModel.js";
import {
  compressSourceDataURLForUpload,
  extractResponseErrorMessage,
  extractResponseText,
  fileNameFromPath,
  isGPTImage2Model,
  isRetryableRaw,
  isTransportishError,
  normalizeAPIMode,
  normalizeAPIKeyForHeader,
  normalizeBaseURL,
  registerRawText,
  readRegisteredText,
  shouldUseAndroidNativeHTTP,
  sleepWithSignal,
  sourceToDataURL,
} from "./common.ts";
import { nativeHttpRequestText } from "./nativeHttp.ts";
import { queryAPIMartTaskRemote, requestAPIMartOnce } from "./apimart.ts";
import { requestImagesOnce } from "./images.ts";
import { requestResponsesOnce } from "./responses.ts";
import {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  RemoteKernelError,
  type RemotePromptOptimizeInput,
  type RemotePromptReverseInput,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

export * from "./types.ts";
export { queryAPIMartTaskRemote };

function stableSizeForRetry(size: string): string {
  switch (size) {
    case "2048x2048":
    case "2880x2880":
      return "1024x1024";
    case "2048x1360":
    case "3456x2304":
      return "1536x1024";
    case "1360x2048":
    case "2304x3456":
      return "1024x1536";
    case "2048x1152":
    case "3840x2160":
      return "1536x864";
    case "1152x2048":
    case "2160x3840":
      return "864x1536";
    case "auto":
      return "1024x1024";
    default:
      return size || "1024x1024";
  }
}

function stabilizeRequestForAttempt(request: RemoteJobRequest, attempt: number): RemoteJobRequest {
  if (attempt <= 1) return request;
  const payload = {
    ...request.payload,
    partialImages: 0,
  };
  if (attempt >= 3) {
    if (!isGPTImage2Model(payload.imageModelID)) {
      payload.size = stableSizeForRetry(payload.size);
    }
    payload.noPromptRevision = false;
    if (payload.quality === "auto" || payload.quality === "high") {
      payload.quality = "medium";
    }
  }
  return { ...request, payload };
}

function isNoFinalImageError(error: RemoteKernelError): boolean {
  const message = String(error.message || "").toLowerCase();
  return message.includes("image_generation_call.result")
    || message.includes("final")
    || message.includes("partial")
    || message.includes("没有返回图片")
    || message.includes("text-only")
    || message.includes("\u4e2d\u95f4\u9884\u89c8");
}

function retryHintForAttempt(attempt: number, request: RemoteJobRequest): string {
  if (attempt === 1) return "Auto retry: disabling partial previews for the next attempt.";
  if (attempt === 2) {
    const next = stabilizeRequestForAttempt(request, 3).payload;
    return `Auto downgrade retry: partial previews off, using ${next.size} / ${next.quality}, allowing safe prompt adaptation.`;
  }
  return "Auto retrying...";
}

export async function runRemoteImageJob(
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  let lastError: RemoteKernelError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptRequest = stabilizeRequestForAttempt(request, attempt);
    try {
      const apiMode = normalizeAPIMode(attemptRequest.payload.apiMode);
      if (apiMode === "images") {
        return await requestImagesOnce(attemptRequest, attempt, callbacks);
      }
      if (apiMode === "apimart") {
        return await requestAPIMartOnce(attemptRequest, attempt, callbacks);
      }
      return await requestResponsesOnce(attemptRequest, attempt, callbacks);
    } catch (error) {
      if (callbacks.signal.aborted) throw error;
      const typed = error instanceof RemoteKernelError
        ? error
        : new RemoteKernelError(String((error as any)?.message || error));
      lastError = typed;
      let retryableRaw = false;
      if (typed.rawPath) {
        try {
          retryableRaw = isRetryableRaw(readRegisteredText(typed.rawPath));
        } catch {
          retryableRaw = false;
        }
      }
      const retryable = retryableRaw || isTransportishError(typed) || isNoFinalImageError(typed);
      if (attempt < MAX_ATTEMPTS && retryable) {
        callbacks.onLog?.(typed.message);
        callbacks.onLog?.(retryHintForAttempt(attempt, request));
        callbacks.onLog?.(`${Math.floor(RETRY_BACKOFF_MS / 1000)} 绉掑悗鑷姩閲嶈瘯...`);
        await sleepWithSignal(callbacks.signal, RETRY_BACKOFF_MS);
        continue;
      }
      throw typed;
    }
  }
  throw lastError ?? new RemoteKernelError("Request failed after multiple attempts");
}

export async function optimizePromptRemote(
  input: RemotePromptOptimizeInput,
  signal: AbortSignal,
): Promise<string> {
  return requestPromptTextRemote(input, signal, (sourceDataURLs) => (
    buildPromptOptimizePayload(input, sourceDataURLs)
  ), "prompt optimization");
}

function emptyPromptTextResultMessage(resultLabel: string, raw: string): string {
  const upstreamMessage = extractResponseErrorMessage(raw);
  const suffix = upstreamMessage ? `\n\n上游提示:${upstreamMessage.slice(0, 500)}` : "";
  if (resultLabel === "reverse prompt") {
    return `上游没有返回可用的反推提示词。请确认当前文本模型支持图片理解(input_image)，或在「上游配置」里换一个支持视觉输入的文本模型。${suffix}`;
  }
  return `上游没有返回可用的优化结果。请确认当前文本模型支持 /v1/responses 文本输出。${suffix}`;
}

export async function reversePromptRemote(
  input: RemotePromptReverseInput,
  signal: AbortSignal,
): Promise<string> {
  return requestPromptTextRemote(input, signal, (sourceDataURLs) => (
    buildPromptReversePayload(input, sourceDataURLs)
  ), "reverse prompt");
}

async function requestPromptTextRemote(
  input: RemotePromptOptimizeInput | RemotePromptReverseInput,
  signal: AbortSignal,
  buildPayload: (sourceDataURLs: string[]) => Record<string, unknown>,
  resultLabel: "prompt optimization" | "reverse prompt",
): Promise<string> {
  const mergedSources = input.sourceImages?.length
    ? input.sourceImages
    : [
        ...(input.imagePaths ?? []).map((path) => ({ path, name: fileNameFromPath(path) })),
        ...(input.imagePath ? [{ path: input.imagePath, name: fileNameFromPath(input.imagePath) }] : []),
      ];
  const sourceDataURLs: string[] = [];
  for (const source of mergedSources) {
    const dataURL = await sourceToDataURL(source);
    if (dataURL) sourceDataURLs.push(await compressSourceDataURLForUpload(dataURL, mergedSources.length));
  }
  if (resultLabel === "reverse prompt" && sourceDataURLs.length === 0) {
    throw new RemoteKernelError("请先选择一张图片");
  }
  const url = `${normalizeBaseURL(input.baseURL)}/v1/responses`;
  const apiKey = normalizeAPIKeyForHeader(input.apiKey);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  const body = JSON.stringify({
    ...buildPayload(sourceDataURLs),
    stream: true,
  });
  const proxyMode = input.proxyMode === "none" || input.proxyMode === "custom" ? input.proxyMode : "system";
  let status = 0;
  let raw = "";
  if (shouldUseAndroidNativeHTTP()) {
    const response = await nativeHttpRequestText(url, "POST", headers, body, signal, undefined, {
      proxyMode,
      proxyURL: input.proxyURL || "",
    });
    status = response.status;
    raw = response.body;
  } else {
    if (proxyMode !== "system") {
      throw new RemoteKernelError("当前远程内核不能控制代理，请切回本地内核或使用 Android 原生运行");
    }
    const webResponse = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
    });
    status = webResponse.status;
    raw = await webResponse.text();
  }
  if (status < 200 || status >= 300) {
    const rawPath = registerRawText(resultLabel === "reverse prompt" ? "reverse" : "optimize", 1, raw);
    throw new RemoteKernelError(`上游返回 ${status}:${extractResponseErrorMessage(raw)}`, rawPath);
  }
  const text = extractResponseText(raw);
  if (!text) {
    const rawPath = registerRawText(resultLabel === "reverse prompt" ? "reverse" : "optimize", 1, raw);
    throw new RemoteKernelError(emptyPromptTextResultMessage(resultLabel, raw), rawPath);
  }
  return text;
}

export {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
};

