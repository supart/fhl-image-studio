import { validateAPIKeyForHeader } from "../../../lib/apiKey";
import {
  imageModelCatalogBaseUrl,
  imageModelCatalogProvider,
  imageModelProviderForProfile,
  intersectFHLImageModelCatalogs,
  normalizeImageModelCatalog,
  type StoredImageModelCatalog,
} from "../../../lib/fhlImageModels";
import {
  isOfficialFHLPoolProfile,
  mapFHLImagesProfilesToPoolSlots,
} from "../../../lib/profiles";
import type { UpstreamProfile } from "../../../types/domain";

type PreparedCredential = {
  apiKey: string;
  profile: UpstreamProfile;
  slotNumber: number;
};

export type PreparedFHLPoolImageModelConfig = {
  catalog: StoredImageModelCatalog;
  /** Safe union used only for diagnostics/UI. Never persist this as validated catalog. */
  availability: FHLPoolModelAvailability[];
  targetProfileIds: string[];
  targetSlotNumbers: number[];
  validationIdsByProfileId: Record<string, string>;
};

export type FHLPoolModelAvailability = {
  id: string;
  available: boolean;
  selectable: boolean;
  supportsGenerations: boolean;
  supportsEdits: boolean;
  supportsTransparency: boolean;
  availableSlotNumbers: number[];
  missingSlotNumbers: number[];
  disabledReason?: string;
};

export type FHLPoolModelValidationTarget = {
  profileId: string;
  slotNumber: number;
  exists: boolean;
  enabled: boolean;
  credentialPresent: boolean;
  baseURL: string;
  provider: string;
};

/**
 * Returns a stable, non-secret identity for the current ten-slot validation
 * inputs. The UI uses it to deduplicate automatic catalog requests during one
 * panel lifetime; credential contents are intentionally never included.
 */
export function buildFHLPoolModelValidationSignature(
  targets: readonly FHLPoolModelValidationTarget[],
  configGeneration: number,
): string {
  const generationNumber = Number(configGeneration);
  const generation = Number.isFinite(generationNumber)
    ? Math.max(0, Math.trunc(generationNumber))
    : 0;
  const normalizedTargets = targets
    .map((target) => ({
      profileId: String(target.profileId ?? "").trim(),
      slotNumber: Number.isFinite(Number(target.slotNumber)) ? Math.trunc(Number(target.slotNumber)) : 0,
      exists: target.exists === true,
      enabled: target.enabled === true,
      credentialPresent: target.credentialPresent === true,
      baseURL: imageModelCatalogBaseUrl(String(target.baseURL ?? "")),
      provider: imageModelCatalogProvider(String(target.provider ?? "fhl")),
    }))
    .sort((left, right) => left.slotNumber - right.slotNumber || left.profileId.localeCompare(right.profileId));
  return JSON.stringify({ generation, targets: normalizedTargets });
}

export function selectConsistentFHLPoolImageModel(
  profiles: readonly UpstreamProfile[],
  targetProfileIds: readonly string[],
): string {
  if (targetProfileIds.length === 0 || new Set(targetProfileIds).size !== targetProfileIds.length) return "";
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const modelIds = targetProfileIds.map((profileId) => (
    profilesById.get(profileId)?.imageModelID.trim() ?? ""
  ));
  const firstModelId = modelIds[0];
  return firstModelId && modelIds.every((modelId) => modelId === firstModelId)
    ? firstModelId
    : "";
}

export type PrepareFHLPoolImageModelConfigInput = {
  profiles: readonly UpstreamProfile[];
  readCredential: (profileId: string) => Promise<string>;
  fetchCatalog: (
    profile: UpstreamProfile,
    apiKey: string,
    slotNumber: number,
    sharedFetchedAt: number,
  ) => Promise<StoredImageModelCatalog>;
  sharedFetchedAt?: number;
};

function fixedSlotError(slotNumber: number, reason: string): Error {
  return new Error(`FHL${slotNumber} ${reason}`);
}

/**
 * Build a conservative, non-persistent union for the ten-slot UI. A model is
 * selectable only when every validated target slot returned it and every
 * slot marked it callable. Missing slots and provider capability conflicts
 * remain visible instead of silently disappearing from the UI.
 */
