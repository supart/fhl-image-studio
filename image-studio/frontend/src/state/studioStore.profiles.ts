import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  SetStoredAPIKey,
  invalidateAndroidImageModelValidationProfiles,
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
import {
  imageModelCatalogBaseUrl,
  imageModelCatalogEntry,
  imageModelCatalogProvider,
  isSupportedFHLImageModelID,
  normalizeImageModelCatalog,
  persistImageModelCatalog,
  type StoredImageModelCatalog,
} from "../lib/fhlImageModels.ts";
import {
  resolveImageModelCatalogBaseUrl,
  resolveImageModelCatalogProvider,
  resolveImageModelValidatedAt,
} from "../lib/profileImageModelValidation.ts";
import { normalizeConcurrencyLimit } from "./workspaceRuntime";
import { persistActiveProfileId, persistProfiles } from "./studioStore.shared";
import { readRuntimePlatformState } from "../platform";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

let activeProfileSelectionEpoch = 0;

// Credential reads happen asynchronously on Android. Keep a process-local
// revision and a small pending-write set so bootstrap can reject a read that
// raced with a profile/key mutation instead of restoring stale state.
let credentialMutationRevision = 0;
const pendingCredentialMutations = new Set<Promise<unknown>>();

export function markCredentialMutation(): number {
  credentialMutationRevision += 1;
  return credentialMutationRevision;
}

export function currentCredentialMutationRevision(): number {
  return credentialMutationRevision;
}

export function trackCredentialMutation<T>(operation: () => Promise<T>): Promise<T> {
  markCredentialMutation();
  const pending = (async () => {
    try {
      return await operation();
    } finally {
      markCredentialMutation();
    }
  })();
  pendingCredentialMutations.add(pending);
  pending.then(
    () => pendingCredentialMutations.delete(pending),
    () => pendingCredentialMutations.delete(pending),
  );
  return pending;
}

export async function waitForCredentialMutations(): Promise<void> {
  while (pendingCredentialMutations.size > 0) {
    await Promise.allSettled([...pendingCredentialMutations]);
  }
}

type ActiveProfileRuntimePatch = Pick<
  StudioState,
  "apiMode" | "requestPolicy" | "baseURL" | "textModelID" | "imageModelID" | "imagesNewAPICompat"
    | "imageModelAvailable" | "imageModelSupportsGenerations" | "imageModelSupportsEdits"
    | "imageModelSupportsTransparency" | "imageModelCatalogValidationId"
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
      imageModelAvailable: profile.imageModelAvailable,
      imageModelSupportsGenerations: profile.imageModelSupportsGenerations,
      imageModelSupportsEdits: profile.imageModelSupportsEdits,
      imageModelSupportsTransparency: profile.imageModelSupportsTransparency,
      imageModelCatalogValidationId: profile.imageModelCatalogValidationId,
    };
  }
  return {
    apiMode: fhlTransportMode,
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: fhlTransportMode === "responses" ? FHL_TEXT_MODEL_ID : profile.textModelID,
    // Keep the exact model selected for this FHL Images slot. The transport
    // mode may switch between Images and Responses, but it must not silently
    // replace a validated model with the legacy default.
    imageModelID: profile.imageModelID || FHL_IMAGE_MODEL_ID,
    imagesNewAPICompat: fhlTransportMode === "images" && profile.imagesNewAPICompat === true,
    imageModelAvailable: profile.imageModelAvailable,
    imageModelSupportsGenerations: profile.imageModelSupportsGenerations,
    imageModelSupportsEdits: profile.imageModelSupportsEdits,
    imageModelSupportsTransparency: profile.imageModelSupportsTransparency,
    imageModelCatalogValidationId: profile.imageModelCatalogValidationId,
  };
}

export type FHLPoolImageModelSelection = {
  imageModelID: string;
  imageModelValidatedAt: number;
  imageModelCatalogBaseUrl: string;
  imageModelCatalogProvider: string;
  imageModelAvailable?: boolean;
  imageModelSupportsGenerations?: boolean;
  imageModelSupportsEdits?: boolean;
  imageModelSupportsTransparency?: boolean;
  imageModelCatalogValidationId?: string;
  validatedProfileId: string;
};

export type ValidatedFHLPoolImageModelCommit = {
  catalog: StoredImageModelCatalog;
  imageModelID: string;
  imageModelCatalogValidationId: string;
  /** Profiles whose own Keystore credentials completed this validation batch. */
  targetProfileIds: readonly string[];
};

