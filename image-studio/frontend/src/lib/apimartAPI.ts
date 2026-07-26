import type { StudioState } from "../state/studioStore.types";
import { blobToBase64 } from "./images";
import {
  APIMART_BASE_URL,
  APIMART_LEGACY_BASE_URL,
  APIMART_CONCURRENCY_LIMIT,
  APIMART_IMAGE_MODEL_ID,
  APIMART_PROFILE_NAME,
  hasUpstreamProfileCapacity,
  isAPIMartOfficialBaseURL,
  normalizeAPIMartBaseURL,
  nextDefaultProfileName,
  upstreamProfileLimitMessage,
} from "./profiles";

export const APIMART_REGISTER_URL = "https://apimart.ai/keys";
const APIMART_LOCAL_PROXY_PREFIX = "/__image-studio-apimart";
const APIMART_LEGACY_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-legacy";
const APIMART_IMAGE_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-image";
const APIMART_SUCCESS_STATUSES = new Set(["success", "succeed", "succeeded", "completed", "complete", "done", "finished", "ok"]);
const APIMART_FAILURE_STATUSES = new Set(["failed", "fail", "error", "cancelled", "canceled", "rejected"]);
const APIMART_TASK_ID_TEXT_RE = /\btask[-_](?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]{5,}\b/i;

export type APIMartRecoveredTask = {
  taskId: string;
  status: string;
  images: string[];
  expiresAt?: number;
  raw: unknown;
};

type APIMartProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

function profileName(store: APIMartProfileActions, currentId = ""): string {
  const candidates = currentId
    ? store.profiles.filter((profile) => profile.id !== currentId)
    : store.profiles;
  return nextDefaultProfileName(candidates) || APIMART_PROFILE_NAME;
}

export async function ensureAPIMartProfile(store: APIMartProfileActions): Promise<string> {
  const existing = store.profiles.find((profile) => (
    profile.apiMode === "apimart"
    && isAPIMartOfficialBaseURL(profile.baseURL)
    && (profile.imageModelID || APIMART_IMAGE_MODEL_ID) === APIMART_IMAGE_MODEL_ID
  ));

  if (!existing) {
    if (!hasUpstreamProfileCapacity(store.profiles)) {
      throw new Error(upstreamProfileLimitMessage());
    }
    return store.createProfile({
      name: profileName(store),
      apiMode: "apimart",
      requestPolicy: "openai",
      baseURL: APIMART_BASE_URL,
      textModelID: "",
      imageModelID: APIMART_IMAGE_MODEL_ID,
      concurrencyLimit: APIMART_CONCURRENCY_LIMIT,
      setActive: true,
    });
  }

  await store.updateProfile(existing.id, {
    name: existing.name.trim() ? existing.name : profileName(store, existing.id),
    apiMode: "apimart",
    requestPolicy: "openai",
    baseURL: existing.baseURL,
    textModelID: existing.textModelID,
    imageModelID: APIMART_IMAGE_MODEL_ID,
    concurrencyLimit: existing.concurrencyLimit || APIMART_CONCURRENCY_LIMIT,
    imagesNewAPICompat: false,
  });
  if (existing.id !== store.activeProfileId) {
    await store.setActiveProfile(existing.id);
  }
  return existing.id;
}

export function focusAPIMartAPIKeyInput() {
  const focusOnce = () => {
    const input = document.querySelector<HTMLInputElement>("[data-fhl-api-key-input='true']");
    if (!input) return false;
    const clearHighlight = () => {
      input.removeAttribute("data-fhl-api-key-highlight");
      const timer = Number(input.dataset.fhlApiKeyHighlightTimer || 0);
      if (timer) window.clearTimeout(timer);
      delete input.dataset.fhlApiKeyHighlightTimer;
    };
    clearHighlight();
    input.setAttribute("data-fhl-api-key-highlight", "true");
    input.addEventListener("input", clearHighlight, { once: true });
    input.dataset.fhlApiKeyHighlightTimer = String(window.setTimeout(clearHighlight, 9000));
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
    input.select();
    return true;
  };

  if (focusOnce()) return;
  [80, 220, 420, 720].forEach((delay) => {
    window.setTimeout(focusOnce, delay);
  });
}

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function apimartEndpoint(baseURL: string, path: string): string {
  const root = normalizeAPIMartBaseURL(String(baseURL || "")).replace(/\/+$/, "").replace(/\/v1$/i, "");
  if (!root) throw new Error("APIMart baseURL 为空，无法重新同步任务");
  const localRoot = apimartLocalPreviewRoot(root);
  return `${localRoot}${path.startsWith("/") ? path : `/${path}`}`;
}

