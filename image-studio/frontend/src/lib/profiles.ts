import type { APIMode, RequestPolicy, UpstreamProfile } from "../types/domain";
import { STORAGE_NAMESPACE, storageKey } from "./storageNamespace.ts";
import {
  isOfficialFHLProfile,
  normalizeProviderBaseURL,
  providerDefaults,
  providerModeLabel,
  ProviderPolicy,
} from "./providerPolicy.ts";

// localStorage 键名规范:
//   gptcodex.profiles        —— UpstreamProfile[] JSON(无 apiKey,key 在 keyring)
//   gptcodex.activeProfileId —— 当前 active profile 的 id
//
// 老格式(v0.1.5 及之前)在 bootstrap 一次性迁移:
//   gptcodex.apiMode                            "responses" | "images"
//   gptcodex.{responses,images}.baseURL
//   gptcodex.{responses,images}.textModelID
//   gptcodex.{responses,images}.imageModelID
//   gptcodex.{responses,images}.concurrencyLimit
//   keyring api-key:responses / api-key:images  → 搬到 api-key:profile:<newId>
export const PROFILES_LS_KEY = storageKey("gptcodex.profiles");
export const ACTIVE_PROFILE_LS_KEY = storageKey("gptcodex.activeProfileId");
export const FHL_PROFILE_ID = "fhl-responses-default";
export const FHL_IMAGES_PROFILE_ID = "fhl-images-default";
export const FHL_PROFILE_NAME = "FHL-1 Responses";
export const FHL_IMAGES_PROFILE_NAME = "FHL-1 Images";
export const FHL_BASE_URL: string = ProviderPolicy.fhl.baseURL;
export const FHL_TEXT_MODEL_ID: string = ProviderPolicy.fhl.textModelID;
export const FHL_IMAGE_MODEL_ID: string = ProviderPolicy.fhl.imageModelID;
export const APIMART_PROFILE_ID = "apimart-async-default";
export const APIMART_PROFILE_NAME = "APIMart 异步";
export const APIMART_BASE_URL: string = ProviderPolicy.apimart.baseURL;
export const APIMART_LEGACY_BASE_URL: string = ProviderPolicy.apimart.legacyBaseURL;
export const APIMART_IMAGE_MODEL_ID: string = ProviderPolicy.apimart.imageModelID;
export const APIMART_CONCURRENCY_LIMIT = 6;
export const RUNNINGHUB_BASE_URL: string = ProviderPolicy.runningHub.baseURL;
export const RUNNINGHUB_BANANA2_PROFILE_NAME = "RH-1 全能图像2";
export const RUNNINGHUB_IMAGE_G2_PROFILE_NAME = "RH-1 全能图像G2";
export const RUNNINGHUB_DEFAULT_MODEL_ID: string = ProviderPolicy.runningHub.imageModelID;
export const DEFAULT_CONCURRENCY_LIMIT = 4;
export const MAX_UPSTREAM_PROFILES = 10;
export const FHL_IMAGES_POOL_SLOT_COUNT = 10;
export const FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT = 5;
export const FHL_IMAGES_POOL_KEY_HINT_LENGTH = 4;
export const FHL_IMAGES_POOL_KEY_PREFIX_LENGTH = 3;

export function normalizeFHLPoolPerAPIConcurrencyLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY_LIMIT;
  if (parsed <= 0) return FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT;
  return Math.max(1, Math.min(FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, Math.floor(parsed)));
}

export function resolveFHLPoolPerAPIConcurrencyLimit(
  storedValue: unknown,
  legacySharedValue: unknown,
): number {
  if (storedValue !== null && storedValue !== undefined) {
    return normalizeFHLPoolPerAPIConcurrencyLimit(storedValue);
  }
  if (legacySharedValue !== null && legacySharedValue !== undefined) {
    return normalizeFHLPoolPerAPIConcurrencyLimit(legacySharedValue);
  }
  return DEFAULT_CONCURRENCY_LIMIT;
}

