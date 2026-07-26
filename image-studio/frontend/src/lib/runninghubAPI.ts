import type { StudioState } from "../state/studioStore.types";
import { blobToBase64 } from "./images";
import {
  hasUpstreamProfileCapacity,
  RUNNINGHUB_BANANA2_PROFILE_NAME,
  RUNNINGHUB_BASE_URL,
  RUNNINGHUB_IMAGE_G2_PROFILE_NAME,
  upstreamProfileLimitMessage,
} from "./profiles";

export const RUNNINGHUB_REGISTER_URL = "https://www.runninghub.cn/call-api/api-detail/2046503667076751361?inviteCode=rh-v1507";

type RunningHubProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

export type RunningHubBridgeConfig = {
  api_key_configured?: boolean;
  base_url?: string;
  upload_url?: string;
  query_path?: string;
  banana2_model?: string;
  banana2_text_model?: string;
  image_g2_model?: string;
  image_g2_text_model?: string;
};

export type RunningHubBridgeCapabilities = {
  provider?: string;
  mode_options?: Record<string, string>;
  resolutions?: string[];
  modes?: Record<string, { label?: string; aspect_ratios?: Record<string, string>; resolutions?: string[] }>;
  models?: Record<string, { label?: string; modes?: Record<string, { endpoint?: string }> }>;
};

export type RunningHubBridgeTaskImage = {
  url?: string;
  dataUrl?: string;
  mimeType?: string;
};

export type RunningHubBridgeTask = {
  id?: string;
  requestId?: string;
  clientId?: string;
  status?: string;
  error?: string | null;
  rawStatus?: string;
  prompt?: string;
  mode?: string;
  modelKey?: string;
  aspectRatio?: string;
  resolution?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
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

function normalizeRunningHubMode(value: string): "text-to-image" | "image-to-image" {
  return String(value || "").trim() === "edit" || String(value || "").trim() === "image-to-image"
    ? "image-to-image"
    : "text-to-image";
}

const RUNNINGHUB_IMAGE_TO_IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"] as const;
const RUNNINGHUB_TEXT_TO_IMAGE_ASPECTS = [
  "1:1",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "21:9",
  "3:4",
  "4:3",
  "9:21",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
] as const;

const RUNNINGHUB_SIZE_TO_ASPECT: Record<string, string> = {
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
  "3840x2160": "16:9",
  "2160x3840": "9:16",
  "3840x1920": "2:1",
  "1920x3840": "1:2",
  "3840x1280": "3:1",
  "1280x3840": "1:3",
};

const RUNNINGHUB_SIZE_TO_RESOLUTION: Record<string, "1k" | "2k" | "4k"> = {
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
  "3840x2160": "4k",
  "2160x3840": "4k",
  "3840x1920": "4k",
  "1920x3840": "4k",
  "3840x1280": "4k",
  "1280x3840": "4k",
};

function supportedRunningHubAspects(mode: "text-to-image" | "image-to-image"): readonly string[] {
  return mode === "image-to-image" ? RUNNINGHUB_IMAGE_TO_IMAGE_ASPECTS : RUNNINGHUB_TEXT_TO_IMAGE_ASPECTS;
}

function nearestRunningHubAspect(size: string, mode: "text-to-image" | "image-to-image"): string {
  const match = String(size || "").trim().toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return supportedRunningHubAspects(mode)[0] || "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return supportedRunningHubAspects(mode)[0] || "1:1";
  }
  const ratio = width / height;
  let best = supportedRunningHubAspects(mode)[0] || "1:1";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const aspect of supportedRunningHubAspects(mode)) {
    const [w, h] = aspect.split(":").map(Number);
    const diff = Math.abs(Math.log(ratio) - Math.log(w / h));
    if (diff < bestDiff) {
      best = aspect;
      bestDiff = diff;
    }
  }
  return best;
}

export function runningHubSizeSelection(
  size: string,
  mode: string,
): { aspectRatio: string; resolution: "1k" | "2k" | "4k" } {
  const normalizedMode = normalizeRunningHubMode(mode);
  const normalizedSize = String(size || "").trim().toLowerCase();
  const aspectMatch = normalizedSize.match(/^(\d+:\d+)(?:@(1k|2k|4k))?$/);
  if (aspectMatch) {
    const aspectRatio = aspectMatch[1];
    const supported = new Set(supportedRunningHubAspects(normalizedMode));
    return {
      aspectRatio: supported.has(aspectRatio) ? aspectRatio : nearestRunningHubAspect("1024x1024", normalizedMode),
      resolution: (aspectMatch[2] as "1k" | "2k" | "4k" | undefined) || "1k",
    };
  }
  return {
    aspectRatio: RUNNINGHUB_SIZE_TO_ASPECT[normalizedSize] || nearestRunningHubAspect(normalizedSize, normalizedMode),
    resolution: RUNNINGHUB_SIZE_TO_RESOLUTION[normalizedSize] || "1k",
  };
}

