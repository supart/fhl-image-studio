import { keyringUserFor } from "../../lib/profiles.ts";
import type {
  APIMode,
  HistoryItem,
  OutputFormatValue,
  ProxyMode,
  PSBridgeSourceMetadata,
  QualityValue,
  RequestPolicy,
  SizeValue,
  UpstreamProfile,
} from "../../types/domain.ts";

export type PSBridgeProfileInput = {
  profileId: string;
  name: string;
  apiMode: APIMode;
  baseURL: string;
  credentialUser: string;
  textModelID: string;
  imageModelID: string;
  requestPolicy: RequestPolicy;
  imagesNewAPICompat: boolean;
  proxyMode: ProxyMode;
  proxyURL: string;
  concurrencyLimit: number;
};

export type PSBridgeProfilePublic = {
  profileId: string;
  name: string;
  provider: string;
  apiMode: APIMode;
  imageModelID: string;
  supportsMask: boolean;
  maxImages: number;
  ready: boolean;
};

export type PSBridgeStatus = {
  running: boolean;
  port?: number;
  instanceId?: string;
  profileReady: boolean;
  profile?: PSBridgeProfilePublic;
};

export type PSBridgeRemoteDispatch = {
  jobId: string;
  clientTaskId: string;
  profileId: string;
  profileName: string;
  apiMode: "apimart" | "runninghub";
  baseURL: string;
  textModelID: string;
  imageModelID: string;
  requestPolicy: RequestPolicy;
  imagesNewAPICompat: boolean;
  proxyMode: ProxyMode;
  proxyURL: string;
  mode: "generate" | "edit";
  prompt: string;
  size: string;
  quality: string;
  outputFormat: string;
  seed: number;
  negativePrompt: string;
  imagePaths: string[];
  maskB64?: string;
};

export type PSBridgeRemoteProgress = {
  jobId: string;
  stage: string;
  elapsed: number;
  bytes: number;
};

export type PSBridgeRemoteCompletion = {
  jobId: string;
  imageB64: string;
  revisedPrompt: string;
  sourceEvent: string;
  rawPath: string;
};

export type PSBridgeRemoteFailure = {
  jobId: string;
  message: string;
  rawPath: string;
};

export type PSBridgeResult = {
  imageB64?: string;
  revisedPrompt?: string;
  sourceEvent?: string;
  imageId?: string;
  savedPath?: string;
  thumbPath?: string;
  previewUrl?: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  previewWidth?: number;
  previewHeight?: number;
  rawPath?: string;
  mode?: string;
  prompt?: string;
};

export type PSBridgeHistoryEvent = {
  jobId: string;
  clientTaskId: string;
  createdAt: number;
  mode: "generate" | "edit";
  prompt: string;
  size: string;
  quality: string;
  outputFormat: string;
  seed: number;
  negativePrompt: string;
  profileId: string;
  profileName: string;
  apiMode: APIMode;
  sources?: PSBridgeSourceMetadata[];
  result: PSBridgeResult;
};

export type PSBridgeProfileState = {
  profiles: UpstreamProfile[];
  activeProfileId: string;
  apiMode: APIMode;
  baseURL: string;
  textModelID: string;
  imageModelID: string;
  requestPolicy: RequestPolicy;
  imagesNewAPICompat: boolean;
  proxyMode: ProxyMode;
  proxyURL: string;
  apiKey: string;
};

function cleanMode(value: string): APIMode {
  if (value === "images" || value === "apimart" || value === "runninghub") return value;
  return "responses";
}

function cleanQuality(value: string): QualityValue {
  if (value === "auto" || value === "high" || value === "low") return value;
  return "medium";
}

function cleanOutputFormat(value: string): OutputFormatValue {
  if (value === "jpeg" || value === "webp") return value;
  return "png";
}

export function buildPSBridgeProfileInput(state: PSBridgeProfileState): PSBridgeProfileInput | null {
  const profile = state.profiles.find((candidate) => candidate.id === state.activeProfileId);
  if (!profile) return null;
  const profileId = String(profile.id || "").trim();
  const name = String(profile.name || "").trim();
  const apiMode = cleanMode(state.apiMode || profile.apiMode);
  const baseURL = String(state.baseURL || profile.baseURL || "").trim();
  if (!profileId || !name || !baseURL) return null;
  return {
    profileId,
    name,
    apiMode,
    baseURL,
    credentialUser: apiMode === "runninghub" ? "" : keyringUserFor(profileId),
    textModelID: String(state.textModelID || profile.textModelID || "").trim(),
    imageModelID: String(state.imageModelID || profile.imageModelID || "").trim(),
    requestPolicy: state.requestPolicy === "compat" ? "compat" : "openai",
    imagesNewAPICompat: apiMode === "images" && state.imagesNewAPICompat === true,
    proxyMode: state.proxyMode === "none" || state.proxyMode === "custom" ? state.proxyMode : "system",
    proxyURL: state.proxyMode === "custom" ? String(state.proxyURL || "").trim() : "",
    concurrencyLimit: 1,
  };
}

export function psBridgeProfileSignature(input: PSBridgeProfileInput | null, keyReadyHint: boolean): string {
  return JSON.stringify({ profile: input, keyReadyHint });
}

export function historyItemFromPSBridgeEvent(event: PSBridgeHistoryEvent): HistoryItem {
  const result = event.result || {};
  const mode = event.mode === "edit" ? "edit" : "generate";
  return {
    id: `ps-bridge:${event.jobId}`,
    imageId: result.imageId || undefined,
    previewUrl: result.previewUrl || undefined,
    fullUrl: result.fullUrl || undefined,
    thumbPath: result.thumbPath || undefined,
    previewWidth: result.previewWidth || undefined,
    previewHeight: result.previewHeight || undefined,
    width: result.width || undefined,
    height: result.height || undefined,
    imageB64: result.imageB64 || undefined,
    prompt: result.prompt || event.prompt || "Photoshop generation",
    revisedPrompt: result.revisedPrompt || undefined,
    mode,
    apiMode: cleanMode(event.apiMode),
    apiProfileId: event.profileId || undefined,
    apiProfileName: event.profileName || undefined,
    size: (event.size || "1024x1024") as SizeValue,
    quality: cleanQuality(event.quality),
    outputFormat: cleanOutputFormat(event.outputFormat),
    createdAt: Number(event.createdAt) || Date.now(),
    seed: Number(event.seed) || 0,
    negativePrompt: event.negativePrompt || "",
    savedPath: result.savedPath || undefined,
    rawPath: result.rawPath || undefined,
    psBridge: {
      jobId: event.jobId,
      clientTaskId: event.clientTaskId,
      sources: Array.isArray(event.sources) ? event.sources.map((source) => ({ ...source })) : [],
    },
  };
}