function commitFHLPoolImageModelSelection(
  store: StateAdapter,
  metadata: FHLPoolImageModelSelection,
): number {
  const state = store.getState();
  const targetIds = new Set(
    state.profiles.filter(isOfficialFHLPoolProfile).map((profile) => profile.id),
  );
  if (targetIds.size === 0) return 0;
  if (!targetIds.has(metadata.validatedProfileId)) {
    throw new Error("完成目录验证的 FHL Images 槽位不存在。");
  }

  const nextProfiles = state.profiles.map((profile) => {
    if (!targetIds.has(profile.id)) return profile;
    if (profile.id !== metadata.validatedProfileId) {
      if (profile.imageModelID === metadata.imageModelID) return profile;
      return {
        ...profile,
        imageModelID: metadata.imageModelID,
        imageModelValidatedAt: undefined,
        imageModelCatalogBaseUrl: undefined,
        imageModelCatalogProvider: undefined,
        imageModelAvailable: undefined,
        imageModelSupportsGenerations: undefined,
        imageModelSupportsEdits: undefined,
        imageModelSupportsTransparency: undefined,
        imageModelCatalogValidationId: undefined,
      };
    }
    return {
      ...profile,
      imageModelID: metadata.imageModelID,
      imageModelValidatedAt: metadata.imageModelValidatedAt,
      imageModelCatalogBaseUrl: metadata.imageModelCatalogBaseUrl,
      imageModelCatalogProvider: metadata.imageModelCatalogProvider,
      imageModelAvailable: metadata.imageModelAvailable,
      imageModelSupportsGenerations: metadata.imageModelSupportsGenerations,
      imageModelSupportsEdits: metadata.imageModelSupportsEdits,
      imageModelSupportsTransparency: metadata.imageModelSupportsTransparency,
      // Legacy/migration helper: only the native unified validation flow may
      // attach a submission-capable batch proof.
      imageModelCatalogValidationId: undefined,
    };
  });
  const active = nextProfiles.find((profile) => profile.id === state.activeProfileId);
  persistProfiles(nextProfiles);
  store.setState({
    profiles: nextProfiles,
    ...(active && targetIds.has(active.id)
      ? activeProfileRuntimePatch(active, state.fhlTransportMode)
      : {}),
  });
  return targetIds.size;
}

/** Atomically applies one provider-confirmed exact model to every FHL Images
 * pool slot without touching credentials, slot URLs, or enabled state. */
export function applyFHLPoolImageModelSelection(
  store: StateAdapter,
  selection: FHLPoolImageModelSelection,
): number {
  const modelID = selection.imageModelID.trim();
  const validatedAt = Number(selection.imageModelValidatedAt);
  const catalogBaseURL = imageModelCatalogBaseUrl(selection.imageModelCatalogBaseUrl);
  const catalogProvider = imageModelCatalogProvider(selection.imageModelCatalogProvider);
  if (!isSupportedFHLImageModelID(modelID)) {
    throw new Error("生图模型必须是 provider 返回的产品精确模型 ID。");
  }
  if (!Number.isFinite(validatedAt) || validatedAt <= 0 || !catalogBaseURL || !catalogProvider) {
    throw new Error("生图模型目录验证元数据不完整。");
  }
  return commitFHLPoolImageModelSelection(store, {
    imageModelID: modelID,
    imageModelValidatedAt: Math.floor(validatedAt),
    imageModelCatalogBaseUrl: catalogBaseURL,
    imageModelCatalogProvider: catalogProvider,
    validatedProfileId: selection.validatedProfileId,
  });
}

/**
 * Commits one shared catalog and its matching profile validation metadata.
 * Every validation and next-state calculation happens before the catalog
 * write. If catalog persistence fails, profiles and in-memory state remain
 * untouched. Credential presence is intentionally not inferred from key
 * hints; the Android UI owns the authoritative Keystore reads.
 */
