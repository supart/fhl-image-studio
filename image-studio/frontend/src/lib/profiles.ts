import type { APIMode, RequestPolicy, UpstreamProfile } from "../types/domain";
import { bestEffortUUID } from "./runtimeCompat.ts";
import { STORAGE_NAMESPACE, storageKey } from "./storageNamespace.ts";
import { isOfficialFHLProfile, normalizeProviderBaseURL } from "./providerPolicy.ts";

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
export const FHL_PROFILE_NAME = "配置1";
export const FHL_BASE_URL = "https://www.fhl.mom";
export const FHL_TEXT_MODEL_ID = "gpt-5.5";
export const FHL_IMAGE_MODEL_ID = "gpt-image-2";
export const DEFAULT_CONCURRENCY_LIMIT = 1;
export const FHL_IMAGES_POOL_SLOT_COUNT = 10;
export const FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT = 4;
export const FHL_IMAGES_POOL_KEY_HINT_LENGTH = 4;
export const FHL_IMAGES_POOL_KEY_PREFIX_LENGTH = 3;
export const APIMART_PROFILE_ID = "apimart-default";
export const APIMART_PROFILE_NAME = "APIMart";
export const APIMART_BASE_URL = "https://api.apimart.ai";
export const APIMART_OPENAI_BASE_URL = "https://api.apimart.ai/v1";
export const APIMART_LEGACY_BASE_URL = "https://api.apib.ai";
export const APIMART_LEGACY_OPENAI_BASE_URL = "https://api.apib.ai/v1";
export const APIMART_TEXT_MODEL_ID = "gpt-5";
export const APIMART_IMAGE_MODEL_ID = "gpt-image-2";
export const RUNNINGHUB_PROFILE_ID = "runninghub-banana2-default";
export const RUNNINGHUB_BANANA2_PROFILE_NAME = "RH-1 全能图像2";
export const RUNNINGHUB_IMAGE_G2_PROFILE_NAME = "RH-1 全能图像G2";
export const RUNNINGHUB_BASE_URL = "http://10.0.2.2:8117";
export const RUNNINGHUB_LOCALHOST_BASE_URL = "http://127.0.0.1:8117";
export const RUNNINGHUB_DEFAULT_MODEL_ID = "banana2";
export const RUNNINGHUB_IMAGE_G2_MODEL_ID = "image_g2";

type UpstreamConfigInput = {
  apiMode?: APIMode | string;
  baseURL?: string;
};

export type UpstreamConfigKind = "fhl" | "images" | "apimart" | "runninghub" | "responses";

function comparableBaseURL(value: string): string {
  const normalized = String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

export function normalizeProfileAPIMode(value: unknown): APIMode {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (mode === "images" || mode === "apimart" || mode === "runninghub") return mode;
  return "responses";
}

export function isFHLBaseURL(baseURL: string): boolean {
  return normalizeProviderBaseURL(baseURL) === FHL_BASE_URL;
}

export function normalizeFHLImagesPoolSlot(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= FHL_IMAGES_POOL_SLOT_COUNT ? value : undefined;
}

// Profile metadata only keeps a redacted display hint. The complete key stays
// in host credential storage and never enters localStorage/profile JSON.
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

  const safeSuffix = text.replace(/[^A-Za-z0-9_-]/g, "");
  return safeSuffix.length >= FHL_IMAGES_POOL_KEY_HINT_LENGTH
    ? safeSuffix.slice(-FHL_IMAGES_POOL_KEY_HINT_LENGTH)
    : undefined;
}

export function isOfficialFHLImagesProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL">,
): boolean {
  return profile.apiMode === "images" && isFHLBaseURL(profile.baseURL);
}

export function isOfficialFHLResponsesProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL">,
): boolean {
  return profile.apiMode === "responses" && isFHLBaseURL(profile.baseURL);
}

export function isOfficialFHLTextProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL"> & Partial<Pick<UpstreamProfile, "fhlImagesPoolSlot">>,
): boolean {
  return isOfficialFHLResponsesProfile(profile)
    && normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot) === undefined;
}

export function isSelectableGenerationProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL"> & Partial<Pick<UpstreamProfile, "fhlImagesPoolSlot">>,
): boolean {
  return !isOfficialFHLTextProfile(profile);
}

export function isOfficialFHLPoolProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL"> & Partial<Pick<UpstreamProfile, "fhlImagesPoolSlot">>,
): boolean {
  if (!isOfficialFHLProfile(profile)) return false;
  return profile.apiMode === "images" || normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot) !== undefined;
}

