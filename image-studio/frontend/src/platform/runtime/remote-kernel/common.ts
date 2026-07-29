import {
  readVirtualText,
  registerVirtualText,
  sourceToDataURL,
} from "../../../lib/virtualHostStore.ts";
import { blobToBase64, dataURLFromBase64 } from "../../../lib/images.ts";
import { validateAPIKeyForHeader } from "../../../lib/apiKey.ts";
import { ProviderPolicy } from "../../../lib/providerPolicy.ts";
import { hasAndroidInvokeBridge } from "../../android/nativeInvoke.ts";
import {
  describeProblem as describeSharedProblem,
  isRetryableRaw as isRetryableRawShared,
  normalizeAPIMode as normalizeSharedAPIMode,
  normalizeBaseURL as normalizeSharedBaseURL,
  normalizeImageModel as normalizeSharedImageModel,
  repairSizeForOpenAI,
  normalizeTextModel as normalizeSharedTextModel,
} from "../../../../../../shared/kernel/requestModel.js";
import type { KernelImageSource, RemoteGeneratePayload } from "./types.ts";

const FHL_BASE_URL = ProviderPolicy.fhl.baseURL;
const FHL_LOCAL_PROXY_PREFIX = "/__image-studio-fhl";
const APIMART_BASE_URL = ProviderPolicy.apimart.baseURL;
const APIMART_LEGACY_BASE_URL = ProviderPolicy.apimart.legacyBaseURL;
const APIMART_LOCAL_PROXY_PREFIX = "/__image-studio-apimart";
const APIMART_LEGACY_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-legacy";
const SINGLE_SOURCE_UPLOAD_COMPRESS_THRESHOLD = 2.5 * 1024 * 1024;
const MULTI_SOURCE_UPLOAD_COMPRESS_THRESHOLD = 512 * 1024;
const UPLOAD_COPY_JPEG_QUALITY = 0.82;
const FHL_IMAGES_SAFE_EXACT_SIZES = new Set([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1536x864",
  "864x1536",
]);
const FHL_IMAGES_STABLE_SIZE_OVERRIDES = new Map<string, string>([
  ["2048x1360", "1536x1024"],
  ["3456x2304", "1536x1024"],
  ["1360x2048", "1024x1536"],
  ["2304x3456", "1024x1536"],
  ["2048x1152", "1536x864"],
  ["3840x2160", "1536x864"],
  ["1152x2048", "864x1536"],
  ["2160x3840", "864x1536"],
]);

export function isGPTImage2Model(modelID: string | undefined): boolean {
  return normalizeSharedImageModel(modelID || "").toLowerCase().startsWith(ProviderPolicy.fhl.imageModelID);
}

type LoadedUploadImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function nowSeconds(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function fileNameFromPath(path: string | undefined): string {
  if (!path) return "image.png";
  return path.split(/[\\/]/).pop() || "image.png";
}

export async function resolveSourceDataURLs(
  sourceImages: KernelImageSource[] | undefined,
  payload: RemoteGeneratePayload,
): Promise<string[]> {
  const ordered: KernelImageSource[] = sourceImages?.length
    ? sourceImages
    : payload.imagePaths.map((path) => ({ path, name: fileNameFromPath(path) }));
  const out: string[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const source = ordered[index];
    const dataURL = await sourceToDataURL(source);
    if (!dataURL) continue;
    out.push(index === 0 && source.preparedBase === true
      ? dataURL
      : await compressSourceDataURLForUpload(dataURL, ordered.length));
  }
  return out;
}

function estimateDataURLBytes(dataURL: string): number {
  const comma = dataURL.indexOf(",");
  if (comma < 0) return dataURL.length;
  const clean = dataURL.slice(comma + 1).replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

function parseDataURL(dataURL: string): { mimeType: string; payload: string } | null {
  const comma = dataURL.indexOf(",");
  if (comma < 0) return null;
  const meta = dataURL.slice(0, comma).toLowerCase();
  if (!meta.startsWith("data:") || !meta.includes(";base64")) return null;
  const mimeType = dataURL.slice(5, dataURL.indexOf(";")).trim() || "image/png";
  return { mimeType, payload: dataURL.slice(comma + 1) };
}

function dataURLToBlob(dataURL: string): Blob | null {
  const parsed = parseDataURL(dataURL);
  if (!parsed) return null;
  const bin = atob(parsed.payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: parsed.mimeType });
}

async function loadUploadImage(blob: Blob): Promise<LoadedUploadImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image decoding is unavailable");
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to decode source image"));
      el.src = url;
    });
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function uploadMaxLongSide(sourceCount: number): number {
  if (sourceCount >= 3) return 1024;
  if (sourceCount >= 2) return 1280;
  return 1600;
}

