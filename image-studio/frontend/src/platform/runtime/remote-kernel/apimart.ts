import { blobToBase64, dataURLFromBase64, imageExtensionForMimeType } from "../../../lib/images.ts";
import { ProviderPolicy } from "../../../lib/providerPolicy.ts";
import {
  isTransportishError,
  normalizeAPIKeyForHeader,
  normalizeBaseURL,
  normalizeImageModel,
  nowSeconds,
  registerRawText,
  resolveSourceDataURLs,
  sleepWithSignal,
} from "./common.ts";
import {
  MAX_ATTEMPTS,
  RemoteKernelError,
  STATUS_INTERVAL_MS,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

const APIMART_DEFAULT_MODEL = ProviderPolicy.apimart.imageModelID;
const APIMART_SUBMIT_TIMEOUT_MS = 240_000;
const APIMART_TASK_TIMEOUT_MS = 1_800_000;
const APIMART_TASK_POLL_TIMEOUT_MS = 60_000;
const APIMART_IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const APIMART_POLL_INTERVAL_MS = 3_000;
const APIMART_UPLOAD_TIMEOUT_MS = 120_000;
const APIMART_UPLOAD_RETRY_DELAY_MS = 1_200;
const APIMART_UPLOAD_RETRY_MAX_LONG_SIDE = 1024;
const APIMART_UPLOAD_RETRY_JPEG_QUALITY = 0.78;
const APIMART_OFFICIAL_BASE_URL = ProviderPolicy.apimart.baseURL;
const APIMART_LEGACY_BASE_URL = ProviderPolicy.apimart.legacyBaseURL;
const APIMART_LOCAL_PROXY_PREFIX = "/__image-studio-apimart";
const APIMART_LEGACY_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-legacy";
const APIMART_IMAGE_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-image";
const APIMART_SUPPORTED_ASPECTS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
  "21:9",
  "9:21",
] as const;
const APIMART_ASPECT_SET = new Set<string>(APIMART_SUPPORTED_ASPECTS);

const SIZE_TO_ASPECT: Record<string, string> = {
  auto: "auto",
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  "1536x1152": "4:3",
  "1152x1536": "3:4",
  "1520x1216": "5:4",
  "1216x1520": "4:5",
  "1536x864": "16:9",
  "864x1536": "9:16",
  "1536x768": "2:1",
  "768x1536": "1:2",
  "1536x512": "3:1",
  "512x1536": "1:3",
  "2048x2048": "1:1",
  "2048x1360": "3:2",
  "1360x2048": "2:3",
  "2048x1536": "4:3",
  "1536x2048": "3:4",
  "2040x1632": "5:4",
  "1632x2040": "4:5",
  "2048x1152": "16:9",
  "1152x2048": "9:16",
  "2048x1024": "2:1",
  "1024x2048": "1:2",
  "2040x680": "3:1",
  "680x2040": "1:3",
  "2880x2880": "1:1",
  "3456x2304": "3:2",
  "2304x3456": "2:3",
  "3840x2880": "4:3",
  "2880x3840": "3:4",
  "3840x3072": "5:4",
  "3072x3840": "4:5",
  "3840x2160": "16:9",
  "2160x3840": "9:16",
  "3840x1920": "2:1",
  "1920x3840": "1:2",
  "3840x1280": "3:1",
  "1280x3840": "1:3",
};

const SIZE_TO_RESOLUTION: Record<string, "1k" | "2k" | "4k"> = {
  "1024x1024": "1k",
  "1536x1024": "1k",
  "1024x1536": "1k",
  "1536x1152": "1k",
  "1152x1536": "1k",
  "1520x1216": "1k",
  "1216x1520": "1k",
  "1536x864": "1k",
  "864x1536": "1k",
  "1536x768": "1k",
  "768x1536": "1k",
  "1536x512": "1k",
  "512x1536": "1k",
  "2048x2048": "2k",
  "2048x1360": "2k",
  "1360x2048": "2k",
  "2048x1536": "2k",
  "1536x2048": "2k",
  "2040x1632": "2k",
  "1632x2040": "2k",
  "2048x1152": "2k",
  "1152x2048": "2k",
  "2048x1024": "2k",
  "1024x2048": "2k",
  "2040x680": "2k",
  "680x2040": "2k",
  "2880x2880": "4k",
  "3456x2304": "4k",
  "2304x3456": "4k",
  "3840x2880": "4k",
  "2880x3840": "4k",
  "3840x3072": "4k",
  "3072x3840": "4k",
  "3840x2160": "4k",
  "2160x3840": "4k",
  "3840x1920": "4k",
  "1920x3840": "4k",
  "3840x1280": "4k",
  "1280x3840": "4k",
};

