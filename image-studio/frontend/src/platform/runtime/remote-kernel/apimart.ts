import { blobToBase64, imageExtensionForMimeType } from "../../../lib/images.ts";
import { promptWithBatchVariation } from "../../../../../../shared/kernel/requestModel.js";
import {
  isTransportishError,
  normalizeAPIKeyForHeader,
  normalizeBaseURL,
  normalizeImageModel,
  nowSeconds,
  registerRawText,
  resolveSourceDataURLs,
  shouldUseAndroidNativeHTTP,
  sleepWithSignal,
} from "./common.ts";
import { nativeHttpRequestBase64, nativeHttpRequestText } from "./nativeHttp.ts";
import { runtimeClearInterval, runtimeSetInterval } from "../../../lib/runtimeCompat.ts";
import {
  MAX_ATTEMPTS,
  RemoteKernelError,
  STATUS_INTERVAL_MS,
  type RemoteAPIMartTaskQueryInput,
  type RemoteAPIMartTaskQueryResult,
  type RemoteJobCallbacks,
  type RemoteJobRequest,
  type RemoteJobResult,
} from "./types.ts";

const APIMART_DEFAULT_MODEL = "gpt-image-2";
const APIMART_OFFICIAL_BASE_URL = "https://api.apimart.ai";
const APIMART_LEGACY_BASE_URL = "https://api.apib.ai";
const APIMART_SUBMIT_TIMEOUT_MS = 240_000;
const APIMART_UPLOAD_TIMEOUT_MS = 120_000;
const APIMART_POLL_TIMEOUT_MS = 60_000;
const APIMART_TASK_TIMEOUT_MS = 1_800_000;
const APIMART_IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const APIMART_POLL_INTERVAL_MS = 3_000;
const APIMART_UPLOAD_RETRY_DELAY_MS = 1_200;
const APIMART_UPLOAD_RETRY_MAX_LONG_SIDE = 1024;
const APIMART_UPLOAD_RETRY_JPEG_QUALITY = 0.78;

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

type LoadedUploadImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function withTimeoutSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" && !parent.aborted) {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, timeout]);
  }
  return parent;
}

function apimartEndpoint(baseURL: string, path: string): string {
  const root = baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function comparableBaseURL(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function apimartBaseURLCandidates(baseURL: string): string[] {
  const normalized = baseURL.replace(/\/+$/, "").replace(/\/v1$/i, "");
  if (comparableBaseURL(normalized) !== comparableBaseURL(APIMART_OFFICIAL_BASE_URL)) {
    return [normalized];
  }
  return [APIMART_OFFICIAL_BASE_URL, APIMART_LEGACY_BASE_URL];
}

function isAPIMartNetworkFallbackError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return isTransportishError(error)
    || message.includes("failed to connect")
    || message.includes("connect timed out")
    || message.includes("sockettimeoutexception")
    || message.includes("network is unreachable")
    || message.includes("no route to host");
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
  if (!parsed) throw new RemoteKernelError("APIMart 图生图上传失败：源图不是有效图片 data URL");
  const bytes = Uint8Array.from(atob(parsed.payload), (ch) => ch.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: parsed.mimeType }),
    mimeType: parsed.mimeType,
  };
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
    throw new Error("当前环境不能解码参考图");
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("参考图解码失败"));
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
      resolve(dataURLToBlob(canvas.toDataURL(mimeType, quality)).blob);
    } catch {
      resolve(null);
    }
  });
}

async function compressUploadRetryDataURL(dataURL: string): Promise<{ dataURL: string; compressed: boolean }> {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return { dataURL, compressed: false };
  }

  const { blob } = dataURLToBlob(dataURL);
  let loaded: LoadedUploadImage | null = null;
  try {
    loaded = await loadUploadImage(blob);
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
      dataURL: `data:image/jpeg;base64,${await blobToBase64(retryBlob)}`,
      compressed: true,
    };
  } catch {
    return { dataURL, compressed: false };
  } finally {
    loaded?.close?.();
  }
}

