import type { APIMode, UpstreamProfile } from "../types/domain";
import { cleanBaseURL } from "./security.ts";

export type FHLTransportMode = "images" | "responses";

export const ProviderPolicy = Object.freeze({
  fhl: Object.freeze({
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
  }),
  apimart: Object.freeze({
    baseURL: "https://api.apimart.ai",
    legacyBaseURL: "https://api.apib.ai",
    imageModelID: "gpt-image-2",
  }),
  runningHub: Object.freeze({
    baseURL: "http://127.0.0.1:8117",
    imageModelID: "banana2",
  }),
});

type ProviderLike = Pick<UpstreamProfile, "apiMode" | "baseURL">;

export function normalizeProviderBaseURL(mode: APIMode, value: string): string {
  const normalized = cleanBaseURL(value);
  if (mode !== "apimart") return normalized;
  if (normalized === `${ProviderPolicy.apimart.baseURL}/v1`) return ProviderPolicy.apimart.baseURL;
  if (normalized === `${ProviderPolicy.apimart.legacyBaseURL}/v1`) return ProviderPolicy.apimart.legacyBaseURL;
  return normalized;
}

export function isOfficialFHLProfile(
  profile: ProviderLike | null | undefined,
  fallback: Partial<ProviderLike> = {},
): boolean {
  const apiMode = profile?.apiMode ?? fallback.apiMode;
  const baseURL = profile?.baseURL || fallback.baseURL || "";
  return (apiMode === "images" || apiMode === "responses")
    && normalizeProviderBaseURL(apiMode, baseURL) === ProviderPolicy.fhl.baseURL;
}

export function effectiveProviderMode(
  profile: ProviderLike | null | undefined,
  fallbackMode: APIMode,
  fhlTransportMode: FHLTransportMode,
  fallbackBaseURL = "",
): APIMode {
  return isOfficialFHLProfile(profile, { apiMode: fallbackMode, baseURL: fallbackBaseURL })
    ? (fhlTransportMode === "responses" ? "responses" : "images")
    : fallbackMode;
}

export function providerModeLabel(mode: APIMode): string {
  if (mode === "images") return "Images API";
  if (mode === "apimart") return "APIMart 异步 API";
  if (mode === "runninghub") return "RunningHub 桥接";
  return "Responses API";
}

export function fhlTransportLabel(mode: FHLTransportMode): string {
  return mode === "responses" ? "FHL Responses" : "FHL Images";
}

export function providerDefaults(mode: APIMode): {
  baseURL: string;
  textModelID: string;
  imageModelID: string;
} {
  if (mode === "responses") {
    return {
      baseURL: ProviderPolicy.fhl.baseURL,
      textModelID: ProviderPolicy.fhl.textModelID,
      imageModelID: ProviderPolicy.fhl.imageModelID,
    };
  }
  if (mode === "apimart") {
    return {
      baseURL: ProviderPolicy.apimart.baseURL,
      textModelID: "",
      imageModelID: ProviderPolicy.apimart.imageModelID,
    };
  }
  if (mode === "runninghub") {
    return {
      baseURL: ProviderPolicy.runningHub.baseURL,
      textModelID: "",
      imageModelID: ProviderPolicy.runningHub.imageModelID,
    };
  }
  return { baseURL: "", textModelID: "", imageModelID: "" };
}