function compareFHLImagesProfiles(a: UpstreamProfile, b: UpstreamProfile): number {
  const aCreatedAt = Number.isFinite(a.createdAt) ? a.createdAt : 0;
  const bCreatedAt = Number.isFinite(b.createdAt) ? b.createdAt : 0;
  if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Read-only projection for the ten-slot editor. Legacy official Images
// profiles without a saved slot fill empty rows deterministically.
export function mapFHLImagesProfilesToPoolSlots(
  profiles: readonly UpstreamProfile[],
): Array<UpstreamProfile | null> {
  const slots: Array<UpstreamProfile | null> = Array.from(
    { length: FHL_IMAGES_POOL_SLOT_COUNT },
    () => null,
  );
  const unassigned: UpstreamProfile[] = [];
  const eligible = profiles
    .filter((profile) => isOfficialFHLPoolProfile(profile))
    .sort(compareFHLImagesProfiles);

  for (const profile of eligible) {
    const slot = normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot);
    if (slot !== undefined && slots[slot - 1] === null) slots[slot - 1] = profile;
    else unassigned.push(profile);
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
    && isOfficialFHLPoolProfile(profile)
    && normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot) === normalizedSlot
  ));
}

export function hasFHLImagesPoolSlotCapacity(
  profiles: readonly UpstreamProfile[],
  slot: unknown,
): boolean {
  const normalizedSlot = normalizeFHLImagesPoolSlot(slot);
  return normalizedSlot !== undefined
    && mapFHLImagesProfilesToPoolSlots(profiles)[normalizedSlot - 1] === null;
}

export function chooseFHLImagesPoolActivationTarget({
  profiles,
  activeProfileId,
  activeProfileReady,
  testedProfileIds = [],
  successfulProfileIds,
}: {
  profiles: readonly UpstreamProfile[];
  activeProfileId: string;
  activeProfileReady: boolean;
  testedProfileIds?: readonly string[];
  successfulProfileIds: readonly string[];
}): string | null {
  const successfulIds = new Set(successfulProfileIds.map((id) => id.trim()).filter(Boolean));
  const testedIds = new Set(testedProfileIds.map((id) => id.trim()).filter(Boolean));
  const activeWasTestedAndFailed = testedIds.has(activeProfileId) && !successfulIds.has(activeProfileId);
  if (
    activeProfileReady
    && !activeWasTestedAndFailed
    && profiles.some((profile) => profile.id === activeProfileId)
  ) return null;
  return mapFHLImagesProfilesToPoolSlots(profiles)
    .find((profile) => !!profile && successfulIds.has(profile.id))?.id ?? null;
}

export function isAPIMartBaseURL(baseURL: string): boolean {
  return comparableBaseURL(baseURL) === comparableBaseURL(APIMART_BASE_URL)
    || comparableBaseURL(baseURL) === comparableBaseURL(APIMART_OPENAI_BASE_URL)
    || comparableBaseURL(baseURL) === comparableBaseURL(APIMART_LEGACY_BASE_URL)
    || comparableBaseURL(baseURL) === comparableBaseURL(APIMART_LEGACY_OPENAI_BASE_URL);
}

export function isRunningHubBaseURL(baseURL: string): boolean {
  const comparable = comparableBaseURL(baseURL);
  return comparable === comparableBaseURL(RUNNINGHUB_BASE_URL)
    || comparable === comparableBaseURL(RUNNINGHUB_LOCALHOST_BASE_URL);
}

export function identifyUpstreamConfig(input: UpstreamConfigInput): UpstreamConfigKind {
  const apiMode = normalizeProfileAPIMode(input.apiMode);
  const baseURL = input.baseURL ?? "";
  if (apiMode === "apimart" || isAPIMartBaseURL(baseURL)) return "apimart";
  if (apiMode === "runninghub" || isRunningHubBaseURL(baseURL)) return "runninghub";
  if (isFHLBaseURL(baseURL)) return "fhl";
  if (apiMode === "images") return "images";
  return "responses";
}

export function upstreamConfigLabel(input: UpstreamConfigInput): string {
  const kind = identifyUpstreamConfig(input);
  if (kind === "fhl") return "FHL";
  if (kind === "images") return "Images API";
  if (kind === "apimart") return "APIMart";
  if (kind === "runninghub") return "RunningHub";
  return "Responses API";
}

export function upstreamConfigShortLabel(input: UpstreamConfigInput): string {
  const kind = identifyUpstreamConfig(input);
  if (kind === "fhl") return "FHL";
  if (kind === "apimart") return "APIMart";
  if (kind === "runninghub") return "RH";
  return kind === "images" ? "Images" : "Responses";
}

