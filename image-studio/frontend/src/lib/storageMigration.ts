import type { UpstreamProfile } from "../types/domain";
import { migrateHistoryFromNamespace } from "./storage";
import {
  STORAGE_NAMESPACE,
  hasMigratableNamespaceState,
  legacyStorageNamespacesFor,
  storageKey,
} from "./storageNamespace";

const MIGRATION_MARKER = storageKey("migration.desktop-v2.0.3");
const PROFILES_SUFFIX = "gptcodex.profiles";
const WORKSPACE_SUFFIX = "gptcodex.workspaceSession.v1";
const TEXT_CREDENTIAL_ID = "fhl-text-assistant";

type CredentialOperations = {
  getKey: (user: string) => Promise<string>;
  setKey: (user: string, value: string) => Promise<void>;
};

function namespacedKey(namespace: string, suffix: string) {
  return `image-studio.${namespace}.${suffix}`;
}

function parseProfiles(raw: string | null): UpstreamProfile[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

function mergeProfiles(source: UpstreamProfile[], target: UpstreamProfile[]) {
  const merged = new Map(source.map((profile) => [profile.id, profile]));
  for (const profile of target) merged.set(profile.id, profile);
  return Array.from(merged.values());
}

function workspaceUpdatedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const value = JSON.parse(raw) as { updatedAt?: unknown };
    return Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0;
  } catch {
    return 0;
  }
}

function copyMissingLocalStorage(sourceNamespace: string) {
  const sourcePrefix = `image-studio.${sourceNamespace}.`;
  const targetPrefix = `image-studio.${STORAGE_NAMESPACE}.`;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(sourcePrefix) && !key.includes(".image-studio.browser-key.")) keys.push(key);
  }
  for (const sourceKey of keys) {
    const targetKey = targetPrefix + sourceKey.slice(sourcePrefix.length);
    if (localStorage.getItem(targetKey) === null) {
      const value = localStorage.getItem(sourceKey);
      if (value !== null) localStorage.setItem(targetKey, value);
    }
  }
}

async function copyCredentialIfMissing(
  sourceNamespace: string,
  credentialId: string,
  operations: CredentialOperations,
) {
  const targetUser = `profile:${STORAGE_NAMESPACE}:${credentialId}`;
  if ((await operations.getKey(targetUser).catch(() => "")).trim()) return;
  const sourceUser = `profile:${sourceNamespace}:${credentialId}`;
  let sourceValue = await operations.getKey(sourceUser).catch(() => "");
  if (!sourceValue.trim()) {
    const browserSourceKey = namespacedKey(sourceNamespace, `image-studio.browser-key.${sourceUser}`);
    sourceValue = localStorage.getItem(browserSourceKey) ?? "";
  }
  if (sourceValue.trim()) await operations.setKey(targetUser, sourceValue.trim());
}

export async function migrateStableNamespaceData(operations: CredentialOperations): Promise<void> {
  if (typeof localStorage === "undefined" || typeof indexedDB === "undefined") return;
  if (localStorage.getItem(MIGRATION_MARKER) === "1") return;
  const sources = legacyStorageNamespacesFor();
  if (sources.length === 0) return;

  for (const sourceNamespace of sources) {
    const sourceHasState = hasMigratableNamespaceState(sourceNamespace, localStorage);
    const sourceProfilesKey = namespacedKey(sourceNamespace, PROFILES_SUFFIX);
    const targetProfilesKey = namespacedKey(STORAGE_NAMESPACE, PROFILES_SUFFIX);
    const sourceProfiles = parseProfiles(localStorage.getItem(sourceProfilesKey));
    const targetProfiles = parseProfiles(localStorage.getItem(targetProfilesKey));
    copyMissingLocalStorage(sourceNamespace);
    const mergedProfiles = mergeProfiles(sourceProfiles, targetProfiles);
    if (mergedProfiles.length > 0) localStorage.setItem(targetProfilesKey, JSON.stringify(mergedProfiles));

    const sourceWorkspaceKey = namespacedKey(sourceNamespace, WORKSPACE_SUFFIX);
    const targetWorkspaceKey = namespacedKey(STORAGE_NAMESPACE, WORKSPACE_SUFFIX);
    const sourceWorkspace = localStorage.getItem(sourceWorkspaceKey);
    const targetWorkspace = localStorage.getItem(targetWorkspaceKey);
    if (sourceWorkspace && workspaceUpdatedAt(sourceWorkspace) > workspaceUpdatedAt(targetWorkspace)) {
      localStorage.setItem(targetWorkspaceKey, sourceWorkspace);
    }

    await migrateHistoryFromNamespace(sourceNamespace);
    for (const profile of sourceProfiles) {
      await copyCredentialIfMissing(sourceNamespace, profile.id, operations);
    }
    if (sourceHasState) {
      await copyCredentialIfMissing(sourceNamespace, TEXT_CREDENTIAL_ID, operations);
    }
  }
  localStorage.setItem(MIGRATION_MARKER, "1");
}
