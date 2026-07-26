import type { StudioState } from "../state/studioStore.types";
import { GetStoredAPIKey, probeCurrentUpstream } from "../platform/runtime/host";
import type { UpstreamProfile } from "../types/domain";
import { syncCLIConfigQuietly } from "./cliConfigSync";
import { isOfficialFHLProfile, ProviderPolicy } from "./providerPolicy";
import {
  DEFAULT_CONCURRENCY_LIMIT,
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_PROFILE_ID,
  FHL_PROFILE_ID,
  FHL_TEXT_MODEL_ID,
  hasUpstreamProfileCapacity,
  keyringUserFor,
  upstreamProfileLimitMessage,
} from "./profiles";

export const FHL_INVITE_CODE = "LPUH6EEHGK3R";
export const FHL_REGISTER_URL = `${ProviderPolicy.fhl.baseURL}/register?aff=${FHL_INVITE_CODE}`;

type FHLProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

type FHLPairConfig = {
  responsesId: string;
  imagesId: string;
  baseName: string;
};

export type FHLQuickVerifyResult = {
  ok: boolean;
  detail: string;
  rawPath: string | null;
  profileId: string;
  profileName: string;
  apiMode: "responses" | "images";
};

type FHLVerifyOptions = {
  proxyMode?: string;
  proxyURL?: string;
  signal?: AbortSignal;
};

const FHL_VERIFY_TIMEOUT_MS = 45_000;

function parseFHLBaseName(name: string): string | null {
  const match = name.trim().match(/^(FHL-\d+)(?:\s+(?:Responses|Images))?$/i);
  return match ? match[1] : null;
}

function desiredFHLProfileName(baseName: string, apiMode: "responses" | "images"): string {
  return `${baseName} ${apiMode === "responses" ? "Responses" : "Images"}`;
}

function shouldRenameLegacyFHLProfile(name: string, desiredName: string): boolean {
  const trimmed = name.trim();
  if (trimmed === desiredName) return false;
  if (trimmed === "" || trimmed === "FHL Responses" || trimmed === "FHL Images") return true;
  if (/^配置\s*\d+$/u.test(trimmed)) return true;
  return parseFHLBaseName(trimmed) !== null;
}

function nextFHLBaseName(store: FHLProfileActions, currentIds: string[] = []): string {
  const ignored = new Set(currentIds.filter(Boolean));
  const usedNumbers = new Set<number>();
  for (const profile of store.profiles) {
    if (ignored.has(profile.id)) continue;
    const baseName = parseFHLBaseName(profile.name);
    if (!baseName) continue;
    const match = baseName.match(/^FHL-(\d+)$/i);
    const value = match ? Number(match[1]) : Number.NaN;
    if (Number.isInteger(value) && value > 0) usedNumbers.add(value);
  }
  let index = 1;
  while (usedNumbers.has(index)) index += 1;
  return `FHL-${index}`;
}

function findFHLProfile(
  store: FHLProfileActions,
  apiMode: "responses" | "images",
): StudioState["profiles"][number] | null {
  const expectedId = apiMode === "responses" ? FHL_PROFILE_ID : FHL_IMAGES_PROFILE_ID;
  return store.profiles.find((profile) => (
    (profile.id === expectedId)
    || (
      profile.apiMode === apiMode
      && isOfficialFHLProfile(profile)
      && profile.imageModelID.trim() === ProviderPolicy.fhl.imageModelID
    )
  )) ?? null;
}

async function loadStoredProfileAPIKey(profileId: string): Promise<string> {
  const stored = await GetStoredAPIKey(keyringUserFor(profileId)).catch(() => "");
  return stored.trim();
}

function resolveFHLBaseName(
  store: FHLProfileActions,
  responsesProfile: StudioState["profiles"][number] | null,
  imagesProfile: StudioState["profiles"][number] | null,
): string {
  const existingBase = parseFHLBaseName(responsesProfile?.name || "")
    || parseFHLBaseName(imagesProfile?.name || "");
  return existingBase || nextFHLBaseName(store, [responsesProfile?.id || "", imagesProfile?.id || ""]);
}

