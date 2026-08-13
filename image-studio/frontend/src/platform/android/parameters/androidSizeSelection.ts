import {
  buildAspectSizeSelection,
  buildResolutionSizeSelection,
  type AspectPreset,
  type ResolutionPreset,
} from "../../../components/panel/sizeCapabilities.ts";
import type { APIMode, RequestPolicy, SizeValue } from "../../../types/domain.ts";

type AndroidSizeSelectionInput = {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
};

export function buildAndroidAspectSizeSelection(
  aspect: AspectPreset,
  currentResolution: ResolutionPreset,
  input: AndroidSizeSelectionInput,
): SizeValue {
  return buildAspectSizeSelection(
    aspect,
    currentResolution,
    input,
  );
}

export function buildAndroidResolutionSizeSelection(
  currentAspect: AspectPreset,
  resolution: ResolutionPreset,
  input: AndroidSizeSelectionInput,
): SizeValue {
  return buildResolutionSizeSelection(
    currentAspect,
    resolution,
    input,
  );
}