export function defaultProfileValuesForAPIMode(apiMode: APIMode): {
  requestPolicy: RequestPolicy;
  baseURL: string;
  textModelID: string;
  imageModelID: string;
} {
  if (apiMode === "apimart") {
    return {
      requestPolicy: "openai",
      baseURL: APIMART_BASE_URL,
      textModelID: APIMART_TEXT_MODEL_ID,
      imageModelID: APIMART_IMAGE_MODEL_ID,
    };
  }
  if (apiMode === "responses") {
    return {
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
      imageModelID: FHL_IMAGE_MODEL_ID,
    };
  }
  if (apiMode === "runninghub") {
    return {
      requestPolicy: "openai",
      baseURL: RUNNINGHUB_BASE_URL,
      textModelID: "",
      imageModelID: RUNNINGHUB_DEFAULT_MODEL_ID,
    };
  }
  return {
    requestPolicy: "openai",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
  };
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
    imagesNewAPICompat: false,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

export function makeAPIMartProfile(): UpstreamProfile {
  return {
    id: APIMART_PROFILE_ID,
    name: APIMART_PROFILE_NAME,
    apiMode: "apimart",
    requestPolicy: "openai",
    baseURL: APIMART_BASE_URL,
    textModelID: APIMART_TEXT_MODEL_ID,
    imageModelID: APIMART_IMAGE_MODEL_ID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
    imagesNewAPICompat: false,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

export function makeRunningHubProfile(): UpstreamProfile {
  return {
    id: RUNNINGHUB_PROFILE_ID,
    name: RUNNINGHUB_BANANA2_PROFILE_NAME,
    apiMode: "runninghub",
    requestPolicy: "openai",
    baseURL: RUNNINGHUB_BASE_URL,
    textModelID: "",
    imageModelID: RUNNINGHUB_DEFAULT_MODEL_ID,
    concurrencyLimit: 1,
    imagesNewAPICompat: false,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

export function genProfileId(): string {
  return bestEffortUUID("p");
}

// keyringUser 把前端的 profile id 翻成后端 credentials.go 用的 user 字段。
// 命名空间 "profile:" 是为了和老的 "api-key:responses" / "api-key:images" 区分。
export function keyringUserFor(profileId: string): string {
  return `profile:${STORAGE_NAMESPACE}:${profileId}`;
}

export function apiModeLabel(mode: APIMode): string {
  if (mode === "apimart") return "APIMart";
  if (mode === "runninghub") return "RunningHub";
  return mode === "images" ? "Images API" : "Responses API";
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
  const apiMode = normalizeProfileAPIMode(o.apiMode);
  const requestPolicy = o.requestPolicy === "compat" ? "compat" : "openai";
  const baseURL = typeof o.baseURL === "string" ? o.baseURL : "";
  const textModelID = typeof o.textModelID === "string" ? o.textModelID : "";
  const imageModelID = typeof o.imageModelID === "string" ? o.imageModelID : "";
  const rawConcurrencyLimit = typeof o.concurrencyLimit === "number" && o.concurrencyLimit >= 0
    ? Math.floor(o.concurrencyLimit) : 0;
  const storedFHLPoolSlot = isOfficialFHLProfile({ apiMode, baseURL })
    ? normalizeFHLImagesPoolSlot(o.fhlImagesPoolSlot)
    : undefined;
  const continuousPoolEnabled = (apiMode === "images" || storedFHLPoolSlot !== undefined)
    && o.continuousPoolEnabled !== false;
  const imagesNewAPICompat = o.imagesNewAPICompat === true;
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
  const lastUsedAt = typeof o.lastUsedAt === "number" ? o.lastUsedAt : undefined;
  const fhlImagesPoolSlot = storedFHLPoolSlot;
  const fhlImagesPoolKeyHint = fhlImagesPoolSlot !== undefined
    ? normalizeFHLImagesPoolKeyHint(o.fhlImagesPoolKeyHint)
    : undefined;
  const concurrencyLimit = fhlImagesPoolSlot !== undefined
    ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
    : rawConcurrencyLimit;
  if (!id || !name) return null;
  return {
    id,
    name,
    apiMode,
    requestPolicy,
    baseURL,
    textModelID,
    imageModelID,
    concurrencyLimit,
    continuousPoolEnabled,
    fhlImagesPoolSlot,
    fhlImagesPoolKeyHint,
    imagesNewAPICompat,
    createdAt,
    lastUsedAt,
  };
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
export function makeBlankProfile(apiMode: APIMode = "responses", profiles: UpstreamProfile[] = []): UpstreamProfile {
  const defaults = defaultProfileValuesForAPIMode(apiMode);
  return {
    id: genProfileId(),
    name: nextDefaultProfileName(profiles),
    apiMode,
    requestPolicy: defaults.requestPolicy,
    baseURL: defaults.baseURL,
    textModelID: defaults.textModelID,
    imageModelID: defaults.imageModelID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
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
    createdAt: Date.now(),
    lastUsedAt: undefined,
    fhlImagesPoolSlot: undefined,
    fhlImagesPoolKeyHint: undefined,
  };
}