function apimartLocalPreviewRoot(root: string): string {
  if (!isLocalPreviewHost()) return root;
  if (root === APIMART_BASE_URL) return `${window.location.origin}${APIMART_LOCAL_PROXY_PREFIX}`;
  if (root === APIMART_LEGACY_BASE_URL) return `${window.location.origin}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  return root;
}

function apimartFallbackEndpoint(baseURL: string, path: string): string {
  const root = normalizeAPIMartBaseURL(String(baseURL || "")).replace(/\/+$/, "").replace(/\/v1$/i, "");
  let fallbackRoot = "";
  if (root === APIMART_BASE_URL) {
    fallbackRoot = APIMART_LEGACY_BASE_URL;
  } else if (root.endsWith(APIMART_LOCAL_PROXY_PREFIX)) {
    fallbackRoot = `${root.slice(0, -APIMART_LOCAL_PROXY_PREFIX.length)}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  if (!fallbackRoot) return "";
  const localRoot = apimartLocalPreviewRoot(fallbackRoot);
  return `${localRoot}${path.startsWith("/") ? path : `/${path}`}`;
}

function isRetryableAPIMartRecoveryError(error: unknown): boolean {
  const name = String((error as any)?.name || "").toLowerCase();
  const message = String((error as any)?.message || error || "").toLowerCase();
  return name === "timeouterror"
    || name === "aborterror"
    || message.includes("failed to fetch")
    || message.includes("network")
    || message.includes("timeout")
    || /\b50[0-4]\b/.test(message)
    || /\b52[0-9]\b/.test(message);
}

function downloadURLForAPIMartImage(value: string): string {
  if (!/^https?:\/\//i.test(value) || !isLocalPreviewHost()) return value;
  return `${window.location.origin}${APIMART_IMAGE_LOCAL_PROXY_PREFIX}/download?url=${encodeURIComponent(value)}`;
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

function extractExpiresAt(value: unknown, key?: string, depth = 0): number | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number") {
    if (!key || !/expires?_?at|expired_?at|expire/i.test(key)) return undefined;
    const millis = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(millis) ? millis : undefined;
  }
  if (typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = extractExpiresAt(child, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    const found = extractExpiresAt(childValue, childKey || key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function readAPIMartJSON(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  let parsed: any = null;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`APIMart ${label} JSON 解析失败：${raw.slice(0, 240)}`);
  }
  const message = firstErrorMessage(parsed);
  if (!response.ok) {
    throw new Error(message ? `APIMart ${label} 返回 ${response.status}：${message}` : `APIMart ${label} 返回 HTTP ${response.status}`);
  }
  const code = Number(parsed?.code ?? parsed?.statusCode ?? 200);
  if (parsed?.success === false || parsed?.ok === false || (Number.isFinite(code) && code >= 400)) {
    throw new Error(message || `APIMart ${label} 返回错误：${code}`);
  }
  return parsed;
}

export function extractAPIMartTaskIdFromText(raw: unknown): string {
  const match = String(raw || "").match(APIMART_TASK_ID_TEXT_RE);
  return match?.[0] ?? "";
}

export async function recoverAPIMartTask(
  baseURL: string,
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<APIMartRecoveredTask> {
  const cleanTaskId = String(taskId || "").trim();
  if (!cleanTaskId) throw new Error("缺少 APIMart task_id，无法重新同步结果");
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("缺少 APIMart API Key，无法查询任务结果");
  const path = `/v1/tasks/${encodeURIComponent(cleanTaskId)}?language=zh`;
  const endpoints = Array.from(new Set([
    apimartEndpoint(baseURL, path),
    apimartFallbackEndpoint(baseURL, path),
  ].filter(Boolean)));
  let lastError: unknown = null;
  let parsed: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          Accept: "application/json",
        },
        signal,
      });
      parsed = await readAPIMartJSON(response, "任务查询");
      break;
    } catch (error) {
      lastError = error;
      if (!isRetryableAPIMartRecoveryError(error)) break;
    }
  }
  if (!parsed) throw lastError instanceof Error ? lastError : new Error(String(lastError || "APIMart 任务查询失败"));
  const status = statusFromPayload(parsed);
  const images = resultImagesFromPayload(parsed);
  if (images.length > 0) {
    return {
      taskId: cleanTaskId,
      status: status || "completed",
      images,
      expiresAt: extractExpiresAt(parsed),
      raw: parsed,
    };
  }
  if (APIMART_FAILURE_STATUSES.has(status)) {
    throw new Error(firstErrorMessage(parsed) || `APIMart 任务失败：${status}`);
  }
  if (APIMART_SUCCESS_STATUSES.has(status)) {
    throw new Error("APIMart 任务已完成，但没有返回可用图片");
  }
  throw new Error(status ? `APIMart 任务仍在处理中：${status}` : "APIMart 任务仍在处理中，暂时没有结果图");
}

export async function fetchAPIMartResultImage(imageURL: string, signal?: AbortSignal): Promise<string> {
  const raw = String(imageURL || "").trim();
  if (!raw) throw new Error("APIMart 任务结果里没有可用图片 URL");
  if (/^data:image\//i.test(raw)) {
    const commaIndex = raw.indexOf(",");
    if (commaIndex >= 0) return raw.slice(commaIndex + 1).replace(/\s+/g, "");
  }
  const response = await fetch(downloadURLForAPIMartImage(raw), {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail.trim() ? `APIMart 图片下载失败 ${response.status}：${detail.trim().slice(0, 220)}` : `APIMart 图片下载失败 ${response.status}`);
  }
  return await blobToBase64(await response.blob());
}
