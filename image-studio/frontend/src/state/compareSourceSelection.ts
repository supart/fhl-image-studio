import type { HistoryItem, SourceImage } from "../types/domain";
import { base64ToBlob } from "../lib/images.ts";
import { sourceImagesFromHistoryItem } from "./historySourceImages.ts";

const TEMP_SOURCE_COMPARE_PREFIX = "compare-source:";

function cloneSource(source: SourceImage | null | undefined): SourceImage | null {
  if (!source?.path) return null;
  return {
    path: source.path,
    name: source.name || source.path.split(/[\\/]/).pop() || "source.png",
    size: Number.isFinite(source.size) ? source.size : 0,
    previewUrl: source.previewUrl || undefined,
    imageB64: source.imageB64 || undefined,
    imageBlob: source.imageBlob ?? null,
  };
}

export function isTemporarySourceCompareItem(item: Pick<HistoryItem, "id"> | null | undefined): boolean {
  return !!item?.id?.startsWith(TEMP_SOURCE_COMPARE_PREFIX);
}

export function primaryCompareSourceFromCurrentImage(
  currentImage: HistoryItem | null | undefined,
  workspaceSources: SourceImage[] = [],
): SourceImage | null {
  const storedSource = cloneSource(currentImage?.sourceImages?.find((source) => String(source?.path || "").trim()));
  if (storedSource) return storedSource;

  const restoredSource = cloneSource(currentImage ? sourceImagesFromHistoryItem(currentImage)[0] : null);
  if (restoredSource) return restoredSource;

  return cloneSource(workspaceSources.find((source) => String(source?.path || "").trim()));
}

export async function materializeCompareSourceAsHistoryItem(
  source: SourceImage | null | undefined,
  currentImage: HistoryItem,
): Promise<HistoryItem | null> {
  const resolvedSource = cloneSource(source);
  if (!resolvedSource?.path) return null;

  let previewUrl = resolvedSource.previewUrl || undefined;
  let fullUrl = resolvedSource.previewUrl || undefined;
  let savedPath = resolvedSource.path;
  let imageId: string | undefined;
  let imageB64 = resolvedSource.imageB64 || undefined;
  let imageBlob = resolvedSource.imageBlob ?? null;

  if (!previewUrl && !imageB64 && !imageBlob) {
    const { ImportImagePath, RegisterImportedImageAsset, ReadImageAsBase64 } = await import("../platform/runtime/host");
    const imported = await ImportImagePath(resolvedSource.path).catch(() => null);
    if (imported?.path) {
      savedPath = imported.path;
      imageId = imported.imageId || undefined;
      previewUrl = imported.previewUrl || undefined;
      fullUrl = imported.imageId ? `/media/full/${imported.imageId}` : previewUrl;
    }
    const ref = await RegisterImportedImageAsset(savedPath).catch(() => null);
    previewUrl = ref?.previewUrl || previewUrl;
    fullUrl = ref?.fullUrl || ref?.previewUrl || fullUrl;
    savedPath = ref?.savedPath || savedPath;
    imageId = ref?.imageId || undefined;
    if (!previewUrl && !fullUrl) {
      const fullB64 = await ReadImageAsBase64(savedPath).catch(() => "");
      if (fullB64) {
        imageB64 = fullB64;
        imageBlob = base64ToBlob(fullB64);
      }
    }
  }

  if (!previewUrl && !fullUrl && !imageB64 && !imageBlob) return null;

  return {
    id: `${TEMP_SOURCE_COMPARE_PREFIX}${currentImage.id}:${savedPath}`,
    imageId,
    previewUrl,
    fullUrl: fullUrl || previewUrl,
    imageB64,
    imageBlob,
    prompt: currentImage.prompt,
    revisedPrompt: currentImage.revisedPrompt,
    mode: "edit",
    size: currentImage.size,
    quality: currentImage.quality,
    outputFormat: currentImage.outputFormat,
    parentId: resolvedSource.path,
    createdAt: Date.now(),
    savedPath,
  };
}
