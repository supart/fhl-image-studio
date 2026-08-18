import { buildPromptOptimizePayload, buildPromptReversePayload } from "../../../../../../shared/kernel/requestModel.js";
import {
  compressSourceDataURLForUpload,
  addFHLEditValidationHint,
  describeProblem,
  extractResponseErrorMessage,
  extractResponseText,
  fileNameFromPath,
  isRetryableRaw,
  isTransientGenerationFailureText,
  isTransportishError,
  normalizeAPIMode,
  normalizeAPIKeyForHeader,
  normalizeBaseURL,
  isGPTImage2Model,
  registerRawText,
  readRegisteredText,
  shouldPreferResponsesForExactFHLSize,
  shouldUseAndroidNativeHTTP,
  sleepWithSignal,
  sourceToDataURL,
  stableFHLImagesSize,
} from "./common.ts";
import { nativeHttpRequestText } from "./nativeHttp.ts";
import { requestAPIMartOnce } from "./apimart.ts";
import { requestImagesOnce } from "./images.ts";
import { requestResponsesOnce } from "./responses.ts";
import { requestRunningHubOnce } from "./runninghub.ts";
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

const RATE_LIMIT_MAX_ATTEMPTS = 6;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const RATE_LIMIT_STAGGER_MS = 45_000;

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
    case "2048x1536":
    case "3840x2880":
      return "1536x1152";
    case "1536x2048":
    case "2880x3840":
      return "1152x1536";
    case "2040x1632":
    case "3840x3072":
      return "1520x1216";
    case "1632x2040":
    case "3072x3840":
      return "1216x1520";
    case "2048x1152":
    case "3840x2160":
      return "1536x864";
    case "1152x2048":
    case "2160x3840":
      return "864x1536";
    case "2048x1024":
    case "3840x1920":
      return "1536x768";
    case "1024x2048":
    case "1920x3840":
      return "768x1536";
    case "2040x680":
    case "3840x1280":
      return "1536x512";
    case "680x2040":
    case "1280x3840":
      return "512x1536";
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

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isRateLimitOrConcurrencyError(error: RemoteKernelError, rawText: string): boolean {
  const text = `${error.message || ""}\n${rawText || ""}`.toLowerCase();
  return text.includes("rate_limit_exceeded")
    || text.includes("http 429")
    || text.includes(" 429")
    || text.includes("concurrency limit exceeded")
    || text.includes("rate limit reached")
    || text.includes("too many requests")
    || text.includes("账号池")
    || text.includes("繁忙");
}

function retryDelayForAttempt(attempt: number, request: RemoteJobRequest, rateLimited: boolean): number {
  if (!rateLimited) return RETRY_BACKOFF_MS;
  const staggerSeed = `${request.payload.prompt || ""}|${request.payload.size || ""}|${attempt}`;
  const stagger = stableHash(staggerSeed) % RATE_LIMIT_STAGGER_MS;
  return RATE_LIMIT_BACKOFF_MS * attempt + stagger;
}

function retryHintForDelay(delayMs: number, rateLimited: boolean): string {
  const seconds = Math.ceil(delayMs / 1000);
  if (rateLimited) return `Rate limit or concurrency cap hit; staggered retry in ${seconds}s.`;
  return `Auto retry in ${seconds}s.`;
}

function isNoFinalImageError(error: RemoteKernelError): boolean {
  const message = String(error.message || "").toLowerCase();
  return message.includes("image_generation_call.result")
    || (message.includes("image_generation_call") && message.includes("result"))
    || message.includes("final")
    || message.includes("partial")
    || message.includes("没有返回图片")
    || message.includes("没有返回可用图片")
    || message.includes("没有返回可用的完整图片")
    || message.includes("text-only")
    || message.includes("\u4e2d\u95f4\u9884\u89c8");
}

function retryHintForAttempt(attempt: number, request: RemoteJobRequest): string {
  if (attempt === 1) return "Auto retry: disabling partial previews for the next attempt.";
  if (attempt === 2) {
    const next = stabilizeRequestForAttempt(request, 3).payload;
    const prefix = next.size === request.payload.size ? "Auto retry" : "Auto downgrade retry";
    return `${prefix}: partial previews off, using ${next.size} / ${next.quality}, allowing safe prompt adaptation.`;
  }
  return "Auto retrying...";
}

