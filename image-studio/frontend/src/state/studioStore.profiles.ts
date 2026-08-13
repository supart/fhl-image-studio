import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  SetStoredAPIKey,
} from "../platform/runtime/host";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import {
  defaultProfileValuesForAPIMode,
  duplicateProfile as cloneProfile,
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  FHL_TEXT_MODEL_ID,
  genProfileId,
  hasFHLImagesPoolSlotCapacity,
  isFHLImagesPoolSlotAvailable,
  isOfficialFHLPoolProfile,
  isOfficialFHLTextProfile,
  isSelectableGenerationProfile,
  keyringUserFor,
  nextDefaultProfileName,
  normalizeFHLImagesPoolKeyHint,
  normalizeFHLImagesPoolSlot,
  pickActiveProfile,
} from "../lib/profiles";
import { isOfficialFHLGenerationProfile } from "../lib/providerPolicy.ts";
import { normalizeAPIKeyInput } from "../lib/apiKey";
import { cleanBaseURL } from "../lib/security";
import { normalizeConcurrencyLimit } from "./workspaceRuntime";
import { persistActiveProfileId, persistProfiles } from "./studioStore.shared";
import { readRuntimePlatformState } from "../platform";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type ActiveProfileRuntimePatch = Pick<
  StudioState,
  "apiMode" | "requestPolicy" | "baseURL" | "textModelID" | "imageModelID" | "imagesNewAPICompat"
>;

export function activeProfileRuntimePatch(
  profile: UpstreamProfile,
  fhlTransportMode: StudioState["fhlTransportMode"],
): ActiveProfileRuntimePatch {
  if (!isOfficialFHLGenerationProfile(profile)) {
    return {
      apiMode: profile.apiMode,
      requestPolicy: profile.requestPolicy,
      baseURL: profile.baseURL,
      textModelID: profile.textModelID,
      imageModelID: profile.imageModelID,
      imagesNewAPICompat: profile.imagesNewAPICompat ?? false,
    };
  }
  return {
    apiMode: fhlTransportMode,
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: fhlTransportMode === "responses" ? FHL_TEXT_MODEL_ID : profile.textModelID,
    imageModelID: FHL_IMAGE_MODEL_ID,
    imagesNewAPICompat: fhlTransportMode === "images" && profile.imagesNewAPICompat === true,
  };
}

