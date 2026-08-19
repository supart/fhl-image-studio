import { beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  optimizePrompt: vi.fn(),
  reversePrompt: vi.fn(),
  openImageDialog: vi.fn(),
  importImageFromB64: vi.fn(),
  registerImportedImageAsset: vi.fn(),
  getStoredAPIKey: vi.fn(),
}));

vi.mock("../src/platform/runtime/host", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/platform/runtime/host")>(),
  OptimizePrompt: hostMocks.optimizePrompt,
  ReversePrompt: hostMocks.reversePrompt,
  OpenImageDialog: hostMocks.openImageDialog,
  ImportImageFromB64: hostMocks.importImageFromB64,
  RegisterImportedImageAsset: hostMocks.registerImportedImageAsset,
  GetStoredAPIKey: hostMocks.getStoredAPIKey,
}));

import { useStudioStore } from "../src/state/studioStore.ts";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults.ts";
import type { SourceImage, UpstreamProfile, Workspace } from "../src/types/domain.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const profile: UpstreamProfile = {
  id: "workspace-profile",
  name: "Workspace Responses",
  apiMode: "responses",
  requestPolicy: "openai",
  baseURL: "https://workspace.example.test",
  textModelID: "text-model",
  imageModelID: "image-model",
  concurrencyLimit: 2,
  createdAt: 1,
};

function workspace(id: string, prompt: string, sources: SourceImage[] = []): Workspace {
  return {
    ...createDefaultWorkspace(id, "png", id, {
      activeProfileId: profile.id,
      fhlTransportMode: "responses",
    }),
    prompt,
    sources,
    reversePromptImage: {
      path: `I:/input/${id}.png`,
      name: `${id}.png`,
      size: 1,
    },
  };
}

function installWorkspaces() {
  const first = workspace("workspace-a", "prompt-a");
  const second = workspace("workspace-b", "prompt-b");
  useStudioStore.setState({
    workspaces: [first, second],
    activeWorkspaceId: first.id,
    activeProfileId: profile.id,
    profiles: [profile],
    apiMode: "responses",
    fhlTransportMode: "responses",
    apiKey: "sk-synthetic-test-key",
    baseURL: profile.baseURL,
    textModelID: profile.textModelID,
    imageModelID: profile.imageModelID,
    fhlTextAPIConfigured: false,
    prompt: first.prompt,
    reversePromptImage: first.reversePromptImage,
    sources: [],
    currentImage: null,
    isResettingApplication: false,
    isOptimizingPrompt: false,
    isReversingPrompt: false,
    workspacePromptOperations: {},
    toasts: [],
  });
  return { first, second };
}

