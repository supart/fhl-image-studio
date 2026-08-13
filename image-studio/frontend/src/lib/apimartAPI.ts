import type { StudioState } from "../state/studioStore.types";
import type { UpstreamProfile } from "../types/domain";
import {
  APIMART_BASE_URL,
  APIMART_IMAGE_MODEL_ID,
  APIMART_LEGACY_BASE_URL,
  APIMART_PROFILE_NAME,
  APIMART_TEXT_MODEL_ID,
  DEFAULT_CONCURRENCY_LIMIT,
  isAPIMartBaseURL,
  nextDefaultProfileName,
} from "./profiles";

export const APIMART_REGISTER_URL = "https://www.apimart.ai/";

type APIMartProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

function profileName(store: APIMartProfileActions, currentId = ""): string {
  const candidates = currentId
    ? store.profiles.filter((profile) => profile.id !== currentId)
    : store.profiles;
  return nextDefaultProfileName(candidates) || APIMART_PROFILE_NAME;
}

function shouldRenameLegacyAPIMartProfile(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || trimmed === "APIMart" || trimmed === "APIMart Async";
}

export function isAPIMartAsyncProfile(profile: Pick<UpstreamProfile, "apiMode" | "baseURL" | "imageModelID">): boolean {
  return profile.apiMode === "apimart"
    || (isAPIMartBaseURL(profile.baseURL) && (profile.imageModelID.trim() || APIMART_IMAGE_MODEL_ID) === APIMART_IMAGE_MODEL_ID);
}

export async function ensureAPIMartAsyncProfile(store: APIMartProfileActions): Promise<string> {
  const existing = store.profiles.find((profile) => (
    profile.apiMode === "apimart"
    && isAPIMartBaseURL(profile.baseURL)
    && (profile.imageModelID.trim() || APIMART_IMAGE_MODEL_ID) === APIMART_IMAGE_MODEL_ID
  ));

  if (!existing) {
    const id = await store.createProfile({
      name: profileName(store),
      apiMode: "apimart",
      requestPolicy: "openai",
      baseURL: APIMART_BASE_URL,
      textModelID: APIMART_TEXT_MODEL_ID,
      imageModelID: APIMART_IMAGE_MODEL_ID,
      imagesNewAPICompat: false,
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      setActive: true,
    });
    return id;
  }

  await store.updateProfile(existing.id, {
    name: shouldRenameLegacyAPIMartProfile(existing.name)
      ? profileName(store, existing.id)
      : existing.name,
    apiMode: "apimart",
    requestPolicy: "openai",
    baseURL: isAPIMartBaseURL(existing.baseURL) ? existing.baseURL : APIMART_BASE_URL,
    textModelID: existing.textModelID || APIMART_TEXT_MODEL_ID,
    imageModelID: existing.imageModelID || APIMART_IMAGE_MODEL_ID,
    imagesNewAPICompat: false,
    concurrencyLimit: existing.concurrencyLimit > 0 ? Math.min(2, existing.concurrencyLimit) : DEFAULT_CONCURRENCY_LIMIT,
  });
  if (existing.id !== store.activeProfileId) {
    await store.setActiveProfile(existing.id);
  }
  return existing.id;
}

export function normalizeAPIMartBaseURL(value: string): string {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return APIMART_BASE_URL;
  if (trimmed.replace(/\/v1$/i, "") === APIMART_LEGACY_BASE_URL) return APIMART_LEGACY_BASE_URL;
  if (trimmed.replace(/\/v1$/i, "") === APIMART_BASE_URL) return APIMART_BASE_URL;
  return trimmed;
}

export function focusAPIMartAPIKeyInput() {
  const focusOnce = () => {
    const input = document.querySelector<HTMLInputElement>(
      "[data-apimart-api-key-input='true'], [data-upstream-api-key-input='true']",
    );
    if (!input) return false;
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
