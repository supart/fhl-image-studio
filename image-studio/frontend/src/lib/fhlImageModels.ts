import type { BackgroundMode, ImageModelSelectionStatus } from "../types/domain";

export const FHL_IMAGE_MODEL_FLARE = "gpt-image-2.5-flare";
export const FHL_IMAGE_MODEL_SUNBURST = "gpt-image-2.5-sunburst";
export const FHL_IMAGE_MODEL_LEGACY = "gpt-image-2";

export const FHL_SELECTABLE_IMAGE_MODELS = [
  FHL_IMAGE_MODEL_FLARE,
  FHL_IMAGE_MODEL_SUNBURST,
  FHL_IMAGE_MODEL_LEGACY,
] as const;

export type FHLSelectableImageModel = typeof FHL_SELECTABLE_IMAGE_MODELS[number];

export const FHL_IMAGE_MODEL_DESCRIPTIONS: Record<FHLSelectableImageModel, string> = {
  [FHL_IMAGE_MODEL_FLARE]: "速度、批量、高吞吐",
  [FHL_IMAGE_MODEL_SUNBURST]: "精度、细节、精细编辑",
  [FHL_IMAGE_MODEL_LEGACY]: "旧版兼容",
};

export function isSelectableFHLImageModel(value: string | null | undefined): value is FHLSelectableImageModel {
  return FHL_SELECTABLE_IMAGE_MODELS.includes(String(value || "").trim() as FHLSelectableImageModel);
}

export function supportsTransparentBackground(value: string | null | undefined): boolean {
  const modelID = String(value || "").trim();
  return modelID === FHL_IMAGE_MODEL_FLARE || modelID === FHL_IMAGE_MODEL_SUNBURST;
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
  if (!isSelectableFHLImageModel(normalized)) {
    return `当前生图模型 ${normalized} 不受 V2.0.5 支持，请重新拉取并选择模型。`;
  }
  return null;
}
