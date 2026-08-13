import type { APIMode, RequestPolicy } from "../types/domain";
import { normalizeProfileAPIMode } from "./profiles.ts";

export type LocalFHLConfig = {
  apiKey: string;
  baseURL: string;
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  textModelID: string;
  imageModelID: string;
};

const LOCAL_CONFIG_ENDPOINT = "/__image-studio-local-config/fhl-api";

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadLocalFHLConfig(): Promise<LocalFHLConfig | null> {
  if (!isLocalPreviewHost() || typeof fetch !== "function") return null;
  try {
    const response = await fetch(LOCAL_CONFIG_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    const apiMode = normalizeProfileAPIMode(data.apiMode);
    const requestPolicy = data.requestPolicy === "compat" ? "compat" : "openai";
    return {
      apiKey: asString(data.apiKey),
      baseURL: asString(data.baseURL),
      apiMode,
      requestPolicy,
      textModelID: asString(data.textModelID),
      imageModelID: asString(data.imageModelID),
    };
  } catch {
    return null;
  }
}
