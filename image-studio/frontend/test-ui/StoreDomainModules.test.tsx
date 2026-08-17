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
import { createWorkspaceActions } from "../src/state/studioStore.workspaces.ts";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults.ts";
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
    });
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

  it("unbinds every native job event when a workspace closes", () => {
    const first = {
      ...createDefaultWorkspace("workspace-1", "png", "Workspace 1"),
      runningJobIds: ["job-1"],
    };
    const second = createDefaultWorkspace("workspace-2", "png", "Workspace 2");
    let state = {
      ...useStudioStore.getState(),
      workspaces: [first, second],
      activeWorkspaceId: first.id,
      runningJobMeta: { "job-1": { workspaceId: first.id } },
    };
    const cancelJob = vi.fn();
    const offEvents = vi.fn();
    const actions = createWorkspaceActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    }, {
      cancelJob,
      offEvents,
      saveActiveSnapshot: (current) => current.workspaces,
    });

    actions.closeWorkspace(first.id);

    expect(cancelJob).toHaveBeenCalledWith("job-1");
    expect(offEvents).toHaveBeenCalledWith(
      "progress:job-1",
      "log:job-1",
      "preview:job-1",
      "result:job-1",
      "error:job-1",
      "settled:job-1",
    );
    expect(state.workspaces.map((workspace) => workspace.id)).toEqual([second.id]);
    expect(state.runningJobMeta).toEqual({});
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
