import type { HistoryItem, Mode, SourceImage } from "../types/domain";

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "source.png";
}

function cloneSourceImage(source: SourceImage, keepBlob: boolean): SourceImage | null {
  if (!source?.path) return null;
  const imageB64 = source.imageB64?.trim() ? source.imageB64 : undefined;
  return {
    path: source.path,
    name: source.name || fileNameFromPath(source.path),
    size: Number.isFinite(source.size) ? source.size : 0,
    width: Number.isFinite(source.width) ? source.width : undefined,
    height: Number.isFinite(source.height) ? source.height : undefined,
    previewUrl: source.previewUrl || undefined,
    photoMetadata: source.photoMetadata,
    imageB64,
    imageBlob: keepBlob ? source.imageBlob ?? null : null,
    panoramaRoundtrip: source.panoramaRoundtrip,
    panoramaProject: source.panoramaProject,
    localEditRoundtrip: source.localEditRoundtrip,
  };
}

export function sourceImagesFromPaths(paths: string[] | undefined): SourceImage[] {
  return (paths ?? [])
    .map((filePath) => String(filePath || "").trim())
    .filter(Boolean)
    .map((filePath) => ({
      path: filePath,
      name: fileNameFromPath(filePath),
      size: 0,
    }));
}

export function sourceImagesForHistory(mode: Mode | string, sources: SourceImage[]): SourceImage[] | undefined {
  if (mode !== "edit" || sources.length === 0) return undefined;
  const cloned = sources
    .map((source) => cloneSourceImage(source, false))
    .filter((source): source is SourceImage => !!source);
  return cloned.length > 0 ? cloned : undefined;
}

export function sourceImagesFromHistoryItem(item: HistoryItem): SourceImage[] {
  const stored = Array.isArray(item.sourceImages)
    ? item.sourceImages
        .map((source) => cloneSourceImage(source, true))
        .filter((source): source is SourceImage => !!source)
    : [];
  if (stored.length > 0) return stored;
  if (item.mode === "edit" && item.parentId) {
    return [{
      path: item.parentId,
      name: fileNameFromPath(item.parentId),
      size: 0,
      width: undefined,
      height: undefined,
      imageBlob: null,
    }];
  }
  return [];
}