const SUCCESS_STATUSES = new Set(["success", "succeed", "succeeded", "completed", "complete", "done", "finished", "ok"]);
const FAILURE_STATUSES = new Set(["failed", "fail", "error", "cancelled", "canceled", "rejected"]);

type LoadedAPIMartUploadImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function dataURLParts(dataURL: string): { mimeType: string; payload: string } | null {
  const comma = dataURL.indexOf(",");
  if (comma < 0) return null;
  const meta = dataURL.slice(0, comma);
  if (!/^data:image\/[^;]+;base64/i.test(meta)) return null;
  const semi = meta.indexOf(";");
  return {
    mimeType: meta.slice(5, semi > 0 ? semi : undefined) || "image/png",
    payload: dataURL.slice(comma + 1),
  };
}

function dataURLToBlob(dataURL: string): { blob: Blob; mimeType: string } {
  const parsed = dataURLParts(dataURL);
  if (!parsed) throw new RemoteKernelError("APIMart 图生图上传失败：源图不是有效 data URL");
  return {
    blob: new Blob([Uint8Array.from(atob(parsed.payload), (ch) => ch.charCodeAt(0))], { type: parsed.mimeType }),
    mimeType: parsed.mimeType,
  };
}

async function loadAPIMartUploadImage(blob: Blob): Promise<LoadedAPIMartUploadImage> {
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

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
      return;
    }
    try {
      const dataURL = canvas.toDataURL(mimeType, quality);
      resolve(dataURLToBlob(dataURL).blob);
    } catch {
      resolve(null);
    }
  });
}

async function compressAPIMartUploadRetryDataURL(dataURL: string): Promise<{ dataURL: string; compressed: boolean }> {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return { dataURL, compressed: false };
  }

  const { blob } = dataURLToBlob(dataURL);
  let loaded: LoadedAPIMartUploadImage | null = null;
  try {
    loaded = await loadAPIMartUploadImage(blob);
    if (!loaded.width || !loaded.height) return { dataURL, compressed: false };

    const scale = Math.min(1, APIMART_UPLOAD_RETRY_MAX_LONG_SIDE / Math.max(loaded.width, loaded.height));
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataURL, compressed: false };

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(loaded.image, 0, 0, width, height);

    const retryBlob = await canvasToBlob(canvas, "image/jpeg", APIMART_UPLOAD_RETRY_JPEG_QUALITY);
    if (!retryBlob) return { dataURL, compressed: false };
    return {
      dataURL: dataURLFromBase64(await blobToBase64(retryBlob), "image/jpeg"),
      compressed: true,
    };
  } catch {
    return { dataURL, compressed: false };
  } finally {
    loaded?.close?.();
  }
}

function isRetryableAPIMartUploadError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return isTransportishError(error)
    || /\b5\d\d\b/.test(message)
    || /\b413\b/.test(message)
    || message.includes("file too large")
    || message.includes("exceeds maximum")
    || message.includes("server_error")
    || message.includes("service_unavailable")
    || message.includes("bad_gateway")
    || message.includes("failed to upload image");
}

function conciseUploadError(error: unknown): string {
  return String((error as any)?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 220);
}

function isRetryableAPIMartSubmitError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return isTransportishError(error)
    || /\b50[0-4]\b/.test(message)
    || message.includes("bad gateway")
    || message.includes("gateway timeout")
    || message.includes("proxy")
    || message.includes("upstream");
}

