import type { BackgroundMode, ImageModelSelectionStatus } from "../types/domain";

export const FHL_IMAGE_MODEL_FLARE = "gpt-image-2.5-flare";
export const FHL_IMAGE_MODEL_SUNBURST = "gpt-image-2.5-sunburst";
export const FHL_IMAGE_MODEL_LEGACY = "gpt-image-2";

// Keep known IDs for descriptions and migration compatibility. FHL can expose
// new image models before a desktop release is updated, so this is not a
// runtime allowlist.
export type FHLSelectableImageModel = string;

export const FHL_IMAGE_MODEL_DESCRIPTIONS: Record<string, string> = {
  [FHL_IMAGE_MODEL_FLARE]: "速度、批量、高吞吐",
  [FHL_IMAGE_MODEL_SUNBURST]: "精度、细节、精细编辑",
  [FHL_IMAGE_MODEL_LEGACY]: "旧版兼容",
};

export function isSelectableFHLImageModel(value: string | null | undefined): value is FHLSelectableImageModel {
  return String(value || "").trim().length > 0;
}

/** GPT Image 2.x models are highlighted, while every fetched model remains selectable. */
export function isHighlightedFHLImageModel(value: string | null | undefined): boolean {
  return /^gpt-image-2(?:$|[.-])/i.test(String(value || "").trim());
}

export function describeFHLImageModel(value: string | null | undefined): string {
  const modelID = String(value || "").trim();
  if (FHL_IMAGE_MODEL_DESCRIPTIONS[modelID]) return FHL_IMAGE_MODEL_DESCRIPTIONS[modelID];
  return isHighlightedFHLImageModel(modelID) ? "GPT Image 2 系列" : "上游模型，可选";
}

export function supportsTransparentBackground(value: string | null | undefined): boolean {
  const modelID = String(value || "").trim().toLowerCase();
  // The legacy exact `gpt-image-2` model is opaque-only. Versioned and
  // suffixed GPT Image 2.x models expose transparent-background output.
  return /^gpt-image-2(?:\.|-)/i.test(modelID);
}

export function normalizeBackgroundMode(value: unknown, imageModelID?: string | null): BackgroundMode {
  return value === "transparent" && supportsTransparentBackground(imageModelID)
    ? "transparent"
    : "opaque";
}

export function imageModelSelectionStatus(
  modelID: string | null | undefined,
  explicitStatus?: ImageModelSelectionStatus | null,
): ImageModelSelectionStatus {
  if (explicitStatus === "selected" && isSelectableFHLImageModel(modelID)) return "selected";
  if (explicitStatus === "legacy" && String(modelID || "").trim()) return "legacy";
  if (!String(modelID || "").trim()) return "required";
  return explicitStatus === "required" ? "required" : "legacy";
}

export function validateFHLImageModelForGeneration(modelID: string | null | undefined): string | null {
  const normalized = String(modelID || "").trim();
  if (!normalized) return "请先在 FHL API 配置中拉取并选择生图模型。";
  return null;
}