export function commitValidatedFHLPoolImageModelSelection(
  store: StateAdapter,
  selection: ValidatedFHLPoolImageModelCommit,
): number {
  const modelID = selection.imageModelID.trim();
  const validatedAt = Number(selection.catalog.fetchedAt);
  if (!isSupportedFHLImageModelID(modelID)) {
    throw new Error("生图模型必须是所有目标槽位共同返回的产品精确模型 ID。");
  }
  if (!Number.isFinite(validatedAt) || validatedAt <= 0) {
    throw new Error("统一生图模型目录验证元数据不完整。");
  }
  const catalog = normalizeImageModelCatalog(
    selection.catalog.models,
    selection.catalog.baseUrl,
    selection.catalog.provider,
    validatedAt,
  );
  const catalogBaseURL = imageModelCatalogBaseUrl(catalog.baseUrl);
  const catalogProvider = imageModelCatalogProvider(catalog.provider);
  if (!catalogBaseURL || !catalogProvider) {
    throw new Error("统一生图模型目录验证元数据不完整。");
  }
  const selectedEntry = imageModelCatalogEntry(catalog, modelID);
  if (!selectedEntry || selectedEntry.available !== true || selectedEntry.supportsGenerations !== true) {
    throw new Error("所选生图模型不在所有目标槽位共同返回的目录中。");
  }
  const validationId = selection.imageModelCatalogValidationId.trim();
  if (!validationId) {
    throw new Error("统一生图模型缺少原生目录验证证明。");
  }

  const rawTargetIds = selection.targetProfileIds.map((value) => String(value || "").trim());
  if (rawTargetIds.length === 0 || rawTargetIds.some((value) => !value)) {
    throw new Error("没有已配置且启用的 FHL Images 槽位可更新。");
  }
  const targetIds = new Set(rawTargetIds);
  if (targetIds.size !== rawTargetIds.length) {
    throw new Error("统一生图模型目标槽位存在重复项。");
  }

  const state = store.getState();
  const profilesById = new Map(state.profiles.map((profile) => [profile.id, profile]));
  for (const profileId of targetIds) {
    const profile = profilesById.get(profileId);
    if (!profile || !isOfficialFHLPoolProfile(profile)) {
      throw new Error("统一生图模型目标包含无效的 FHL Images 槽位。");
    }
    if (profile.continuousPoolEnabled === false) {
      throw new Error("统一生图模型目标包含未启用的 FHL Images 槽位。");
    }
    const profileBaseURL = imageModelCatalogBaseUrl(profile.baseURL);
    const profileProvider = imageModelCatalogProvider(profile.provider || "fhl");
    if (profileBaseURL !== catalogBaseURL || profileProvider !== catalogProvider) {
      throw new Error("已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。");
    }
  }

  const officialPoolIds = new Set(
    state.profiles.filter(isOfficialFHLPoolProfile).map((profile) => profile.id),
  );
  const nextProfiles = state.profiles.map((profile) => {
    if (!officialPoolIds.has(profile.id)) return profile;
    if (!targetIds.has(profile.id)) {
      return {
        ...profile,
        imageModelValidatedAt: undefined,
        imageModelCatalogBaseUrl: undefined,
        imageModelCatalogProvider: undefined,
        imageModelAvailable: undefined,
        imageModelSupportsGenerations: undefined,
        imageModelSupportsEdits: undefined,
        imageModelSupportsTransparency: undefined,
        imageModelCatalogValidationId: undefined,
      };
    }
    return {
      ...profile,
      imageModelID: modelID,
      imageModelValidatedAt: Math.floor(validatedAt),
      imageModelCatalogBaseUrl: catalogBaseURL,
      imageModelCatalogProvider: catalogProvider,
      imageModelAvailable: selectedEntry.available,
      imageModelSupportsGenerations: selectedEntry.supportsGenerations,
      imageModelSupportsEdits: selectedEntry.supportsEdits,
      imageModelSupportsTransparency: selectedEntry.supportsTransparency,
      imageModelCatalogValidationId: validationId,
    };
  });
  const active = nextProfiles.find((profile) => profile.id === state.activeProfileId);
  if (!persistImageModelCatalog(catalog)) {
    throw new Error("统一生图模型目录保存失败，原配置未改变。");
  }
  persistProfiles(nextProfiles);
  store.setState({
    profiles: nextProfiles,
    ...(active && officialPoolIds.has(active.id)
      ? activeProfileRuntimePatch(active, state.fhlTransportMode)
      : {}),
  });
  return targetIds.size;
}

/** Invalidates one slot, or all slots when no profile is specified, while
 * retaining each exact prior model ID as migration evidence. */
