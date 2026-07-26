import { isLikelyPanoramaItem } from "../../panorama/core.ts";
import type { APIMode, BatchProcessConfig, HistoryItem, Mode, RequestPolicy, SizeValue } from "../../types/domain.ts";
import {
  aspectPresetsForAPIMode,
  buildAspectSizeSelection,
  type ResolutionPreset,
} from "../panel/sizeCapabilities.ts";

export const PANORAMA_STUDIO_ASPECT = "2:1" as const;

export function supportsPanoramaGenerateAspect(input: {
  apiMode: APIMode;
  mode?: Mode | string;
}): boolean {
  return aspectPresetsForAPIMode(input.apiMode, input.mode ?? "generate")
    .some((preset) => preset.value === PANORAMA_STUDIO_ASPECT);
}

export function buildPanoramaGenerateSize(input: {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
  currentResolution: ResolutionPreset;
}): SizeValue | null {
  if (!supportsPanoramaGenerateAspect({ apiMode: input.apiMode, mode: "generate" })) {
    return null;
  }
  return buildAspectSizeSelection(
    PANORAMA_STUDIO_ASPECT,
    input.currentResolution,
    {
      apiMode: input.apiMode,
      requestPolicy: input.requestPolicy,
      imageModelID: input.imageModelID,
      mode: "generate",
    },
  );
}

export function preservePanoramaManualAspect(
  batchProcess: BatchProcessConfig,
): BatchProcessConfig {
  if (batchProcess.autoAspectResolution === "") return batchProcess;
  return {
    ...batchProcess,
    autoAspectResolution: "",
  };
}

export function isPanoramaStudioItem(
  item: Pick<HistoryItem, "width" | "height" | "previewWidth" | "previewHeight" | "size" | "panoramaProject"> | null | undefined,
): boolean {
  return !!item?.panoramaProject?.sourceHistoryId || isLikelyPanoramaItem(item);
}

export function recentPanoramaHistoryItems(history: HistoryItem[], limit = 6): HistoryItem[] {
  return history
    .filter((item) => isPanoramaStudioItem(item))
    .slice(0, Math.max(0, limit));
}
