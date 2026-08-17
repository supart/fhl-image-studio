import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearHistoryStorage: vi.fn(async () => ({ historyEntries: 2, fullHistoryEntries: 1 })),
  deleteStoredAPIKey: vi.fn(async () => undefined),
  generate: vi.fn(async () => undefined),
  setOutputDir: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/storage")>(),
  clearHistoryStorage: mocks.clearHistoryStorage,
}));

vi.mock("../src/platform/runtime/host", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/platform/runtime/host")>(),
  DeleteStoredAPIKey: mocks.deleteStoredAPIKey,
  Generate: mocks.generate,
  SetOutputDir: mocks.setOutputDir,
}));

import { storageKey } from "../src/lib/storageNamespace.ts";
import { useStudioStore } from "../src/state/studioStore";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults";

const profiles = [
  {
    id: "fhl-images-1",
    name: "FHL Images 1",
    apiMode: "images" as const,
    requestPolicy: "openai" as const,
    baseURL: "https://api.example.test",
    textModelID: "text-model",
    imageModelID: "image-model",
    concurrencyLimit: 5,
    fhlImagesPoolSlot: 1,
    fhlImagesPoolKeyHint: "sk-test...1234",
    imagesNewAPICompat: true,
    createdAt: 1,
  },
];

function removeAllTestStorage() {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
  for (const key of keys) localStorage.removeItem(key!);
}

function seedDirtyState() {
  const first = createDefaultWorkspace("ws-one", "webp", "工作区 1");
  const second = createDefaultWorkspace("ws-two", "webp", "工作区 2");
  useStudioStore.setState({
    apiKey: "memory-secret",
    profiles,
    activeProfileId: profiles[0].id,
    baseURL: profiles[0].baseURL,
    textModelID: profiles[0].textModelID,
    imageModelID: profiles[0].imageModelID,
    apiMode: "images",
    requestPolicy: "openai",
    imagesNewAPICompat: true,
    fhlTransportMode: "responses",
    fhlTextAPIConfigured: true,
    fhlTextAPIKeyHint: "...5678",
    fhlTextAPITestStatus: "success",
    fhlTextAPITestMessage: "configured",
    mode: "edit",
    prompt: "dirty prompt",
    outputFormat: "webp",
    proxyMode: "custom",
    proxyURL: "http://127.0.0.1:7890",
    workspaces: [first, second],
    activeWorkspaceId: second.id,
    history: [{
      id: "history-one",
      prompt: "history",
      mode: "generate",
      size: "1024x1024",
      quality: "medium",
      createdAt: 1,
    }],
    promptHistory: ["one", "two"],
    presets: [{
      id: "preset-one",
      name: "preset",
      size: "1024x1024",
      quality: "medium",
      negativePrompt: "",
      batchCount: 1,
    }],
    materialGroups: [{
      id: "material-one",
      name: "素材",
      kind: "folder",
      items: [],
      createdAt: 1,
      updatedAt: 1,
    }],
    batchTasksById: {
      finished: {
        id: "finished",
        workspaceId: second.id,
        slotIndex: 0,
        status: "failed",
        createdAt: 1,
        updatedAt: 1,
        mode: "generate",
        apiMode: "images",
        prompt: "done",
        size: "1024x1024",
        quality: "medium",
        outputFormat: "png",
      },
    },
    runningJobs: [],
    runningJobMeta: {},
    jobGroupsByWorkspace: {},
    isRunning: false,
    isTestingKey: false,
    isOptimizingPrompt: false,
    isReversingPrompt: false,
    isResettingApplication: false,
    historyLoading: false,
    historyHasMore: false,
    canvasViewResetTick: 7,
  });
  localStorage.setItem(storageKey("gptcodex.profiles"), "profiles-byte-for-byte");
  localStorage.setItem(storageKey("gptcodex.activeProfileId"), profiles[0].id);
  localStorage.setItem(storageKey("gptcodex.fhlTransportMode.v1"), "responses");
  localStorage.setItem(storageKey("image-studio.browser-key.profile:default:fhl-images-1"), "browser-secret");
  localStorage.setItem(storageKey("migration.desktop-v2.0.3"), "1");
  localStorage.setItem(storageKey("gptcodex.promptHistory"), "dirty");
}

