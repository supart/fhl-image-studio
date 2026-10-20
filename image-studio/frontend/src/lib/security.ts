import type { HistoryItem } from "../types/domain";

export function cleanBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function sanitizeHistoryForExport(item: HistoryItem): HistoryItem {
  const localEditRoundtrip = item.localEditRoundtrip
    ? item.localEditRoundtrip.kind === "planar"
      ? { ...item.localEditRoundtrip, sourcePath: undefined, outputPath: undefined }
      : {
          ...item.localEditRoundtrip,
          sourcePath: undefined,
          panoramaRoundtrip: {
            ...item.localEditRoundtrip.panoramaRoundtrip,
            sourcePath: undefined,
            roundtripState: {
              ...item.localEditRoundtrip.panoramaRoundtrip.roundtripState,
              source_erp: {
                ...item.localEditRoundtrip.panoramaRoundtrip.roundtripState.source_erp,
                path: undefined,
              },
            },
          },
      }
    : undefined;
  const annotationComposite = item.annotationComposite
    ? { ...item.annotationComposite, sourcePath: undefined, outputPath: undefined }
    : undefined;
  return {
    ...item,
    savedPath: undefined,
    rawPath: undefined,
    fullUrl: undefined,
    imageB64: undefined,
    imageBlob: null,
    previewBlob: null,
    sourceImages: undefined,
    panoramaRoundtrip: undefined,
    localEditRoundtrip,
    annotationComposite,
    previewOnly: true,
  };
}

export function sanitizeImportedHistoryItem(item: HistoryItem): HistoryItem {
  return sanitizeHistoryForExport(item);
}

export function suggestedImportNameForHistory(item: Pick<HistoryItem, "id" | "mode">): string {
  return `history-${item.mode}-${item.id.slice(0, 8)}.png`;
}