export function hasUpstreamProfileCapacity(profiles: readonly UpstreamProfile[], required = 1): boolean {
  const requested = Number(required);
  if (!Number.isFinite(requested)) return false;
  const requiredCount = Math.max(0, Math.floor(requested));
  // A helper that only reconciles existing profiles must remain usable when
  // old data already contains more than the current cap.
  return requiredCount === 0 || profiles.length + requiredCount <= MAX_UPSTREAM_PROFILES;
}

export function upstreamProfileLimitMessage(): string {
  return `最多只能保存 ${MAX_UPSTREAM_PROFILES} 个 API 配置。`;
}

export function normalizeFHLImagesPoolSlot(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= FHL_IMAGES_POOL_SLOT_COUNT ? value : undefined;
}

// Store only a redacted display hint so a saved pool row can be identified
// without querying the keyring or putting a credential in profile metadata.
export function normalizeFHLImagesPoolKeyHint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const redacted = text.match(/^(sk|msk)-([A-Za-z0-9_-]{1,})\.\.\.([A-Za-z0-9_-]{4})$/i);
  if (redacted) return `${redacted[1].toLowerCase()}-${redacted[2]}...${redacted[3]}`;

  const rawKey = text.match(/^(sk|msk)-([A-Za-z0-9._-]+)$/i);
  if (rawKey) {
    const token = rawKey[2].replace(/[^A-Za-z0-9_-]/g, "");
    if (token.length < FHL_IMAGES_POOL_KEY_HINT_LENGTH) return undefined;
    return `${rawKey[1].toLowerCase()}-${token.slice(0, FHL_IMAGES_POOL_KEY_PREFIX_LENGTH)}...${token.slice(-FHL_IMAGES_POOL_KEY_HINT_LENGTH)}`;
  }

  // V2.0.2.2 early builds persisted only a four-character tail. Preserve it
  // without inventing a prefix that was never stored.
  const safeSuffixSource = text.replace(/[^A-Za-z0-9_-]/g, "");
  if (safeSuffixSource.length < FHL_IMAGES_POOL_KEY_HINT_LENGTH) return undefined;
  return safeSuffixSource.slice(-FHL_IMAGES_POOL_KEY_HINT_LENGTH);
}

export function isOfficialFHLImagesProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL">,
): boolean {
  return profile.apiMode === "images" && isOfficialFHLProfile(profile);
}

export function hasUsableFHLConfiguration({
  apiKey,
  apiMode,
  baseURL,
  profiles,
}: {
  apiKey: string;
  apiMode: APIMode;
  baseURL: string;
  profiles: readonly UpstreamProfile[];
}): boolean {
  const hasCurrentCredential = (
    (apiMode === "responses" || apiMode === "images")
    && apiKey.trim().length > 0
  ) || (
    apiMode === "runninghub"
    && baseURL.trim().length > 0
  );
  if (hasCurrentCredential) return true;

  return profiles.some((profile) => (
    isOfficialFHLImagesProfile(profile)
    && normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot) !== undefined
    && normalizeFHLImagesPoolKeyHint(profile.fhlImagesPoolKeyHint) !== undefined
  ));
}

function compareFHLImagesProfiles(a: UpstreamProfile, b: UpstreamProfile): number {
  const aCreatedAt = Number.isFinite(a.createdAt) ? a.createdAt : 0;
  const bCreatedAt = Number.isFinite(b.createdAt) ? b.createdAt : 0;
  if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// This read-only projection is for the ten-row setup surface. Profiles without
// a persisted slot are placed by creation order, but are never rewritten here.
export function mapFHLImagesProfilesToPoolSlots(
  profiles: readonly UpstreamProfile[],
): Array<UpstreamProfile | null> {
  const slots: Array<UpstreamProfile | null> = Array.from(
    { length: FHL_IMAGES_POOL_SLOT_COUNT },
    () => null,
  );
  const unassigned: UpstreamProfile[] = [];
  const eligible = profiles
    .filter((profile) => isOfficialFHLImagesProfile(profile))
    .sort(compareFHLImagesProfiles);

  for (const profile of eligible) {
    const slot = normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot);
    if (slot !== undefined && slots[slot - 1] === null) {
      slots[slot - 1] = profile;
    } else {
      unassigned.push(profile);
    }
  }

  for (const profile of unassigned) {
    const emptyIndex = slots.findIndex((slot) => slot === null);
    if (emptyIndex < 0) break;
    slots[emptyIndex] = profile;
  }

  return slots;
}

