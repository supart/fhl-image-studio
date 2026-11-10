import { listImageModelsFromUpstream } from "../platform/runtime/host.ts";
import type { ImageModelDescriptorLike } from "../platform/runtime/hostTypes.ts";
import type { UpstreamProfile } from "../types/domain";
import { storageKey } from "./storageNamespace.ts";

export const IMAGE_MODEL_CATALOG_VERSION = 2;
export const IMAGE_MODEL_CATALOG_LS_KEY = storageKey("gptcodex.fhl.image-model-catalog.v2");
export const IMAGE_MODEL_TRANSPARENT_PROMPT = "Output on a fully transparent background with real alpha transparency and clean edges. Do not add a solid backdrop, drawn checkerboard, scenery, or watermark.";
export const GPT_IMAGE_2_FAMILY_PATTERN = /^gpt-image-2(?:\.(\d+))?(?:-[a-z0-9][a-z0-9._-]*)?$/i;

/** Kept as a compatibility alias for callers that used the old literal type. */
export type SupportedFHLImageModelID = string;

export type ImageModelDescriptor = {
  id: string;
  description: string;
  imageCapable: boolean;
  supportsGenerations: boolean;
  supportsEdits: boolean;
  supportsTransparency: boolean;
  available: boolean;
  disabledReason?: string;
};

export type StoredImageModelCatalog = {
  version: number;
  baseUrl: string;
  provider: string;
  fetchedAt: number;
  models: ImageModelDescriptor[];
  /** Process/native-private proof returned by Android; never persisted in localStorage. */
  validationId?: string;
};

export type FetchFHLImageModelCatalogOptions = {
  /** Keep false while validating several independent pool credentials. */
  persist?: boolean;
  /** Allows a completed validation batch to share one exact snapshot time. */
  fetchedAt?: number;
  validationProfileId?: string;
  validationSlotNumber?: number;
};

type ImageModelDescriptorInput = Partial<ImageModelDescriptor> & {
  id?: unknown;
};

const NON_IMAGE_HINT = /(?:^|[-_.])(?:text|chat|language|embedding|embed|audio|speech|moderation|rerank|transcri(?:be|ption)|tts|whisper)(?:$|[-_.])/i;
const IMAGE_NAME_HINT = /(?:^|[-_.])image(?:$|[-_.])|vision|paint|diffusion|flux|sdxl|stable-diffusion/i;
const FIXED_DISABLED_REASONS = new Set([
  "不可调用的模糊模型别名",
  "Provider 未声明图像生成能力",
  "Provider 不支持图像生成",
  "Provider 标记为不可用",
  "当前 API 路由不支持",
  "Provider 明确禁止当前能力",
  "当前 Android 实现暂不支持",
  "并非所有已启用槽位共同可用",
]);

const DESCRIPTIONS: Record<string, string> = {
  "gpt-image-2": "兼容原有 V2.0 工作方式，继续使用稳定流程。",
  "gpt-image-2.5-flare": "速度优先，适合批量生成和快速迭代，支持透明 PNG。",
  "gpt-image-2.5-sunburst": "高精度，适合精细编辑、复杂细节和透明 PNG。",
};

function normalizedBaseUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    // Catalog metadata must never retain credentials, query strings or
    // fragments copied from a provider URL.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    pathname = pathname.replace(/\/v1$/i, "");
    const host = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol.toLowerCase()}//${host}${port}${pathname}`;
  } catch {
    // Keep non-URL values comparable without retaining request components.
    return raw
      .split(/[?#]/, 1)[0]
      .replace(/\/v1$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function safeProvider(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 80 || /\p{Cc}/u.test(raw)) return "fhl";
  if (/(?:bearer\s+|(?:^|[^a-z])(?:sk|msk)-[a-z0-9])/i.test(raw)) return "fhl";
  const safe = raw.replace(/[^\p{L}\p{N}._:-]+/gu, "_").slice(0, 80);
  return safe || "fhl";
}

export function isGPTImage2FamilyID(value: unknown): value is string {
  const id = cleanExactID(value);
  return !!id && GPT_IMAGE_2_FAMILY_PATTERN.test(id);
}

export function gptImage2Minor(value: unknown): number | null {
  const id = cleanExactID(value);
  if (!id || !GPT_IMAGE_2_FAMILY_PATTERN.test(id)) return null;
  const match = GPT_IMAGE_2_FAMILY_PATTERN.exec(id);
  if (!match?.[1]) return 0;
  const minor = Number(match[1]);
  return Number.isSafeInteger(minor) ? minor : null;
}

function isFuzzyImage25Alias(value: string): boolean {
  return value.trim().toLowerCase() === "gpt-image-2.5";
}

/** Only callable exact GPT Image 2.x IDs may be committed to a profile. */
export function isSupportedFHLImageModelID(value: unknown): value is SupportedFHLImageModelID {
  const id = typeof value === "string" ? cleanExactID(value) : "";
  return !!id && isGPTImage2FamilyID(id) && !isFuzzyImage25Alias(id);
}

function cleanExactID(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || Array.from(id).length > 128 || /\p{Cc}/u.test(id)) return "";
  return id;
}

function explicitImageCapability(item: ImageModelDescriptorInput): boolean | undefined {
  const flags = [item.imageCapable, item.supportsGenerations, item.supportsEdits]
    .filter((value): value is boolean => typeof value === "boolean");
  return flags.length > 0 ? flags.some(Boolean) : undefined;
}

function isCandidateModel(id: string, item: ImageModelDescriptorInput): boolean {
  const explicit = explicitImageCapability(item);
  // Keep every syntactically valid GPT Image 2.x row as a diagnostic, even
  // when provider metadata disables it. Other known text/audio model families
  // must never enter the Android image catalog merely because a malformed row
  // also contains an optimistic capability flag.
  if (isGPTImage2FamilyID(id)) return true;
  if (NON_IMAGE_HINT.test(id)) return false;
  if (explicit === true) return true;
  return IMAGE_NAME_HINT.test(id);
}

function safeDisabledReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (FIXED_DISABLED_REASONS.has(raw)) return raw;
  if (/模糊|alias/i.test(raw)) return "不可调用的模糊模型别名";
  if (/透明|transparen/i.test(raw)) return "Provider 明确禁止当前能力";
  if (/生成|generation|image/i.test(raw) && /不|未|禁止|unsupported|disable/i.test(raw)) {
    return "Provider 不支持图像生成";
  }
  return raw ? "Provider 标记为不可用" : undefined;
}

function knownDescription(id: string): string {
  return DESCRIPTIONS[id.toLowerCase()] || "Provider 返回的图像模型";
}

function normalizeDescriptor(id: string, item: ImageModelDescriptorInput): ImageModelDescriptor {
  const gptFamily = isGPTImage2FamilyID(id);
  const explicit = explicitImageCapability(item);
  const imageCapable = typeof item.imageCapable === "boolean"
    ? item.imageCapable
    : true;
  const supportsGenerations = typeof item.supportsGenerations === "boolean"
    ? item.supportsGenerations
    : true;
  const supportsEdits = typeof item.supportsEdits === "boolean"
    ? item.supportsEdits
    : true;
  let available = item.available !== false && imageCapable && supportsGenerations;
  let disabledReason = safeDisabledReason(item.disabledReason);
  if (isFuzzyImage25Alias(id)) {
    available = false;
    disabledReason = "不可调用的模糊模型别名";
  } else if (!imageCapable) {
    available = false;
    disabledReason = "Provider 未声明图像生成能力";
  } else if (!supportsGenerations) {
    available = false;
    disabledReason = "Provider 不支持图像生成";
  } else if (!gptFamily) {
    available = false;
    disabledReason = "当前 Android 实现暂不支持";
  } else if (item.available === false && !disabledReason) {
    disabledReason = "Provider 标记为不可用";
  }
  const minor = gptImage2Minor(id);
  const supportsTransparency = available
    && minor !== null
    && minor >= 5
    && !isFuzzyImage25Alias(id)
    && item.supportsTransparency !== false;
  return {
    id,
    description: knownDescription(id),
    imageCapable,
    supportsGenerations,
    supportsEdits,
    supportsTransparency,
    available,
    ...(disabledReason ? { disabledReason } : {}),
  };
}

export function normalizeImageModelCatalog(
  models: readonly (ImageModelDescriptorInput | ImageModelDescriptorLike | string)[],
  baseUrl: string,
  provider = "fhl",
  fetchedAt = Date.now(),
): StoredImageModelCatalog {
  const normalizedByID = new Map<string, ImageModelDescriptor>();
  for (const raw of models) {
    const item: ImageModelDescriptorInput = typeof raw === "string" ? { id: raw } : raw ?? {};
    const id = cleanExactID(item.id);
    if (!id || !isCandidateModel(id, item)) continue;
    const key = id.toLowerCase();
    const descriptor = normalizeDescriptor(id, item);
    const previous = normalizedByID.get(key);
    if (!previous) {
      normalizedByID.set(key, descriptor);
      continue;
    }
    // Duplicate provider rows are merged conservatively instead of allowing a
    // later optimistic capability declaration to widen the model.
    const mergedAvailable = previous.available && descriptor.available;
    const mergedGenerations = previous.supportsGenerations && descriptor.supportsGenerations;
    const mergedEdits = previous.supportsEdits && descriptor.supportsEdits;
    const mergedTransparency = previous.supportsTransparency && descriptor.supportsTransparency;
    const mergedReason = previous.disabledReason || descriptor.disabledReason;
    normalizedByID.set(key, {
      ...previous,
      imageCapable: previous.imageCapable && descriptor.imageCapable,
      supportsGenerations: mergedGenerations,
      supportsEdits: mergedEdits,
      supportsTransparency: mergedTransparency,
      available: mergedAvailable,
      ...(mergedReason ? { disabledReason: mergedReason } : {}),
    });
  }
  const normalized = [...normalizedByID.values()];
  const safeFetchedAt = Number.isFinite(Number(fetchedAt)) && Number(fetchedAt) > 0
    ? Math.floor(Number(fetchedAt))
    : Date.now();
  return {
    version: IMAGE_MODEL_CATALOG_VERSION,
    baseUrl: normalizedBaseUrl(baseUrl),
    provider: safeProvider(provider),
    fetchedAt: safeFetchedAt,
    models: normalized,
  };
}

/**
 * Build the single catalog snapshot used by a uniformly configured FHL pool.
 * A capability remains available only when every participating credential
 * reported it for the same exact model ID.
 */
export function intersectFHLImageModelCatalogs(
  catalogs: readonly StoredImageModelCatalog[],
  sharedFetchedAt = Date.now(),
): StoredImageModelCatalog {
  if (catalogs.length === 0) {
    throw new Error("没有已配置且启用的 FHL Images 槽位可验证。");
  }

  const normalized = catalogs.map((catalog) => normalizeImageModelCatalog(
    catalog.models,
    catalog.baseUrl,
    catalog.provider,
    catalog.fetchedAt,
  ));
  const baseUrl = normalized[0].baseUrl;
  const provider = normalized[0].provider;
  if (normalized.some((catalog) => (
    catalog.baseUrl !== baseUrl || catalog.provider !== provider
  ))) {
    throw new Error("已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。");
  }

  const intersectedModels = normalized[0].models.flatMap((firstModel) => {
    const firstKey = firstModel.id.toLowerCase();
    const matches = normalized.map((catalog) => (
      catalog.models.find((model) => model.id.toLowerCase() === firstKey)
    ));
    if (matches.some((model) => !model)) return [];
    const models = matches as ImageModelDescriptor[];
    return [{
      id: firstModel.id,
      imageCapable: models.every((model) => model.imageCapable),
      supportsGenerations: models.every((model) => model.supportsGenerations),
      supportsEdits: models.every((model) => model.supportsEdits),
      supportsTransparency: models.every((model) => model.supportsTransparency),
      available: models.every((model) => model.available),
      ...(models.find((model) => model.disabledReason)?.disabledReason
        ? { disabledReason: models.find((model) => model.disabledReason)?.disabledReason }
        : {}),
    }];
  });
  const catalog = normalizeImageModelCatalog(
    intersectedModels,
    baseUrl,
    provider,
    sharedFetchedAt,
  );
  if (catalog.models.length === 0) {
    throw new Error("已配置且启用的 FHL Images 槽位没有共同可用的精确生图模型。");
  }
  return catalog;
}

export function persistImageModelCatalog(catalog: StoredImageModelCatalog): boolean {
  try {
    const safe = normalizeImageModelCatalog(
      catalog.models,
      catalog.baseUrl,
      catalog.provider,
      catalog.fetchedAt,
    );
    localStorage.setItem(IMAGE_MODEL_CATALOG_LS_KEY, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}

export function loadImageModelCatalog(baseUrl?: string, provider?: string): StoredImageModelCatalog | null {
  try {
    const raw = localStorage.getItem(IMAGE_MODEL_CATALOG_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredImageModelCatalog;
    if (parsed?.version !== IMAGE_MODEL_CATALOG_VERSION || !Array.isArray(parsed.models)) return null;
    if (baseUrl !== undefined && normalizedBaseUrl(parsed.baseUrl) !== normalizedBaseUrl(baseUrl)) return null;
    if (provider !== undefined && safeProvider(parsed.provider) !== safeProvider(provider)) return null;
    const catalog = normalizeImageModelCatalog(parsed.models, parsed.baseUrl, parsed.provider, parsed.fetchedAt);
    return catalog.models.length > 0 ? catalog : null;
  } catch {
    return null;
  }
}

export function imageModelCatalogEntry(catalog: StoredImageModelCatalog | null | undefined, modelID: string): ImageModelDescriptor | null {
  const id = cleanExactID(modelID);
  const key = id.toLowerCase();
  return catalog?.models.find((model) => model.id.toLowerCase() === key) ?? null;
}

export function imageModelIsValidated(
  profile: Pick<UpstreamProfile,
    | "imageModelID"
    | "imageModelValidatedAt"
    | "imageModelCatalogBaseUrl"
    | "imageModelCatalogProvider"
    | "imageModelAvailable"
    | "imageModelSupportsGenerations"
    | "imageModelSupportsEdits"
    | "imageModelSupportsTransparency"
    | "imageModelCatalogValidationId"
  > | null | undefined,
  catalog: StoredImageModelCatalog | null | undefined,
): boolean {
  if (!profile?.imageModelValidatedAt || !Number.isFinite(profile.imageModelValidatedAt)) return false;
  if (!catalog || profile.imageModelValidatedAt !== catalog.fetchedAt) return false;
  if (!profile.imageModelCatalogBaseUrl?.trim() || !profile.imageModelCatalogProvider?.trim()) return false;
  if (normalizedBaseUrl(profile.imageModelCatalogBaseUrl) !== normalizedBaseUrl(catalog.baseUrl)) return false;
  if (safeProvider(profile.imageModelCatalogProvider) !== safeProvider(catalog.provider)) return false;
  const entry = imageModelCatalogEntry(catalog, profile.imageModelID);
  return entry?.available === true
    && entry.supportsGenerations === true
    && profile.imageModelAvailable === entry.available
    && profile.imageModelSupportsGenerations === entry.supportsGenerations
    && profile.imageModelSupportsEdits === entry.supportsEdits
    && profile.imageModelSupportsTransparency === entry.supportsTransparency
    && !!profile.imageModelCatalogValidationId?.trim();
}

export function imageModelSupportsTransparency(catalog: StoredImageModelCatalog | null | undefined, modelID: string): boolean {
  return imageModelCatalogEntry(catalog, modelID)?.supportsTransparency === true;
}

export function imageModelCatalogBaseUrl(value: string): string {
  return normalizedBaseUrl(value);
}

export function imageModelCatalogProvider(value: string): string {
  return safeProvider(value);
}

/** Resolve the configured provider identity for a profile. Catalog metadata
 * describes a previous validation and must never override current config. */
export function imageModelProviderForProfile(
  profile: Pick<UpstreamProfile, "provider"> | null | undefined,
): string {
  return safeProvider(profile?.provider || "fhl");
}

/** Fetch one successful image catalog. Persistence remains the default for
 * single-slot callers; pool validation can defer it until every slot passes. */
export async function fetchFHLImageModelCatalog(
  baseUrl: string,
  apiKey: string,
  provider = "fhl",
  proxyMode = "system",
  proxyURL = "",
  signal?: AbortSignal,
  options: FetchFHLImageModelCatalogOptions = {},
): Promise<StoredImageModelCatalog> {
  const result = await listImageModelsFromUpstream(
    baseUrl,
    apiKey,
    provider,
    proxyMode,
    proxyURL,
    signal,
    options.validationProfileId && options.validationSlotNumber && options.fetchedAt
      ? {
          profileId: options.validationProfileId,
          slotNumber: options.validationSlotNumber,
          fetchedAt: options.fetchedAt,
        }
      : undefined,
  );
  const normalized = normalizeImageModelCatalog(
    result.models ?? [],
    result.baseURL || baseUrl,
    result.provider || provider,
    options.fetchedAt ?? Date.now(),
  );
  const catalog: StoredImageModelCatalog = {
    ...normalized,
    ...(result.validationId ? { validationId: result.validationId } : {}),
  };
  if (catalog.models.length === 0) {
    throw new Error("当前 Images API 未返回可用的精确生图模型。");
  }
  if (options.persist !== false) persistImageModelCatalog(catalog);
  return catalog;
}

export function knownImageModelDescription(modelID: string): string {
  return DESCRIPTIONS[modelID.trim().toLowerCase()] || "Provider 返回的图像模型";
}
