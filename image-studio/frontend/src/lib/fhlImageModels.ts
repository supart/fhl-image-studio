import { listImageModelsFromUpstream } from "../platform/runtime/host.ts";
import type { ImageModelDescriptorLike } from "../platform/runtime/hostTypes.ts";
import type { UpstreamProfile } from "../types/domain";
import { storageKey } from "./storageNamespace.ts";

export const IMAGE_MODEL_CATALOG_VERSION = 1;
export const IMAGE_MODEL_CATALOG_LS_KEY = storageKey("gptcodex.fhl.image-model-catalog.v1");
export const IMAGE_MODEL_TRANSPARENT_PROMPT = "Output on a fully transparent background with real alpha transparency and clean edges. Do not add a solid backdrop, drawn checkerboard, scenery, or watermark.";
export const SUPPORTED_FHL_IMAGE_MODEL_IDS = [
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;

export type SupportedFHLImageModelID = (typeof SUPPORTED_FHL_IMAGE_MODEL_IDS)[number];

export type ImageModelDescriptor = {
  id: string;
  description: string;
  imageCapable: boolean;
  supportsGenerations: boolean;
  supportsEdits: boolean;
  supportsTransparency: boolean;
};

export type StoredImageModelCatalog = {
  version: number;
  baseUrl: string;
  provider: string;
  fetchedAt: number;
  models: ImageModelDescriptor[];
};

export type FetchFHLImageModelCatalogOptions = {
  /** Keep false while validating several independent pool credentials. */
  persist?: boolean;
  /** Allows a completed validation batch to share one exact snapshot time. */
  fetchedAt?: number;
};

type ImageModelDescriptorInput = Partial<ImageModelDescriptor> & {
  id?: unknown;
};

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
  if (!raw || raw.length > 80 || /[\u0000-\u001f\u007f]/.test(raw)) return "fhl";
  if (/(?:bearer\s+|(?:^|[^a-z])(?:sk|msk)-[a-z0-9])/i.test(raw)) return "fhl";
  const safe = raw.replace(/[^\p{L}\p{N}._:-]+/gu, "_").slice(0, 80);
  return safe || "fhl";
}

export function isSupportedFHLImageModelID(value: unknown): value is SupportedFHLImageModelID {
  return typeof value === "string"
    && (SUPPORTED_FHL_IMAGE_MODEL_IDS as readonly string[]).includes(value);
}

function cleanExactID(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.toLowerCase() === "gpt-image-2.5" || Array.from(id).length > 128 || /[\u0000-\u001f\u007f]/.test(id)) return "";
  return id;
}

export function normalizeImageModelCatalog(
  models: readonly (ImageModelDescriptorInput | ImageModelDescriptorLike | string)[],
  baseUrl: string,
  provider = "fhl",
  fetchedAt = Date.now(),
): StoredImageModelCatalog {
  const seen = new Set<string>();
  const normalized: ImageModelDescriptor[] = [];
  for (const raw of models) {
    const item: ImageModelDescriptorInput = typeof raw === "string" ? { id: raw } : raw ?? {};
    const id = cleanExactID(item.id);
    if (!isSupportedFHLImageModelID(id) || seen.has(id)) continue;
    // A provider may explicitly mark an allow-listed ID as non-image or
    // input-only. Do not turn that metadata into a callable model.
    if (item.imageCapable === false) continue;
    seen.add(id);
    normalized.push({
      id,
      description: DESCRIPTIONS[id],
      imageCapable: true,
      supportsGenerations: item.supportsGenerations !== false,
      supportsEdits: item.supportsEdits !== false,
      supportsTransparency: id !== "gpt-image-2" && item.supportsTransparency !== false,
    });
  }
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
    const matches = normalized.map((catalog) => (
      catalog.models.find((model) => model.id === firstModel.id)
    ));
    if (matches.some((model) => !model)) return [];
    const models = matches as ImageModelDescriptor[];
    return [{
      id: firstModel.id,
      imageCapable: models.every((model) => model.imageCapable),
      supportsGenerations: models.every((model) => model.supportsGenerations),
      supportsEdits: models.every((model) => model.supportsEdits),
      supportsTransparency: models.every((model) => model.supportsTransparency),
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
  return catalog?.models.find((model) => model.id === id) ?? null;
}

export function imageModelIsValidated(
  profile: Pick<UpstreamProfile, "imageModelID" | "imageModelValidatedAt" | "imageModelCatalogBaseUrl" | "imageModelCatalogProvider"> | null | undefined,
  catalog: StoredImageModelCatalog | null | undefined,
): boolean {
  if (!profile?.imageModelValidatedAt || !Number.isFinite(profile.imageModelValidatedAt)) return false;
  if (!catalog || profile.imageModelValidatedAt !== catalog.fetchedAt) return false;
  if (!profile.imageModelCatalogBaseUrl?.trim() || !profile.imageModelCatalogProvider?.trim()) return false;
  if (normalizedBaseUrl(profile.imageModelCatalogBaseUrl) !== normalizedBaseUrl(catalog.baseUrl)) return false;
  if (safeProvider(profile.imageModelCatalogProvider) !== safeProvider(catalog.provider)) return false;
  return !!imageModelCatalogEntry(catalog, profile.imageModelID);
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
  );
  const catalog = normalizeImageModelCatalog(
    result.models ?? [],
    result.baseURL || baseUrl,
    result.provider || provider,
    options.fetchedAt ?? Date.now(),
  );
  if (catalog.models.length === 0) {
    throw new Error("当前 Images API 未返回可用的精确生图模型。");
  }
  if (options.persist !== false) persistImageModelCatalog(catalog);
  return catalog;
}

export function knownImageModelDescription(modelID: string): string {
  return DESCRIPTIONS[modelID.trim()] || "Provider 返回的图像模型";
}
