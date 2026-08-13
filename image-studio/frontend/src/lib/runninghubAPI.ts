import type { StudioState } from "../state/studioStore.types";
import { blobToBase64 } from "./images";
import {
  RUNNINGHUB_BANANA2_PROFILE_NAME,
  RUNNINGHUB_BASE_URL,
  RUNNINGHUB_DEFAULT_MODEL_ID,
  RUNNINGHUB_IMAGE_G2_MODEL_ID,
  RUNNINGHUB_IMAGE_G2_PROFILE_NAME,
} from "./profiles";

export const RUNNINGHUB_REGISTER_URL = "https://www.runninghub.cn/call-api/api-detail/2046503667076751361?inviteCode=rh-v1507";

type RunningHubProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

export type RunningHubBridgeConfig = {
  api_key_configured?: boolean;
  base_url?: string;
};

export type RunningHubBridgeCapabilities = {
  modes?: Record<string, { label?: string; aspect_ratios?: Record<string, string>; resolutions?: string[] }>;
};

export type RunningHubBridgeTaskImage = {
  url?: string;
  dataUrl?: string;
  mimeType?: string;
};

export type RunningHubBridgeTask = {
  id?: string;
  status?: string;
  error?: string | null;
  images?: RunningHubBridgeTaskImage[];
};

export type RunningHubQuickSummary = {
  bridge: { ok: boolean; detail: string };
  textToImage: { ok: boolean; detail: string };
  imageToImage: { ok: boolean; detail: string };
};

type RunningHubAPIJSON<T> = {
  ok?: boolean;
  message?: string;
  config?: T;
  task?: T;
} & T;

function normalizeRunningHubBaseURL(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "") || RUNNINGHUB_BASE_URL;
}

function runningHubAPIURL(baseURL: string, path: string): string {
  return `${normalizeRunningHubBaseURL(baseURL)}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readJSON<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let parsed: RunningHubAPIJSON<T> | null = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    if (!response.ok) throw new Error(raw.trim() || `RunningHub bridge request failed (${response.status})`);
    throw new Error("RunningHub bridge returned invalid JSON");
  }
  if (!response.ok || parsed?.ok === false) {
    throw new Error(String(parsed?.message || raw || `RunningHub bridge request failed (${response.status})`).trim());
  }
  return parsed as T;
}

export async function fetchRunningHubConfig(baseURL: string, signal?: AbortSignal): Promise<RunningHubBridgeConfig> {
  const response = await fetch(runningHubAPIURL(baseURL, "/api/config"), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const parsed = await readJSON<{ ok: true; config: RunningHubBridgeConfig }>(response);
  return parsed.config || {};
}

export async function saveRunningHubConfig(
  baseURL: string,
  input: { apiKey?: string },
  signal?: AbortSignal,
): Promise<RunningHubBridgeConfig> {
  const response = await fetch(runningHubAPIURL(baseURL, "/api/config"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input.apiKey ? { api_key: input.apiKey } : {}),
    signal,
  });
  const parsed = await readJSON<{ ok: true; config: RunningHubBridgeConfig }>(response);
  return parsed.config || {};
}

export async function fetchRunningHubCapabilities(
  baseURL: string,
  signal?: AbortSignal,
): Promise<RunningHubBridgeCapabilities> {
  const response = await fetch(runningHubAPIURL(baseURL, "/api/runninghub-sizes"), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  return await readJSON<RunningHubBridgeCapabilities>(response);
}

export async function fetchRunningHubResultImage(
  baseURL: string,
  image: RunningHubBridgeTaskImage | null | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const dataURL = String(image?.dataUrl || "").trim();
  if (dataURL.startsWith("data:image/")) {
    const commaIndex = dataURL.indexOf(",");
    if (commaIndex >= 0) return dataURL.slice(commaIndex + 1).replace(/\s+/g, "");
  }
  const url = String(image?.url || "").trim();
  if (!url) throw new Error("RunningHub bridge returned no usable result image");
  const response = await fetch(`${runningHubAPIURL(baseURL, "/api/image")}?url=${encodeURIComponent(url)}`, {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw.trim() || `RunningHub image proxy failed (${response.status})`);
  }
  return await blobToBase64(await response.blob());
}

export async function verifyRunningHubBridge(
  baseURL: string,
  signal?: AbortSignal,
): Promise<{ config: RunningHubBridgeConfig; capabilities: RunningHubBridgeCapabilities; summary: RunningHubQuickSummary }> {
  const config = await fetchRunningHubConfig(baseURL, signal);
  const capabilities = await fetchRunningHubCapabilities(baseURL, signal);
  const textToImage = capabilities.modes?.["text-to-image"];
  const imageToImage = capabilities.modes?.["image-to-image"];
  return {
    config,
    capabilities,
    summary: {
      bridge: {
        ok: !!config.api_key_configured,
        detail: config.api_key_configured
          ? `桥接可达，Key 已写入 ${normalizeRunningHubBaseURL(baseURL)}`
          : `桥接可达，但 ${normalizeRunningHubBaseURL(baseURL)} 里还没有 RunningHub API Key`,
      },
      textToImage: {
        ok: !!textToImage,
        detail: textToImage ? `支持文生图，分辨率 ${String((textToImage.resolutions || []).join(" / ") || "1k / 2k / 4k")}` : "桥接没有返回文生图能力矩阵",
      },
      imageToImage: {
        ok: !!imageToImage,
        detail: imageToImage ? `支持图生图，分辨率 ${String((imageToImage.resolutions || []).join(" / ") || "1k / 2k / 4k")}` : "桥接没有返回图生图能力矩阵",
      },
    },
  };
}

async function ensureRunningHubProfile(
  store: RunningHubProfileActions,
  input: { name: string; imageModelID: "banana2" | "image_g2"; baseURL: string },
): Promise<string> {
  const existing = store.profiles.find((profile) => (
    profile.apiMode === "runninghub"
    && profile.imageModelID.trim() === input.imageModelID
  ));

  if (!existing) {
    return store.createProfile({
      name: input.name,
      apiMode: "runninghub",
      requestPolicy: "openai",
      baseURL: input.baseURL,
      textModelID: "",
      imageModelID: input.imageModelID,
      concurrencyLimit: 1,
      setActive: false,
    });
  }

  await store.updateProfile(existing.id, {
    name: input.name,
    apiMode: "runninghub",
    requestPolicy: "openai",
    baseURL: input.baseURL,
    textModelID: "",
    imageModelID: input.imageModelID,
    concurrencyLimit: existing.concurrencyLimit || 1,
    imagesNewAPICompat: false,
  });
  return existing.id;
}

export async function ensureRunningHubProfiles(
  store: RunningHubProfileActions,
  baseURL: string,
): Promise<{ banana2Id: string; imageG2Id: string }> {
  const normalizedBaseURL = normalizeRunningHubBaseURL(baseURL);
  const banana2Id = await ensureRunningHubProfile(store, {
    name: RUNNINGHUB_BANANA2_PROFILE_NAME,
    imageModelID: RUNNINGHUB_DEFAULT_MODEL_ID,
    baseURL: normalizedBaseURL,
  });
  const imageG2Id = await ensureRunningHubProfile(store, {
    name: RUNNINGHUB_IMAGE_G2_PROFILE_NAME,
    imageModelID: RUNNINGHUB_IMAGE_G2_MODEL_ID,
    baseURL: normalizedBaseURL,
  });
  if (banana2Id !== store.activeProfileId) await store.setActiveProfile(banana2Id);
  return { banana2Id, imageG2Id };
}
