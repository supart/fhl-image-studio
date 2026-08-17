import type { Workspace } from "../types/domain.ts";
import type { StudioState } from "./studioStore.types.ts";
import { streamPreviewItemFromWorkspace } from "./studioStore.streamPreview.ts";
import { defaultBatchProcessConfig, historyItemsByIds } from "./workspaceRuntime.ts";
import { createDefaultWorkspace } from "./workspaceDefaults.ts";
import { activeProfileRuntimePatch } from "./studioStore.profiles.ts";
import { invalidateWorkspaceActions } from "./workspaceActionTokens.ts";
import { workspaceCanvasSelectionPatch } from "./workspaceCanvasRuntime.ts";

export type WorkspaceTabStatus = "idle" | "queued" | "running" | "prompting" | "failed";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type WorkspaceActionRuntime = {
  cancelJob: (jobId: string) => unknown;
  detachJobEvents: (jobId: string) => void;
  syncTaskSubscriptions: () => void;
  saveActiveSnapshot: (state: StudioState) => Workspace[];
};

function workspaceTasks(state: StudioState, workspaceId: string) {
  return Object.values(state.batchTasksById).filter((task) => task.workspaceId === workspaceId);
}

export function workspaceTabStatus(state: StudioState, workspaceId: string): WorkspaceTabStatus {
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  const tasks = workspaceTasks(state, workspaceId);
  const groups = state.jobGroupsByWorkspace[workspaceId] ?? [];
  if (
    (workspace?.runningJobIds.length ?? 0) > 0
    || tasks.some((task) => task.status === "running" || task.launchState === "submitting")
    || groups.some((group) => group.slots.some((slot) => slot.status === "running"))
  ) return "running";
  const prompt = state.workspacePromptOperations[workspaceId];
  if (prompt?.isOptimizingPrompt || prompt?.isReversingPrompt) return "prompting";
  if (
    tasks.some((task) => task.status === "queued")
    || groups.some((group) => group.slots.some((slot) => slot.status === "queued"))
  ) return "queued";
  if (workspace?.errorMessage || tasks.some((task) => task.status === "failed")) return "failed";
  return "idle";
}

export function workspaceHasActiveWork(state: StudioState, workspaceId: string): boolean {
  const status = workspaceTabStatus(state, workspaceId);
  return status === "running" || status === "queued" || status === "prompting";
}