function fallbackAPIMartBaseURL(baseURL: string): string {
  const normalized = String(baseURL || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
  if (normalized === APIMART_OFFICIAL_BASE_URL) return APIMART_LEGACY_BASE_URL;
  const proxyIndex = normalized.indexOf(APIMART_LOCAL_PROXY_PREFIX);
  if (proxyIndex >= 0) {
    return `${normalized.slice(0, proxyIndex)}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  return "";
}

function withTimeoutSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" && !parent.aborted) {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, timeout]);
  }
  return parent;
}

function parseAPIMartSize(size: string): { aspect: string; resolution: "1k" | "2k" | "4k" | "" } | null {
  const normalized = String(size || "").trim().toLowerCase();
  const match = normalized.match(/^(\d+:\d+|auto)(?:@(1k|2k|4k))?$/);
  if (!match || !APIMART_ASPECT_SET.has(match[1])) return null;
  return {
    aspect: match[1],
    resolution: (match[2] as "1k" | "2k" | "4k" | undefined) ?? "",
  };
}

function nearestAPIMartAspectForPixels(size: string): string {
  const match = String(size || "").trim().toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  const ratio = width / height;
  let best = "1:1";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const aspect of APIMART_SUPPORTED_ASPECTS) {
    if (aspect === "auto") continue;
    const [w, h] = aspect.split(":").map(Number);
    const diff = Math.abs(Math.log(ratio) - Math.log(w / h));
    if (diff < bestDiff) {
      best = aspect;
      bestDiff = diff;
    }
  }
  return best;
}

function aspectForSize(size: string): string {
  const normalized = String(size || "").trim().toLowerCase();
  const parsed = parseAPIMartSize(normalized);
  if (parsed) return parsed.aspect;
  return SIZE_TO_ASPECT[normalized] || nearestAPIMartAspectForPixels(normalized) || "1:1";
}

function resolutionForSize(size: string): "1k" | "2k" | "4k" {
  const normalized = String(size || "").trim().toLowerCase();
  const parsed = parseAPIMartSize(normalized);
  if (parsed?.resolution) return parsed.resolution;
  return SIZE_TO_RESOLUTION[normalized] || "1k";
}

function normalizeAPIMartModel(modelID: string): string {
  return normalizeImageModel(modelID) || APIMART_DEFAULT_MODEL;
}

function normalizeAPIMartResolution(resolution: "1k" | "2k" | "4k", model: string): string {
  return model.toLowerCase().includes("gemini") ? resolution.toUpperCase() : resolution;
}

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function downloadURLForImageResult(value: string): string {
  if (!/^https?:\/\//i.test(value) || !isLocalPreviewHost()) return value;
  return `${window.location.origin}${APIMART_IMAGE_LOCAL_PROXY_PREFIX}/download?url=${encodeURIComponent(value)}`;
}

function apimartEndpoint(baseURL: string, path: string): string {
  const root = baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function statusFromPayload(payload: any): string {
  return String(payload?.status ?? payload?.data?.status ?? payload?.state ?? payload?.data?.state ?? "").trim().toLowerCase();
}

function collectImageValues(value: unknown, out: string[], key?: string, depth = 0) {
  if (depth > 8) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed
      && (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed))
      && (!key || /url|image|output|src|uri|file/i.test(key))
    ) {
      out.push(trimmed);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child) => collectImageValues(child, out, key, depth + 1));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    collectImageValues(childValue, out, childKey || key, depth + 1);
  }
}

function resultImagesFromPayload(payload: unknown): string[] {
  const out: string[] = [];
  collectImageValues(payload, out);
  return Array.from(new Set(out));
}

function extractTaskId(value: unknown, depth = 0): string {
  if (!value || typeof value !== "object" || depth > 8) return "";
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "task_id" || key === "taskId") && typeof child === "string" && child.trim()) {
      return child.trim();
    }
    if (key === "id" && typeof child === "string" && /^task(?:[_-]|$)/i.test(child.trim())) {
      return child.trim();
    }
    const nested = extractTaskId(child, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function firstErrorMessage(value: unknown, key?: string, depth = 0): string {
  if (depth > 8) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && key && /message|msg|error|reason|detail|description/i.test(key) ? trimmed : "";
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const preferred of ["message", "msg", "error_message", "reason", "detail", "description", "error"]) {
    const msg = firstErrorMessage(record[preferred], preferred, depth + 1);
    if (msg) return msg;
  }
  for (const [childKey, childValue] of Object.entries(record)) {
    const msg = firstErrorMessage(childValue, childKey || key, depth + 1);
    if (msg) return msg;
  }
  return "";
}

async function parseJSONResponse(
  response: Response,
  label: string,
  attempt: number,
): Promise<{ rawPath: string | null; data: any }> {
  const raw = await response.text();
  const rawPath = registerRawText("apimart", attempt, raw);
  let data: any = null;
  try {
    data = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    if (!response.ok) throw new RemoteKernelError(`APIMart ${label} 返回 HTTP ${response.status}: ${raw.slice(0, 400)}`, rawPath);
    throw new RemoteKernelError(`APIMart ${label} JSON 解析失败:${(error as any)?.message || error}`, rawPath);
  }
  if (!response.ok) {
    const message = firstErrorMessage(data) || raw.slice(0, 400) || `HTTP ${response.status}`;
    throw new RemoteKernelError(`APIMart ${label} 返回 ${response.status}:${message}`, rawPath);
  }
  if (Number(data?.code) >= 400) {
    throw new RemoteKernelError(`APIMart ${label} 返回错误:${firstErrorMessage(data) || data.code}`, rawPath);
  }
  return { rawPath, data };
}

async function uploadImage(
  baseURL: string,
  apiKey: string,
  dataURL: string,
  index: number,
  attempt: number,
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<string> {
  const logUploaded = () => {
    if (request.payload.mode === "edit") callbacks.onLog?.(`[APIMart] 已上传参考图 ${index + 1}`);
  };
  const sourceCount = request.sourceImages?.length || request.payload.imagePaths.length || 1;
  const sourceLabel = `${index + 1}/${Math.max(1, sourceCount)}`;

  try {
    const { blob, mimeType } = dataURLToBlob(dataURL);
    const form = new FormData();
    form.append("file", blob, `source-${index + 1}.${imageExtensionForMimeType(mimeType)}`);
    callbacks.onProgress?.(`APIMart 上传参考图 ${sourceLabel}（尚未提交生图任务）`, 0, blob.size);
    const response = await fetch(apimartEndpoint(baseURL, "/v1/uploads/images"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: form,
      signal: withTimeoutSignal(callbacks.signal, APIMART_UPLOAD_TIMEOUT_MS),
    });
    const { data } = await parseJSONResponse(response, "上传参考图", attempt);
    const url = resultImagesFromPayload(data)[0] || "";
    if (!url) throw new RemoteKernelError("APIMart 上传参考图失败：响应里没有图片 URL");
    logUploaded();
    return url;
  } catch (error) {
    if (!isRetryableAPIMartUploadError(error)) throw error;
    const retry = await compressAPIMartUploadRetryDataURL(dataURL);
    callbacks.onLog?.(`[APIMart] 参考图 ${index + 1} 上传失败，${retry.compressed ? "已压缩为 JPEG 后" : "准备"}重试一次：${conciseUploadError(error)}`);
    await sleepWithSignal(callbacks.signal, APIMART_UPLOAD_RETRY_DELAY_MS);
    try {
      const { blob, mimeType } = dataURLToBlob(retry.dataURL);
      const form = new FormData();
      form.append("file", blob, `source-${index + 1}.${imageExtensionForMimeType(mimeType)}`);
      callbacks.onProgress?.(`APIMart 上传参考图 ${sourceLabel}（重试，尚未提交生图任务）`, 0, blob.size);
      const response = await fetch(apimartEndpoint(baseURL, "/v1/uploads/images"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        body: form,
        signal: withTimeoutSignal(callbacks.signal, APIMART_UPLOAD_TIMEOUT_MS),
      });
      const { data } = await parseJSONResponse(response, "上传参考图", attempt);
      const url = resultImagesFromPayload(data)[0] || "";
      if (!url) throw new RemoteKernelError("APIMart 上传参考图失败：响应里没有图片 URL");
      callbacks.onLog?.(`[APIMart] 参考图 ${index + 1} 重试上传成功${retry.compressed ? "（JPEG 压缩副本）" : ""}`);
      logUploaded();
      return url;
    } catch (retryError) {
      const rawPath = retryError instanceof RemoteKernelError ? retryError.rawPath : error instanceof RemoteKernelError ? error.rawPath : null;
      const retryAction = retry.compressed ? "已压缩重试仍失败" : "已重试仍失败";
      throw new RemoteKernelError(
        `APIMart 上传参考图失败：上传服务返回异常，${retryAction}，尚未提交 APIMart 生图任务，APIMart 后台不会看到任务。请稍后重试，或换一张小于 20MB 的 JPG/PNG/WebP 参考图。最后错误：${conciseUploadError(retryError)}`,
        rawPath,
      );
    }
  }
}
async function imageResultToBase64(value: string, signal: AbortSignal): Promise<string> {
  if (/^data:image\//i.test(value)) {
    return dataURLParts(value)?.payload.replace(/\s+/g, "") || "";
  }
  const response = await fetch(downloadURLForImageResult(value), {
    signal: withTimeoutSignal(signal, APIMART_IMAGE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RemoteKernelError(`APIMart 图片下载失败 ${response.status}${detail ? `:${detail.slice(0, 220)}` : ""}`);
  }
  return blobToBase64(await response.blob());
}

async function submitTask(
  baseURL: string,
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
  imageURLs: string[],
  attempt: number,
): Promise<{ taskId: string; images: string[]; rawPath: string | null }> {
  const apiKey = normalizeAPIKeyForHeader(request.payload.apiKey);
  const model = normalizeAPIMartModel(request.payload.imageModelID);
  const resolution = resolutionForSize(request.payload.size);
  const body = {
    model,
    prompt: request.payload.prompt,
    n: 1,
    size: aspectForSize(request.payload.size),
    resolution: normalizeAPIMartResolution(resolution, model),
    official_fallback: false,
    image_urls: imageURLs,
  };
  callbacks.onProgress?.("APIMart 提交异步任务", 0, 0);
  callbacks.onLog?.(`[APIMart] 提交异步任务 ${body.size}/${body.resolution}`);
  const response = await fetch(apimartEndpoint(baseURL, "/v1/images/generations"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: withTimeoutSignal(callbacks.signal, APIMART_SUBMIT_TIMEOUT_MS),
  });
  const { data, rawPath } = await parseJSONResponse(response, "提交任务", attempt);
  const images = resultImagesFromPayload(data);
  const taskId = extractTaskId(data);
  if (!taskId && images.length === 0) {
    throw new RemoteKernelError("APIMart 没有返回 task_id 或图片结果", rawPath);
  }
  return { taskId, images, rawPath };
}

async function pollTask(
  baseURL: string,
  apiKey: string,
  taskId: string,
  startedAt: number,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<{ images: string[]; rawPath: string | null }> {
  const deadline = Date.now() + APIMART_TASK_TIMEOUT_MS;
  let rawPath: string | null = null;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await sleepWithSignal(callbacks.signal, APIMART_POLL_INTERVAL_MS);
    const elapsed = nowSeconds(startedAt);
    callbacks.onProgress?.(`APIMart 轮询任务 ${taskId}${lastStatus ? ` (${lastStatus})` : ""}`, elapsed, 0);
    const response = await fetch(apimartEndpoint(baseURL, `/v1/tasks/${encodeURIComponent(taskId)}?language=zh`), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: withTimeoutSignal(callbacks.signal, APIMART_TASK_POLL_TIMEOUT_MS),
    });
    const parsed = await parseJSONResponse(response, "查询任务", attempt);
    rawPath = parsed.rawPath;
    const images = resultImagesFromPayload(parsed.data);
    if (images.length > 0) return { images, rawPath };
    lastStatus = statusFromPayload(parsed.data);
    if (SUCCESS_STATUSES.has(lastStatus)) {
      throw new RemoteKernelError("APIMart 任务完成但没有返回可用图片", rawPath);
    }
    if (FAILURE_STATUSES.has(lastStatus)) {
      throw new RemoteKernelError(firstErrorMessage(parsed.data) || `APIMart 任务失败:${lastStatus}`, rawPath);
    }
  }
  throw new RemoteKernelError(`APIMart 任务超时：${taskId}`, rawPath);
}

export async function requestAPIMartOnce(
  request: RemoteJobRequest,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  const startedAt = Date.now();
  let submittedTaskId = "";
  callbacks.onLog?.(`[APIMart] 第 ${attempt}/${MAX_ATTEMPTS} 次请求...`);
  callbacks.onProgress?.("APIMart 准备异步任务", 0, 0);
  let currentStage = "APIMart 准备异步任务";
  const ticker = globalThis.setInterval(() => {
    callbacks.onProgress?.(currentStage, nowSeconds(startedAt), 0);
  }, STATUS_INTERVAL_MS);

  const throwTrackedError = (error: unknown): never => {
    if (error instanceof RemoteKernelError) {
      if (submittedTaskId && !error.apimartTaskId) error.apimartTaskId = submittedTaskId;
      throw error;
    }
    const wrapped = new RemoteKernelError(String((error as any)?.message || error));
    if (submittedTaskId) wrapped.apimartTaskId = submittedTaskId;
    throw wrapped;
  };

  const runWithBaseURL = async (baseURL: string): Promise<RemoteJobResult> => {
    const apiKey = normalizeAPIKeyForHeader(request.payload.apiKey);
    currentStage = "APIMart 读取参考图";
    callbacks.onProgress?.(currentStage, 0, 0);
    const sourceDataURLs = await resolveSourceDataURLs(request.sourceImages, request.payload);
    if (request.payload.mode === "edit" && sourceDataURLs.length === 0) {
      throw new RemoteKernelError("APIMart 图生图模式需要至少一张源图");
    }
    currentStage = sourceDataURLs.length > 0
      ? `APIMart 准备上传 ${sourceDataURLs.length} 张参考图（尚未提交生图任务）`
      : "APIMart 准备提交异步任务";
    callbacks.onProgress?.(currentStage, nowSeconds(startedAt), 0);
    const imageURLs: string[] = [];
    for (let i = 0; i < sourceDataURLs.length; i += 1) {
      currentStage = `APIMart 上传参考图 ${i + 1}/${sourceDataURLs.length}（尚未提交生图任务）`;
      imageURLs.push(await uploadImage(baseURL, apiKey, sourceDataURLs[i], i, attempt, request, callbacks));
    }
    currentStage = "APIMart 提交异步任务";
    const submitted = await submitTask(baseURL, request, callbacks, imageURLs, attempt);
    submittedTaskId = submitted.taskId || "";
    let images = submitted.images;
    let rawPath = submitted.rawPath;
    if (images.length === 0 && submitted.taskId) {
      currentStage = `APIMart 已提交任务 ${submitted.taskId}，等待结果`;
      const polled = await pollTask(baseURL, apiKey, submitted.taskId, startedAt, attempt, callbacks);
      images = polled.images;
      rawPath = polled.rawPath ?? rawPath;
    }
    const first = images[0] || "";
    if (!first) throw new RemoteKernelError("APIMart 没有返回可用图片", rawPath);
    const imageB64 = await imageResultToBase64(first, callbacks.signal);
    if (!imageB64) throw new RemoteKernelError("APIMart 图片结果为空", rawPath);
    return {
      imageB64,
      revisedPrompt: "",
      sourceEvent: "apimart_async",
      rawPath,
      prompt: request.payload.prompt,
      mode: request.payload.mode,
      apimartTaskId: submittedTaskId || undefined,
    };
  };

  try {
    const baseURL = normalizeBaseURL(request.payload.baseURL);
    try {
      return await runWithBaseURL(baseURL);
    } catch (error) {
      const fallbackBaseURL = !submittedTaskId && isRetryableAPIMartSubmitError(error)
        ? fallbackAPIMartBaseURL(baseURL)
        : "";
      if (!fallbackBaseURL) throw error;
      currentStage = "APIMart 官方域名连接失败，切换备用域名重试";
      callbacks.onProgress?.(currentStage, nowSeconds(startedAt), 0);
      callbacks.onLog?.(`[APIMart] 官方域名连接失败，改用备用域名重试一次：${conciseUploadError(error)}`);
      return await runWithBaseURL(fallbackBaseURL);
    }
  } catch (error) {
    return throwTrackedError(error);
  } finally {
    globalThis.clearInterval(ticker);
  }
}
