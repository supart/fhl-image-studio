import type { backend } from "../../wailsjs/go/models.ts";
import type {
  APIMode,
  HistoryItem,
  ImageBackgroundMode,
  JobGroupSnapshot,
  JobSlotSnapshot,
  OutputFormatValue,
  QualityValue,
  SizeValue,
  SourceImage,
} from "../types/domain.ts";
import type { FrozenSubmissionReplay } from "./studioStore.types.ts";
import { sourceImagesFromHistoryItem } from "./historySourceImages.ts";

type FrozenPayloadLike = backend.GenerateOptions & {
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  styleTag?: string;
};

function pathLeaf(filePath: string): string {
  const normalized = String(filePath || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) return "image.png";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || "image.png";
}

export function sourceImagesFromFrozenPaths(paths: string[] | undefined): SourceImage[] {
  return (paths ?? [])
    .map((filePath) => String(filePath || "").trim())
    .filter(Boolean)
    .map((filePath) => ({
      path: filePath,
      name: pathLeaf(filePath),
      size: 0,
    }));
}

function frozenAPIMode(value: unknown): APIMode | null {
  return value === "images" || value === "responses" || value === "apimart" || value === "runninghub"
    ? value
    : null;
}

function frozenOutputFormat(value: unknown): OutputFormatValue | null {
  return value === "png" || value === "jpeg" || value === "webp" ? value : null;
}

function frozenBackgroundMode(value: unknown): ImageBackgroundMode {
  return value === "transparent" ? "transparent" : "standard";
}

type FrozenImageModelMetadata = Pick<
  JobGroupSnapshot,
  "imageModelID" | "imageModelValidatedAt" | "imageModelCatalogBaseUrl"
    | "imageModelCatalogProvider" | "imageModelAvailable"
    | "imageModelSupportsGenerations" | "imageModelSupportsEdits"
    | "imageModelSupportsTransparency" | "imageModelCatalogValidationId"
>;

const frozenModelMetadataKeys = [
  "imageModelID",
  "imageModelValidatedAt",
  "imageModelCatalogBaseUrl",
  "imageModelCatalogProvider",
  "imageModelAvailable",
  "imageModelSupportsGenerations",
  "imageModelSupportsEdits",
  "imageModelSupportsTransparency",
  "imageModelCatalogValidationId",
] as const satisfies readonly (keyof FrozenImageModelMetadata)[];

function hasMetadataValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** A job slot may narrow missing group metadata, but two defined snapshots must
 * never disagree. Conflicts are treated as an untrusted replay source. */
export function jobSlotHasConflictingImageModelMetadata(
  group: FrozenImageModelMetadata,
  slot: FrozenImageModelMetadata,
): boolean {
  return frozenModelMetadataKeys.some((key) => {
    const groupValue = group[key];
    const slotValue = slot[key];
    return hasMetadataValue(groupValue)
      && hasMetadataValue(slotValue)
      && groupValue !== slotValue;
  });
}

function strictOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function frozenReplayFromHistory(item: HistoryItem): FrozenSubmissionReplay | null {
  const apiProfileId = item.apiProfileId?.trim() || "";
  const provider = item.provider?.trim() || "";
  const imageModelID = item.imageModelID?.trim() || "";
  const outputFormat = frozenOutputFormat(item.outputFormat);
  if (!apiProfileId || !item.apiMode || !provider || !imageModelID || !outputFormat) return null;
  return {
    source: "history",
    apiProfileId,
    apiProfileName: item.apiProfileName,
    fhlImagesPoolSlot: item.fhlImagesPoolSlot,
    apiMode: item.apiMode,
    provider,
    imageModelID,
    imageModelValidatedAt: item.imageModelValidatedAt,
    imageModelCatalogBaseUrl: item.imageModelCatalogBaseUrl,
    imageModelCatalogProvider: item.imageModelCatalogProvider,
    imageModelAvailable: item.imageModelAvailable,
    imageModelSupportsGenerations: item.imageModelSupportsGenerations,
    imageModelSupportsEdits: item.imageModelSupportsEdits,
    imageModelSupportsTransparency: item.imageModelSupportsTransparency,
    imageModelCatalogValidationId: item.imageModelCatalogValidationId,
    mode: item.mode,
    prompt: item.prompt || "",
    size: item.size,
    quality: item.quality,
    outputFormat,
    imageBackgroundMode: frozenBackgroundMode(item.imageBackgroundMode),
    seed: Number.isFinite(Number(item.seed)) ? Number(item.seed) : 0,
    negativePrompt: item.negativePrompt || "",
    styleTag: item.styleTag || "",
    sources: item.mode === "edit" ? sourceImagesFromHistoryItem(item) : [],
  };
}