export async function runRemoteImageJob(
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  let lastError: RemoteKernelError | null = null;
  const hardMaxAttempts = Math.max(MAX_ATTEMPTS, RATE_LIMIT_MAX_ATTEMPTS);
  for (let attempt = 1; attempt <= hardMaxAttempts; attempt++) {
    const attemptRequest = stabilizeRequestForAttempt(request, attempt);
    try {
      const apiMode = normalizeAPIMode(attemptRequest.payload.apiMode);
      if (apiMode === "images") {
        const stableSize = stableFHLImagesSize(attemptRequest.payload);
        const routedRequest = stableSize !== attemptRequest.payload.size
          ? { ...attemptRequest, payload: { ...attemptRequest.payload, size: stableSize } }
          : attemptRequest;
        if (stableSize !== attemptRequest.payload.size) {
          callbacks.onLog?.(`FHL Images size ${attemptRequest.payload.size} uses stable ${stableSize} for portrait output.`);
        }
        if (shouldPreferResponsesForExactFHLSize(routedRequest.payload)) {
          callbacks.onLog?.(`FHL exact size ${attemptRequest.payload.size} uses Responses API for stable output.`);
          return await requestResponsesOnce(routedRequest, attempt, callbacks);
        }
        return await requestImagesOnce(routedRequest, attempt, callbacks);
      }
      if (apiMode === "apimart") {
        return await requestAPIMartOnce(attemptRequest, attempt, callbacks);
      }
      if (apiMode === "runninghub") {
        return await requestRunningHubOnce(attemptRequest, attempt, callbacks);
      }
      return await requestResponsesOnce(attemptRequest, attempt, callbacks);
    } catch (error) {
      if (callbacks.signal.aborted) throw error;
      const typed = error instanceof RemoteKernelError
        ? error
        : new RemoteKernelError(String((error as any)?.message || error));
      let rawText = "";
      let retryableRaw = false;
      if (typed.rawPath) {
        try {
          rawText = readRegisteredText(typed.rawPath);
          retryableRaw = isRetryableRaw(rawText);
        } catch {
          retryableRaw = false;
        }
      }
      const explained = addFHLEditValidationHint(typed, attemptRequest.payload, rawText);
      lastError = explained;
      if (explained !== typed) throw explained;
      const rateLimited = isRateLimitOrConcurrencyError(typed, rawText);
      const retryable = retryableRaw
        || isTransportishError(typed)
        || isNoFinalImageError(typed)
        || isTransientGenerationFailureText(typed.message, rawText);
      const maxAttemptsForError = rateLimited ? RATE_LIMIT_MAX_ATTEMPTS : MAX_ATTEMPTS;
      if (attempt < maxAttemptsForError && retryable) {
        const retryDelayMs = retryDelayForAttempt(attempt, request, rateLimited);
        callbacks.onLog?.(typed.message);
        callbacks.onLog?.(retryHintForAttempt(attempt, request));
        callbacks.onLog?.(retryHintForDelay(retryDelayMs, rateLimited));
        await sleepWithSignal(callbacks.signal, retryDelayMs);
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
  ), "prompt optimization", true);
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
  ), "reverse prompt", true);
}

async function requestPromptTextRemote(
  input: RemotePromptOptimizeInput | RemotePromptReverseInput,
  signal: AbortSignal,
  buildPayload: (sourceDataURLs: string[]) => Record<string, unknown>,
  resultLabel: string,
  streamResponse: boolean,
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
    if (dataURL) {
      sourceDataURLs.push(resultLabel === "reverse prompt" || resultLabel === "prompt optimization"
        ? await compressSourceDataURLForUpload(dataURL, mergedSources.length)
        : dataURL);
    }
  }
  if (resultLabel === "reverse prompt" && sourceDataURLs.length === 0) {
    throw new RemoteKernelError("请先导入一张反推图片，或先生成/选择一张当前图片");
  }
  const url = `${normalizeBaseURL(input.baseURL)}/v1/responses`;
  const apiKey = normalizeAPIKeyForHeader(input.apiKey);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: streamResponse ? "text/event-stream, application/json" : "application/json, text/event-stream",
  };
  const body = JSON.stringify({
    ...buildPayload(sourceDataURLs),
    stream: streamResponse,
  });
  const proxyMode = input.proxyMode === "none" || input.proxyMode === "custom" ? input.proxyMode : "system";
  const response = shouldUseAndroidNativeHTTP()
    ? await nativeHttpRequestText(url, "POST", headers, body, signal, undefined, {
        proxyMode,
        proxyURL: input.proxyURL || "",
      })
    : {
        status: 0,
        body: "",
      };
  const raw = shouldUseAndroidNativeHTTP()
    ? response.body
    : await (async () => {
        if (proxyMode !== "system") {
          throw new RemoteKernelError("当前远程内核不能控制代理，请切回本地内核或使用 Android 原生运行");
        }
        const webResponse = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal,
        });
        const text = await webResponse.text();
        response.status = webResponse.status;
        return text;
      })();
  const rawPath = registerRawText(resultLabel === "reverse prompt" ? "reverse" : "optimize", 1, raw);
  if (response.status < 200 || response.status >= 300) {
    const reason = extractResponseErrorMessage(raw) || describeProblem(raw);
    throw new RemoteKernelError(`上游返回 ${response.status}:${reason}`, rawPath);
  }
  const text = extractResponseText(raw);
  if (!text) {
    throw new RemoteKernelError(emptyPromptTextResultMessage(resultLabel, raw), rawPath);
  }
  return text;
}

export {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
};
