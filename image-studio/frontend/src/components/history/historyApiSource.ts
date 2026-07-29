import type { APIMode, HistoryItem, JobGroupSnapshot } from "../../types/domain";
import { normalizeFHLImagesPoolSlot } from "../../lib/profiles.ts";

const FHL_PROFILE_ID = "fhl-responses-default";

function apiModeName(mode: APIMode | string | undefined): string {
  if (mode === "apimart") return "APIMart";
  if (mode === "runninghub") return "RunningHub";
  if (mode === "images") return "Images API";
  if (mode === "responses") return "FHL";
  return "";
}

export type HistoryApiSource = Pick<HistoryItem, "apiMode" | "apiProfileName" | "apiProfileId" | "fhlImagesPoolSlot">;

function poolSlotLabel(source: Pick<HistoryApiSource, "fhlImagesPoolSlot">): string {
  const slot = normalizeFHLImagesPoolSlot(source.fhlImagesPoolSlot);
  return slot === undefined ? "" : `FHL${slot}`;
}

function sourceLooksLikeFHL(source: HistoryApiSource): boolean {
  if (source.apiMode === "apimart" || source.apiMode === "runninghub") return false;
  if (String(source.apiProfileId || "").trim() === FHL_PROFILE_ID) return true;
  return /\bfhl\b/i.test(String(source.apiProfileName || "").trim());
}

function configuredSourceName(source: HistoryApiSource): string {
  return String(source.apiProfileName || source.apiProfileId || "").trim();
}

function shortenConfiguredName(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "";
  if (/apimart/i.test(cleaned)) return "APIMart";
  if (/runninghub|^rh\b/i.test(cleaned)) return "RunningHub";
  if (/\bfhl\b/i.test(cleaned)) return "FHL";
  if (/images?\s*api/i.test(cleaned)) return "Images";
  const token = cleaned.split(/[\s\-_\/|:]+/).find(Boolean) || cleaned;
  const chars = Array.from(token);
  const asciiOnly = chars.every((char) => char.charCodeAt(0) < 128);
  const limit = asciiOnly ? 10 : 6;
  return chars.length > limit ? chars.slice(0, limit).join("") : token;
}

export function apiSourceDisplayName(source: HistoryApiSource): string {
  const slotLabel = poolSlotLabel(source);
  const configuredName = configuredSourceName(source);
  if (slotLabel) return configuredName ? `${slotLabel} · ${configuredName}` : slotLabel;
  if (sourceLooksLikeFHL(source)) return "FHL";
  const name = configuredName;
  if (name) return name;
  return apiModeName(source.apiMode);
}

export function apiSourceShortLabel(source: HistoryApiSource): string {
  const slotLabel = poolSlotLabel(source);
  if (slotLabel) return slotLabel;
  if (sourceLooksLikeFHL(source)) return "FHL";
  const modeName = apiModeName(source.apiMode).replace(" API", "");
  if (modeName) return modeName;
  const name = configuredSourceName(source);
  if (name) return shortenConfiguredName(name);
  return "";
}

export function apiSourceDetailLabel(source: HistoryApiSource): string {
  const configuredName = configuredSourceName(source);
  const modeName = sourceLooksLikeFHL(source) ? "FHL" : apiModeName(source.apiMode);
  const detail = configuredName && modeName ? `${configuredName} | ${modeName}` : configuredName || modeName;
  const slotLabel = poolSlotLabel(source);
  return slotLabel ? `${slotLabel}${detail ? ` · ${detail}` : ""}` : detail;
}

export function jobGroupApiSourceDisplayName(source: Pick<JobGroupSnapshot, "apiMode" | "apiProfileName" | "apiProfileId" | "fhlImagesPoolSlot">): string {
  const slotLabel = poolSlotLabel(source);
  const configuredName = String(source.apiProfileName || source.apiProfileId || "").trim();
  const sourceName = configuredName || apiModeName(source.apiMode);
  return slotLabel ? `${slotLabel}${sourceName ? ` · ${sourceName}` : ""}` : sourceName;
}