export function createProfileActions(store: StateAdapter) {
  return {
    async createProfile(input: {
      name?: string;
      apiMode: APIMode;
      baseURL?: string;
      requestPolicy?: RequestPolicy;
      textModelID?: string;
      imageModelID?: string;
      concurrencyLimit?: number;
      continuousPoolEnabled?: boolean;
      fhlImagesPoolSlot?: number;
      fhlImagesPoolKeyHint?: string;
      imagesNewAPICompat?: boolean;
      apiKey?: string;
      setActive?: boolean;
    }) {
      const list = store.getState().profiles;
      const id = genProfileId();
      const defaults = defaultProfileValuesForAPIMode(input.apiMode);
      const baseURL = cleanBaseURL(input.baseURL ?? defaults.baseURL);
      const fhlImagesPoolSlot = isOfficialFHLPoolProfile({
        apiMode: input.apiMode,
        baseURL,
        fhlImagesPoolSlot: input.fhlImagesPoolSlot,
      })
        ? normalizeFHLImagesPoolSlot(input.fhlImagesPoolSlot)
        : undefined;
      if (fhlImagesPoolSlot !== undefined && !hasFHLImagesPoolSlotCapacity(list, fhlImagesPoolSlot)) {
        throw new Error(`FHL Images API 槽位 ${fhlImagesPoolSlot} 已被占用。`);
      }
      const profile: UpstreamProfile = {
        id,
        name: input.name?.trim() || nextDefaultProfileName(list),
        apiMode: input.apiMode,
        requestPolicy: input.requestPolicy ?? defaults.requestPolicy,
        baseURL,
        textModelID: (input.textModelID ?? defaults.textModelID).trim(),
        imageModelID: (input.imageModelID ?? defaults.imageModelID).trim(),
        concurrencyLimit: fhlImagesPoolSlot !== undefined
          ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
          : normalizeConcurrencyLimit(input.concurrencyLimit ?? 0),
        continuousPoolEnabled: fhlImagesPoolSlot !== undefined && input.continuousPoolEnabled !== false,
        fhlImagesPoolSlot,
        fhlImagesPoolKeyHint: fhlImagesPoolSlot !== undefined
          ? normalizeFHLImagesPoolKeyHint(input.fhlImagesPoolKeyHint ?? input.apiKey)
          : undefined,
        imagesNewAPICompat: input.apiMode === "images" && input.imagesNewAPICompat === true,
        createdAt: Date.now(),
      };
      const inputAPIKey = normalizeAPIKeyInput(input.apiKey ?? "");
      if (inputAPIKey) {
        try { await SetStoredAPIKey(keyringUserFor(id), inputAPIKey); }
        catch (e: any) {
          if (readRuntimePlatformState().isAndroid) {
            throw new Error(e?.message ?? "API 凭据安全保存失败，请重新配置该 API");
          }
          if (typeof console !== "undefined") console.error("写 keyring 失败", e);
        }
      }
      const next = [...list, profile];
      persistProfiles(next);
      store.setState({ profiles: next });
      if (input.setActive ?? true) {
        await this.setActiveProfile(id);
      }
      return id;
    },

    async updateProfile(id: string, patch: Partial<Omit<UpstreamProfile, "id" | "createdAt">> & { apiKey?: string }) {
      const list = store.getState().profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return false;
      const current = list[index];
      const nextAPIMode = patch.apiMode ?? current.apiMode;
      const defaults = defaultProfileValuesForAPIMode(nextAPIMode);
      const shouldApplyModeDefaults = patch.apiMode !== undefined && patch.apiMode !== current.apiMode;
      const nextBaseURL = patch.baseURL !== undefined
        ? cleanBaseURL(patch.baseURL)
        : shouldApplyModeDefaults ? current.baseURL || defaults.baseURL : current.baseURL;
      const nextFHLImagesPoolSlot = isOfficialFHLPoolProfile({
        apiMode: nextAPIMode,
        baseURL: nextBaseURL,
        fhlImagesPoolSlot: patch.fhlImagesPoolSlot ?? current.fhlImagesPoolSlot,
      })
        ? normalizeFHLImagesPoolSlot(patch.fhlImagesPoolSlot ?? current.fhlImagesPoolSlot)
        : undefined;
      if (
        nextFHLImagesPoolSlot !== undefined
        && !isFHLImagesPoolSlotAvailable(list, nextFHLImagesPoolSlot, id)
      ) {
        throw new Error(`FHL Images API 槽位 ${nextFHLImagesPoolSlot} 已被占用。`);
      }
      const nextFHLImagesPoolKeyHint = nextFHLImagesPoolSlot === undefined
        ? undefined
        : patch.fhlImagesPoolKeyHint !== undefined
          ? normalizeFHLImagesPoolKeyHint(patch.fhlImagesPoolKeyHint)
          : patch.apiKey !== undefined
            ? normalizeFHLImagesPoolKeyHint(patch.apiKey)
            : normalizeFHLImagesPoolKeyHint(current.fhlImagesPoolKeyHint);
      const next: UpstreamProfile = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        apiMode: nextAPIMode,
        requestPolicy: patch.requestPolicy ?? current.requestPolicy,
        baseURL: nextBaseURL,
        textModelID: patch.textModelID !== undefined
          ? patch.textModelID.trim()
          : shouldApplyModeDefaults ? current.textModelID || defaults.textModelID : current.textModelID,
        imageModelID: patch.imageModelID !== undefined
          ? patch.imageModelID.trim()
          : shouldApplyModeDefaults ? current.imageModelID || defaults.imageModelID : current.imageModelID,
        concurrencyLimit: nextFHLImagesPoolSlot !== undefined
          ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
          : patch.concurrencyLimit !== undefined
            ? normalizeConcurrencyLimit(patch.concurrencyLimit) : current.concurrencyLimit,
        continuousPoolEnabled: nextFHLImagesPoolSlot !== undefined
          && (patch.continuousPoolEnabled ?? current.continuousPoolEnabled ?? true),
        fhlImagesPoolSlot: nextFHLImagesPoolSlot,
        fhlImagesPoolKeyHint: nextFHLImagesPoolKeyHint,
        imagesNewAPICompat: (patch.apiMode ?? current.apiMode) === "images"
          ? patch.imagesNewAPICompat ?? current.imagesNewAPICompat ?? false
          : false,
        lastUsedAt: patch.lastUsedAt ?? current.lastUsedAt,
      };
      const nextList = list.map((profile, idx) => (idx === index ? next : profile));
      if (patch.apiKey !== undefined) {
        try { await SetStoredAPIKey(keyringUserFor(id), normalizeAPIKeyInput(patch.apiKey)); }
        catch (e: any) {
          if (readRuntimePlatformState().isAndroid) {
            throw new Error(e?.message ?? "API 凭据安全保存失败，请重新配置该 API");
          }
          if (typeof console !== "undefined") console.error("写 keyring 失败", e);
        }
      }
      persistProfiles(nextList);
      store.setState({ profiles: nextList });
      if (id === store.getState().activeProfileId) {
        if (readRuntimePlatformState().isAndroid && !isSelectableGenerationProfile(next)) {
          const fallback = pickActiveProfile(
            nextList.filter((profile) => profile.id !== id && isSelectableGenerationProfile(profile)),
            "",
          );
          if (fallback) {
            await this.setActiveProfile(fallback.id);
          } else {
            persistActiveProfileId("");
            store.setState({
              activeProfileId: "",
              apiKey: "",
              baseURL: "",
              textModelID: "",
              imageModelID: "",
              apiMode: store.getState().fhlTransportMode,
              requestPolicy: "openai",
              imagesNewAPICompat: false,
            });
          }
          return true;
        }
        const apiKey = patch.apiKey !== undefined ? normalizeAPIKeyInput(patch.apiKey) : store.getState().apiKey;
        store.setState({ ...activeProfileRuntimePatch(next, store.getState().fhlTransportMode), apiKey });
      }
      return true;
    },

    async deleteProfile(id: string) {
      const list = store.getState().profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return;
      const nextList = list.filter((_, i) => i !== index);
      persistProfiles(nextList);
      try { await DeleteStoredAPIKey(keyringUserFor(id)); }
      catch (e: any) {
        if (typeof console !== "undefined") console.warn("删 keyring 项失败(继续)", e);
      }
      store.setState({ profiles: nextList });
      if (store.getState().activeProfileId === id) {
        const fallbackProfiles = readRuntimePlatformState().isAndroid
          ? nextList.filter(isSelectableGenerationProfile)
          : nextList;
        const fallback = pickActiveProfile(fallbackProfiles, "");
        if (fallback) {
          await this.setActiveProfile(fallback.id);
        } else {
          persistActiveProfileId("");
          store.setState({
            profiles: nextList,
            activeProfileId: "",
            apiKey: "",
            baseURL: "",
            textModelID: "",
            imageModelID: "",
            apiMode: store.getState().fhlTransportMode,
            requestPolicy: "openai",
            imagesNewAPICompat: false,
            upstreamModalOpen: false,
            settingsOpen: true,
            upstreamReturnTarget: "settings",
          });
        }
      }
    },

    async duplicateProfile(id: string) {
      const current = store.getState().profiles.find((profile) => profile.id === id);
      if (!current) return null;
      const cloned = cloneProfile(current);
      try {
        const existingKey = await GetStoredAPIKey(keyringUserFor(id)).catch(() => "");
        if (existingKey) {
          await SetStoredAPIKey(keyringUserFor(cloned.id), existingKey);
        }
      } catch {}
      const next = [...store.getState().profiles, cloned];
      persistProfiles(next);
      store.setState({ profiles: next });
      return cloned.id;
    },

    async setActiveProfile(id: string) {
      const profile = store.getState().profiles.find((p) => p.id === id);
      if (!profile) return;
      if (readRuntimePlatformState().isAndroid && isOfficialFHLTextProfile(profile)) {
        store.getState().pushToast("FHL Responses 文本配置仅用于提示词工具，不能设为当前生图 API。", "warn", 4200);
        return;
      }
      persistActiveProfileId(id);
      const apiKey = await GetStoredAPIKey(keyringUserFor(id)).catch(() => "");
      const refreshed: UpstreamProfile = { ...profile, lastUsedAt: Date.now() };
      const nextProfiles = store.getState().profiles.map((p) => p.id === id ? refreshed : p);
      persistProfiles(nextProfiles);
      store.setState({
        profiles: nextProfiles,
        activeProfileId: id,
        ...activeProfileRuntimePatch(profile, store.getState().fhlTransportMode),
        apiKey,
      });
    },
  };
}
