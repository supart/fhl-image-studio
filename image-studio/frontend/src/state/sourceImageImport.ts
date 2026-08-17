import type { SourceImage } from "../types/domain";

export type SourceImageImportOutcome = "added" | "replaced" | "duplicate" | "stale";

export function applySourceImageImport(
  sources: SourceImage[],
  imported: SourceImage,
  replaceSourcePath?: string,
): { sources: SourceImage[]; outcome: SourceImageImportOutcome } {
  if (!replaceSourcePath) {
    if (sources.some((source) => source.path === imported.path)) {
      return { sources, outcome: "duplicate" };
    }
    return { sources: [...sources, imported], outcome: "added" };
  }

  const targetIndex = sources.findIndex((source) => source.path === replaceSourcePath);
  if (targetIndex < 0) return { sources, outcome: "stale" };
  if (sources.some((source, index) => index !== targetIndex && source.path === imported.path)) {
    return { sources, outcome: "duplicate" };
  }

  const next = [...sources];
  next[targetIndex] = imported;
  return { sources: next, outcome: "replaced" };
}
