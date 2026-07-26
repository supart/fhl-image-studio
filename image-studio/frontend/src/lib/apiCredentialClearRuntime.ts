import { DeleteStoredAPIKey, GetStoredAPIKey } from "../platform/runtime/host.ts";
import { persistActiveProfileId, persistProfiles } from "../state/studioStore.shared.ts";
import type { StudioState } from "../state/studioStore.types.ts";
import { clearBrowserCredentialStorage } from "./browserCredentialCleanup.ts";
import { clearLocalCredentialFiles } from "./localCredentialCleanup.ts";
import { clearRunningHubCredential } from "./runningHubCredentialCleanup.ts";
import { clearLegacyAPIKeys } from "./storage.ts";
import {
  clearAllAPIConfigurations,
  type APICredentialClearOperations,
} from "./apiCredentialClear.ts";

const RUNTIME_CLEAR_OPERATIONS: APICredentialClearOperations = {
  deleteKey: DeleteStoredAPIKey,
  getKey: GetStoredAPIKey,
  clearRunningHub: clearRunningHubCredential,
  clearLocalFiles: clearLocalCredentialFiles,
  clearBrowserStorage: clearBrowserCredentialStorage,
  clearLegacyKeys: clearLegacyAPIKeys,
  persistProfiles,
  persistActiveProfileId,
};

export function clearAllRuntimeAPIConfigurations(
  state: StudioState,
  setState: (patch: Partial<StudioState>) => void,
) {
  return clearAllAPIConfigurations(state, setState, RUNTIME_CLEAR_OPERATIONS);
}
