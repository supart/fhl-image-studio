import { validateAPIKeyForHeader } from "../../../lib/apiKey";
import {
  imageModelCatalogBaseUrl,
  imageModelCatalogProvider,
  imageModelProviderForProfile,
  intersectFHLImageModelCatalogs,
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
  targetProfileIds: string[];
  targetSlotNumbers: number[];
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
  ) => Promise<StoredImageModelCatalog>;
  sharedFetchedAt?: number;
};

function fixedSlotError(slotNumber: number, reason: string): Error {
  return new Error(`FHL${slotNumber} ${reason}`);
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
        catalogs.push(await fetchCatalog(credential.profile, credential.apiKey));
      } catch {
        throw fixedSlotError(credential.slotNumber, "模型目录验证失败，统一配置未生效。");
      } finally {
        credential.apiKey = "";
      }
    }

    const catalog = intersectFHLImageModelCatalogs(catalogs, sharedFetchedAt);
    return {
      catalog,
      targetProfileIds: credentials.map(({ profile }) => profile.id),
      targetSlotNumbers: credentials.map(({ slotNumber }) => slotNumber),
    };
  } finally {
    for (const credential of credentials) credential.apiKey = "";
  }
}
