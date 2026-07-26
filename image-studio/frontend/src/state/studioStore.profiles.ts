import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  SetStoredAPIKey,
} from "../platform/runtime/host";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import {
  DEFAULT_CONCURRENCY_LIMIT,
  duplicateProfile as cloneProfile,
  FHL_BASE_URL,
  FHL_IMAGE_MODEL_ID,
  FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
  FHL_TEXT_MODEL_ID,
  genProfileId,
  hasFHLImagesPoolSlotCapacity,
  hasUpstreamProfileCapacity,
  isFHLImagesPoolSlotAvailable,
  isOfficialFHLImagesProfile,
  keyringUserFor,
  nextDefaultProfileName,
  normalizeAPIMartBaseURL,
  normalizeFHLImagesPoolKeyHint,
  normalizeFHLImagesPoolSlot,
  pickActiveProfile,
  upstreamProfileLimitMessage,
} from "../lib/profiles";
import { normalizeAPIKeyInput } from "../lib/apiKey";
import { syncCLIConfigQuietly, type CLIConfigSyncInput } from "../lib/cliConfigSync";
import { isOfficialFHLProfile, ProviderPolicy } from "../lib/providerPolicy";
import { cleanBaseURL } from "../lib/security";
import { normalizeConcurrencyLimit } from "./workspaceRuntime";
import { persistActiveProfileId, persistProfiles } from "./studioStore.shared";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

function cleanProfileBaseURL(apiMode: APIMode, value: string): string {
  const cleaned = cleanBaseURL(value);
  return apiMode === "apimart" ? normalizeAPIMartBaseURL(cleaned) : cleaned;
}

function isFHLProfileConfig(profile: Pick<UpstreamProfile, "baseURL" | "imageModelID">): boolean {
  return isOfficialFHLProfile({ apiMode: "images", baseURL: profile.baseURL })
    && profile.imageModelID.trim() === ProviderPolicy.fhl.imageModelID;
}

function isOfficialFHLRuntimeProfile(
  profile: Pick<UpstreamProfile, "apiMode" | "baseURL">,
): boolean {
  return isOfficialFHLProfile(profile);
}

type ActiveProfileRuntimePatch = Pick<
  StudioState,
  "apiMode" | "requestPolicy" | "baseURL" | "textModelID" | "imageModelID" | "imagesNewAPICompat"
>;

// FHL transport is a global runtime choice. Keep the saved slot as Images so
// its key, stable slot number, and pool membership are never rewritten.
export function activeProfileRuntimePatch(
  profile: UpstreamProfile,
  fhlTransportMode: StudioState["fhlTransportMode"],
): ActiveProfileRuntimePatch {
  if (!isOfficialFHLRuntimeProfile(profile)) {
    return {
      apiMode: profile.apiMode,
      requestPolicy: profile.requestPolicy,
      baseURL: profile.baseURL,
      textModelID: profile.textModelID,
      imageModelID: profile.imageModelID,
      imagesNewAPICompat: profile.imagesNewAPICompat ?? false,
    };
  }

  const apiMode = fhlTransportMode;
  return {
    apiMode,
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: apiMode === "responses" ? FHL_TEXT_MODEL_ID : profile.textModelID,
    imageModelID: FHL_IMAGE_MODEL_ID,
    imagesNewAPICompat: apiMode === "images" && profile.imagesNewAPICompat === true,
  };
}