describe("resetApplicationStatePreservingAPI", () => {
  beforeEach(() => {
    removeAllTestStorage();
    mocks.clearHistoryStorage.mockClear();
    mocks.deleteStoredAPIKey.mockClear();
    mocks.generate.mockClear();
    mocks.setOutputDir.mockReset();
    mocks.setOutputDir.mockResolvedValue(undefined);
    seedDirtyState();
  });

  it("resets user state while preserving every API field and credential marker", async () => {
    const before = useStudioStore.getState();
    const preserved = {
      apiKey: before.apiKey,
      profiles: structuredClone(before.profiles),
      activeProfileId: before.activeProfileId,
      baseURL: before.baseURL,
      textModelID: before.textModelID,
      imageModelID: before.imageModelID,
      apiMode: before.apiMode,
      requestPolicy: before.requestPolicy,
      imagesNewAPICompat: before.imagesNewAPICompat,
      fhlTransportMode: before.fhlTransportMode,
      fhlTextAPIConfigured: before.fhlTextAPIConfigured,
      fhlTextAPIKeyHint: before.fhlTextAPIKeyHint,
    };

    const summary = await before.resetApplicationStatePreservingAPI();
    const after = useStudioStore.getState();

    expect(mocks.setOutputDir).toHaveBeenCalledOnce();
    expect(mocks.setOutputDir).toHaveBeenCalledWith("");
    expect(mocks.clearHistoryStorage).toHaveBeenCalledOnce();
    expect(mocks.deleteStoredAPIKey).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect({
      apiKey: after.apiKey,
      profiles: after.profiles,
      activeProfileId: after.activeProfileId,
      baseURL: after.baseURL,
      textModelID: after.textModelID,
      imageModelID: after.imageModelID,
      apiMode: after.apiMode,
      requestPolicy: after.requestPolicy,
      imagesNewAPICompat: after.imagesNewAPICompat,
      fhlTransportMode: after.fhlTransportMode,
      fhlTextAPIConfigured: after.fhlTextAPIConfigured,
      fhlTextAPIKeyHint: after.fhlTextAPIKeyHint,
    }).toEqual(preserved);
    expect(after.workspaces).toHaveLength(1);
    expect(after.prompt).toBe("");
    expect(after.history).toEqual([]);
    expect(after.promptHistory).toEqual([]);
    expect(after.presets).toEqual([]);
    expect(after.materialGroups).toEqual([]);
    expect(after.batchTasksById).toEqual({});
    expect(after.theme).toBe("system");
    expect(after.proxyMode).toBe("system");
    expect(after.outputFormat).toBe("png");
    expect(after.canvasViewResetTick).toBe(8);
    expect(summary.apiConfigurationsPreserved).toBe(2);
    expect(localStorage.getItem(storageKey("gptcodex.profiles"))).toBe("profiles-byte-for-byte");
    expect(localStorage.getItem(storageKey("gptcodex.activeProfileId"))).toBe(profiles[0].id);
    expect(localStorage.getItem(storageKey("gptcodex.fhlTransportMode.v1"))).toBe("responses");
    expect(localStorage.getItem(storageKey("image-studio.browser-key.profile:default:fhl-images-1"))).toBe("browser-secret");
    expect(localStorage.getItem(storageKey("migration.desktop-v2.0.3"))).toBe("1");
  });

  it("rejects active work before any persistence mutation", async () => {
    useStudioStore.setState({
      batchTasksById: {
        pending: {
          ...useStudioStore.getState().batchTasksById.finished,
          id: "pending",
          status: "failed",
          launchState: "submitting",
        },
      },
    });

    await expect(useStudioStore.getState().resetApplicationStatePreservingAPI()).rejects.toThrow(/结束后才能恢复默认/);
    expect(mocks.setOutputDir).not.toHaveBeenCalled();
    expect(mocks.clearHistoryStorage).not.toHaveBeenCalled();
    expect(mocks.deleteStoredAPIKey).not.toHaveBeenCalled();
    expect(useStudioStore.getState().history).toHaveLength(1);
    expect(localStorage.getItem(storageKey("gptcodex.promptHistory"))).toBe("dirty");
  });

  it("deduplicates reset and blocks a submit while persistence is in flight", async () => {
    let releaseOutput!: () => void;
    mocks.setOutputDir.mockImplementation(() => new Promise<void>((resolve) => { releaseOutput = resolve; }));

    const first = useStudioStore.getState().resetApplicationStatePreservingAPI();
    const second = useStudioStore.getState().resetApplicationStatePreservingAPI();
    expect(first).toBe(second);
    expect(useStudioStore.getState().isResettingApplication).toBe(true);
    await useStudioStore.getState().submit();
    expect(mocks.generate).not.toHaveBeenCalled();

    releaseOutput();
    await first;
    expect(mocks.setOutputDir).toHaveBeenCalledOnce();
    expect(mocks.clearHistoryStorage).toHaveBeenCalledOnce();
    expect(useStudioStore.getState().isResettingApplication).toBe(false);
  });
});
