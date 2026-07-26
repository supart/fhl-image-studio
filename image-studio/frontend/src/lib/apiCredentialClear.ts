import {
  apiCredentialUsersForProfiles,
  buildAPICredentialInventory,
  deleteAndVerifyAPIKeyUsers,
  hasActiveAPIWork,
  type APICredentialClearResult,
} from "./apiCredentialLibrary.ts";
import type { StudioState } from "../state/studioStore.types.ts";
import { legacyStorageNamespacesFor } from "./storageNamespace.ts";

export type APICredentialClearOperations = {
  deleteKey: (user: string) => Promise<void>;
  getKey: (user: string) => Promise<string>;
  clearRunningHub: (baseURL: string) => Promise<void>;
  clearLocalFiles: () => Promise<boolean>;
  clearBrowserStorage: () => number;
  clearLegacyKeys: () => void;
  persistProfiles: (profiles: StudioState["profiles"]) => void;
  persistActiveProfileId: (id: string) => void;
};

export async function clearAllAPIConfigurations(
  state: StudioState,
  setState: (patch: Partial<StudioState>) => void,
  operations: APICredentialClearOperations,
): Promise<APICredentialClearResult> {
  if (hasActiveAPIWork(state)) {
    throw new Error("仍有排队、运行或测试中的 API 任务，任务结束后才能清空。");
  }

  const profiles = [...state.profiles];
  const inventory = buildAPICredentialInventory(profiles, state.fhlTextAPIConfigured);
  const keyUsers = [
    ...apiCredentialUsersForProfiles(profiles),
    ...legacyStorageNamespacesFor().flatMap((namespace) => [
      `profile:${namespace}:fhl-text-assistant`,
      ...profiles.map((profile) => `profile:${namespace}:${profile.id}`),
    ]),
  ];
  const deletion = await deleteAndVerifyAPIKeyUsers(keyUsers, {
    deleteKey: operations.deleteKey,
    getKey: operations.getKey,
  });
  if (deletion.failedUsers.length > 0) {
    throw new Error(`系统凭据库仍有 ${deletion.failedUsers.length} 项未能删除，配置记录已保留，请重试。`);
  }

  const runningHubBaseURLs = Array.from(new Set(
    inventory.runningHubProfiles.map((profile) => profile.baseURL.trim()).filter(Boolean),
  ));
  let runningHubBridgesCleared = 0;
  for (const baseURL of runningHubBaseURLs) {
    try {
      await operations.clearRunningHub(baseURL);
    } catch (error: any) {
      throw new Error(`本地凭据已清除，但 RunningHub 桥接清除失败：${error?.message ?? error}。配置记录已保留，可重试。`);
    }
    runningHubBridgesCleared += 1;
  }

  let localFilesCleared = false;
  try {
    localFilesCleared = await operations.clearLocalFiles();
  } catch (error: any) {
    throw new Error(`系统凭据已清除，但本地 API 凭据文件删除失败：${error?.message ?? error}。配置记录已保留，可重试。`);
  }
  operations.clearBrowserStorage();
  operations.clearLegacyKeys();
  operations.persistProfiles([]);
  operations.persistActiveProfileId("");
  setState({
    profiles: [],
    activeProfileId: "",
    apiKey: "",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    apiMode: "responses",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    fhlTextAPIConfigured: false,
    fhlTextAPIKeyHint: "",
    fhlTextAPITestStatus: "unconfigured",
    fhlTextAPITestMessage: "",
  });

  return {
    credentialsCleared: deletion.attempted,
    profilesCleared: profiles.length,
    runningHubBridgesCleared,
    localFilesCleared,
  };
}
