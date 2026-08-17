import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadHistoryPage: vi.fn(),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/storage")>(),
  loadHistoryPage: mocks.loadHistoryPage,
}));

import { MATERIAL_LIBRARY_KEY } from "../src/state/materialLibrary.ts";
import { activeWorkspaceEditAutoAspectUserLocked } from "../src/state/sharedEditAutoAspect.ts";
import { useStudioStore } from "../src/state/studioStore.ts";
import { loadWorkspaceSession, persistWorkspaceSession } from "../src/state/studioStore.shared.ts";
import { createWorkspaceActions, workspaceSelectionPatch } from "../src/state/studioStore.workspaces.ts";
import { createApplicationResetPatch } from "../src/state/applicationStateReset.ts";
import { mapWorkspaceCanvasHistoryItems } from "../src/state/workspaceCanvasRuntime.ts";
import { createDefaultWorkspace, WORKSPACE_DEFAULT_FIELD_KEYS } from "../src/state/workspaceDefaults.ts";
import { storageKey } from "../src/lib/storageNamespace.ts";
import type { HistoryItem } from "../src/types/domain.ts";

function historyItem(id: string, createdAt: number): HistoryItem {
  return {
    id,
    prompt: id,
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    createdAt,
  };
}

describe("workspace, material, and history domain modules", () => {
  beforeEach(() => {
    mocks.loadHistoryPage.mockReset();
    localStorage.removeItem(MATERIAL_LIBRARY_KEY);
    useStudioStore.setState({
      history: [],
      historyHasMore: false,
      historyLoading: false,
      historyCursor: null,
      historyGalleryOpen: false,
      historyGallerySort: "newest",
      materialGroups: [],
      isResettingApplication: false,
      batchTasksById: {},
      workspaceCanvasRuntime: {},
      workspaceCloseRequest: null,
      canvasView: null,
    });
  });

  it("keeps the explicit workspace field manifest aligned with defaults", () => {
    expect(Object.keys(createDefaultWorkspace("workspace-fields")).sort())
      .toEqual([...WORKSPACE_DEFAULT_FIELD_KEYS].sort());
  });

  it("restores the profile, transport, and reverse prompt image for the selected workspace", () => {
    const first = createDefaultWorkspace("workspace-1", "png", "Workspace 1", {
      activeProfileId: "profile-images",
      fhlTransportMode: "images",
    });
    const second = {
      ...createDefaultWorkspace("workspace-2", "webp", "Workspace 2", {
        activeProfileId: "profile-responses",
        fhlTransportMode: "responses",
      }),
      reversePromptImage: {
        path: "I:/input/reverse.png",
        name: "reverse.png",
        size: 42,
      },
    };
    const state = {
      ...useStudioStore.getState(),
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      activeProfileId: first.activeProfileId,
      fhlTransportMode: first.fhlTransportMode,
      apiKey: "key-stays-only-with-current-profile",
      profiles: [
        {
          id: "profile-images", name: "Images", apiMode: "images" as const,
          requestPolicy: "openai" as const, baseURL: "https://images.example.test",
          textModelID: "", imageModelID: "image-a", concurrencyLimit: 1, createdAt: 1,
        },
        {
          id: "profile-responses", name: "Responses", apiMode: "responses" as const,
          requestPolicy: "openai" as const, baseURL: "https://responses.example.test",
          textModelID: "text-b", imageModelID: "image-b", concurrencyLimit: 1, createdAt: 2,
        },
      ],
    };

    const patch = workspaceSelectionPatch(state, second, state.workspaces);

    expect(patch.activeProfileId).toBe("profile-responses");
    expect(patch.fhlTransportMode).toBe("responses");
    expect(patch.apiMode).toBe("responses");
    expect(patch.textModelID).toBe("text-b");
    expect(patch.reversePromptImage).toEqual(second.reversePromptImage);
    expect(patch.apiKey).toBe("");
  });

  it("creates a blank workspace that inherits only the active profile selection", () => {
    const first = createDefaultWorkspace("workspace-1", "webp", "Workspace 1", {
      activeProfileId: "profile-current",
      fhlTransportMode: "responses",
    });
    useStudioStore.setState({
      workspaces: [first],
      activeWorkspaceId: first.id,
      activeProfileId: "profile-current",
      fhlTransportMode: "responses",
      outputFormat: "webp",
      prompt: "must not be copied",
      sources: [{ path: "I:/input/a.png", name: "a.png", size: 1 }],
    });

    useStudioStore.getState().newWorkspace("Fresh");
    const created = useStudioStore.getState().workspaces.at(-1)!;

    expect(created.activeProfileId).toBe("profile-current");
    expect(created.fhlTransportMode).toBe("responses");
    expect(created.prompt).toBe("");
    expect(created.sources).toEqual([]);
    expect(created.reversePromptImage).toBeNull();
    expect(created.batchTaskIds).toEqual([]);
  });

  it("migrates v1 workspace sessions to v2 defaults without persisting image payloads", () => {
    const key = storageKey("gptcodex.workspaceSession.v1");
    const legacy = createDefaultWorkspace("legacy-workspace", "png");
    const legacyRecord = { ...legacy } as Record<string, unknown>;
    delete legacyRecord.activeProfileId;
    delete legacyRecord.fhlTransportMode;
    delete legacyRecord.reversePromptImage;
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      activeWorkspaceId: legacy.id,
      workspaces: [legacyRecord],
      batchTasksById: {},
    }));

    const restored = loadWorkspaceSession("png", {
      activeProfileId: "profile-fallback",
      fhlTransportMode: "responses",
    });
    expect(restored?.workspaces[0].activeProfileId).toBe("profile-fallback");
    expect(restored?.workspaces[0].fhlTransportMode).toBe("responses");
    expect(restored?.workspaces[0].reversePromptImage).toBeNull();

    const workspace = {
      ...restored!.workspaces[0],
      reversePromptImage: {
        path: "I:/input/reverse.png",
        name: "reverse.png",
        size: 10,
        imageB64: "must-not-persist",
        imageBlob: new Blob(["must-not-persist"]),
      },
    };
    persistWorkspaceSession(workspace.id, [workspace], {});
    const persisted = JSON.parse(localStorage.getItem(key) ?? "{}");
    expect(persisted.version).toBe(2);
    expect(persisted.workspaces[0].reversePromptImage).toEqual({
      path: "I:/input/reverse.png",
      name: "reverse.png",
      size: 10,
      imageBlob: null,
    });
    expect(JSON.stringify(persisted)).not.toContain("must-not-persist");
  });

  it("switches workspaces through the compatibility store entry", () => {
    const first = createDefaultWorkspace("workspace-1", "png", "Workspace 1");
    const second = {
      ...createDefaultWorkspace("workspace-2", "webp", "Workspace 2"),
      prompt: "second prompt",
      batchResultIds: ["history-2"],
      currentImageId: "history-2",
      runningJobIds: ["job-2"],
      jobsTotal: 2,
      jobsCompleted: 1,
    };
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      prompt: "first draft",
      outputFormat: "png",
      history: [historyItem("history-2", 2)],
      editAutoAspectUserLocked: true,
    });

    useStudioStore.getState().switchWorkspace(second.id);

    const state = useStudioStore.getState();
    expect(state.activeWorkspaceId).toBe(second.id);
    expect(state.prompt).toBe("second prompt");
    expect(state.currentImage?.id).toBe("history-2");
    expect(state.batchResults.map((item) => item.id)).toEqual(["history-2"]);
    expect(state.runningJobs).toEqual(["job-2"]);
    expect(state.isRunning).toBe(true);
    expect(state.editAutoAspectUserLocked).toBe(false);
    expect(state.workspaces.find((workspace) => workspace.id === first.id)?.prompt).toBe("first draft");
  });

  it("keeps the active auto-aspect lock mirror aligned with its workspace", () => {
    const first = {
      ...createDefaultWorkspace("workspace-1", "png", "Workspace 1"),
      mode: "edit" as const,
      editSourceMode: "manual" as const,
      batchProcess: {
        ...createDefaultWorkspace("workspace-defaults", "png").batchProcess,
        autoAspectResolution: "1k" as const,
      },
    };
    const second = createDefaultWorkspace("workspace-2", "png", "Workspace 2");
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      mode: first.mode,
      editSourceMode: first.editSourceMode,
      batchProcess: first.batchProcess,
      editAutoAspectUserLocked: false,
    });

    useStudioStore.getState().setField("size", "1536x1024");

    expect(useStudioStore.getState().editAutoAspectUserLocked).toBe(true);
    expect(useStudioStore.getState().workspaces[0].editAutoAspectUserLocked).toBe(true);

    useStudioStore.setState({ editAutoAspectUserLocked: false });
    expect(activeWorkspaceEditAutoAspectUserLocked(useStudioStore.getState())).toBe(true);

    useStudioStore.getState().switchWorkspace(second.id);
    expect(useStudioStore.getState().editAutoAspectUserLocked).toBe(false);

    useStudioStore.getState().switchWorkspace(first.id);
    expect(useStudioStore.getState().editAutoAspectUserLocked).toBe(true);
  });

  it("restores independent runtime canvas state when switching workspaces", () => {
    const first = createDefaultWorkspace("workspace-1", "png", "Workspace 1");
    const second = createDefaultWorkspace("workspace-2", "png", "Workspace 2");
    const compareA = historyItem("compare-a", 1);
    const compareB = historyItem("compare-b", 2);
    const strokeA = { points: [1, 2], size: 4 };
    const strokeB = { points: [5, 6], size: 2 };
    const undoA = { label: "a", undo: () => ({ strokes: [] }), redo: () => ({ strokes: [strokeA] }) };
    const undoB = { label: "b", undo: () => ({ strokes: [] }), redo: () => ({ strokes: [strokeB] }) };
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      workspaceCanvasRuntime: {},
      tool: "mask",
      brushSize: 42,
      maskDataURL: "mask-a",
      strokes: [strokeA],
      annotations: [{ id: "annotation-a", kind: "rect", x: 1, y: 2, w: 3, h: 4, color: "#f00" }],
      compareB: compareA,
      compareMode: "sideBySide",
      compareSplit: 0.3,
      canvasView: { scale: 1.5, x: 10, y: 20 },
      viewZoom: 1.5,
      undoStack: [undoA],
      redoStack: [],
    });

    useStudioStore.getState().switchWorkspace(second.id);
    expect(useStudioStore.getState()).toMatchObject({
      tool: "pan",
      maskDataURL: null,
      annotations: [],
      compareB: null,
      canvasView: null,
      undoStack: [],
    });
    useStudioStore.setState({
      tool: "annotate",
      brushSize: 18,
      maskDataURL: "mask-b",
      strokes: [strokeB],
      annotations: [{ id: "annotation-b", kind: "arrow", x: 5, y: 6, w: 7, h: 8, color: "#0f0" }],
      compareB,
      compareMode: "curtain",
      compareSplit: 0.7,
      canvasView: { scale: 0.75, x: -4, y: 8 },
      viewZoom: 0.75,
      undoStack: [undoB],
      redoStack: [undoA],
    });

    useStudioStore.getState().switchWorkspace(first.id);
    expect(useStudioStore.getState()).toMatchObject({
      tool: "mask",
      brushSize: 42,
      maskDataURL: "mask-a",
      compareB: compareA,
      compareMode: "sideBySide",
      compareSplit: 0.3,
      canvasView: { scale: 1.5, x: 10, y: 20 },
      viewZoom: 1.5,
      undoStack: [undoA],
      redoStack: [],
    });
    expect(useStudioStore.getState().annotations.map((item) => item.id)).toEqual(["annotation-a"]);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().strokes).toEqual([]);

    useStudioStore.getState().switchWorkspace(second.id);
    expect(useStudioStore.getState()).toMatchObject({
      tool: "annotate",
      brushSize: 18,
      maskDataURL: "mask-b",
      compareB,
      canvasView: { scale: 0.75, x: -4, y: 8 },
      undoStack: [undoB],
      redoStack: [undoA],
    });
    expect(useStudioStore.getState().annotations.map((item) => item.id)).toEqual(["annotation-b"]);
    expect(useStudioStore.getState().strokes).toEqual([strokeB]);

    useStudioStore.getState().switchWorkspace(first.id);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().strokes).toEqual([strokeA]);

    const refreshedCompareA = { ...compareA, previewUrl: "/media/compare-a.avif" };
    const mappedRuntime = mapWorkspaceCanvasHistoryItems(
      useStudioStore.getState().workspaceCanvasRuntime,
      (item) => item?.id === compareA.id ? refreshedCompareA : item,
    );
    expect(mappedRuntime[first.id].compareB).toEqual(refreshedCompareA);
    expect(mappedRuntime[second.id].compareB).toEqual(compareB);

    const resetPatch = createApplicationResetPatch(first);
    expect(resetPatch.workspaceCanvasRuntime).toEqual({});
    expect(resetPatch.canvasView).toBeNull();
  });

  it("requires confirmation and cancels only the target workspace when it closes", () => {
    const first = {
      ...createDefaultWorkspace("workspace-1", "png", "Workspace 1"),
      runningJobIds: ["job-1"],
    };
    const second = {
      ...createDefaultWorkspace("workspace-2", "png", "Workspace 2"),
      runningJobIds: ["job-2"],
    };
    let state = {
      ...useStudioStore.getState(),
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      workspaceCanvasRuntime: {
        [first.id]: { ...useStudioStore.getState().workspaceCanvasRuntime[first.id] },
        [second.id]: { ...useStudioStore.getState().workspaceCanvasRuntime[second.id] },
      },
      runningJobMeta: {
        "job-1": { workspaceId: first.id },
        "job-2": { workspaceId: second.id },
      },
      jobGroupsByWorkspace: { [first.id]: [], [second.id]: [] },
    };
    const cancelJob = vi.fn();
    const detachJobEvents = vi.fn();
    const syncTaskSubscriptions = vi.fn();
    const actions = createWorkspaceActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    }, {
      cancelJob,
      detachJobEvents,
      syncTaskSubscriptions,
      saveActiveSnapshot: (current) => current.workspaces,
    });

    actions.closeWorkspace(first.id);

    expect(state.workspaceCloseRequest).toEqual({ workspaceId: first.id, workspaceName: first.name });
    expect(cancelJob).not.toHaveBeenCalled();
    expect(state.workspaces).toHaveLength(2);

    actions.cancelWorkspaceClose();
    expect(state.workspaceCloseRequest).toBeNull();
    expect(state.workspaces).toHaveLength(2);

    actions.closeWorkspace(first.id);
    actions.confirmWorkspaceClose();

    expect(cancelJob).toHaveBeenCalledWith("job-1");
    expect(cancelJob).not.toHaveBeenCalledWith("job-2");
    expect(detachJobEvents).toHaveBeenCalledExactlyOnceWith("job-1");
    expect(syncTaskSubscriptions).toHaveBeenCalledTimes(1);
    expect(state.workspaces.map((workspace) => workspace.id)).toEqual([second.id]);
    expect(state.runningJobMeta).toEqual({ "job-2": { workspaceId: second.id } });
    expect(state.jobGroupsByWorkspace).toEqual({ [second.id]: [] });
    expect(state.workspaceCanvasRuntime[first.id]).toBeUndefined();
  });

  it("closes an inactive prompting workspace without changing the active workspace", () => {
    const first = createDefaultWorkspace("workspace-1", "png", "Workspace 1");
    const second = createDefaultWorkspace("workspace-2", "png", "Workspace 2");
    useStudioStore.setState({
      workspaces: [first, second],
      activeWorkspaceId: second.id,
      prompt: second.prompt,
      workspaceCanvasRuntime: {},
      workspacePromptOperations: {
        [first.id]: { isOptimizingPrompt: true, isReversingPrompt: false },
      },
      workspaceCloseRequest: null,
    });

    useStudioStore.getState().closeWorkspace(first.id);
    expect(useStudioStore.getState().workspaceCloseRequest?.workspaceId).toBe(first.id);
    useStudioStore.getState().confirmWorkspaceClose();

    expect(useStudioStore.getState().activeWorkspaceId).toBe(second.id);
    expect(useStudioStore.getState().workspaces.map((workspace) => workspace.id)).toEqual([second.id]);
    expect(useStudioStore.getState().workspacePromptOperations[first.id]).toBeUndefined();
  });

  it("persists material group mutations and deduplicates history refs", () => {
    useStudioStore.setState({ history: [historyItem("history-1", 1)] });

    const groupId = useStudioStore.getState().createMaterialGroup("folder", "Collection");
    useStudioStore.getState().moveHistoryItemsToMaterialGroup(groupId, ["history-1", "history-1", "missing"]);
    useStudioStore.getState().renameMaterialGroup(groupId, "Renamed");

    let group = useStudioStore.getState().materialGroups.find((item) => item.id === groupId);
    expect(group?.name).toBe("Renamed");
    expect(group?.items).toEqual([{ kind: "history", historyId: "history-1" }]);
    expect(JSON.parse(localStorage.getItem(MATERIAL_LIBRARY_KEY) ?? "[]")[0].name).toBe("Renamed");

    useStudioStore.getState().removeMaterialItem(groupId, { kind: "history", historyId: "history-1" });
    group = useStudioStore.getState().materialGroups.find((item) => item.id === groupId);
    expect(group?.items).toEqual([]);

    useStudioStore.getState().deleteMaterialGroup(groupId);
    expect(useStudioStore.getState().materialGroups).toEqual([]);
    expect(JSON.parse(localStorage.getItem(MATERIAL_LIBRARY_KEY) ?? "[]")).toEqual([]);
  });

  it("merges a delayed history page into live history without dropping a new result", async () => {
    let resolvePage!: (value: {
      items: HistoryItem[];
      nextCursor: null;
    }) => void;
    mocks.loadHistoryPage.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePage = resolve;
    }));
    const existing = historyItem("existing", 10);
    const generatedWhileLoading = historyItem("generated", 30);
    const paged = historyItem("paged", 5);
    useStudioStore.setState({
      history: [existing],
      historyHasMore: true,
      historyLoading: false,
      historyCursor: null,
      historyGalleryOpen: false,
      historyGallerySort: "newest",
    });

    const loading = useStudioStore.getState().loadMoreHistory();
    useStudioStore.setState({ history: [generatedWhileLoading, existing] });
    resolvePage({ items: [paged], nextCursor: null });
    await loading;

    expect(useStudioStore.getState().history.map((item) => item.id)).toEqual([
      "generated",
      "existing",
      "paged",
    ]);
    expect(useStudioStore.getState().historyLoading).toBe(false);
    expect(useStudioStore.getState().historyHasMore).toBe(false);
  });
});
