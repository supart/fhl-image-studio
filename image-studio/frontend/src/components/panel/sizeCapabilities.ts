import { classifyImageModel } from "../../../../../shared/kernel/requestModel.js";
import type { APIMode, RequestPolicy, SizeValue } from "../../types/domain";

export type FHLAspectPreset =
  | "auto"
  | "1:1"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "5:4"
  | "4:5"
  | "16:9"
  | "9:16"
  | "2:1"
  | "1:2"
  | "3:1"
  | "1:3"
  | "7:4"
  | "4:7";
export type APIMartAspectPreset =
  | FHLAspectPreset
  | "21:9"
  | "9:21";
export type AspectPreset = APIMartAspectPreset;
export type ResolutionPreset = "auto" | "1k" | "2k" | "4k";
export type AspectPresetOption = { value: AspectPreset; label: string; w: number; h: number; auto?: boolean };

export const ASPECT_PRESETS: Array<AspectPresetOption & { value: FHLAspectPreset }> = [
  { value: "auto", label: "Auto", w: 18, h: 18, auto: true },
  { value: "1:1", label: "1:1", w: 18, h: 18 },
  { value: "3:2", label: "3:2", w: 22, h: 14 },
  { value: "2:3", label: "2:3", w: 14, h: 20 },
  { value: "16:9", label: "16:9", w: 24, h: 13 },
  { value: "9:16", label: "9:16", w: 12, h: 22 },
  { value: "2:1", label: "2:1", w: 24, h: 12 },
  { value: "1:2", label: "1:2", w: 12, h: 24 },
  { value: "7:4", label: "7:4", w: 24, h: 14 },
  { value: "4:7", label: "4:7", w: 14, h: 24 },
];

export const APIMART_ASPECT_PRESETS: AspectPresetOption[] = [
  { value: "auto", label: "Auto", w: 18, h: 18, auto: true },
  { value: "1:1", label: "1:1", w: 18, h: 18 },
  { value: "3:2", label: "3:2", w: 22, h: 14 },
  { value: "2:3", label: "2:3", w: 14, h: 20 },
  { value: "4:3", label: "4:3", w: 22, h: 16 },
  { value: "3:4", label: "3:4", w: 16, h: 22 },
  { value: "5:4", label: "5:4", w: 22, h: 17 },
  { value: "4:5", label: "4:5", w: 17, h: 22 },
  { value: "16:9", label: "16:9", w: 24, h: 13 },
  { value: "9:16", label: "9:16", w: 12, h: 22 },
  { value: "2:1", label: "2:1", w: 24, h: 12 },
  { value: "1:2", label: "1:2", w: 12, h: 24 },
  { value: "3:1", label: "3:1", w: 24, h: 8 },
  { value: "1:3", label: "1:3", w: 8, h: 24 },
  { value: "21:9", label: "21:9", w: 28, h: 12 },
  { value: "9:21", label: "9:21", w: 12, h: 28 },
];