function shouldCompressUploadCopy(dataURL: string, sourceCount: number): boolean {
  const bytes = estimateDataURLBytes(dataURL);
  if (sourceCount >= 2) return bytes >= MULTI_SOURCE_UPLOAD_COMPRESS_THRESHOLD;
  return bytes >= SINGLE_SOURCE_UPLOAD_COMPRESS_THRESHOLD;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
      return;
    }
    try {
      const dataURL = canvas.toDataURL(mimeType, quality);
      resolve(dataURLToBlob(dataURL));
    } catch {
      resolve(null);
    }
  });
}

export async function compressSourceDataURLForUpload(dataURL: string, sourceCount: number): Promise<string> {
  if (!shouldCompressUploadCopy(dataURL, sourceCount)) return dataURL;
  if (typeof document === "undefined" || typeof document.createElement !== "function") return dataURL;

  const blob = dataURLToBlob(dataURL);
  if (!blob) return dataURL;

  let loaded: LoadedUploadImage | null = null;
  try {
    loaded = await loadUploadImage(blob);
    if (!loaded.width || !loaded.height) return dataURL;

    const maxLongSide = uploadMaxLongSide(sourceCount);
    const scale = Math.min(1, maxLongSide / Math.max(loaded.width, loaded.height));
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataURL;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(loaded.image, 0, 0, width, height);

    const uploadBlob = await canvasToBlob(canvas, "image/jpeg", UPLOAD_COPY_JPEG_QUALITY);
    if (!uploadBlob) return dataURL;
    const compressed = dataURLFromBase64(await blobToBase64(uploadBlob), "image/jpeg");
    if (compressed.length >= dataURL.length && scale >= 1) return dataURL;
    return compressed;
  } catch {
    return dataURL;
  } finally {
    loaded?.close?.();
  }
}

