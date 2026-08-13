import type { StudioState } from "../state/studioStore.types";
import { syncCLIConfigQuietly } from "./cliConfigSync.ts";
import {
  DEFAULT_CONCURRENCY_LIMIT,
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_PROFILE_NAME,
  FHL_TEXT_MODEL_ID,
  isOfficialFHLPoolProfile,
  isOfficialFHLTextProfile,
  nextDefaultProfileName,
} from "./profiles.ts";

export const FHL_INVITE_CODE = "LPUH6EEHGK3R";
export const FHL_REGISTER_URL = `https://www.fhl.mom/register?aff=${FHL_INVITE_CODE}`;

type FHLProfileActions = Pick<
  StudioState,
  "profiles" | "activeProfileId" | "createProfile" | "updateProfile" | "setActiveProfile"
>;

type EnsureFHLResponsesProfileOptions = {
  setActive?: boolean;
};

function officialProfileName(store: FHLProfileActions, currentId = ""): string {
  const candidates = currentId
    ? store.profiles.filter((profile) => profile.id !== currentId)
    : store.profiles;
  return nextDefaultProfileName(candidates) || FHL_PROFILE_NAME;
}

function shouldRenameLegacyFHLProfile(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || trimmed === "FHL Responses" || trimmed === "FHL Images";
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

export async function ensureFHLResponsesProfile(
  store: FHLProfileActions,
  options: EnsureFHLResponsesProfileOptions = {},
): Promise<string> {
  const setActive = options.setActive !== false;
  // Slotted Responses profiles belong to image generation. Text tools get a
  // dedicated no-slot profile so they never overwrite a pool member.
  const fhlProfile = store.profiles.find(isOfficialFHLTextProfile);

  if (!fhlProfile) {
    const id = await store.createProfile({
      name: officialProfileName(store),
      apiMode: "responses",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      imagesNewAPICompat: false,
      setActive,
    });
    syncCLIConfigQuietly();
    return id;
  }

  await store.updateProfile(fhlProfile.id, {
    name: shouldRenameLegacyFHLProfile(fhlProfile.name)
      ? officialProfileName(store, fhlProfile.id)
      : fhlProfile.name,
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: FHL_TEXT_MODEL_ID,
    imageModelID: FHL_IMAGE_MODEL_ID,
    concurrencyLimit: fhlProfile.concurrencyLimit > 0 ? Math.min(2, fhlProfile.concurrencyLimit) : DEFAULT_CONCURRENCY_LIMIT,
    imagesNewAPICompat: false,
  });
  if (setActive && fhlProfile.id !== store.activeProfileId) {
    await store.setActiveProfile(fhlProfile.id);
  }
  syncCLIConfigQuietly();
  return fhlProfile.id;
}

export async function ensureFHLImagesProfile(store: FHLProfileActions): Promise<string> {
  const fhlProfile = store.profiles.find((profile) => (
    isOfficialFHLPoolProfile(profile)
    && profile.imageModelID === FHL_IMAGE_MODEL_ID
  ));

  if (!fhlProfile) {
    const id = await store.createProfile({
      name: officialProfileName(store),
      apiMode: "images",
      requestPolicy: "openai",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
      imageModelID: FHL_IMAGE_MODEL_ID,
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      imagesNewAPICompat: true,
      setActive: true,
    });
    syncCLIConfigQuietly();
    return id;
  }

  await store.updateProfile(fhlProfile.id, {
    name: shouldRenameLegacyFHLProfile(fhlProfile.name)
      ? officialProfileName(store, fhlProfile.id)
      : fhlProfile.name,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: FHL_TEXT_MODEL_ID,
    imageModelID: FHL_IMAGE_MODEL_ID,
    concurrencyLimit: fhlProfile.concurrencyLimit > 0 ? Math.min(2, fhlProfile.concurrencyLimit) : DEFAULT_CONCURRENCY_LIMIT,
    imagesNewAPICompat: true,
  });
  if (fhlProfile.id !== store.activeProfileId) {
    await store.setActiveProfile(fhlProfile.id);
  }
  syncCLIConfigQuietly();
  return fhlProfile.id;
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