async function readJSON<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let parsed: RunningHubAPIJSON<T> | null = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    if (!response.ok) {
      throw new Error(raw.trim() || `RunningHub bridge request failed (${response.status})`);
    }
    throw new Error("RunningHub bridge returned invalid JSON");
  }
  if (!response.ok || parsed?.ok === false) {
    throw new Error(
      String(parsed?.message || raw || `RunningHub bridge request failed (${response.status})`).trim(),
    );
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
    body: JSON.stringify({
      ...(input.apiKey ? { api_key: input.apiKey } : {}),
    }),
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

export async function recoverRunningHubTask(
  baseURL: string,
  input: {
    prompt: string;
    mode: string;
    model: string;
    size: string;
    requestId?: string;
    bridgeTaskId?: string;
  },
  signal?: AbortSignal,
): Promise<RunningHubBridgeTask> {
  const sizeSelection = runningHubSizeSelection(input.size, input.mode);
  const response = await fetch(runningHubAPIURL(baseURL, "/api/recover"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      ...(input.bridgeTaskId ? { task_id: input.bridgeTaskId } : {}),
      ...(input.requestId ? { request_id: input.requestId } : {}),
      prompt: input.prompt,
      mode: normalizeRunningHubMode(input.mode),
      model: input.model,
      aspect_ratio: sizeSelection.aspectRatio,
      resolution: sizeSelection.resolution,
    }),
    signal,
  });
  const parsed = await readJSON<{ ok: true; task: RunningHubBridgeTask }>(response);
  return parsed.task || {};
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
        detail: textToImage
          ? `支持文生图，分辨率 ${String((textToImage.resolutions || []).join(" / ") || "1k / 2k / 4k")}`
          : "桥接没有返回文生图能力矩阵",
      },
      imageToImage: {
        ok: !!imageToImage,
        detail: imageToImage
          ? `支持图生图，分辨率 ${String((imageToImage.resolutions || []).join(" / ") || "1k / 2k / 4k")}`
          : "桥接没有返回图生图能力矩阵",
      },
    },
  };
}

async function ensureRunningHubProfile(
  store: RunningHubProfileActions,
  input: {
    name: string;
    imageModelID: "banana2" | "image_g2";
    baseURL: string;
    currentId?: string;
  },
): Promise<string> {
  const existing = (input.currentId
    ? store.profiles.find((profile) => profile.id === input.currentId)
    : null)
    || store.profiles.find((profile) => (
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
      concurrencyLimit: 2,
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
    concurrencyLimit: existing.concurrencyLimit || 2,
    imagesNewAPICompat: false,
  });
  return existing.id;
}

export async function ensureRunningHubProfiles(
  store: RunningHubProfileActions,
  baseURL: string,
): Promise<{ banana2Id: string; imageG2Id: string }> {
  const normalizedBaseURL = normalizeRunningHubBaseURL(baseURL);
  const hasBanana2 = store.profiles.some((profile) => (
    profile.apiMode === "runninghub" && profile.imageModelID.trim() === "banana2"
  ));
  const hasImageG2 = store.profiles.some((profile) => (
    profile.apiMode === "runninghub" && profile.imageModelID.trim() === "image_g2"
  ));
  const missingProfiles = Number(!hasBanana2) + Number(!hasImageG2);
  if (!hasUpstreamProfileCapacity(store.profiles, missingProfiles)) {
    throw new Error(upstreamProfileLimitMessage());
  }
  const banana2Id = await ensureRunningHubProfile(store, {
    name: RUNNINGHUB_BANANA2_PROFILE_NAME,
    imageModelID: "banana2",
    baseURL: normalizedBaseURL,
  });
  const imageG2Id = await ensureRunningHubProfile(store, {
    name: RUNNINGHUB_IMAGE_G2_PROFILE_NAME,
    imageModelID: "image_g2",
    baseURL: normalizedBaseURL,
  });
  if (banana2Id !== store.activeProfileId) {
    await store.setActiveProfile(banana2Id);
  }
  return { banana2Id, imageG2Id };
}