describe("workspace async isolation", () => {
  beforeEach(() => {
    hostMocks.optimizePrompt.mockReset();
    hostMocks.reversePrompt.mockReset();
    hostMocks.openImageDialog.mockReset();
    hostMocks.importImageFromB64.mockReset();
    hostMocks.registerImportedImageAsset.mockReset();
    hostMocks.getStoredAPIKey.mockReset();
    hostMocks.registerImportedImageAsset.mockResolvedValue(null);
    hostMocks.getStoredAPIKey.mockResolvedValue("");
    installWorkspaces();
  });

  it("routes prompt optimization completions to their origin workspaces", async () => {
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    hostMocks.optimizePrompt
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);

    const firstRun = useStudioStore.getState().optimizePrompt();
    await vi.waitFor(() => expect(hostMocks.optimizePrompt).toHaveBeenCalledTimes(1));
    expect(useStudioStore.getState().isOptimizingPrompt).toBe(true);

    useStudioStore.getState().switchWorkspace("workspace-b");
    expect(useStudioStore.getState().prompt).toBe("prompt-b");
    expect(useStudioStore.getState().isOptimizingPrompt).toBe(false);
    const secondRun = useStudioStore.getState().optimizePrompt();
    await vi.waitFor(() => expect(hostMocks.optimizePrompt).toHaveBeenCalledTimes(2));

    secondResult.resolve("optimized-b");
    await secondRun;
    expect(useStudioStore.getState().prompt).toBe("optimized-b");
    expect(useStudioStore.getState().isOptimizingPrompt).toBe(false);

    firstResult.resolve("optimized-a");
    await firstRun;
    expect(useStudioStore.getState().activeWorkspaceId).toBe("workspace-b");
    expect(useStudioStore.getState().prompt).toBe("optimized-b");
    expect(useStudioStore.getState().workspaces.find((item) => item.id === "workspace-a")?.prompt)
      .toBe("optimized-a");
  });

  it("routes reverse prompt completions independently when they finish out of order", async () => {
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    hostMocks.reversePrompt
      .mockReturnValueOnce(firstResult.promise)
      .mockReturnValueOnce(secondResult.promise);

    const firstRun = useStudioStore.getState().reversePromptFromImage();
    await vi.waitFor(() => expect(hostMocks.reversePrompt).toHaveBeenCalledTimes(1));
    useStudioStore.getState().switchWorkspace("workspace-b");
    const secondRun = useStudioStore.getState().reversePromptFromImage();
    await vi.waitFor(() => expect(hostMocks.reversePrompt).toHaveBeenCalledTimes(2));

    firstResult.resolve("reversed-a");
    await firstRun;
    expect(useStudioStore.getState().prompt).toBe("prompt-b");
    expect(useStudioStore.getState().workspaces.find((item) => item.id === "workspace-a")?.prompt)
      .toBe("reversed-a");

    secondResult.resolve("reversed-b");
    await secondRun;
    expect(useStudioStore.getState().prompt).toBe("reversed-b");
    expect(useStudioStore.getState().workspacePromptOperations).toEqual({
      "workspace-a": { isOptimizingPrompt: false, isReversingPrompt: false },
      "workspace-b": { isOptimizingPrompt: false, isReversingPrompt: false },
    });
  });

  it("returns delayed file dialog selections to the workspace that opened them", async () => {
    const firstDialog = deferred<any>();
    const secondDialog = deferred<any>();
    hostMocks.openImageDialog
      .mockReturnValueOnce(firstDialog.promise)
      .mockReturnValueOnce(secondDialog.promise);

    const firstRun = useStudioStore.getState().selectSourceImage();
    useStudioStore.getState().switchWorkspace("workspace-b");
    const secondRun = useStudioStore.getState().selectSourceImage();

    secondDialog.resolve({ path: "I:/input/b.png", name: "b.png", size: 2 });
    await secondRun;
    firstDialog.resolve({ path: "I:/input/a.png", name: "a.png", size: 1 });
    await firstRun;

    const state = useStudioStore.getState();
    expect(state.activeWorkspaceId).toBe("workspace-b");
    expect(state.sources.map((source) => source.path)).toEqual(["I:/input/b.png"]);
    expect(state.workspaces.find((item) => item.id === "workspace-a")?.sources.map((source) => source.path))
      .toEqual(["I:/input/a.png"]);
    expect(state.workspaces.find((item) => item.id === "workspace-b")?.sources.map((source) => source.path))
      .toEqual(["I:/input/b.png"]);
  });

  it("drops an imported image completion after its origin workspace closes", async () => {
    const imported = deferred<any>();
    hostMocks.importImageFromB64.mockReturnValueOnce(imported.promise);
    const file = new File([new Uint8Array([1, 2, 3])], "late.png", { type: "image/png" });

    const importing = useStudioStore.getState().importSourceImageFile(file);
    await vi.waitFor(() => expect(hostMocks.importImageFromB64).toHaveBeenCalledTimes(1));
    useStudioStore.getState().closeWorkspace("workspace-a");
    imported.resolve({ path: "I:/managed/late.png", imageB64: "AQID" });
    await importing;

    const state = useStudioStore.getState();
    expect(state.workspaces.map((item) => item.id)).toEqual(["workspace-b"]);
    expect(state.sources).toEqual([]);
    expect(hostMocks.registerImportedImageAsset).not.toHaveBeenCalled();
  });

  it("bases a delayed import on the live active source list after a deletion", async () => {
    const first = { path: "I:/input/first.png", name: "first.png", size: 1, width: 12000, height: 8000 };
    const second = { path: "I:/input/second.png", name: "second.png", size: 1, width: 12000, height: 8000 };
    const thirdImport = deferred<any>();
    const sourceWorkspace = workspace("workspace-a", "prompt-a", [first, second]);
    useStudioStore.setState({
      workspaces: [sourceWorkspace, useStudioStore.getState().workspaces[1]],
      sources: [first, second],
    });
    hostMocks.importImageFromB64.mockReturnValueOnce(thirdImport.promise);
    hostMocks.registerImportedImageAsset.mockResolvedValueOnce(null);

    const importing = useStudioStore.getState().importSourceImageFile(
      new File([new Uint8Array([1, 2, 3])], "third.png", { type: "image/png" }),
    );
    await vi.waitFor(() => expect(hostMocks.importImageFromB64).toHaveBeenCalledTimes(1));
    useStudioStore.getState().removeSource(0);
    thirdImport.resolve({ path: "I:/managed/third.png", imageB64: "AQID", width: 2400, height: 1600 });
    await importing;

    const state = useStudioStore.getState();
    expect(state.sources.map((source) => source.path)).toEqual([
      "I:/input/second.png",
      "I:/managed/third.png",
    ]);
    expect(state.workspaces.find((item) => item.id === "workspace-a")?.sources.map((source) => source.path))
      .toEqual(["I:/input/second.png", "I:/managed/third.png"]);
  });

  it("does not let delayed history materialization replace another workspace canvas", async () => {
    const mediaRef = deferred<any>();
    hostMocks.registerImportedImageAsset.mockReturnValueOnce(mediaRef.promise);
    const item = {
      id: "history-a",
      prompt: "history prompt",
      mode: "generate" as const,
      size: "1024x1024" as const,
      quality: "medium" as const,
      createdAt: 10,
      savedPath: "I:/output/history-a.png",
      previewUrl: "/media/preview/history-a",
      previewOnly: true,
    };
    useStudioStore.setState({ history: [item] });

    const selecting = useStudioStore.getState().selectHistoryGalleryResult(item);
    await vi.waitFor(() => expect(hostMocks.registerImportedImageAsset).toHaveBeenCalledTimes(1));
    useStudioStore.getState().switchWorkspace("workspace-b");
    expect(useStudioStore.getState().currentImage).toBeNull();

    mediaRef.resolve({
      imageId: "media-history-a",
      savedPath: item.savedPath,
      previewUrl: item.previewUrl,
      fullUrl: "/media/full/media-history-a",
    });
    await selecting;

    expect(useStudioStore.getState().activeWorkspaceId).toBe("workspace-b");
    expect(useStudioStore.getState().currentImage).toBeNull();
    expect(useStudioStore.getState().workspaces.find((workspace) => workspace.id === "workspace-a")?.currentImageId)
      .toBe("history-a");
  });

  it("does not let delayed profile credentials overwrite the newly active workspace", async () => {
    const profileB = { ...profile, id: "profile-b", name: "Profile B", createdAt: 2 };
    const first = workspace("workspace-a", "prompt-a");
    const second = {
      ...workspace("workspace-b", "prompt-b"),
      activeProfileId: profileB.id,
    };
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      activeProfileId: profile.id,
      profiles: [profile, profileB],
      apiKey: "key-a-before-switch",
    });
    const keyB = deferred<string>();
    const keyA = deferred<string>();
    hostMocks.getStoredAPIKey
      .mockReturnValueOnce(keyB.promise)
      .mockReturnValueOnce(keyA.promise);

    useStudioStore.getState().switchWorkspace("workspace-b");
    await vi.waitFor(() => expect(hostMocks.getStoredAPIKey).toHaveBeenCalledTimes(1));
    useStudioStore.getState().switchWorkspace("workspace-a");
    await vi.waitFor(() => expect(hostMocks.getStoredAPIKey).toHaveBeenCalledTimes(2));

    keyB.resolve("key-b-late");
    await Promise.resolve();
    expect(useStudioStore.getState().activeWorkspaceId).toBe("workspace-a");
    expect(useStudioStore.getState().apiKey).not.toBe("key-b-late");

    keyA.resolve("key-a-restored");
    await vi.waitFor(() => expect(useStudioStore.getState().apiKey).toBe("key-a-restored"));
    expect(useStudioStore.getState().workspaces.find((item) => item.id === "workspace-b")?.activeProfileId)
      .toBe("profile-b");
  });
});
