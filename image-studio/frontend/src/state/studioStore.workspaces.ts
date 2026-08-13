import {
  Cancel as wailsCancel,
  EventsOff,
} from "../platform/runtime/host";
import type { HistoryItem, Workspace } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import { historyItemsByIds, saveActiveWorkspaceSnapshot } from "./studioStore.runtime";
import { streamPreviewItemFromWorkspace } from "./studioStore.streamPreview";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

export function createWorkspaceActions(store: StateAdapter) {
  return {
    newWorkspace(name?: string) {
      const state = store.getState();
      const persisted = saveActiveWorkspaceSnapshot(state);
      const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const newWorkspace: Workspace = {
        id,
        name: name ?? `图片 ${persisted.length + 1}`,
        promptPrefix: "",
        prompt: "",
        optimizationGuidance: "",
        negativePrompt: "",
        mode: "generate",
        size: "1024x1024",
        quality: "medium",
        outputFormat: state.outputFormat,
        seed: 0,
        batchCount: 1,
        continuousGenerateTest: true,
        styleTag: "",
        sources: [],
        currentImageId: null,
        batchResultIds: [],
        resultGridOpen: false,
        runningJobIds: [],
        jobsTotal: 0,
        jobsCompleted: 0,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        errorMessage: null,
        errorRawPath: null,
        apimartRecoveryTask: null,
        apimartRecoveryTasks: [],
        lastPayload: null,
      };
      store.setState({
        workspaces: [...persisted, newWorkspace],
        activeWorkspaceId: id,
        promptPrefix: newWorkspace.promptPrefix,
        prompt: newWorkspace.prompt,
        optimizationGuidance: newWorkspace.optimizationGuidance ?? "",
        negativePrompt: newWorkspace.negativePrompt,
        mode: newWorkspace.mode,
        size: newWorkspace.size,
        quality: newWorkspace.quality,
        outputFormat: newWorkspace.outputFormat,
        seed: newWorkspace.seed,
        batchCount: newWorkspace.batchCount,
        continuousGenerateTest: newWorkspace.continuousGenerateTest ?? true,
        styleTag: newWorkspace.styleTag,
        sources: newWorkspace.sources,
        currentImage: null,
        batchResults: [],
        resultGridOpen: false,
        annotations: [],
        strokes: [],
        maskDataURL: null,
        runningJobs: [],
        jobsTotal: 0,
        jobsCompleted: 0,
        progress: null,
        streamPreview: null,
        streamPreviews: {},
        lastLogLine: "",
        errorMessage: null,
        errorRawPath: null,
        apimartRecoveryTask: null,
        apimartRecoveryTasks: [],
        isRunning: false,
        lastPayload: null,
      });
    },

    switchWorkspace(id: string) {
      const state = store.getState();
      if (state.activeWorkspaceId === id) return;
      const persisted = saveActiveWorkspaceSnapshot(state);
      const target = persisted.find((workspace) => workspace.id === id);
      if (!target) return;
      const persistedCurrent = target.currentImageId
        ? state.history.find((item) => item.id === target.currentImageId) ?? null
        : null;
      const newCurrent = streamPreviewItemFromWorkspace(target, persistedCurrent) ?? persistedCurrent;
      const batchResults = historyItemsByIds(state.history, target.batchResultIds ?? []);
      const runningJobs = target.runningJobIds ?? [];
      store.setState({
        workspaces: persisted,
        activeWorkspaceId: id,
        promptPrefix: target.promptPrefix ?? "",
        prompt: target.prompt,
        optimizationGuidance: target.optimizationGuidance ?? "",
        negativePrompt: target.negativePrompt,
        mode: target.mode,
        size: target.size,
        quality: target.quality,
        outputFormat: target.outputFormat ?? store.getState().outputFormat,
        seed: target.seed,
        batchCount: target.batchCount,
        continuousGenerateTest: target.continuousGenerateTest ?? true,
        styleTag: target.styleTag ?? "",
        sources: target.sources,
        currentImage: newCurrent,
        batchResults,
        resultGridOpen: !!target.resultGridOpen,
        annotations: [],
        strokes: [],
        maskDataURL: null,
        runningJobs,
        jobsTotal: target.jobsTotal ?? 0,
        jobsCompleted: target.jobsCompleted ?? 0,
        progress: target.progress ?? null,
        streamPreview: target.streamPreview ?? null,
        streamPreviews: target.streamPreviews ?? {},
        lastLogLine: target.lastLogLine ?? "",
        errorMessage: target.errorMessage ?? null,
        errorRawPath: target.errorRawPath ?? null,
        apimartRecoveryTask: target.apimartRecoveryTask ?? null,
        apimartRecoveryTasks: target.apimartRecoveryTasks ?? [],
        isRunning: runningJobs.length > 0,
        lastPayload: target.lastPayload ?? null,
      });
    },

    closeWorkspace(id: string) {
      const state = store.getState();
      if (state.workspaces.length <= 1) {
        state.pushToast("至少保留一个标签页", "warn");
        return;
      }
      const closingJobIds = state.workspaces.find((workspace) => workspace.id === id)?.runningJobIds ?? [];
      for (const jobId of closingJobIds) {
        try { void wailsCancel(jobId); } catch {}
        EventsOff(`progress:${jobId}`, `log:${jobId}`, `preview:${jobId}`, `result:${jobId}`, `error:${jobId}`);
      }
      const nextMeta = { ...state.runningJobMeta };
      for (const jobId of closingJobIds) delete nextMeta[jobId];
      const remaining = state.workspaces.filter((workspace) => workspace.id !== id);
      if (state.activeWorkspaceId === id) {
        const next = remaining[0];
        const persistedCurrent = next.currentImageId
          ? state.history.find((item) => item.id === next.currentImageId) ?? null
          : null;
        const newCurrent = streamPreviewItemFromWorkspace(next, persistedCurrent) ?? persistedCurrent;
        const batchResults = historyItemsByIds(state.history, next.batchResultIds ?? []);
        const runningJobs = next.runningJobIds ?? [];
        store.setState({
          workspaces: remaining,
          runningJobMeta: nextMeta,
          activeWorkspaceId: next.id,
          promptPrefix: next.promptPrefix ?? "",
          prompt: next.prompt,
          optimizationGuidance: next.optimizationGuidance ?? "",
          negativePrompt: next.negativePrompt,
          mode: next.mode,
          size: next.size,
          quality: next.quality,
          outputFormat: next.outputFormat ?? store.getState().outputFormat,
          seed: next.seed,
          batchCount: next.batchCount,
          continuousGenerateTest: next.continuousGenerateTest ?? true,
          styleTag: next.styleTag ?? "",
          sources: next.sources,
          currentImage: newCurrent,
          batchResults,
          resultGridOpen: !!next.resultGridOpen,
          annotations: [],
          strokes: [],
          maskDataURL: null,
          runningJobs,
          jobsTotal: next.jobsTotal ?? 0,
          jobsCompleted: next.jobsCompleted ?? 0,
          progress: next.progress ?? null,
          streamPreview: next.streamPreview ?? null,
          streamPreviews: next.streamPreviews ?? {},
          lastLogLine: next.lastLogLine ?? "",
          errorMessage: next.errorMessage ?? null,
          errorRawPath: next.errorRawPath ?? null,
          apimartRecoveryTask: next.apimartRecoveryTask ?? null,
          apimartRecoveryTasks: next.apimartRecoveryTasks ?? [],
          isRunning: runningJobs.length > 0,
          lastPayload: next.lastPayload ?? null,
        });
      } else {
        store.setState({ workspaces: remaining, runningJobMeta: nextMeta });
      }
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