export const RESOLUTION_PRESETS: Array<{ value: ResolutionPreset; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

type VisibleFHLAspectPreset = "1:1" | "3:2" | "2:3" | "16:9" | "9:16" | "2:1" | "1:2" | "7:4" | "4:7";

const FHL_SIZE_MATRIX: Record<VisibleFHLAspectPreset, Record<Exclude<ResolutionPreset, "auto">, SizeValue>> = {
  "1:1": {
    "1k": "1024x1024",
    "2k": "2048x2048",
    "4k": "2880x2880",
  },
  "3:2": {
    "1k": "1536x1024",
    "2k": "2048x1360",
    "4k": "3520x2352",
  },
  "2:3": {
    "1k": "1024x1536",
    "2k": "1360x2048",
    "4k": "2352x3520",
  },
  "16:9": {
    "1k": "1536x864",
    "2k": "2048x1152",
    "4k": "3840x2160",
  },
  "9:16": {
    "1k": "864x1536",
    "2k": "1152x2048",
    "4k": "2160x3840",
  },
  "2:1": {
    "1k": "1536x768",
    "2k": "2048x1024",
    "4k": "3840x1920",
  },
  "1:2": {
    "1k": "768x1536",
    "2k": "1024x2048",
    "4k": "1920x3840",
  },
  "7:4": {
    "1k": "1664x944",
    "2k": "2208x1264",
    "4k": "3808x2176",
  },
  "4:7": {
    "1k": "944x1664",
    "2k": "1264x2208",
    "4k": "2176x3808",
  },
};

const SIZE_TO_ASPECT: Record<string, AspectPreset> = {
  auto: "auto",
  "1024x1024": "1:1",
  "2048x2048": "1:1",
  "2880x2880": "1:1",
  "1248x832": "3:2",
  "1536x1024": "3:2",
  "2048x1360": "3:2",
  "3456x2304": "3:2",
  "3520x2352": "3:2",
  "832x1248": "2:3",
  "1024x1536": "2:3",
  "1360x2048": "2:3",
  "2304x3456": "2:3",
  "2352x3520": "2:3",
  "1152x864": "4:3",
  "1536x1152": "4:3",
  "2048x1536": "4:3",
  "3840x2880": "4:3",
  "864x1152": "3:4",
  "1152x1536": "3:4",
  "1536x2048": "3:4",
  "2880x3840": "3:4",
  "1120x896": "5:4",
  "1520x1216": "5:4",
  "2040x1632": "5:4",
  "3840x3072": "5:4",
  "896x1120": "4:5",
  "1216x1520": "4:5",
  "1632x2040": "4:5",
  "3072x3840": "4:5",
  "1280x720": "16:9",
  "1536x864": "16:9",
  "2048x1152": "16:9",
  "3840x2160": "16:9",
  "720x1280": "9:16",
  "864x1536": "9:16",
  "1152x2048": "9:16",
  "2160x3840": "9:16",
  "1440x720": "2:1",
  "1536x768": "2:1",
  "2048x1024": "2:1",
  "3840x1920": "2:1",
  "720x1440": "1:2",
  "768x1536": "1:2",
  "1024x2048": "1:2",
  "1920x3840": "1:2",
  "1728x576": "3:1",
  "1536x512": "3:1",
  "2040x680": "3:1",
  "3840x1280": "3:1",
  "576x1728": "1:3",
  "512x1536": "1:3",
  "680x2040": "1:3",
  "1280x3840": "1:3",
  "1664x944": "7:4",
  "2208x1264": "7:4",
  "3808x2176": "7:4",
  "1792x1024": "7:4",
  "944x1664": "4:7",
  "1264x2208": "4:7",
  "2176x3808": "4:7",
  "1024x1792": "4:7",
};

const SIZE_TO_RESOLUTION: Record<string, ResolutionPreset> = {
  auto: "auto",
  "1024x1024": "1k",
  "1248x832": "1k",
  "1536x1024": "1k",
  "832x1248": "1k",
  "1024x1536": "1k",
  "1152x864": "1k",
  "1536x1152": "1k",
  "864x1152": "1k",
  "1152x1536": "1k",
  "1120x896": "1k",
  "1520x1216": "1k",
  "896x1120": "1k",
  "1216x1520": "1k",
  "1280x720": "1k",
  "1536x864": "1k",
  "720x1280": "1k",
  "864x1536": "1k",
  "1440x720": "1k",
  "1536x768": "1k",
  "720x1440": "1k",
  "768x1536": "1k",
  "1728x576": "1k",
  "1536x512": "1k",
  "576x1728": "1k",
  "512x1536": "1k",
  "1664x944": "1k",
  "944x1664": "1k",
  "1792x1024": "1k",
  "1024x1792": "1k",
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
  "2208x1264": "2k",
  "1264x2208": "2k",
  "2880x2880": "4k",
  "3456x2304": "4k",
  "3520x2352": "4k",
  "2304x3456": "4k",
  "2352x3520": "4k",
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
  "3808x2176": "4k",
  "2176x3808": "4k",
};

const APIMART_ASPECT_VALUES = new Set<AspectPreset>(APIMART_ASPECT_PRESETS.map((item) => item.value));
const LARGE_RESOLUTION_PRESETS = new Set<ResolutionPreset>(["2k", "4k"]);
const DEFAULT_FHL_ASPECT_FROM_AUTO: Exclude<AspectPreset, "auto"> = "1:1";
const DEFAULT_APIMART_ASPECT_FROM_AUTO: Exclude<AspectPreset, "auto"> = "9:16";
const DEFAULT_RESOLUTION_FROM_AUTO: Exclude<ResolutionPreset, "auto"> = "1k";

function parseAPIMartSize(size: SizeValue): { aspect: AspectPreset; resolution: ResolutionPreset } | null {
  const normalized = String(size || "").trim().toLowerCase();
  const match = normalized.match(/^(\d+:\d+)(?:@(1k|2k|4k))?$/);
  if (!match) return null;
  const aspect = match[1] as AspectPreset;
  if (!APIMART_ASPECT_VALUES.has(aspect)) return null;
  return {
    aspect,
    resolution: (match[2] as ResolutionPreset | undefined) ?? DEFAULT_RESOLUTION_FROM_AUTO,
  };
}

function normalizeFHLAspectSelection(aspect: AspectPreset): VisibleFHLAspectPreset {
  switch (aspect) {
    case "3:2":
    case "2:3":
    case "16:9":
    case "9:16":
    case "2:1":
    case "1:2":
    case "7:4":
    case "4:7":
    case "1:1":
      return aspect;
    case "4:3":
    case "5:4":
      return "3:2";
    case "3:4":
    case "4:5":
      return "2:3";
    case "21:9":
      return "16:9";
    case "9:21":
      return "9:16";
    case "3:1":
      return "7:4";
    case "1:3":
      return "4:7";
    default:
      return "1:1";
  }
}

function normalizeAPIMartAspectSelection(aspect: AspectPreset): Exclude<APIMartAspectPreset, "auto"> {
  return aspect !== "auto" && APIMART_ASPECT_VALUES.has(aspect)
    ? aspect as Exclude<APIMartAspectPreset, "auto">
    : "1:1";
}

export function aspectPresetsForAPIMode(apiMode: APIMode): AspectPresetOption[] {
  return apiMode === "apimart" ? APIMART_ASPECT_PRESETS : ASPECT_PRESETS;
}

export function normalizeAspectSelection(
  aspect: AspectPreset,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): AspectPreset {
  if (input.apiMode === "apimart") {
    return aspect === "auto" ? "auto" : normalizeAPIMartAspectSelection(aspect);
  }
  if (aspect === "auto") return "auto";
  return normalizeFHLAspectSelection(aspect);
}

export function supportsExplicitLargeSizes({
  apiMode,
  requestPolicy,
  imageModelID,
}: {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
}): boolean {
  const family = classifyImageModel(imageModelID || "");
  if (apiMode === "images") {
    return family === "gpt-image" || family === "dalle3";
  }
  if (family === "gpt-image") {
    return true;
  }
  return requestPolicy === "compat";
}

export function availableResolutionPresets(input: {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
}): ResolutionPreset[] {
  const all: ResolutionPreset[] = ["auto", "1k", "2k", "4k"];
  if (input.apiMode === "apimart") {
    return all;
  }
  if (supportsExplicitLargeSizes(input)) {
    return all;
  }
  return all.filter((value) => !LARGE_RESOLUTION_PRESETS.has(value));
}

export function deriveAspectPreset(size: SizeValue): AspectPreset {
  const apimartSize = parseAPIMartSize(size);
  if (apimartSize) return apimartSize.aspect;
  return SIZE_TO_ASPECT[size] ?? "1:1";
}

export function deriveResolutionPreset(size: SizeValue): ResolutionPreset {
  const apimartSize = parseAPIMartSize(size);
  if (apimartSize) return apimartSize.resolution;
  return SIZE_TO_RESOLUTION[size] ?? "1k";
}

export function buildSizeSelection(
  aspect: AspectPreset,
  resolution: ResolutionPreset,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): SizeValue {
  if (aspect === "auto" || resolution === "auto") {
    return "auto";
  }
  const normalizedResolution = normalizeResolutionSelection(resolution, input);
  if (normalizedResolution === "auto") {
    return "auto";
  }
  if (input.apiMode === "apimart") {
    return `${normalizeAPIMartAspectSelection(aspect)}@${normalizedResolution}`;
  }
  return FHL_SIZE_MATRIX[normalizeFHLAspectSelection(aspect)][normalizedResolution];
}

export function buildAspectSizeSelection(
  aspect: AspectPreset,
  currentResolution: ResolutionPreset,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): SizeValue {
  if (aspect === "auto") return "auto";
  const normalizedResolution = normalizeResolutionSelection(currentResolution, input);
  return buildSizeSelection(
    aspect,
    normalizedResolution === "auto" ? DEFAULT_RESOLUTION_FROM_AUTO : normalizedResolution,
    input,
  );
}

export function buildResolutionSizeSelection(
  currentAspect: AspectPreset,
  resolution: ResolutionPreset,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): SizeValue {
  if (resolution === "auto") return "auto";
  const defaultAspect = input.apiMode === "apimart"
    ? DEFAULT_APIMART_ASPECT_FROM_AUTO
    : DEFAULT_FHL_ASPECT_FROM_AUTO;
  return buildSizeSelection(
    currentAspect === "auto" ? defaultAspect : currentAspect,
    normalizeResolutionSelection(resolution, input),
    input,
  );
}

export function normalizeResolutionSelection(
  resolution: ResolutionPreset,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): ResolutionPreset {
  const allowed = new Set(availableResolutionPresets(input));
  return allowed.has(resolution) ? resolution : "1k";
}

export function normalizeSizeSelection(
  size: SizeValue,
  input: {
    apiMode: APIMode;
    requestPolicy: RequestPolicy;
    imageModelID?: string;
  },
): SizeValue {
  const aspect = deriveAspectPreset(size);
  const resolution = deriveResolutionPreset(size);
  return buildSizeSelection(aspect, resolution, input);
}

export function sizeCapabilityHint(input: {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
}): string {
  if (input.apiMode === "apimart") {
    return "";
  }
  if (supportsExplicitLargeSizes(input)) {
    return "";
  }
  return "当前链路只保证基础尺寸稳定可用。";
}
