import {
  normalizeBaseURL as normalizeSharedBaseURL,
} from "../../../../../shared/kernel/requestModel.js";
import { validateAPIKeyForHeader } from "../../lib/apiKey.ts";
import { normalizeProviderBaseURL, ProviderPolicy } from "../../lib/providerPolicy.ts";
import {
  browserStoredAPIKey,
  setBrowserStoredAPIKey,
} from "./hostBrowser.ts";
import { isTransportishError } from "./remote-kernel/common.ts";
import {
  canInvokeAndroidMethod,
  hasServiceMethod,
  invokeAndroid,
  invokeService,
} from "./hostBindings.ts";
import {
  detectHostKind,
  isLocalPreviewHost,
  unsupportedMessage,
} from "./hostContext.ts";
import type {
  ProbeUpstreamOptionsLike,
  ProbeUpstreamResultLike,
} from "./hostTypes.ts";

const FHL_BASE_URL = ProviderPolicy.fhl.baseURL;
const FHL_LOCAL_PROXY_PREFIX = "/__image-studio-fhl";
const APIMART_BASE_URL = ProviderPolicy.apimart.baseURL;
const APIMART_LEGACY_BASE_URL = ProviderPolicy.apimart.legacyBaseURL;
const APIMART_LOCAL_PROXY_PREFIX = "/__image-studio-apimart";
const APIMART_LEGACY_LOCAL_PROXY_PREFIX = "/__image-studio-apimart-legacy";
const APIMART_PROBE_TIMEOUT_MS = 15_000;

function normalizeProbeBaseURL(
  raw: string,
  apiMode: "responses" | "images" | "apimart" | "runninghub" = "responses",
): string {
  const normalized = normalizeProviderBaseURL(apiMode, normalizeSharedBaseURL(raw));
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

function summarizeProbeBody(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function fallbackAPIMartProbeBaseURL(baseURL: string): string {
  const normalized = String(baseURL || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
  if (normalized === APIMART_BASE_URL) return APIMART_LEGACY_BASE_URL;
  if (normalized.endsWith(APIMART_LOCAL_PROXY_PREFIX)) {
    return `${normalized.slice(0, -APIMART_LOCAL_PROXY_PREFIX.length)}${APIMART_LEGACY_LOCAL_PROXY_PREFIX}`;
  }
  return "";
}

function apimartProbeSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return signal;
  const timeout = AbortSignal.timeout(APIMART_PROBE_TIMEOUT_MS);
  if (signal && typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return timeout;
}

function isRetryableAPIMartProbeError(error: unknown): boolean {
  const name = String((error as any)?.name || "").toLowerCase();
  const message = String((error as any)?.message || error || "").toLowerCase();
  return name === "timeouterror"
    || message.includes("timeout")
    || /\b50[0-4]\b/.test(message)
    || isTransportishError(error);
}

async function probeUpstreamFromBrowser(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL);
  const headerAPIKey = validateAPIKeyForHeader(apiKey);
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const response = await fetch(`${normalizedBaseURL}/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${headerAPIKey}`,
      Accept: "application/json",
    },
    signal,
  });
  const raw = await response.text();
  if (!response.ok) {
    const summary = summarizeProbeBody(raw);
    throw new Error(summary ? `上游 /v1/models 返回 ${response.status}: ${summary}` : `上游 /v1/models 返回 ${response.status}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("上游 /v1/models 返回的 JSON 无效");
  }
  if (!Array.isArray(parsed?.data)) {
    throw new Error("上游 /v1/models 响应缺少 data 数组");
  }
}

async function probeAPIMartFromBrowser(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL, "apimart");
  const headerAPIKey = validateAPIKeyForHeader(apiKey);
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const probeOnce = async (probeBaseURL: string): Promise<void> => {
    const response = await fetch(`${probeBaseURL}/v1/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${headerAPIKey}`,
        Accept: "application/json",
      },
      signal: apimartProbeSignal(signal),
    });
    const raw = await response.text();
    const summary = summarizeProbeBody(raw);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(summary ? `APIMart API Key 无效或未授权 (${response.status}): ${summary}` : `APIMart API Key 无效或未授权 (${response.status})`);
      }
      if (response.status >= 500) {
        throw new Error(summary ? `APIMart 上游或网络异常 (${response.status}): ${summary}` : `APIMart 上游或网络异常 (${response.status})`);
      }
      throw new Error(summary ? `APIMart /v1/balance 返回 ${response.status}: ${summary}` : `APIMart /v1/balance 返回 ${response.status}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("APIMart /v1/balance 返回的 JSON 无效");
    }
    if (parsed?.success === false || parsed?.ok === false) {
      const message = typeof parsed?.message === "string"
        ? parsed.message
        : typeof parsed?.error === "string"
          ? parsed.error
          : typeof parsed?.error?.message === "string"
            ? parsed.error.message
            : "";
      throw new Error(message ? `APIMart /v1/balance 返回失败: ${message}` : "APIMart /v1/balance 返回 success:false");
    }
  };
  try {
    await probeOnce(normalizedBaseURL);
  } catch (error) {
    const fallbackBaseURL = isRetryableAPIMartProbeError(error) ? fallbackAPIMartProbeBaseURL(normalizedBaseURL) : "";
    if (!fallbackBaseURL) throw error;
    await probeOnce(fallbackBaseURL);
  }
}