export function buildFHLPoolModelAvailability(
  catalogs: readonly StoredImageModelCatalog[],
  targetSlotNumbers: readonly number[],
): FHLPoolModelAvailability[] {
  const slotNumbers = targetSlotNumbers.map((value) => Math.trunc(Number(value))).filter((value) => value > 0);
  const byModel = new Map<string, {
    id: string;
    entries: Array<{ slot: number; model: StoredImageModelCatalog["models"][number] }>;
  }>();
  catalogs.forEach((catalog, index) => {
    const slot = slotNumbers[index] ?? index + 1;
    for (const model of catalog.models) {
      const key = model.id.trim().toLowerCase();
      if (!key || byModel.has(key) && byModel.get(key)!.entries.some((entry) => entry.slot === slot)) continue;
      const current = byModel.get(key) ?? { id: model.id, entries: [] };
      current.entries.push({ slot, model });
      byModel.set(key, current);
    }
  });
  return Array.from(byModel.values())
    .map(({ id, entries }) => {
      const presentSlots = entries.map(({ slot }) => slot).sort((a, b) => a - b);
      const missingSlots = slotNumbers.filter((slot) => !presentSlots.includes(slot));
      const models = entries.map(({ model }) => model);
      const supportsGenerations = missingSlots.length === 0 && models.every((model) => model.supportsGenerations === true);
      const supportsEdits = missingSlots.length === 0 && models.every((model) => model.supportsEdits === true);
      const supportsTransparency = missingSlots.length === 0 && models.every((model) => model.supportsTransparency === true);
      const providerAvailable = models.every((model) => model.available !== false);
      const selectable = missingSlots.length === 0 && providerAvailable && supportsGenerations;
      let disabledReason = models.find((model) => model.disabledReason)?.disabledReason;
      if (!selectable && missingSlots.length > 0) {
        disabledReason = `并非所有已启用槽位共同可用（缺少 ${missingSlots.map((slot) => `FHL${slot}`).join("、")}）`;
      } else if (!selectable && !disabledReason) {
        disabledReason = supportsGenerations ? "Provider 或当前路由标记为不可用" : "Provider 不支持图像生成";
      }
      return {
        id,
        // `available` is the final pool-level truth: a partial-slot or
        // generation-disabled entry is diagnostic-only, never callable.
        available: selectable,
        selectable,
        supportsGenerations,
        supportsEdits,
        supportsTransparency,
        availableSlotNumbers: presentSlots,
        missingSlotNumbers: missingSlots,
        ...(disabledReason ? { disabledReason } : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Reads and validates each enabled pool credential without exposing it outside
 * this function. Provider errors are deliberately replaced with fixed text.
 */
export async function prepareFHLPoolImageModelConfig({
  profiles,
  readCredential,
  fetchCatalog,
  sharedFetchedAt = Date.now(),
}: PrepareFHLPoolImageModelConfigInput): Promise<PreparedFHLPoolImageModelConfig> {
  const enabledSlots = mapFHLImagesProfilesToPoolSlots([...profiles])
    .map((profile, index) => ({ profile, slotNumber: index + 1 }))
    .filter((entry): entry is { profile: UpstreamProfile; slotNumber: number } => (
      !!entry.profile
      && isOfficialFHLPoolProfile(entry.profile)
      && entry.profile.continuousPoolEnabled !== false
    ));
  const credentials: PreparedCredential[] = [];

  try {
    for (const { profile, slotNumber } of enabledSlots) {
      let rawKey = "";
      try {
        rawKey = await readCredential(profile.id);
      } catch {
        throw fixedSlotError(slotNumber, "无法读取已保存凭据，统一配置未生效。");
      }
      if (!rawKey.trim()) {
        if (profile.fhlImagesPoolKeyHint) {
          throw fixedSlotError(slotNumber, "已保存凭据不可用，统一配置未生效。");
        }
        continue;
      }
      try {
        credentials.push({
          apiKey: validateAPIKeyForHeader(rawKey),
          profile,
          slotNumber,
        });
      } catch {
        throw fixedSlotError(slotNumber, "已保存凭据格式无效，统一配置未生效。");
      } finally {
        rawKey = "";
      }
    }

    if (credentials.length === 0) {
      throw new Error("没有已配置且启用的 FHL Images 槽位可验证。");
    }

    const expectedBaseURL = imageModelCatalogBaseUrl(credentials[0].profile.baseURL);
    const expectedProvider = imageModelProviderForProfile(credentials[0].profile);
    if (credentials.some(({ profile }) => (
      imageModelCatalogBaseUrl(profile.baseURL) !== expectedBaseURL
      || imageModelProviderForProfile(profile) !== expectedProvider
    ))) {
      throw new Error("已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。");
    }

    const catalogs: StoredImageModelCatalog[] = [];
    for (const credential of credentials) {
      try {
        const catalog = await fetchCatalog(
          credential.profile,
          credential.apiKey,
          credential.slotNumber,
          sharedFetchedAt,
        );
        if (!catalog.validationId?.trim()) {
          throw new Error("原生模型目录未返回槽位验证证明。");
        }
        catalogs.push(catalog);
      } catch {
        throw fixedSlotError(credential.slotNumber, "模型目录验证失败，统一配置未生效。");
      } finally {
        credential.apiKey = "";
      }
    }

    let catalog: StoredImageModelCatalog;
    try {
      catalog = intersectFHLImageModelCatalogs(catalogs, sharedFetchedAt);
    } catch (error) {
      // Keep the union available for diagnostics when there is no common
      // model. Other structural failures (URL/provider mismatch) remain fatal.
      if (!(error instanceof Error) || !error.message.includes("没有共同可用")) throw error;
      const first = catalogs[0];
      catalog = normalizeImageModelCatalog([], first.baseUrl, first.provider, sharedFetchedAt);
    }
    return {
      catalog,
      availability: buildFHLPoolModelAvailability(catalogs, credentials.map(({ slotNumber }) => slotNumber)),
      targetProfileIds: credentials.map(({ profile }) => profile.id),
      targetSlotNumbers: credentials.map(({ slotNumber }) => slotNumber),
      validationIdsByProfileId: Object.fromEntries(credentials.map(({ profile }, index) => (
        [profile.id, catalogs[index].validationId!]
      ))),
    };
  } finally {
    for (const credential of credentials) credential.apiKey = "";
  }
}