export function frozenReplayFromJobSlot(
  group: JobGroupSnapshot,
  slot: JobSlotSnapshot,
): FrozenSubmissionReplay | null {
  if (jobSlotHasConflictingImageModelMetadata(group, slot)) return null;
  const apiProfileId = (slot.apiProfileId || group.apiProfileId || "").trim();
  const provider = (slot.provider || group.provider || "").trim();
  const imageModelID = (slot.imageModelID || group.imageModelID || "").trim();
  if (!apiProfileId || !provider || !imageModelID) return null;
  const seedBase = Number.isFinite(Number(group.seed)) ? Number(group.seed) : 0;
  return {
    source: "job-slot",
    apiProfileId,
    apiProfileName: slot.apiProfileName || group.apiProfileName,
    fhlImagesPoolSlot: slot.fhlImagesPoolSlot ?? group.fhlImagesPoolSlot,
    apiMode: group.apiMode,
    provider,
    imageModelID,
    imageModelValidatedAt: slot.imageModelValidatedAt ?? group.imageModelValidatedAt,
    imageModelCatalogBaseUrl: slot.imageModelCatalogBaseUrl || group.imageModelCatalogBaseUrl,
    imageModelCatalogProvider: slot.imageModelCatalogProvider || group.imageModelCatalogProvider,
    imageModelAvailable: strictOptionalBoolean(slot.imageModelAvailable ?? group.imageModelAvailable),
    imageModelSupportsGenerations: strictOptionalBoolean(slot.imageModelSupportsGenerations ?? group.imageModelSupportsGenerations),
    imageModelSupportsEdits: strictOptionalBoolean(slot.imageModelSupportsEdits ?? group.imageModelSupportsEdits),
    imageModelSupportsTransparency: strictOptionalBoolean(slot.imageModelSupportsTransparency ?? group.imageModelSupportsTransparency),
    imageModelCatalogValidationId: slot.imageModelCatalogValidationId || group.imageModelCatalogValidationId,
    mode: group.mode,
    prompt: group.prompt || "",
    size: group.size,
    quality: group.quality,
    outputFormat: group.outputFormat,
    imageBackgroundMode: frozenBackgroundMode(slot.imageBackgroundMode ?? group.imageBackgroundMode),
    seed: seedBase > 0 ? seedBase + slot.batchIndex : seedBase,
    negativePrompt: group.negativePrompt || "",
    styleTag: group.styleTag || "",
    sources: group.mode === "edit" ? sourceImagesFromFrozenPaths(group.sourceImagePaths) : [],
  };
}

export function frozenReplayFromLastPayload(
  payload: backend.GenerateOptions,
): FrozenSubmissionReplay | null {
  const frozen = payload as FrozenPayloadLike;
  const apiProfileId = frozen.apiProfileId?.trim() || "";
  const provider = frozen.provider?.trim() || "";
  const imageModelID = frozen.imageModelID?.trim() || "";
  const apiMode = frozenAPIMode(frozen.apiMode);
  const outputFormat = frozenOutputFormat(frozen.outputFormat);
  if (!apiProfileId || !provider || !imageModelID || !apiMode || !outputFormat) return null;
  return {
    source: "last-payload",
    apiProfileId,
    apiProfileName: frozen.apiProfileName,
    fhlImagesPoolSlot: frozen.fhlImagesPoolSlot,
    apiMode,
    provider,
    imageModelID,
    imageModelValidatedAt: frozen.imageModelValidatedAt,
    imageModelCatalogBaseUrl: frozen.imageModelCatalogBaseUrl,
    imageModelCatalogProvider: frozen.imageModelCatalogProvider,
    imageModelAvailable: frozen.imageModelAvailable,
    imageModelSupportsGenerations: frozen.imageModelSupportsGenerations,
    imageModelSupportsEdits: frozen.imageModelSupportsEdits,
    imageModelSupportsTransparency: frozen.imageModelSupportsTransparency,
    imageModelCatalogValidationId: frozen.imageModelCatalogValidationId,
    mode: frozen.mode === "edit" ? "edit" : "generate",
    prompt: frozen.prompt || "",
    size: frozen.size as SizeValue,
    quality: frozen.quality as QualityValue,
    outputFormat,
    imageBackgroundMode: frozenBackgroundMode(frozen.imageBackgroundMode),
    seed: Number.isFinite(Number(frozen.seed)) ? Number(frozen.seed) : 0,
    negativePrompt: frozen.negativePrompt || "",
    styleTag: frozen.styleTag || "",
    sources: frozen.mode === "edit" ? sourceImagesFromFrozenPaths(frozen.imagePaths) : [],
  };
}