export function workspaceSelectionPatch(
  state: StudioState,
  target: Workspace,
  workspaces: Workspace[],
): Partial<StudioState> {
  const persistedCurrent = target.currentImageId
    ? state.history.find((item) => item.id === target.currentImageId) ?? null
    : null;
  const currentImage = streamPreviewItemFromWorkspace(target, persistedCurrent) ?? persistedCurrent;
  const batchResults = historyItemsByIds(state.history, target.batchResultIds ?? []);
  const runningJobs = target.runningJobIds ?? [];
  const fhlTransportMode = target.fhlTransportMode ?? state.fhlTransportMode;
  const activeProfileId = target.activeProfileId ?? state.activeProfileId;
  const activeProfile = state.profiles.find((profile) => profile.id === activeProfileId);
  const profilePatch = activeProfile
    ? activeProfileRuntimePatch(activeProfile, fhlTransportMode)
    : {};
  const promptOperations = state.workspacePromptOperations[target.id];

  return {
    ...workspaceCanvasSelectionPatch(state, target.id),
    workspaces,
    activeWorkspaceId: target.id,
    activeProfileId,
    fhlTransportMode,
    ...profilePatch,
    apiKey: activeProfileId === state.activeProfileId ? state.apiKey : "",
    isOptimizingPrompt: promptOperations?.isOptimizingPrompt === true,
    isReversingPrompt: promptOperations?.isReversingPrompt === true,
    promptPrefix: target.promptPrefix ?? "",
    prompt: target.prompt,
    optimizationGuidance: target.optimizationGuidance,
    negativePrompt: target.negativePrompt,
    mode: target.mode,
    size: target.size,
    quality: target.quality,
    outputFormat: target.outputFormat ?? state.outputFormat,
    seed: target.seed,
    batchCount: target.batchCount,
    continuousGenerateTest: target.continuousGenerateTest === true,
    editSourceMode: target.editSourceMode ?? "manual",
    batchProcess: target.batchProcess ?? defaultBatchProcessConfig(),
    editAutoAspectUserLocked: target.editAutoAspectUserLocked === true,
    styleTag: target.styleTag ?? "",
    sources: target.sources,
    reversePromptImage: target.reversePromptImage ?? null,
    currentImage,
    batchResults,
    selectedBatchTaskId: target.selectedBatchTaskId ?? null,
    resultGridOpen: !!target.resultGridOpen,
    historyGalleryOpen: target.historyGalleryOpen === true,
    historyGallerySinglePreviewId: target.historyGallerySinglePreviewId ?? null,
    historyGallerySort: target.historyGallerySort ?? "newest",
    runningJobs,
    jobsTotal: target.jobsTotal ?? 0,
    jobsCompleted: target.jobsCompleted ?? 0,
    jobsFailed: target.jobsFailed ?? 0,
    progress: target.progress ?? null,
    streamPreview: target.streamPreview ?? null,
    streamPreviews: target.streamPreviews ?? {},
    lastLogLine: target.lastLogLine ?? "",
    errorMessage: target.errorMessage ?? null,
    errorRawPath: target.errorRawPath ?? null,
    isRunning: runningJobs.length > 0,
    lastPayload: target.lastPayload ?? null,
  };
}
export function createWorkspaceActions(store: StateAdapter, runtime: WorkspaceActionRuntime) {
  function performCloseWorkspace(id: string) {
    const state = store.getState();
    const closingWorkspace = state.workspaces.find((workspace) => workspace.id === id);
    if (!closingWorkspace) {
      store.setState({ workspaceCloseRequest: null });
      return;
    }
    invalidateWorkspaceActions(id);
    const now = Date.now();
    const batchTasksById = { ...state.batchTasksById };
    const closingJobIds = new Set(closingWorkspace.runningJobIds ?? []);
    for (const [taskId, task] of Object.entries(batchTasksById)) {
      if (task.workspaceId !== id) continue;
      if (task.status !== "queued" && task.status !== "running" && task.launchState !== "submitting") continue;
      if (task.jobId) closingJobIds.add(task.jobId);
      batchTasksById[taskId] = {
        ...task,
        status: "cancelled",
        launchState: undefined,
        queuedReason: undefined,
        queuePriority: undefined,
        updatedAt: now,
      };
    }
    for (const [jobId, meta] of Object.entries(state.runningJobMeta)) {
      if (meta.workspaceId === id) closingJobIds.add(jobId);
    }
    for (const group of state.jobGroupsByWorkspace[id] ?? []) {
      for (const slot of group.slots) {
        if (slot.status === "queued" || slot.status === "running") closingJobIds.add(slot.jobId);
      }
    }
    for (const jobId of closingJobIds) {
      try { void runtime.cancelJob(jobId); } catch {}
      runtime.detachJobEvents(jobId);
    }
    const runningJobMeta = { ...state.runningJobMeta };
    for (const [jobId, meta] of Object.entries(runningJobMeta)) {
      if (meta.workspaceId === id) delete runningJobMeta[jobId];
    }
    const jobGroupsByWorkspace = { ...state.jobGroupsByWorkspace };
    delete jobGroupsByWorkspace[id];
    const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
    const workspacePromptOperations = { ...state.workspacePromptOperations };
    delete workspacePromptOperations[id];
    if (state.activeWorkspaceId === id) {
      const nextActive = remaining[0];
      const selectionPatch = workspaceSelectionPatch(state, nextActive, remaining);
      const workspaceCanvasRuntime = { ...selectionPatch.workspaceCanvasRuntime };
      delete workspaceCanvasRuntime[id];
      store.setState({
        ...selectionPatch,
        workspaceCanvasRuntime,
        workspaceCloseRequest: null,
        batchTasksById,
        runningJobMeta,
        jobGroupsByWorkspace,
        workspacePromptOperations,
      });
      if (nextActive.activeProfileId && nextActive.activeProfileId !== state.activeProfileId) {
        void store.getState().setActiveProfile(nextActive.activeProfileId);
      }
    } else {
      const workspaceCanvasRuntime = { ...state.workspaceCanvasRuntime };
      delete workspaceCanvasRuntime[id];
      store.setState({
        workspaces: remaining,
        workspaceCanvasRuntime,
        workspaceCloseRequest: null,
        batchTasksById,
        runningJobMeta,
        jobGroupsByWorkspace,
        workspacePromptOperations,
      });
    }
    runtime.syncTaskSubscriptions();
  }

  return {
    newWorkspace(name?: string) {
      const state = store.getState();
      const persisted = runtime.saveActiveSnapshot(state);
      const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const workspace = createDefaultWorkspace(
        id,
        state.outputFormat,
        name ?? `图片 ${persisted.length + 1}`,
        {
          activeProfileId: state.activeProfileId,
          fhlTransportMode: state.fhlTransportMode,
        },
      );
      store.setState(workspaceSelectionPatch(state, workspace, [...persisted, workspace]));
    },

    switchWorkspace(id: string) {
      const state = store.getState();
      if (state.activeWorkspaceId === id) return;
      const persisted = runtime.saveActiveSnapshot(state);
      const target = persisted.find((workspace) => workspace.id === id);
      if (!target) return;
      store.setState(workspaceSelectionPatch(state, target, persisted));
      if (target.activeProfileId && target.activeProfileId !== state.activeProfileId) {
        void store.getState().setActiveProfile(target.activeProfileId);
      }
    },

    closeWorkspace(id: string) {
      const state = store.getState();
      if (state.workspaces.length <= 1) {
        state.pushToast("至少保留一个标签页", "warn");
        return;
      }
      const workspace = state.workspaces.find((entry) => entry.id === id);
      if (!workspace) return;
      if (workspaceHasActiveWork(state, id)) {
        store.setState({ workspaceCloseRequest: { workspaceId: id, workspaceName: workspace.name } });
        return;
      }
      performCloseWorkspace(id);
    },

    cancelWorkspaceClose() {
      store.setState({ workspaceCloseRequest: null });
    },

    confirmWorkspaceClose() {
      const request = store.getState().workspaceCloseRequest;
      if (!request) return;
      performCloseWorkspace(request.workspaceId);
    },

    renameWorkspace(id: string, name: string) {
      store.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => (
          workspace.id === id ? { ...workspace, name } : workspace
        )),
      }));
    },
  };
}
