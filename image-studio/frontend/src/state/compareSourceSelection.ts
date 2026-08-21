import type { HistoryItem, SourceImage } from "../types/domain";
import { base64ToBlob } from "../lib/images.ts";
import { sourceImagesFromHistoryItem } from "./historySourceImages.ts";

const TEMP_SOURCE_COMPARE_PREFIX = "compare-source:";

type ComparableSourceImage = SourceImage & {
  // These fields may exist on a live source object even though old persisted
  // workspace snapshots only retain path + previewUrl.
  imageId?: string;
  fullUrl?: string;
};

function isUsableFullUrl(value: unknown): value is string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return false;
  // The media preview endpoints are AVIF/thumbnail derivatives, never the
  // source that should be enlarged in a compare canvas.
  return !/\/media\/(?:thumb|preview)\//i.test(url);
}

function cloneSource(source: SourceImage | null | undefined): ComparableSourceImage | null {
  if (!source?.path) return null;
  const raw = source as ComparableSourceImage;
  return {
    path: source.path,
    name: source.name || source.path.split(/[\\/]/).pop() || "source.png",
    size: Number.isFinite(source.size) ? source.size : 0,
    previewUrl: source.previewUrl || undefined,
    imageB64: source.imageB64 || undefined,
    imageBlob: source.imageBlob ?? null,
    imageId: raw.imageId || undefined,
    fullUrl: isUsableFullUrl(raw.fullUrl) ? raw.fullUrl : undefined,
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
  let fullUrl = resolvedSource.fullUrl || undefined;
  let savedPath = resolvedSource.path;
  let imageId: string | undefined = resolvedSource.imageId;
  let imageB64 = resolvedSource.imageB64 || undefined;
  let imageBlob = resolvedSource.imageBlob ?? null;

  // A source preview is intentionally present for the reference strip, but it
  // is usually a 384px derivative. Resolve the managed full media by path even
  // when that preview already exists; only keep the preview as a last-resort
  // fallback when the host cannot expose the original.
  if (!imageB64 && !imageBlob) {
    const { ImportImagePath, RegisterImportedImageAsset, ReadImageAsBase64 } = await import("../platform/runtime/host.ts");
    const applyMediaRef = (ref: {
      savedPath?: string;
      imageId?: string;
      previewUrl?: string;
      fullUrl?: string;
    } | null | undefined) => {
      if (!ref) return;
      savedPath = ref.savedPath || savedPath;
      imageId = ref.imageId || imageId;
      previewUrl = ref.previewUrl || previewUrl;
      if (isUsableFullUrl(ref.fullUrl)) fullUrl = ref.fullUrl;
    };

    const registerCurrentPath = async () => {
      const ref = await RegisterImportedImageAsset(savedPath).catch(() => null);
      applyMediaRef(ref);
      return !!fullUrl;
    };

    let hasFullMedia = await registerCurrentPath();
    if (!hasFullMedia) {
      // External paths may not be in the host's managed roots yet. Import once,
      // then register the managed copy so the compare view still gets a full URL.
      const imported = await ImportImagePath(savedPath).catch(() => null);
      if (imported?.path) {
        savedPath = imported.path;
        imageId = imported.imageId || imageId;
        previewUrl = imported.previewUrl || previewUrl;
        if (imported.imageB64) {
          imageB64 = imported.imageB64;
          imageBlob = base64ToBlob(imported.imageB64);
        }
        hasFullMedia = await registerCurrentPath();
      }
    }

    if (!hasFullMedia && !imageB64 && !imageBlob && !previewUrl) {
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
    fullUrl,
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
