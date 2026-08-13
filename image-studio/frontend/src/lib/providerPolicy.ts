import type { APIMode, UpstreamProfile } from "../types/domain";
import { cleanBaseURL } from "./security.ts";

export type FHLTransportMode = "images" | "responses";

export const ProviderPolicy = Object.freeze({
  fhl: Object.freeze({
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
  }),
});

type ProviderLike = Pick<UpstreamProfile, "apiMode" | "baseURL">
  & Partial<Pick<UpstreamProfile, "fhlImagesPoolSlot">>;

function hasFHLPoolSlot(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

export function normalizeFHLTransportModePreference(value: unknown): FHLTransportMode {
  return value === "responses" ? "responses" : "images";
}

type FHLTransportPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function readFHLTransportModePreference(
  storage: Pick<FHLTransportPreferenceStorage, "getItem">,
  key: string,
): FHLTransportMode {
  try {
    return normalizeFHLTransportModePreference(storage.getItem(key));
  } catch {
    return "images";
  }
}

export function writeFHLTransportModePreference(
  storage: Pick<FHLTransportPreferenceStorage, "setItem">,
  key: string,
  mode: FHLTransportMode,
): void {
  try { storage.setItem(key, mode); } catch {}
}

export function normalizeProviderBaseURL(value: string): string {
  const normalized = cleanBaseURL(value);
  try {
    const url = new URL(normalized);
    const rawHasEncodedOrRequestParts = /[%?#]/.test(normalized);
    const allowedPath = url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/";
    if (
      !rawHasEncodedOrRequestParts
      && url.protocol === "https:"
      && url.hostname.toLowerCase() === "www.fhl.mom"
      && (!url.port || url.port === "443")
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && allowedPath
    ) {
      return ProviderPolicy.fhl.baseURL;
    }
  } catch {
    // Non-URL values remain non-official and continue through normal profile handling.
  }
  return normalized;
}

export function isOfficialFHLProfile(
  profile: ProviderLike | null | undefined,
  fallback: Partial<ProviderLike> = {},
): boolean {
  const apiMode = profile?.apiMode ?? fallback.apiMode;
  const baseURL = profile?.baseURL || fallback.baseURL || "";
  return (apiMode === "images" || apiMode === "responses")
    && normalizeProviderBaseURL(baseURL) === ProviderPolicy.fhl.baseURL;
}

export function isOfficialFHLGenerationProfile(
  profile: ProviderLike | null | undefined,
  fallback: Partial<ProviderLike> = {},
): boolean {
  if (!isOfficialFHLProfile(profile, fallback)) return false;
  const apiMode = profile?.apiMode ?? fallback.apiMode;
  const poolSlot = profile?.fhlImagesPoolSlot ?? fallback.fhlImagesPoolSlot;
  return apiMode === "images" || hasFHLPoolSlot(poolSlot);
}

export function effectiveProviderMode(
  profile: ProviderLike | null | undefined,
  fallbackMode: APIMode,
  fhlTransportMode: FHLTransportMode,
  fallbackBaseURL = "",
): APIMode {
  return isOfficialFHLGenerationProfile(profile, { apiMode: fallbackMode, baseURL: fallbackBaseURL })
    ? fhlTransportMode
    : fallbackMode;
}

export function providerModeLabel(mode: APIMode): string {
  if (mode === "images") return "Images API";
  if (mode === "apimart") return "APIMart 异步 API";
  if (mode === "runninghub") return "RunningHub 桥接";
  return "Responses API";
}

export function fhlTransportLabel(mode: FHLTransportMode): string {
  return mode === "responses" ? "Responses API" : "Images API";
}