export async function ensureFHLProfiles(store: FHLProfileActions): Promise<FHLPairConfig> {
  const responsesProfile = findFHLProfile(store, "responses");
  const imagesProfile = findFHLProfile(store, "images");
  const baseName = resolveFHLBaseName(store, responsesProfile, imagesProfile);
  const responsesName = desiredFHLProfileName(baseName, "responses");
  const imagesName = desiredFHLProfileName(baseName, "images");
  const missingProfiles = Number(!responsesProfile) + Number(!imagesProfile);
  if (!hasUpstreamProfileCapacity(store.profiles, missingProfiles)) {
    throw new Error(upstreamProfileLimitMessage());
  }
  const responsesKey = responsesProfile ? await loadStoredProfileAPIKey(responsesProfile.id) : "";
  const imagesKey = imagesProfile ? await loadStoredProfileAPIKey(imagesProfile.id) : "";
  const sharedKey = responsesKey || imagesKey;
  let responsesId = responsesProfile?.id || "";
  let imagesId = imagesProfile?.id || "";

  if (!responsesProfile) {
    responsesId = await store.createProfile({
      name: responsesName,
      apiMode: "responses",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      continuousPoolEnabled: false,
      imagesNewAPICompat: false,
      apiKey: sharedKey || undefined,
      setActive: false,
    });
  } else {
    const patch: Parameters<FHLProfileActions["updateProfile"]>[1] = {
      name: shouldRenameLegacyFHLProfile(responsesProfile.name, responsesName)
        ? responsesName
        : responsesProfile.name,
      apiMode: "responses",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: responsesProfile.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT,
      continuousPoolEnabled: false,
      imagesNewAPICompat: false,
    };
    if (!responsesKey && sharedKey) patch.apiKey = sharedKey;
    await store.updateProfile(responsesProfile.id, patch);
    responsesId = responsesProfile.id;
  }

  if (!imagesProfile) {
    imagesId = await store.createProfile({
      name: imagesName,
      apiMode: "images",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: "",
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      continuousPoolEnabled: true,
      imagesNewAPICompat: true,
      apiKey: sharedKey || undefined,
      setActive: true,
    });
  } else {
    const patch: Parameters<FHLProfileActions["updateProfile"]>[1] = {
      name: shouldRenameLegacyFHLProfile(imagesProfile.name, imagesName)
        ? imagesName
        : imagesProfile.name,
      apiMode: "images",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: "",
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: imagesProfile.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT,
      continuousPoolEnabled: imagesProfile.continuousPoolEnabled ?? true,
      imagesNewAPICompat: true,
    };
    if (!imagesKey && sharedKey) patch.apiKey = sharedKey;
    await store.updateProfile(imagesProfile.id, patch);
    imagesId = imagesProfile.id;
  }

  if (imagesId !== store.activeProfileId) {
    await store.setActiveProfile(imagesId);
  }
  syncCLIConfigQuietly();
  return { responsesId, imagesId, baseName };
}

export async function configureFHLProfilesWithSharedAPIKey(
  store: FHLProfileActions,
  apiKey: string,
): Promise<FHLPairConfig> {
  const pair = await ensureFHLProfiles(store);
  await store.updateProfile(pair.responsesId, { apiKey });
  await store.updateProfile(pair.imagesId, { apiKey });
  if (pair.imagesId !== store.activeProfileId) {
    await store.setActiveProfile(pair.imagesId);
  }
  syncCLIConfigQuietly();
  return pair;
}

function createVerificationSignal(
  options: FHLVerifyOptions,
): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FHL_VERIFY_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromParent);
    },
    didTimeout: () => timedOut,
  };
}

function formatVerificationError(error: unknown, timedOut: boolean): string {
  if (timedOut) return `验证超时（${Math.ceil(FHL_VERIFY_TIMEOUT_MS / 1000)} 秒）`;
  if (error instanceof DOMException && error.name === "AbortError") return "验证已取消";
  const message = String((error as any)?.message || error || "").trim();
  if (!message) return "连接失败";
  return message;
}

export async function verifyFHLImageCapability(
  profile: UpstreamProfile,
  apiKey: string,
  options: FHLVerifyOptions = {},
): Promise<FHLQuickVerifyResult> {
  const verify = createVerificationSignal(options);
  try {
    await probeCurrentUpstream(
      profile.baseURL || FHL_BASE_URL,
      apiKey,
      options.proxyMode || "system",
      options.proxyURL || "",
      profile.apiMode === "images" ? "images" : "responses",
      verify.signal,
    );
    return {
      ok: true,
      detail: "连接验证成功（/v1/models）",
      rawPath: null,
      profileId: profile.id,
      profileName: profile.name,
      apiMode: profile.apiMode === "images" ? "images" : "responses",
    };
  } catch (error) {
    return {
      ok: false,
      detail: formatVerificationError(error, verify.didTimeout()),
      rawPath: null,
      profileId: profile.id,
      profileName: profile.name,
      apiMode: profile.apiMode === "images" ? "images" : "responses",
    };
  } finally {
    verify.cleanup();
  }
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy path below in restricted browser shells.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    input.remove();
  }

  if (!copied) throw new Error("Copy command was blocked");
}

export async function ensureFHLResponsesProfile(store: FHLProfileActions): Promise<string> {
  const pair = await ensureFHLProfiles(store);
  return pair.responsesId;
}

export function focusFHLAPIKeyInput() {
  const focusOnce = () => {
    const input = document.querySelector<HTMLInputElement>("[data-fhl-api-key-input='true']");
    if (!input) return false;
    const clearHighlight = () => {
      input.removeAttribute("data-fhl-api-key-highlight");
      const timer = Number(input.dataset.fhlApiKeyHighlightTimer || 0);
      if (timer) window.clearTimeout(timer);
      delete input.dataset.fhlApiKeyHighlightTimer;
    };
    clearHighlight();
    input.setAttribute("data-fhl-api-key-highlight", "true");
    input.addEventListener("input", clearHighlight, { once: true });
    input.dataset.fhlApiKeyHighlightTimer = String(window.setTimeout(clearHighlight, 9000));
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
    input.select();
    return true;
  };

  if (focusOnce()) return;
  [80, 220, 420, 720].forEach((delay) => {
    window.setTimeout(focusOnce, delay);
  });
}