export function invalidateFHLPoolImageModelValidation(
  store: StateAdapter,
  profileId?: string,
): number {
  const state = store.getState();
  const targetIds = new Set(
    state.profiles
      .filter((profile) => isOfficialFHLPoolProfile(profile) && (!profileId || profile.id === profileId))
      .map((profile) => profile.id),
  );
  if (targetIds.size === 0) return 0;
  const nextProfiles = state.profiles.map((profile) => (
    targetIds.has(profile.id)
      ? {
          ...profile,
          imageModelValidatedAt: undefined,
          imageModelCatalogBaseUrl: undefined,
          imageModelCatalogProvider: undefined,
          imageModelAvailable: undefined,
          imageModelSupportsGenerations: undefined,
          imageModelSupportsEdits: undefined,
          imageModelSupportsTransparency: undefined,
          imageModelCatalogValidationId: undefined,
        }
      : profile
  ));
  const active = nextProfiles.find((profile) => profile.id === state.activeProfileId);
  persistProfiles(nextProfiles);
  store.setState({
    profiles: nextProfiles,
    ...(active && targetIds.has(active.id)
      ? activeProfileRuntimePatch(active, state.fhlTransportMode)
      : {}),
  });
  return targetIds.size;
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
      imageModelValidatedAt?: number;
      imageModelCatalogBaseUrl?: string;
      imageModelCatalogProvider?: string;
      imageModelAvailable?: boolean;
      imageModelSupportsGenerations?: boolean;
      imageModelSupportsEdits?: boolean;
      imageModelSupportsTransparency?: boolean;
      imageModelCatalogValidationId?: string;
      provider?: string;
      concurrencyLimit?: number;
      continuousPoolEnabled?: boolean;
      fhlImagesPoolSlot?: number;
      fhlImagesPoolKeyHint?: string;
      imagesNewAPICompat?: boolean;
      apiKey?: string;
      setActive?: boolean;
    }) {
      const list = store.getState().profiles;
      markCredentialMutation();
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
        imageModelValidatedAt: Number.isFinite(Number(input.imageModelValidatedAt)) && Number(input.imageModelValidatedAt) > 0
          ? Math.floor(Number(input.imageModelValidatedAt))
          : undefined,
        imageModelCatalogBaseUrl: input.imageModelCatalogBaseUrl
          ? imageModelCatalogBaseUrl(input.imageModelCatalogBaseUrl)
          : undefined,
        imageModelCatalogProvider: input.imageModelCatalogProvider
          ? imageModelCatalogProvider(input.imageModelCatalogProvider)
          : undefined,
        imageModelAvailable: input.imageModelAvailable === true ? true : undefined,
        imageModelSupportsGenerations: input.imageModelSupportsGenerations === true ? true : undefined,
        imageModelSupportsEdits: input.imageModelSupportsEdits === true ? true : undefined,
        imageModelSupportsTransparency: input.imageModelSupportsTransparency === true ? true : undefined,
        imageModelCatalogValidationId: input.imageModelCatalogValidationId?.trim() || undefined,
        provider: input.provider?.trim()
          ? imageModelCatalogProvider(input.provider)
          : undefined,
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
        try { await trackCredentialMutation(() => SetStoredAPIKey(keyringUserFor(id), inputAPIKey)); }
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
      markCredentialMutation();
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
      const nextImageModelID = patch.imageModelID !== undefined
        ? patch.imageModelID.trim()
        : shouldApplyModeDefaults ? current.imageModelID || defaults.imageModelID : current.imageModelID;
      const currentProvider = current.provider?.trim()
        ? imageModelCatalogProvider(current.provider)
        : undefined;
      const nextProvider = patch.provider !== undefined
        ? (patch.provider.trim() ? imageModelCatalogProvider(patch.provider) : undefined)
        : currentProvider;
      const modelChanged = nextImageModelID !== current.imageModelID;
      const baseURLChanged = nextBaseURL !== current.baseURL;
      const apiModeChanged = nextAPIMode !== current.apiMode;
      const providerChanged = nextProvider !== currentProvider;
      // A slot that leaves and later re-enters the active pool must fetch a
      // fresh directory with its own credential before it can submit again.
      // Compare normalized pool-enabled state so legacy undefined values do
      // not invalidate unrelated edits on every update.
      const currentPoolEnabled = current.fhlImagesPoolSlot !== undefined
        && current.continuousPoolEnabled !== false;
      const nextPoolEnabled = nextFHLImagesPoolSlot !== undefined
        && (patch.continuousPoolEnabled ?? current.continuousPoolEnabled ?? true);
      const poolEnabledChanged = currentPoolEnabled !== nextPoolEnabled;
      const metadataBaseURL = patch.imageModelCatalogBaseUrl !== undefined
        ? imageModelCatalogBaseUrl(patch.imageModelCatalogBaseUrl)
        : current.imageModelCatalogBaseUrl;
      const metadataProvider = patch.imageModelCatalogProvider !== undefined
        ? imageModelCatalogProvider(patch.imageModelCatalogProvider)
        : current.imageModelCatalogProvider;
      const catalogProviderChanged = patch.imageModelCatalogProvider !== undefined
        && metadataProvider !== imageModelCatalogProvider(current.imageModelCatalogProvider || "");
      const catalogBaseURLChanged = patch.imageModelCatalogBaseUrl !== undefined
        && metadataBaseURL !== imageModelCatalogBaseUrl(current.imageModelCatalogBaseUrl || "");
      const validationMetadataChanged = (
        patch.imageModelValidatedAt !== undefined
          && patch.imageModelValidatedAt !== current.imageModelValidatedAt
      ) || (
        patch.imageModelAvailable !== undefined
          && patch.imageModelAvailable !== current.imageModelAvailable
      ) || (
        patch.imageModelSupportsGenerations !== undefined
          && patch.imageModelSupportsGenerations !== current.imageModelSupportsGenerations
      ) || (
        patch.imageModelSupportsEdits !== undefined
          && patch.imageModelSupportsEdits !== current.imageModelSupportsEdits
      ) || (
        patch.imageModelSupportsTransparency !== undefined
          && patch.imageModelSupportsTransparency !== current.imageModelSupportsTransparency
      ) || (
        patch.imageModelCatalogValidationId !== undefined
          && patch.imageModelCatalogValidationId.trim() !== (current.imageModelCatalogValidationId || "")
      );
      let keyChanged = false;
      let normalizedPatchKey = "";
      if (patch.apiKey !== undefined) {
        normalizedPatchKey = normalizeAPIKeyInput(patch.apiKey);
        const existingKey = await GetStoredAPIKey(keyringUserFor(id)).catch(() => "");
        keyChanged = normalizeAPIKeyInput(existingKey) !== normalizedPatchKey;
      }
      // The native batch commit is the only path allowed to establish model
      // validation. Ordinary profile edits may preserve identical metadata,
      // but cannot migrate or manufacture a proof for a changed configuration.
      const validationInvalidated = poolEnabledChanged
        || modelChanged
        || baseURLChanged
        || apiModeChanged
        || providerChanged
        || catalogProviderChanged
        || catalogBaseURLChanged
        || validationMetadataChanged
        || keyChanged;
      const validationPatch = validationInvalidated
        ? {
            ...patch,
            imageModelValidatedAt: undefined,
            imageModelCatalogBaseUrl: undefined,
            imageModelCatalogProvider: undefined,
            imageModelAvailable: undefined,
            imageModelSupportsGenerations: undefined,
            imageModelSupportsEdits: undefined,
            imageModelSupportsTransparency: undefined,
            imageModelCatalogValidationId: undefined,
          }
        : patch;
      const next: UpstreamProfile = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        apiMode: nextAPIMode,
        requestPolicy: patch.requestPolicy ?? current.requestPolicy,
        baseURL: nextBaseURL,
        textModelID: patch.textModelID !== undefined
          ? patch.textModelID.trim()
          : shouldApplyModeDefaults ? current.textModelID || defaults.textModelID : current.textModelID,
        imageModelID: nextImageModelID,
        provider: nextProvider,
        imageModelValidatedAt: resolveImageModelValidatedAt(
          validationPatch,
          current.imageModelValidatedAt,
          validationInvalidated,
        ),
        imageModelCatalogBaseUrl: resolveImageModelCatalogBaseUrl(
          validationPatch,
          current.imageModelCatalogBaseUrl,
          validationInvalidated,
        ),
        imageModelCatalogProvider: resolveImageModelCatalogProvider(
          validationPatch,
          current.imageModelCatalogProvider,
          validationInvalidated,
        ),
        imageModelAvailable: validationInvalidated
          ? undefined
          : patch.imageModelAvailable !== undefined
            ? patch.imageModelAvailable === true
            : current.imageModelAvailable,
        imageModelSupportsGenerations: validationInvalidated
          ? undefined
          : patch.imageModelSupportsGenerations !== undefined
            ? patch.imageModelSupportsGenerations === true
            : current.imageModelSupportsGenerations,
        imageModelSupportsEdits: validationInvalidated
          ? undefined
          : patch.imageModelSupportsEdits !== undefined
            ? patch.imageModelSupportsEdits === true
            : current.imageModelSupportsEdits,
        imageModelSupportsTransparency: validationInvalidated
          ? undefined
          : patch.imageModelSupportsTransparency !== undefined
            ? patch.imageModelSupportsTransparency === true
            : current.imageModelSupportsTransparency,
        imageModelCatalogValidationId: validationInvalidated
          ? undefined
          : patch.imageModelCatalogValidationId?.trim() || current.imageModelCatalogValidationId,
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
      if (patch.apiKey !== undefined && keyChanged) {
        try { await trackCredentialMutation(() => SetStoredAPIKey(keyringUserFor(id), normalizedPatchKey)); }
        catch (e: any) {
          if (readRuntimePlatformState().isAndroid) {
            throw new Error(e?.message ?? "API 凭据安全保存失败，请重新配置该 API");
          }
          if (typeof console !== "undefined") console.error("写 keyring 失败", e);
        }
      }
      if (
        validationInvalidated
        && !keyChanged
        && readRuntimePlatformState().isAndroid
        && (isOfficialFHLPoolProfile(current) || nextFHLImagesPoolSlot !== undefined)
      ) {
        await invalidateAndroidImageModelValidationProfiles([id]);
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
              activeCredentialStatus: "missing",
              baseURL: "",
              textModelID: "",
              imageModelID: "",
              apiMode: store.getState().fhlTransportMode,
              requestPolicy: "openai",
              imagesNewAPICompat: false,
              imageModelAvailable: undefined,
              imageModelSupportsGenerations: undefined,
              imageModelSupportsEdits: undefined,
              imageModelSupportsTransparency: undefined,
              imageModelCatalogValidationId: undefined,
            });
          }
          return true;
        }
        const apiKey = patch.apiKey !== undefined ? normalizeAPIKeyInput(patch.apiKey) : store.getState().apiKey;
        store.setState({
          ...activeProfileRuntimePatch(next, store.getState().fhlTransportMode),
          apiKey,
          ...(patch.apiKey !== undefined
            ? { activeCredentialStatus: apiKey ? "present" as const : "missing" as const }
            : {}),
        });
      }
      return true;
    },

    async deleteProfile(id: string) {
      const list = store.getState().profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return;
      markCredentialMutation();
      const nextList = list.filter((_, i) => i !== index);
      if (readRuntimePlatformState().isAndroid) {
        await invalidateAndroidImageModelValidationProfiles([id]);
      }
      persistProfiles(nextList);
      try { await trackCredentialMutation(() => DeleteStoredAPIKey(keyringUserFor(id))); }
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
            activeCredentialStatus: "missing",
            baseURL: "",
            textModelID: "",
            imageModelID: "",
            apiMode: store.getState().fhlTransportMode,
            requestPolicy: "openai",
            imagesNewAPICompat: false,
            imageModelAvailable: undefined,
            imageModelSupportsGenerations: undefined,
            imageModelSupportsEdits: undefined,
            imageModelSupportsTransparency: undefined,
            imageModelCatalogValidationId: undefined,
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
      markCredentialMutation();
      const cloned = cloneProfile(current);
      try {
        const existingKey = await GetStoredAPIKey(keyringUserFor(id)).catch(() => "");
        if (existingKey) {
          await trackCredentialMutation(() => SetStoredAPIKey(keyringUserFor(cloned.id), existingKey));
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
      markCredentialMutation();
      const selectionEpoch = ++activeProfileSelectionEpoch;
      persistActiveProfileId(id);
      const refreshed: UpstreamProfile = { ...profile, lastUsedAt: Date.now() };
      const nextProfiles = store.getState().profiles.map((p) => p.id === id ? refreshed : p);
      persistProfiles(nextProfiles);
      store.setState({
        profiles: nextProfiles,
        activeProfileId: id,
        ...activeProfileRuntimePatch(profile, store.getState().fhlTransportMode),
        apiKey: "",
        activeCredentialStatus: profile.apiMode === "runninghub" ? "present" : "checking",
      });
      if (profile.apiMode === "runninghub") return;
      try {
        const apiKey = await GetStoredAPIKey(keyringUserFor(id));
        if (selectionEpoch !== activeProfileSelectionEpoch || store.getState().activeProfileId !== id) return;
        store.setState({
          apiKey,
          activeCredentialStatus: apiKey.trim() ? "present" : "missing",
        });
      } catch {
        if (selectionEpoch !== activeProfileSelectionEpoch || store.getState().activeProfileId !== id) return;
        store.setState({ apiKey: "", activeCredentialStatus: "error" });
      }
    },
  };
}