async function probeRunningHubFromBrowser(
  baseURL: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedBaseURL = normalizeProbeBaseURL(baseURL, "runninghub");
  if (!normalizedBaseURL) throw new Error("BASE_URL 不能为空");
  const configResponse = await fetch(`${normalizedBaseURL}/api/config`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const configRaw = await configResponse.text();
  const configSummary = summarizeProbeBody(configRaw);
  if (!configResponse.ok) {
    throw new Error(configSummary ? `RunningHub bridge /api/config 返回 ${configResponse.status}: ${configSummary}` : `RunningHub bridge /api/config 返回 ${configResponse.status}`);
  }
  let configParsed: any;
  try {
    configParsed = JSON.parse(configRaw);
  } catch {
    throw new Error("RunningHub bridge /api/config 返回的 JSON 无效");
  }
  if (configParsed?.ok === false) {
    throw new Error(String(configParsed?.message || "RunningHub bridge /api/config 返回失败"));
  }
  if (configParsed?.config?.api_key_configured !== true) {
    throw new Error("RunningHub bridge 可达，但桥接里还没有配置 RunningHub API Key");
  }

  const sizesResponse = await fetch(`${normalizedBaseURL}/api/runninghub-sizes`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const sizesRaw = await sizesResponse.text();
  const sizesSummary = summarizeProbeBody(sizesRaw);
  if (!sizesResponse.ok) {
    throw new Error(sizesSummary ? `RunningHub bridge /api/runninghub-sizes 返回 ${sizesResponse.status}: ${sizesSummary}` : `RunningHub bridge /api/runninghub-sizes 返回 ${sizesResponse.status}`);
  }
  let sizesParsed: any;
  try {
    sizesParsed = JSON.parse(sizesRaw);
  } catch {
    throw new Error("RunningHub bridge /api/runninghub-sizes 返回的 JSON 无效");
  }
  if (sizesParsed?.ok === false) {
    throw new Error(String(sizesParsed?.message || "RunningHub bridge /api/runninghub-sizes 返回失败"));
  }
  if (!sizesParsed?.modes?.["text-to-image"] || !sizesParsed?.modes?.["image-to-image"]) {
    throw new Error("RunningHub bridge 没有返回完整的文生图/图生图能力矩阵");
  }
}

export function DeleteStoredAPIKey(user: string): Promise<void> {
  if (hasServiceMethod("DeleteStoredAPIKey")) {
    return invokeService<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  if (canInvokeAndroidMethod("DeleteStoredAPIKey")) {
    return invokeAndroid<void>(unsupportedMessage, "DeleteStoredAPIKey", user);
  }
  setBrowserStoredAPIKey(user, "");
  return Promise.resolve();
}

export function GetStoredAPIKey(user: string): Promise<string> {
  if (hasServiceMethod("GetStoredAPIKey")) {
    return invokeService<string>(unsupportedMessage, "GetStoredAPIKey", user);
  }
  if (canInvokeAndroidMethod("GetStoredAPIKey")) {
    return invokeAndroid<string>(unsupportedMessage, "GetStoredAPIKey", user);
  }
  return Promise.resolve(browserStoredAPIKey(user));
}

export function SetStoredAPIKey(user: string, value: string): Promise<void> {
  if (hasServiceMethod("SetStoredAPIKey")) {
    return invokeService<void>(unsupportedMessage, "SetStoredAPIKey", user, value);
  }
  if (canInvokeAndroidMethod("SetStoredAPIKey")) {
    return invokeAndroid<void>(unsupportedMessage, "SetStoredAPIKey", user, value);
  }
  setBrowserStoredAPIKey(user, value);
  return Promise.resolve();
}

export function GetOutputDir(): Promise<string> {
  if (hasServiceMethod("GetOutputDir")) {
    return invokeService<string>(unsupportedMessage, "GetOutputDir");
  }
  if (canInvokeAndroidMethod("GetOutputDir")) {
    return invokeAndroid<string>(unsupportedMessage, "GetOutputDir");
  }
  return Promise.resolve("");
}

export function SetOutputDir(path: string): Promise<void> {
  if (hasServiceMethod("SetOutputDir")) {
    return invokeService<void>(unsupportedMessage, "SetOutputDir", path);
  }
  if (canInvokeAndroidMethod("SetOutputDir")) {
    return invokeAndroid<void>(unsupportedMessage, "SetOutputDir", path);
  }
  return Promise.resolve();
}

export async function probeCurrentUpstream(
  baseURL: string,
  apiKey: string,
  proxyMode = "system",
  proxyURL = "",
  apiModeOrSignal: string | AbortSignal = "responses",
  maybeSignal?: AbortSignal,
): Promise<void> {
  const apiMode = typeof apiModeOrSignal === "string" ? apiModeOrSignal : "responses";
  const signal = typeof apiModeOrSignal === "string" ? maybeSignal : apiModeOrSignal;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (apiMode === "apimart") {
    await probeAPIMartFromBrowser(baseURL, apiKey, signal);
    return;
  }
  if (apiMode === "runninghub") {
    await probeRunningHubFromBrowser(baseURL, signal);
    return;
  }
  const options: ProbeUpstreamOptionsLike = { baseURL, apiKey, proxyMode, proxyURL };
  if (hasServiceMethod("ProbeUpstream")) {
    await invokeService<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (canInvokeAndroidMethod("ProbeUpstream")) {
    await invokeAndroid<ProbeUpstreamResultLike>(unsupportedMessage, "ProbeUpstream", options);
    return;
  }
  if (detectHostKind() === "browser") {
    await probeUpstreamFromBrowser(baseURL, apiKey, signal);
    return;
  }
  throw new Error(unsupportedMessage("ProbeUpstream"));
}
