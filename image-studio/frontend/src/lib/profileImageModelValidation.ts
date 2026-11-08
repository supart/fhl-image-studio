import { imageModelCatalogBaseUrl, imageModelCatalogProvider } from "./fhlImageModels.ts";

/** Resolve the persisted validation timestamp without ever storing credentials. */
export function resolveImageModelValidatedAt(
  patch: { imageModelValidatedAt?: unknown },
  current: number | undefined,
  invalidated: boolean,
): number | undefined {
  if (Object.prototype.hasOwnProperty.call(patch, "imageModelValidatedAt")) {
    const value = Number(patch.imageModelValidatedAt);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }
  return invalidated ? undefined : current;
}

export function resolveImageModelCatalogBaseUrl(
  patch: { imageModelCatalogBaseUrl?: unknown },
  current: string | undefined,
  invalidated: boolean,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(patch, "imageModelCatalogBaseUrl")) {
    const value = imageModelCatalogBaseUrl(String(patch.imageModelCatalogBaseUrl ?? ""));
    return value || undefined;
  }
  return invalidated ? undefined : current;
}

export function resolveImageModelCatalogProvider(
  patch: { imageModelCatalogProvider?: unknown },
  current: string | undefined,
  invalidated: boolean,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(patch, "imageModelCatalogProvider")) {
    const raw = String(patch.imageModelCatalogProvider ?? "").trim();
    if (!raw) return undefined;
    const value = imageModelCatalogProvider(raw);
    return value || undefined;
  }
  return invalidated ? undefined : current;
}