export function normalizeBaseURL(raw: string): string {
  const normalizedRaw = normalizeSharedBaseURL(raw);
  const normalized = normalizedRaw.replace(/(\/v1)+$/i, "");
  if (isLocalPreviewHost() && normalized === FHL_BASE_URL) {
    return `${window.location.origin}${FHL_LOCAL_PROXY_PREFIX}`;
  }
  if (isLocalPreviewHost() && normalized === APIMART_BASE_URL) {
    return `${window.location.origin}${APIMART_LOCAL_PROXY_PREFIX}`;
  }
  if (isLocalPreviewHost() && normalized === APIMART_LEGACY_BASE_URL) {
    return `${window.location.origin}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  return normalized;
}

function normalizeBaseURLForRouting(raw: string): string {
  return normalizeSharedBaseURL(raw).replace(/(\/v1)+$/i, "");
}

function normalizeExactSizeForRouting(size: string): string {
  const trimmed = String(size || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "auto" || !/^\d+x\d+$/i.test(trimmed)) return "";
  return repairSizeForOpenAI({ size: trimmed })?.size || trimmed;
}

export function shouldPreferResponsesForExactFHLSize(
  payload: Pick<RemoteGeneratePayload, "apiMode" | "baseURL" | "size" | "imageModelID">,
): boolean {
  if (normalizeSharedAPIMode(payload.apiMode) !== "images") return false;
  if (normalizeBaseURLForRouting(payload.baseURL) !== FHL_BASE_URL) return false;
  if (isGPTImage2Model(payload.imageModelID)) return false;
  const exactSize = normalizeExactSizeForRouting(payload.size);
  if (!exactSize) return false;
  if (FHL_IMAGES_STABLE_SIZE_OVERRIDES.has(exactSize)) return false;
  return !FHL_IMAGES_SAFE_EXACT_SIZES.has(exactSize);
}

export function stableFHLImagesSize(
  payload: Pick<RemoteGeneratePayload, "apiMode" | "baseURL" | "size" | "imageModelID">,
): string {
  if (normalizeSharedAPIMode(payload.apiMode) !== "images") return payload.size;
  if (normalizeBaseURLForRouting(payload.baseURL) !== FHL_BASE_URL) return payload.size;
  if (isGPTImage2Model(payload.imageModelID)) return payload.size;
  const exactSize = normalizeExactSizeForRouting(payload.size);
  if (!exactSize) return payload.size;
  return FHL_IMAGES_STABLE_SIZE_OVERRIDES.get(exactSize) || exactSize;
}

export function normalizeAPIMode(apiMode: string): "responses" | "images" | "apimart" | "runninghub" {
  if (String(apiMode || "").trim() === "runninghub") return "runninghub";
  return normalizeSharedAPIMode(apiMode);
}

export function normalizeTextModel(modelID: string): string {
  return normalizeSharedTextModel(modelID);
}

export function normalizeImageModel(modelID: string): string {
  return normalizeSharedImageModel(modelID);
}

export function normalizeAPIKeyForHeader(apiKey: string): string {
  return validateAPIKeyForHeader(apiKey);
}

export function shouldUseAndroidNativeHTTP(): boolean {
  return typeof window !== "undefined" && hasAndroidInvokeBridge();
}

export const describeProblem = describeSharedProblem;
export const isRetryableRaw = isRetryableRawShared;

const TRANSIENT_FAILURE_RE = /\b(?:429|502|503|504|524)\b|rate[_ -]?limit|too many requests|concurrency limit|timeout|timed out|gateway|network(?:error| error)?|failed to fetch|load failed|connection reset|econnreset|econnrefused|cloudflare|busy|overloaded|service unavailable|no available compatible accounts|no final image|no image|no result|账号池.*繁忙|稍后重试|自动重试|超时|耗时|排队|未返回|没有返回|最终图缺失|终图缺失|璐﹀彿姹爘绻佸繖|绋嶅悗閲嶈瘯|鑷姩閲嶈瘯|瓒呮椂|鑰楁椂|鎺掗槦|鏈繑鍥瀨娌℃湁杩斿洖|鏈€缁堝浘缂哄け|缁堝浘缂哄け/i;
const CONFIG_FAILURE_RE = /\b(?:400|401|403|404)\b|unauthorized|forbidden|permission|not enabled for this group|invalid api key|api key.*invalid|invalid key|insufficient|balance|quota|billing|model_not_found|model not found|not found|unsupported|bad request|invalid_request|invalid parameter|validation|aborterror|aborted|user cancelled|用户取消|取消任务|api key|密钥|权限|余额|模型不存在|参数错误|校验|鐢ㄦ埛鍙栨秷|鍙栨秷浠诲姟|api key|瀵嗛挜|鏉冮檺|浣欓|妯″瀷涓嶅瓨鍦▅鍙傛暟閿欒|鏍￠獙/i;

export function isConfigurationFailureText(...parts: Array<unknown>): boolean {
  const text = parts.map((part) => String(part || "")).join("\n");
  return CONFIG_FAILURE_RE.test(text) && !/rate[_ -]?limit|too many requests|concurrency limit/i.test(text);
}

export function isTransientGenerationFailureText(...parts: Array<unknown>): boolean {
  const text = parts.map((part) => String(part || "")).join("\n");
  if (!text.trim()) return false;
  if (isConfigurationFailureText(text)) return false;
  return TRANSIENT_FAILURE_RE.test(text);
}

export function isTransportishError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return [
    "timeout",
    "networkerror",
    "network error",
    "failed to fetch",
    "load failed",
    "i/o timeout",
    "connection reset",
    "connection attempt failed",
    "connectex",
    "dial tcp",
    "econnreset",
    "econnrefused",
    "gateway",
    "host has failed to respond",
    "tls handshake timeout",
  ].some((marker) => message.includes(marker));
}

export async function sleepWithSignal(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function registerRawText(kind: "responses" | "images" | "apimart" | "runninghub" | "optimize" | "reverse", attempt: number, raw: string): string | null {
  if (!raw.trim()) return null;
  const ext = kind === "responses" ? "txt" : "json";
  return registerVirtualText(raw, `${kind}-response-attempt${attempt}.${ext}`);
}

export function readRegisteredText(path: string): string {
  return readVirtualText(path);
}

function promptTextCandidate(value: unknown, depth = 0): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const child of value) {
      const text = promptTextCandidate(child, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (!value || typeof value !== "object" || depth > 2) return "";
  const record = value as Record<string, unknown>;
  return promptTextCandidate(record.value, depth + 1)
    || promptTextCandidate(record.text, depth + 1)
    || promptTextCandidate(record.content, depth + 1)
    || promptTextCandidate(record.parts, depth + 1);
}

function extractResponseTextValue(value: any): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const child of value) {
      const text = extractResponseTextValue(child);
      if (text) return text;
    }
    return "";
  }

  const direct = promptTextCandidate(value.output_text);
  if (direct) return direct;

  const type = String(value.type || "");
  const genericText = promptTextCandidate(value.text) || promptTextCandidate(value.value);
  if (genericText) {
    return genericText;
  }

  if (type === "output_text" || type === "text" || type === "refusal") {
    const text = promptTextCandidate(value.text)
      || promptTextCandidate(value.content)
      || promptTextCandidate(value.value)
      || promptTextCandidate(value.refusal);
    if (text) return text;
  }

  if (value.response) {
    const text = extractResponseTextValue(value.response);
    if (text) return text;
  }
  if (value.item) {
    const text = extractResponseTextValue(value.item);
    if (text) return text;
  }
  if (value.message) {
    const text = extractResponseTextValue(value.message) || promptTextCandidate(value.message);
    if (text) return text;
  }

  for (const key of ["output", "outputs", "messages", "data", "items", "parts", "summary", "candidates"]) {
    if (!value[key]) continue;
    const text = extractResponseTextValue(value[key]);
    if (text) return text;
  }

  if (value.content) {
    const text = extractResponseTextValue(value.content);
    if (text) return text;
    if ((value.role === "assistant" || type === "message") && promptTextCandidate(value.content)) {
      return promptTextCandidate(value.content);
    }
  }

  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      const text = extractResponseTextValue(choice?.message)
        || extractResponseTextValue(choice?.delta)
        || promptTextCandidate(choice?.text);
      if (text) return text;
    }
  }

  return "";
}

function extractResponseTextDelta(value: any): string {
  if (!value || typeof value !== "object") return "";
  const type = String(value.type || "");
  if (type === "response.output_text.delta" || type === "output_text.delta") {
    return typeof value.delta === "string" ? value.delta : "";
  }
  if (Array.isArray(value.choices)) {
    return value.choices
      .map((choice: any) => promptTextCandidate(choice?.delta?.content) || promptTextCandidate(choice?.text))
      .join("");
  }
  return "";
}

function parseResponseEventPayload(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === "[DONE]" || !data.startsWith("{")) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function extractResponseText(raw: string): string {
  try {
    const parsed: any = JSON.parse(raw);
    const text = extractResponseTextValue(parsed);
    if (text) return text;
  } catch {
    // Fall through to SSE / line-delimited JSON parsing.
  }

  const deltas: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const event = parseResponseEventPayload(line);
    if (!event) continue;
    const text = extractResponseTextValue(event);
    if (text) return text;
    const delta = extractResponseTextDelta(event);
    if (delta) deltas.push(delta);
  }

  return deltas.join("").trim();
}

export function extractResponseErrorMessage(raw: string): string {
  try {
    const parsed: any = JSON.parse(raw);
    if (typeof parsed?.error?.message === "string" && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed?.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // ignore
  }
  return raw.trim();
}

export { sourceToDataURL };