export function isFHLImagesPoolSlotAvailable(
  profiles: readonly UpstreamProfile[],
  slot: unknown,
  excludeProfileId?: string,
): boolean {
  const normalizedSlot = normalizeFHLImagesPoolSlot(slot);
  if (normalizedSlot === undefined) return false;
  return !profiles.some((profile) => (
    profile.id !== excludeProfileId
    && isOfficialFHLImagesProfile(profile)
    && normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot) === normalizedSlot
  ));
}

// The Images pool owns ten fixed slots independently from the generic
// profile-list cap. Legacy eligible profiles consume their projected row too,
// so a new profile can never create a second owner for that visible slot.
export function hasFHLImagesPoolSlotCapacity(
  profiles: readonly UpstreamProfile[],
  slot: unknown,
): boolean {
  const normalizedSlot = normalizeFHLImagesPoolSlot(slot);
  return normalizedSlot !== undefined
    && mapFHLImagesProfilesToPoolSlots(profiles)[normalizedSlot - 1] === null;
}

export function normalizeAPIMartBaseURL(value: string): string {
  return normalizeProviderBaseURL("apimart", value);
}

export function isAPIMartOfficialBaseURL(value: string): boolean {
  const normalized = normalizeAPIMartBaseURL(value);
  return normalized === APIMART_BASE_URL || normalized === APIMART_LEGACY_BASE_URL;
}

