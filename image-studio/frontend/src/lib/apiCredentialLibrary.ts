import type { UpstreamProfile } from "../types/domain.ts";
import { FHL_TEXT_API_KEYRING_USER, LEGACY_API_KEY_USERS } from "./apiCredentialIds.ts";
import {
  apiModeUsesBridgeStoredKey,
  isOfficialFHLImagesProfile,
  keyringUserFor,
} from "./profiles.ts";

export type APICredentialInventory = {
  fhlTextConfigured: boolean;
  fhlImagesProfiles: UpstreamProfile[];
  directProfiles: UpstreamProfile[];
  runningHubProfiles: UpstreamProfile[];
  profileCount: number;
};

export type APIKeyDeletionResult = {
  attempted: number;
  failedUsers: string[];
};

export type APICredentialClearResult = {
  credentialsCleared: number;
  profilesCleared: number;
  runningHubBridgesCleared: number;
  localFilesCleared: boolean;
};

export function buildAPICredentialInventory(
  profiles: UpstreamProfile[],
  fhlTextConfigured: boolean,
): APICredentialInventory {
  const fhlImagesProfiles = profiles.filter((profile) => (
    isOfficialFHLImagesProfile(profile) && profile.fhlImagesPoolSlot !== undefined
  ));
  const fhlImageIds = new Set(fhlImagesProfiles.map((profile) => profile.id));
  const runningHubProfiles = profiles.filter((profile) => apiModeUsesBridgeStoredKey(profile.apiMode));
  const runningHubIds = new Set(runningHubProfiles.map((profile) => profile.id));
  const directProfiles = profiles.filter((profile) => (
    !fhlImageIds.has(profile.id) && !runningHubIds.has(profile.id)
  ));
  return {
    fhlTextConfigured,
    fhlImagesProfiles,
    directProfiles,
    runningHubProfiles,
    profileCount: profiles.length,
  };
}

export function apiCredentialUsersForProfiles(profiles: UpstreamProfile[]): string[] {
  return Array.from(new Set([
    FHL_TEXT_API_KEYRING_USER,
    ...LEGACY_API_KEY_USERS,
    ...profiles.map((profile) => keyringUserFor(profile.id)),
  ]));
}

export function hasActiveAPIWork(input: {
  isRunning: boolean;
  runningJobs: string[];
  batchTasksById: Record<string, { status: string; launchState?: string }>;
  runningJobMeta?: Record<string, unknown>;
  isTestingKey?: boolean;
  fhlTextAPITestStatus?: string;
  isOptimizingPrompt?: boolean;
  isReversingPrompt?: boolean;
  workspacePromptOperations?: Record<string, {
    isOptimizingPrompt?: boolean;
    isReversingPrompt?: boolean;
  }>;
  jobGroupsByWorkspace?: Record<string, Array<{
    statusSummary?: { queued?: number; running?: number };
    slots?: Array<{ status?: string }>;
  }>>;
}): boolean {
  if (
    input.isRunning
    || input.runningJobs.length > 0
    || input.isTestingKey
    || input.fhlTextAPITestStatus === "testing"
    || input.isOptimizingPrompt
    || input.isReversingPrompt
    || Object.keys(input.runningJobMeta ?? {}).length > 0
  ) return true;
  if (Object.values(input.workspacePromptOperations ?? {}).some((operation) => (
    operation.isOptimizingPrompt || operation.isReversingPrompt
  ))) return true;
  if (Object.values(input.batchTasksById).some((task) => (
    task.status === "queued" || task.status === "running" || task.launchState === "submitting"
  ))) return true;
  return Object.values(input.jobGroupsByWorkspace ?? {}).some((groups) => groups.some((group) => (
    (group.statusSummary?.queued ?? 0) > 0
    || (group.statusSummary?.running ?? 0) > 0
    || (group.slots ?? []).some((slot) => slot.status === "queued" || slot.status === "running")
  )));
}

export async function deleteAndVerifyAPIKeyUsers(
  users: string[],
  operations: {
    deleteKey: (user: string) => Promise<void>;
    getKey: (user: string) => Promise<string>;
  },
): Promise<APIKeyDeletionResult> {
  const failedUsers: string[] = [];
  for (const user of Array.from(new Set(users))) {
    try {
      await operations.deleteKey(user);
      const remaining = await operations.getKey(user);
      if (remaining.trim()) failedUsers.push(user);
    } catch {
      failedUsers.push(user);
    }
  }
  return {
    attempted: Array.from(new Set(users)).length,
    failedUsers,
  };
}
