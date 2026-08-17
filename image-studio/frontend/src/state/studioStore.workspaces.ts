import type { Workspace } from "../types/domain.ts";
import type { StudioState } from "./studioStore.types.ts";
import { streamPreviewItemFromWorkspace } from "./studioStore.streamPreview.ts";
import { defaultBatchProcessConfig, historyItemsByIds } from "./workspaceRuntime.ts";
import { createDefaultWorkspace } from "./workspaceDefaults.ts";

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

  return {
    workspaces,
    activeWorkspaceId: target.id,
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
    currentImage,
    sourcePreviewReturnImage: null,
    batchResults,
    selectedBatchTaskId: target.selectedBatchTaskId ?? null,
    resultGridOpen: !!target.resultGridOpen,
    historyGalleryOpen: target.historyGalleryOpen === true,
    historyGallerySinglePreviewId: target.historyGallerySinglePreviewId ?? null,
    historyGallerySort: target.historyGallerySort ?? "newest",
    annotations: [],
    strokes: [],
    maskDataURL: null,
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
  return {
    newWorkspace(name?: string) {
      const state = store.getState();
      const persisted = runtime.saveActiveSnapshot(state);
      const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const workspace = createDefaultWorkspace(
        id,
        state.outputFormat,
        name ?? `图片 ${persisted.length + 1}`,
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
    },

    closeWorkspace(id: string) {
      const state = store.getState();
      if (state.workspaces.length <= 1) {
        state.pushToast("至少保留一个标签页", "warn");
        return;
      }
      const closingJobIds = state.workspaces.find((workspace) => workspace.id === id)?.runningJobIds ?? [];
      for (const jobId of closingJobIds) {
        try { void runtime.cancelJob(jobId); } catch {}
        runtime.detachJobEvents(jobId);
      }
      const nextMeta = { ...state.runningJobMeta };
      for (const jobId of closingJobIds) delete nextMeta[jobId];
      const jobGroupsByWorkspace = { ...state.jobGroupsByWorkspace };
      delete jobGroupsByWorkspace[id];
      const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
      if (state.activeWorkspaceId === id) {
        store.setState({
          ...workspaceSelectionPatch(state, remaining[0], remaining),
          runningJobMeta: nextMeta,
          jobGroupsByWorkspace,
        });
      } else {
        store.setState({ workspaces: remaining, runningJobMeta: nextMeta, jobGroupsByWorkspace });
      }
      runtime.syncTaskSubscriptions();
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