function cliConfigFromProfileState(
  state: StudioState,
  profile: UpstreamProfile,
  apiKey: string,
): CLIConfigSyncInput {
  return {
    apiKey,
    baseURL: profile.baseURL,
    apiMode: profile.apiMode,
    requestPolicy: profile.requestPolicy,
    imagesNewAPICompat: profile.apiMode === "images" && (profile.imagesNewAPICompat ?? false) === true,
    textModelID: profile.textModelID,
    imageModelID: profile.imageModelID,
    outputFormat: state.outputFormat,
    quality: state.quality,
    size: state.size,
    partialImages: 1,
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
      const baseURL = cleanProfileBaseURL(input.apiMode, input.baseURL ?? "");
      const fhlImagesPoolSlot = isOfficialFHLImagesProfile({ apiMode: input.apiMode, baseURL })
        ? normalizeFHLImagesPoolSlot(input.fhlImagesPoolSlot)
        : undefined;
      if (fhlImagesPoolSlot !== undefined) {
        if (!hasFHLImagesPoolSlotCapacity(list, fhlImagesPoolSlot)) {
          throw new Error(`FHL Images API 槽位 ${fhlImagesPoolSlot} 已被占用。`);
        }
      } else if (!hasUpstreamProfileCapacity(list)) {
        throw new Error(upstreamProfileLimitMessage());
      }
      const id = genProfileId();
      const rawProfile: UpstreamProfile = {
        id,
        name: input.name?.trim() || nextDefaultProfileName(list),
        apiMode: input.apiMode,
        requestPolicy: input.requestPolicy ?? "openai",
        baseURL,
        textModelID: (input.textModelID ?? "").trim(),
        imageModelID: (input.imageModelID ?? "").trim(),
        concurrencyLimit: fhlImagesPoolSlot !== undefined
          ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
          : normalizeConcurrencyLimit(input.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT),
        continuousPoolEnabled: input.apiMode === "images" && input.continuousPoolEnabled !== false,
        fhlImagesPoolSlot,
        fhlImagesPoolKeyHint: fhlImagesPoolSlot !== undefined
          ? normalizeFHLImagesPoolKeyHint(input.fhlImagesPoolKeyHint ?? input.apiKey)
          : undefined,
        imagesNewAPICompat: input.apiMode === "images" && input.imagesNewAPICompat === true,
        createdAt: Date.now(),
      };
      const profile: UpstreamProfile = isFHLProfileConfig(rawProfile)
        ? {
            ...rawProfile,
            requestPolicy: "openai",
            imagesNewAPICompat: rawProfile.apiMode === "images" && rawProfile.imagesNewAPICompat === true,
          }
        : rawProfile;
      const inputAPIKey = normalizeAPIKeyInput(input.apiKey ?? "");
      if (inputAPIKey) {
        try { await SetStoredAPIKey(keyringUserFor(id), inputAPIKey); }
        catch (e: any) {
          if (typeof console !== "undefined") console.error("写入 keyring 失败", e);
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
      const nextApiMode = patch.apiMode ?? current.apiMode;
      const nextBaseURL = patch.baseURL !== undefined
        ? cleanProfileBaseURL(nextApiMode, patch.baseURL)
        : cleanProfileBaseURL(nextApiMode, current.baseURL);
      const nextFHLImagesPoolSlot = isOfficialFHLImagesProfile({
        apiMode: nextApiMode,
        baseURL: nextBaseURL,
      })
        ? normalizeFHLImagesPoolSlot(patch.fhlImagesPoolSlot ?? current.fhlImagesPoolSlot)
        : undefined;
      const nextFHLImagesPoolKeyHint = nextFHLImagesPoolSlot !== undefined
        ? normalizeFHLImagesPoolKeyHint(
            patch.fhlImagesPoolKeyHint
            ?? (patch.apiKey !== undefined ? patch.apiKey : current.fhlImagesPoolKeyHint),
          )
        : undefined;
      const rawNext: UpstreamProfile = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        apiMode: nextApiMode,
        requestPolicy: patch.requestPolicy ?? current.requestPolicy,
        baseURL: nextBaseURL,
        textModelID: patch.textModelID !== undefined ? patch.textModelID.trim() : current.textModelID,
        imageModelID: patch.imageModelID !== undefined ? patch.imageModelID.trim() : current.imageModelID,
        concurrencyLimit: nextFHLImagesPoolSlot !== undefined
          ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
          : patch.concurrencyLimit !== undefined
            ? normalizeConcurrencyLimit(patch.concurrencyLimit) : current.concurrencyLimit,
        imagesNewAPICompat: nextApiMode === "images"
          ? patch.imagesNewAPICompat ?? current.imagesNewAPICompat ?? false
          : false,
        continuousPoolEnabled: nextApiMode === "images"
          ? patch.continuousPoolEnabled ?? current.continuousPoolEnabled ?? true
          : false,
        fhlImagesPoolSlot: nextFHLImagesPoolSlot,
        fhlImagesPoolKeyHint: nextFHLImagesPoolKeyHint,
        lastUsedAt: patch.lastUsedAt ?? current.lastUsedAt,
      };
      const next: UpstreamProfile = isFHLProfileConfig(rawNext)
        ? {
            ...rawNext,
            requestPolicy: "openai",
            imagesNewAPICompat: rawNext.apiMode === "images" && rawNext.imagesNewAPICompat === true,
          }
        : rawNext;
      if (
        patch.fhlImagesPoolSlot !== undefined
        && next.fhlImagesPoolSlot !== undefined
        && !isFHLImagesPoolSlotAvailable(list, next.fhlImagesPoolSlot, id)
      ) {
        return false;
      }
      const nextList = list.map((profile, idx) => (idx === index ? next : profile));
      persistProfiles(nextList);
      store.setState({ profiles: nextList });
      if (patch.apiKey !== undefined) {
        try { await SetStoredAPIKey(keyringUserFor(id), normalizeAPIKeyInput(patch.apiKey)); }
        catch (e: any) {
          if (typeof console !== "undefined") console.error("写入 keyring 失败", e);
        }
      }
      if (id === store.getState().activeProfileId) {
        const apiKey = patch.apiKey !== undefined ? normalizeAPIKeyInput(patch.apiKey) : store.getState().apiKey;
        store.setState({
          ...activeProfileRuntimePatch(next, store.getState().fhlTransportMode),
          apiKey,
        });
        syncCLIConfigQuietly(cliConfigFromProfileState(store.getState(), next, apiKey));
      }
      return true;
    },

    async deleteProfile(id: string) {
      const currentState = store.getState();
      const list = currentState.profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return false;
      const hasActiveAssignedTask = Object.values(currentState.batchTasksById).some((task) => (
        task.apiProfileId === id
        && (task.status === "queued" || task.status === "running")
      ));
      if (hasActiveAssignedTask) return false;
      const nextList = list.filter((_, i) => i !== index);
      persistProfiles(nextList);
      try { await DeleteStoredAPIKey(keyringUserFor(id)); }
      catch (e: any) {
        if (typeof console !== "undefined") console.warn("删除 keyring 项失败，继续", e);
      }
      store.setState({ profiles: nextList });
      if (store.getState().activeProfileId === id) {
        const fallback = pickActiveProfile(nextList, "");
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
            apiMode: "responses",
            requestPolicy: "openai",
            imagesNewAPICompat: false,
            upstreamModalOpen: false,
            settingsOpen: true,
            upstreamReturnTarget: "settings",
          });
        }
      }
      return true;
    },

    async duplicateProfile(id: string) {
      const current = store.getState().profiles.find((profile) => profile.id === id);
      if (!current) return null;
      if (!hasUpstreamProfileCapacity(store.getState().profiles)) return null;
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
      const before = store.getState();
      const profile = before.profiles.find((p) => p.id === id);
      if (!profile) return;
      persistActiveProfileId(id);
      const refreshed: UpstreamProfile = { ...profile, lastUsedAt: Date.now() };
      const nextProfiles = store.getState().profiles.map((p) => p.id === id ? refreshed : p);
      persistProfiles(nextProfiles);
      store.setState({
        profiles: nextProfiles,
        activeProfileId: id,
        ...activeProfileRuntimePatch(profile, before.fhlTransportMode),
        apiKey: "",
      });
      const apiKey = await GetStoredAPIKey(keyringUserFor(id)).catch(() => "");
      if (store.getState().activeProfileId === id) {
        store.setState({ apiKey });
        syncCLIConfigQuietly(cliConfigFromProfileState(store.getState(), refreshed, apiKey));
      }
    },
  };
}