function isRetryableUploadError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return isTransportishError(error)
    || /\b5\d\d\b/.test(message)
    || /\b413\b/.test(message)
    || message.includes("file too large")
    || message.includes("exceeds maximum")
    || message.includes("failed to upload image");
}

function conciseError(error: unknown): string {
  return String((error as any)?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function requestText(
  request: RemoteJobRequest,
  parentSignal: AbortSignal,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit | null | undefined,
  timeoutMs: number,
): Promise<{ status: number; raw: string; contentType: string }> {
  const signal = withTimeoutSignal(parentSignal, timeoutMs);
  const proxyMode = request.payload.proxyMode === "none" || request.payload.proxyMode === "custom"
    ? request.payload.proxyMode
    : "system";
  const proxyConfig = { proxyMode, proxyURL: request.payload.proxyURL || "" };
  if (shouldUseAndroidNativeHTTP()) {
    const response = await nativeHttpRequestText(url, method, headers, body, signal, undefined, proxyConfig);
    return {
      status: response.status,
      raw: response.body || "",
      contentType: response.contentType || "",
    };
  }
  if (proxyMode !== "system") {
    throw new RemoteKernelError("当前远程内核不能控制代理，请使用 Android 原生运行。");
  }
  const response = await fetch(url, { method, headers, body, signal });
  return {
    status: response.status,
    raw: await response.text(),
    contentType: response.headers.get("content-type") || "",
  };
}

async function parseJSONResponse(
  raw: string,
  status: number,
  label: string,
  attempt: number,
): Promise<{ rawPath: string | null; data: any }> {
  const rawPath = registerRawText("apimart", attempt, raw);
  let data: any = null;
  try {
    data = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    if (status < 200 || status >= 300) {
      throw new RemoteKernelError(`APIMart ${label} 返回 HTTP ${status}: ${raw.slice(0, 400)}`, rawPath);
    }
    throw new RemoteKernelError(`APIMart ${label} JSON 解析失败: ${(error as any)?.message || error}`, rawPath);
  }
  if (status < 200 || status >= 300) {
    throw new RemoteKernelError(`APIMart ${label} 返回 ${status}: ${firstErrorMessage(data) || raw.slice(0, 400)}`, rawPath);
  }
  if (Number(data?.code) >= 400 || data?.success === false) {
    throw new RemoteKernelError(`APIMart ${label} 返回错误: ${firstErrorMessage(data) || data?.code || "unknown"}`, rawPath);
  }
  return { rawPath, data };
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

async function uploadImage(
  baseURL: string,
  apiKey: string,
  dataURL: string,
  index: number,
  attempt: number,
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<string> {
  const sourceCount = request.sourceImages?.length || request.payload.imagePaths.length || 1;
  const sourceLabel = `${index + 1}/${Math.max(1, sourceCount)}`;
  const doUpload = async (uploadDataURL: string, retrying: boolean): Promise<string> => {
    const { blob, mimeType } = dataURLToBlob(uploadDataURL);
    const form = new FormData();
    form.append("file", blob, `source-${index + 1}.${imageExtensionForMimeType(mimeType)}`);
    callbacks.onProgress?.(`APIMart 上传参考图 ${sourceLabel}${retrying ? "（重试）" : ""}`, 0, blob.size);
    const response = await requestText(
      request,
      callbacks.signal,
      apimartEndpoint(baseURL, "/v1/uploads/images"),
      "POST",
      {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      form,
      APIMART_UPLOAD_TIMEOUT_MS,
    );
    const { data } = await parseJSONResponse(response.raw, response.status, "上传参考图", attempt);
    const url = resultImagesFromPayload(data)[0] || "";
    if (!url) throw new RemoteKernelError("APIMart 上传参考图失败：响应里没有图片 URL");
    callbacks.onLog?.(`[APIMart] 已上传参考图 ${index + 1}`);
    return url;
  };

  try {
    return await doUpload(dataURL, false);
  } catch (error) {
    if (!isRetryableUploadError(error)) throw error;
    const retry = await compressUploadRetryDataURL(dataURL);
    callbacks.onLog?.(`[APIMart] 参考图 ${index + 1} 上传失败，${retry.compressed ? "已压缩为 JPEG 后" : ""}重试一次：${conciseError(error)}`);
    await sleepWithSignal(callbacks.signal, APIMART_UPLOAD_RETRY_DELAY_MS);
    try {
      return await doUpload(retry.dataURL, true);
    } catch (retryError) {
      const rawPath = retryError instanceof RemoteKernelError
        ? retryError.rawPath
        : error instanceof RemoteKernelError
          ? error.rawPath
          : null;
      throw new RemoteKernelError(
        `APIMart 上传参考图失败：上传服务返回异常，尚未提交生图任务。请稍后重试，或换一张小于 20MB 的 JPG/PNG/WebP 参考图。最后错误：${conciseError(retryError)}`,
        rawPath,
      );
    }
  }
}

async function submitTask(
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
  imageURLs: string[],
  attempt: number,
): Promise<{ taskId: string; images: string[]; rawPath: string | null }> {
  const baseURL = normalizeBaseURL(request.payload.baseURL);
  const apiKey = normalizeAPIKeyForHeader(request.payload.apiKey);
  const model = normalizeAPIMartModel(request.payload.imageModelID);
  const resolution = resolutionForSize(request.payload.size);
  const body = {
    model,
    prompt: promptWithBatchVariation(request.payload),
    n: 1,
    size: aspectForSize(request.payload.size),
    resolution: normalizeAPIMartResolution(resolution, model),
    official_fallback: false,
    ...(imageURLs.length ? { image_urls: imageURLs } : {}),
  };
  callbacks.onProgress?.("APIMart 提交异步任务", 0, 0);
  callbacks.onLog?.(`[APIMart] 提交异步任务 ${body.size}/${body.resolution}`);
  const response = await requestText(
    request,
    callbacks.signal,
    apimartEndpoint(baseURL, "/v1/images/generations"),
    "POST",
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    JSON.stringify(body),
    APIMART_SUBMIT_TIMEOUT_MS,
  );
  const { data, rawPath } = await parseJSONResponse(response.raw, response.status, "提交任务", attempt);
  const images = resultImagesFromPayload(data);
  const taskId = extractTaskId(data);
  if (!taskId && images.length === 0) {
    throw new RemoteKernelError("APIMart 没有返回 task_id 或图片结果", rawPath);
  }
  if (taskId) {
    callbacks.onLog?.(`[APIMart] task_id: ${taskId}`);
    callbacks.onAPIMartTaskSubmitted?.({ taskId, status: "submitted", rawPath });
  }
  return { taskId, images, rawPath };
}

async function pollTask(
  baseURL: string,
  apiKey: string,
  taskId: string,
  startedAt: number,
  attempt: number,
  request: RemoteJobRequest,
  callbacks: RemoteJobCallbacks,
): Promise<{ images: string[]; rawPath: string | null }> {
  const deadline = Date.now() + APIMART_TASK_TIMEOUT_MS;
  let rawPath: string | null = null;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await sleepWithSignal(callbacks.signal, APIMART_POLL_INTERVAL_MS);
    const elapsed = nowSeconds(startedAt);
    callbacks.onProgress?.(`APIMart 查询任务 ${taskId}${lastStatus ? ` (${lastStatus})` : ""}`, elapsed, 0);
    const response = await requestText(
      request,
      callbacks.signal,
      apimartEndpoint(baseURL, `/v1/tasks/${encodeURIComponent(taskId)}?language=zh`),
      "GET",
      {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      null,
      APIMART_POLL_TIMEOUT_MS,
    );
    const parsed = await parseJSONResponse(response.raw, response.status, "查询任务", attempt);
    rawPath = parsed.rawPath;
    const images = resultImagesFromPayload(parsed.data);
    if (images.length > 0) return { images, rawPath };
    lastStatus = statusFromPayload(parsed.data);
    if (SUCCESS_STATUSES.has(lastStatus)) {
      throw new RemoteKernelError("APIMart 任务完成但没有返回可用图片", rawPath, {
        apimartTaskId: taskId,
        apimartTaskStatus: lastStatus,
      });
    }
    if (FAILURE_STATUSES.has(lastStatus)) {
      throw new RemoteKernelError(firstErrorMessage(parsed.data) || `APIMart 任务失败：${lastStatus}`, rawPath, {
        apimartTaskId: taskId,
        apimartTaskStatus: lastStatus,
      });
    }
  }
  throw new RemoteKernelError(`APIMart 已提交但本地等待超时，可稍后重试或查询后台任务：${taskId}`, rawPath, {
    apimartTaskId: taskId,
    apimartTaskStatus: lastStatus || "timeout",
  });
}

async function imageResultToBase64(value: string, request: RemoteJobRequest, signal: AbortSignal): Promise<string> {
  if (/^data:image\//i.test(value)) {
    return dataURLParts(value)?.payload.replace(/\s+/g, "") || "";
  }
  const proxyMode = request.payload.proxyMode === "none" || request.payload.proxyMode === "custom"
    ? request.payload.proxyMode
    : "system";
  const proxyConfig = { proxyMode, proxyURL: request.payload.proxyURL || "" };
  const timeoutSignal = withTimeoutSignal(signal, APIMART_IMAGE_DOWNLOAD_TIMEOUT_MS);
  if (shouldUseAndroidNativeHTTP()) {
    const response = await nativeHttpRequestBase64(
      value,
      "GET",
      { Accept: "image/*,*/*" },
      null,
      timeoutSignal,
      proxyConfig,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new RemoteKernelError(`APIMart 图片下载失败 ${response.status}`);
    }
    return response.bodyBase64 || "";
  }
  if (proxyMode !== "system") {
    throw new RemoteKernelError("当前远程内核不能控制代理，请使用 Android 原生运行。");
  }
  const response = await fetch(value, { signal: timeoutSignal });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RemoteKernelError(`APIMart 图片下载失败 ${response.status}${detail ? `: ${detail.slice(0, 220)}` : ""}`);
  }
  return blobToBase64(await response.blob());
}

export async function requestAPIMartOnce(
  request: RemoteJobRequest,
  attempt: number,
  callbacks: RemoteJobCallbacks,
): Promise<RemoteJobResult> {
  const startedAt = Date.now();
  callbacks.onLog?.(`[APIMart] 第 ${attempt}/${MAX_ATTEMPTS} 次请求...`);
  callbacks.onProgress?.("APIMart 准备异步任务", 0, 0);
  let currentStage = "APIMart 准备异步任务";
  const ticker = runtimeSetInterval(() => {
    callbacks.onProgress?.(currentStage, nowSeconds(startedAt), 0);
  }, STATUS_INTERVAL_MS);
  try {
    const configuredBaseURL = normalizeBaseURL(request.payload.baseURL);
    const baseURLCandidates = apimartBaseURLCandidates(configuredBaseURL);
    const apiKey = normalizeAPIKeyForHeader(request.payload.apiKey);
    currentStage = "APIMart 读取参考图";
    callbacks.onProgress?.(currentStage, 0, 0);
    const sourceDataURLs = await resolveSourceDataURLs(request.sourceImages, request.payload);
    if (request.payload.mode === "edit" && sourceDataURLs.length === 0) {
      throw new RemoteKernelError("APIMart 图生图模式需要至少一张源图。");
    }
    let lastError: unknown = null;
    for (let baseIndex = 0; baseIndex < baseURLCandidates.length; baseIndex += 1) {
      const baseURL = baseURLCandidates[baseIndex];
      try {
        if (baseIndex > 0) {
          callbacks.onLog?.(`[APIMart] 官方域名连接失败，改用兼容线路 ${baseURL}`);
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
        const submitted = await submitTask({ ...request, payload: { ...request.payload, baseURL } }, callbacks, imageURLs, attempt);
        let images = submitted.images;
        let rawPath = submitted.rawPath;
        if (images.length === 0 && submitted.taskId) {
          currentStage = `APIMart 已提交任务 ${submitted.taskId}，等待结果`;
          const polled = await pollTask(baseURL, apiKey, submitted.taskId, startedAt, attempt, { ...request, payload: { ...request.payload, baseURL } }, callbacks);
          images = polled.images;
          rawPath = polled.rawPath ?? rawPath;
        }
        const first = images[0] || "";
        if (!first) throw new RemoteKernelError("APIMart 没有返回可用图片", rawPath);
        currentStage = "APIMart 下载结果图";
        const imageB64 = await imageResultToBase64(first, { ...request, payload: { ...request.payload, baseURL } }, callbacks.signal);
        if (!imageB64) throw new RemoteKernelError("APIMart 图片结果为空", rawPath);
        return {
          imageB64,
          revisedPrompt: "",
          sourceEvent: "apimart_async",
          rawPath,
          prompt: request.payload.prompt,
          mode: request.payload.mode,
          apimartTaskId: submitted.taskId || undefined,
          apimartTaskStatus: "succeeded",
        };
      } catch (error) {
        lastError = error;
        if (baseIndex < baseURLCandidates.length - 1 && isAPIMartNetworkFallbackError(error)) {
          callbacks.onLog?.(`[APIMart] ${baseURL} 网络连接失败：${conciseError(error)}`);
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new RemoteKernelError("APIMart 请求失败");
  } catch (error) {
    if (error instanceof RemoteKernelError) throw error;
    throw new RemoteKernelError(String((error as any)?.message || error));
  } finally {
    runtimeClearInterval(ticker);
  }
}

export async function queryAPIMartTaskRemote(
  input: RemoteAPIMartTaskQueryInput,
  signal: AbortSignal,
): Promise<RemoteAPIMartTaskQueryResult> {
  const taskId = String(input.taskId || "").trim();
  if (!taskId) throw new RemoteKernelError("缺少 APIMart task_id");
  const baseURLCandidates = apimartBaseURLCandidates(normalizeBaseURL(input.baseURL));
  const apiKey = normalizeAPIKeyForHeader(input.apiKey);
  let lastError: unknown = null;
  for (let baseIndex = 0; baseIndex < baseURLCandidates.length; baseIndex += 1) {
    const baseURL = baseURLCandidates[baseIndex];
    const request: RemoteJobRequest = {
      payload: {
        apiKey,
        baseURL,
        apiMode: "apimart",
        requestPolicy: "compat",
        mode: input.mode || "generate",
        prompt: input.prompt || "",
        size: input.size || "auto",
        quality: input.quality || "auto",
        outputFormat: input.outputFormat || "png",
        imagePaths: [],
        imagePath: "",
        maskB64: "",
        seed: 0,
        negativePrompt: "",
        textModelID: "",
        imageModelID: input.imageModelID || APIMART_DEFAULT_MODEL,
        proxyMode: input.proxyMode,
        proxyURL: input.proxyURL,
        noPromptRevision: true,
      },
    };
    try {
      const response = await requestText(
        request,
        signal,
        apimartEndpoint(baseURL, `/v1/tasks/${encodeURIComponent(taskId)}?language=zh`),
        "GET",
        {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        null,
        APIMART_POLL_TIMEOUT_MS,
      );
      const parsed = await parseJSONResponse(response.raw, response.status, "query task", 1);
      const status = statusFromPayload(parsed.data) || "";
      const images = resultImagesFromPayload(parsed.data);
      if (images.length > 0) {
        const imageB64 = await imageResultToBase64(images[0], request, signal);
        if (!imageB64) throw new RemoteKernelError("APIMart 图片结果为空", parsed.rawPath);
        return {
          taskId,
          status: status || "succeeded",
          imageB64,
          rawPath: parsed.rawPath,
        };
      }
      if (FAILURE_STATUSES.has(status)) {
        return {
          taskId,
          status,
          rawPath: parsed.rawPath,
          errorMessage: firstErrorMessage(parsed.data) || `APIMart 任务失败:${status}`,
        };
      }
      return {
        taskId,
        status: status || "running",
        rawPath: parsed.rawPath,
      };
    } catch (error) {
      lastError = error;
      if (baseIndex < baseURLCandidates.length - 1 && isAPIMartNetworkFallbackError(error)) continue;
      throw error;
    }
  }
  throw lastError ?? new RemoteKernelError("APIMart 后台任务查询失败");
}