export function makeFHLResponsesProfile(): UpstreamProfile {
  return {
    id: FHL_PROFILE_ID,
    name: FHL_PROFILE_NAME,
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: FHL_TEXT_MODEL_ID,
    imageModelID: FHL_IMAGE_MODEL_ID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
    continuousPoolEnabled: false,
    imagesNewAPICompat: false,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

export function makeFHLImagesProfile(): UpstreamProfile {
  return {
    id: FHL_IMAGES_PROFILE_ID,
    name: FHL_IMAGES_PROFILE_NAME,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    imageModelID: FHL_IMAGE_MODEL_ID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
    continuousPoolEnabled: true,
    imagesNewAPICompat: true,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

// crypto.randomUUID 在 WebView2 / 现代 Chromium 都有。fallback 防御老内核。
export function genProfileId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// keyringUser 把前端的 profile id 翻成后端 credentials.go 用的 user 字段。
// 命名空间 "profile:" 是为了和老的 "api-key:responses" / "api-key:images" 区分。
export function keyringUserFor(profileId: string): string {
  return `profile:${STORAGE_NAMESPACE}:${profileId}`;
}

export function apiModeLabel(mode: APIMode): string {
  return providerModeLabel(mode);
}

export function apiModeUsesBridgeStoredKey(mode: APIMode): boolean {
  return mode === "runninghub";
}

export function apiModeRequiresDirectAPIKey(mode: APIMode): boolean {
  return !apiModeUsesBridgeStoredKey(mode);
}

export function requestPolicyLabel(mode: RequestPolicy): string {
  return mode === "compat" ? "兼容中转扩展" : "OpenAI 标准";
}

// 从可信任的 JSON 反序列化一个 profile。字段缺失 / 类型不对回 null,bootstrap
// 里遇到坏的就跳过,不让一条坏数据带崩整张表。
export function tryParseProfile(raw: unknown): UpstreamProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  const apiMode = o.apiMode === "images" || o.apiMode === "apimart" || o.apiMode === "runninghub"
    ? o.apiMode
    : "responses";
  const requestPolicy = o.requestPolicy === "compat" ? "compat" : "openai";
  const rawBaseURL = typeof o.baseURL === "string" ? o.baseURL : "";
  const baseURL = apiMode === "apimart" ? normalizeAPIMartBaseURL(rawBaseURL) : rawBaseURL;
  const textModelID = typeof o.textModelID === "string" ? o.textModelID : "";
  const imageModelID = typeof o.imageModelID === "string" ? o.imageModelID : "";
  const rawConcurrencyLimit = typeof o.concurrencyLimit === "number" && o.concurrencyLimit >= 0
    ? Math.floor(o.concurrencyLimit) : 0;
  const continuousPoolEnabled = apiMode === "images" && o.continuousPoolEnabled !== false;
  const imagesNewAPICompat = o.imagesNewAPICompat === true;
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
  const lastUsedAt = typeof o.lastUsedAt === "number" ? o.lastUsedAt : undefined;
  const fhlImagesPoolSlot = isOfficialFHLImagesProfile({ apiMode, baseURL })
    ? normalizeFHLImagesPoolSlot(o.fhlImagesPoolSlot)
    : undefined;
  const fhlImagesPoolKeyHint = fhlImagesPoolSlot !== undefined
    ? normalizeFHLImagesPoolKeyHint(o.fhlImagesPoolKeyHint)
    : undefined;
  const concurrencyLimit = fhlImagesPoolSlot !== undefined
    ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
    : rawConcurrencyLimit;
  if (!id || !name) return null;
  return { id, name, apiMode, requestPolicy, baseURL, textModelID, imageModelID, concurrencyLimit, continuousPoolEnabled, fhlImagesPoolSlot, fhlImagesPoolKeyHint, imagesNewAPICompat, createdAt, lastUsedAt };
}

// 列表里挑当前 active —— activeProfileId 命中时用它,否则用最近使用过的,
// 否则就第一条。空列表返回 null,调用方据此弹「首次配置」modal。
export function pickActiveProfile(
  profiles: UpstreamProfile[],
  activeId: string,
): UpstreamProfile | null {
  if (profiles.length === 0) return null;
  const byId = profiles.find((p) => p.id === activeId);
  if (byId) return byId;
  const sorted = [...profiles].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  return sorted[0] ?? profiles[0];
}

export function nextDefaultProfileName(profiles: UpstreamProfile[] = []): string {
  const usedNumbers = new Set<number>();
  for (const profile of profiles) {
    const match = profile.name.trim().match(/^配置\s*(\d+)$/);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) usedNumbers.add(value);
  }
  let index = 1;
  while (usedNumbers.has(index)) index += 1;
  return `配置${index}`;
}

// 新建 profile 的默认值 —— UpstreamConfigModal 里点「+ 新建」用。
export function makeBlankProfile(apiMode: APIMode = "images", profiles: UpstreamProfile[] = []): UpstreamProfile {
  const isAPIMart = apiMode === "apimart";
  const defaults = providerDefaults(apiMode);
  return {
    id: genProfileId(),
    name: nextDefaultProfileName(profiles),
    apiMode,
    requestPolicy: "openai",
    baseURL: defaults.baseURL,
    textModelID: defaults.textModelID,
    imageModelID: defaults.imageModelID,
    concurrencyLimit: isAPIMart ? APIMART_CONCURRENCY_LIMIT : DEFAULT_CONCURRENCY_LIMIT,
    continuousPoolEnabled: apiMode === "images",
    imagesNewAPICompat: false,
    createdAt: Date.now(),
  };
}

// 复制一个 profile,name 末尾追加「副本」并生成新 id。
// keyring 里的 apiKey 由调用方在 commit 后单独搬过来(get → set)。
export function duplicateProfile(p: UpstreamProfile): UpstreamProfile {
  return {
    ...p,
    id: genProfileId(),
    name: `${p.name} · 副本`,
    fhlImagesPoolSlot: undefined,
    fhlImagesPoolKeyHint: undefined,
    createdAt: Date.now(),
    lastUsedAt: undefined,
  };
}

