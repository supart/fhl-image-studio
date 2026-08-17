import type { BatchTaskRecord } from "../types/domain.ts";
import {
  isRetryableBatchTask,
  sortedBatchTasksForCurrentView,
  sortedBatchTasksForWorkspace,
} from "./batchTaskRecords.ts";
import { sourceContextPatchFromBatchTask } from "./sourceContextSelection.ts";
import { removeStreamPreview } from "./studioStore.streamPreview.ts";
import type { StudioState } from "./studioStore.types.ts";
import {
  activeRuntimePatch,
  patchWorkspaceRuntime,
  workspaceRuntimeFromState,
  type WorkspacePatch,
} from "./workspaceRuntime.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type TaskActionRuntime = {
  cancelJob: (jobId: string) => unknown;
  clearAutoRetryTimer: (taskId: string) => void;
  removeStartingTask: (taskId: string) => void;
  isStartingTask: (taskId: string) => boolean;
  startQueuedTask: (taskId: string) => Promise<boolean>;
  requestPoolPump: () => unknown;
  pumpQueue: (workspaceId: string, apiMode: BatchTaskRecord["apiMode"]) => unknown;
  shouldRetainPoolCapacityOnCancel: (state: StudioState, jobId: string) => boolean;
  syncEditAutoAspect: () => unknown;
};

export type TaskActions = Pick<StudioState,
  | "selectBatchTask"
  | "selectBatchTaskForCancel"
  | "cancelBatchTask"
  | "cancelQueuedBatchTasks"
  | "clearFailedBatchTasks"
  | "promoteBatchTask"
  | "cancelSelectedTask"
>;

function retryHistoryById(state: StudioState) {
  return new Map([...state.batchResults, ...state.history].map((item) => [item.id, item]));
}

export function taskRuntimePatchForWorkspace(
  workspaceId: string,
  taskIds: string[],
  tasksById: Record<string, BatchTaskRecord>,
): WorkspacePatch {
  const tasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, tasksById);
  const runningJobs = tasks
    .filter((task) => task.status === "running" || (task.status === "queued" && !!task.jobId))
    .map((task) => task.jobId)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return {
    batchTaskIds: taskIds,
    jobsTotal: tasks.length,
    jobsCompleted: tasks.filter((task) => (
      task.status === "succeeded"
      || task.status === "failed"
      || task.status === "cancelled"
      || task.status === "interrupted"
    )).length,
    jobsFailed: tasks.filter((task) => task.status === "failed" || task.status === "interrupted").length,
    runningJobs,
    resultGridOpen: tasks.length > 0 || runningJobs.length > 0,
  };
}

export function createTaskActions(store: StateAdapter, runtime: TaskActionRuntime): TaskActions {
  const actions: TaskActions = {
    selectBatchTask(taskId) {
      const trimmed = typeof taskId === "string" ? taskId.trim() : "";
      const selectedBatchTaskId = trimmed ? trimmed : null;
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      const task = selectedBatchTaskId ? state.batchTasksById[selectedBatchTaskId] : null;
      if (!task || task.workspaceId !== workspaceId || !(workspace?.batchTaskIds ?? []).includes(task.id)) {
        store.setState({
          selectedBatchTaskId,
          workspaces: patchWorkspaceRuntime(state.workspaces, workspaceId, { selectedBatchTaskId }),
        });
        return;
      }
      store.setState(sourceContextPatchFromBatchTask(state, task, selectedBatchTaskId));
      if (task.mode === "edit" && (task.sourceImagePaths?.length ?? 0) > 0) {
        void runtime.syncEditAutoAspect();
      }
    },

    selectBatchTaskForCancel(taskId) {
      store.getState().selectBatchTask(taskId);
    },

    async cancelBatchTask(taskId) {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const selectedId = typeof taskId === "string" ? taskId.trim() : "";
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      const taskIds = workspace?.batchTaskIds ?? [];
      const task = selectedId ? state.batchTasksById[selectedId] : null;
      if (!task || task.workspaceId !== workspaceId || !taskIds.includes(task.id)) {
        state.pushToast("No matching batch task was found", "warn", 2400);
        return;
      }
      const retryableTerminalTask = isRetryableBatchTask(task, retryHistoryById(state));
      if (task.status !== "queued" && task.status !== "running" && !retryableTerminalTask) {
        state.pushToast("This task is not queued, running, failed, or missing its final image", "warn", 2400);
        return;
      }

      runtime.clearAutoRetryTimer(task.id);
      const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";
      const current = store.getState();
      const currentTask = current.batchTasksById[task.id] ?? task;
      const currentRetryableTerminalTask = isRetryableBatchTask(currentTask, retryHistoryById(current));
      if (currentTask.status !== "queued" && currentTask.status !== "running" && !currentRetryableTerminalTask) {
        return;
      }
      const batchTasksById: Record<string, BatchTaskRecord> = {
        ...current.batchTasksById,
        [task.id]: {
          ...currentTask,
          status: "cancelled",
          queuedReason: undefined,
          queuePriority: undefined,
          updatedAt: Date.now(),
        },
      };
      const currentRuntime = workspaceRuntimeFromState(current, workspaceId);
      const prunedPreview = jobId ? removeStreamPreview(currentRuntime.streamPreviews, jobId) : {
        streamPreview: currentRuntime.streamPreview,
        streamPreviews: currentRuntime.streamPreviews,
      };
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
      const nextMeta = { ...current.runningJobMeta };
      if (jobId && !runtime.shouldRetainPoolCapacityOnCancel(current, jobId)) delete nextMeta[jobId];
      const cancelPatch: WorkspacePatch = {
        ...taskPatch,
        selectedBatchTaskId: null,
        progress: taskPatch.runningJobs?.length ? currentRuntime.progress : null,
        streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
        streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
        lastLogLine: taskPatch.runningJobs?.length ? currentRuntime.lastLogLine : "",
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      store.setState((nextState) => ({
        batchTasksById,
        selectedBatchTaskId: null,
        runningJobMeta: nextMeta,
        workspaces: patchWorkspaceRuntime(nextState.workspaces, workspaceId, cancelPatch),
        ...(nextState.activeWorkspaceId === workspaceId ? {
          ...activeRuntimePatch(cancelPatch),
          resultGridOpen: true,
          historyGalleryOpen: false,
        } : {}),
      } as Partial<StudioState>));
      if (jobId) {
        try { await runtime.cancelJob(jobId); } catch { /* best effort */ }
      }
      store.getState().pushToast(jobId
        ? "Cancelled running task; upstream work may already be billed"
        : "Cancelled queued task",
        "info",
        3600,
      );
      if (task.continuousPoolTask) {
        void runtime.requestPoolPump();
      } else {
        void runtime.pumpQueue(workspaceId, task.apiMode);
      }
    },

    async cancelQueuedBatchTasks() {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      const taskIds = workspace?.batchTaskIds ?? [];
      const queuedTasks = sortedBatchTasksForWorkspace(workspaceId, taskIds, state.batchTasksById)
        .filter((task) => task.status === "queued");
      if (queuedTasks.length === 0) {
        state.pushToast("No queued tasks in the current batch", "info", 2200);
        return;
      }

      const queuedTaskIds = new Set(queuedTasks.map((task) => task.id));
      const current = store.getState();
      const currentWorkspace = current.workspaces.find((entry) => entry.id === workspaceId);
      const currentTaskIds = currentWorkspace?.batchTaskIds ?? taskIds;
      const now = Date.now();
      let cancelledCount = 0;
      const cancelledJobIds = new Set<string>();
      const batchTasksById: Record<string, BatchTaskRecord> = { ...current.batchTasksById };
      for (const id of currentTaskIds) {
        const task = batchTasksById[id];
        if (!task || task.workspaceId !== workspaceId || !queuedTaskIds.has(task.id) || task.status !== "queued") continue;
        const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";
        if (jobId) cancelledJobIds.add(jobId);
        runtime.removeStartingTask(task.id);
        runtime.clearAutoRetryTimer(task.id);
        batchTasksById[task.id] = {
          ...task,
          status: "cancelled",
          queuedReason: undefined,
          queuePriority: undefined,
          updatedAt: now,
        };
        cancelledCount += 1;
      }
      if (cancelledCount === 0) {
        store.getState().pushToast("No cancellable queued tasks were found after refresh", "info", 2200);
        return;
      }

      const currentRuntime = workspaceRuntimeFromState(current, workspaceId);
      let prunedPreview = {
        streamPreview: currentRuntime.streamPreview,
        streamPreviews: currentRuntime.streamPreviews,
      };
      for (const jobId of cancelledJobIds) {
        prunedPreview = removeStreamPreview(prunedPreview.streamPreviews, jobId);
      }
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, currentTaskIds, batchTasksById);
      const nextMeta = { ...current.runningJobMeta };
      for (const jobId of cancelledJobIds) {
        if (!runtime.shouldRetainPoolCapacityOnCancel(current, jobId)) delete nextMeta[jobId];
      }
      const cancelPatch: WorkspacePatch = {
        ...taskPatch,
        selectedBatchTaskId: null,
        progress: taskPatch.runningJobs?.length ? currentRuntime.progress : null,
        streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
        streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
        lastLogLine: taskPatch.runningJobs?.length ? currentRuntime.lastLogLine : "",
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      store.setState((nextState) => ({
        batchTasksById,
        selectedBatchTaskId: null,
        runningJobMeta: nextMeta,
        workspaces: patchWorkspaceRuntime(nextState.workspaces, workspaceId, cancelPatch),
        ...(nextState.activeWorkspaceId === workspaceId ? {
          ...activeRuntimePatch(cancelPatch),
          resultGridOpen: true,
          historyGalleryOpen: false,
        } : {}),
      } as Partial<StudioState>));
      store.getState().pushToast(`已取消当前批次 ${cancelledCount} 个排队任务`, "info", 3200);
      for (const jobId of cancelledJobIds) {
        try { await runtime.cancelJob(jobId); } catch { /* best effort */ }
      }
      if (queuedTasks.some((task) => task.continuousPoolTask)) void runtime.requestPoolPump();
    },

    async clearFailedBatchTasks() {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      const taskIds = workspace?.batchTaskIds ?? [];
      const retryableTasks = sortedBatchTasksForCurrentView(workspaceId, taskIds, state.batchTasksById)
        .filter((task) => isRetryableBatchTask(task, retryHistoryById(state)));
      if (retryableTasks.length === 0) {
        state.pushToast("当前批次没有可清空的生成失败/终图缺失任务", "info", 2200);
        return;
      }

      const current = store.getState();
      const currentWorkspace = current.workspaces.find((entry) => entry.id === workspaceId);
      const currentTaskIds = currentWorkspace?.batchTaskIds ?? taskIds;
      const currentRetryHistoryById = retryHistoryById(current);
      const now = Date.now();
      const clearedTaskIds = new Set(retryableTasks.map((task) => task.id));
      const clearedJobIds = new Set<string>();
      let clearedCount = 0;
      const batchTasksById: Record<string, BatchTaskRecord> = { ...current.batchTasksById };
      for (const id of currentTaskIds) {
        const task = batchTasksById[id];
        if (!task || task.workspaceId !== workspaceId || !clearedTaskIds.has(task.id) || !isRetryableBatchTask(task, currentRetryHistoryById)) continue;
        runtime.clearAutoRetryTimer(task.id);
        const jobId = typeof task.jobId === "string" && task.jobId.trim() ? task.jobId.trim() : "";
        if (jobId) clearedJobIds.add(jobId);
        batchTasksById[task.id] = {
          ...task,
          status: "cancelled",
          queuedReason: undefined,
          queuePriority: undefined,
          groupId: undefined,
          jobId: undefined,
          autoRetryScheduledAt: undefined,
          autoRetryReason: undefined,
          autoRetryCount: 0,
          updatedAt: now,
        };
        clearedCount += 1;
      }
      if (clearedCount === 0) {
        store.getState().pushToast("刷新后没有剩余的生成失败/终图缺失任务", "info", 2200);
        return;
      }

      const currentRuntime = workspaceRuntimeFromState(current, workspaceId);
      let prunedPreview = {
        streamPreview: currentRuntime.streamPreview,
        streamPreviews: currentRuntime.streamPreviews,
      };
      for (const jobId of clearedJobIds) {
        prunedPreview = removeStreamPreview(prunedPreview.streamPreviews, jobId);
      }
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, currentTaskIds, batchTasksById);
      const nextMeta = { ...current.runningJobMeta };
      for (const jobId of clearedJobIds) delete nextMeta[jobId];
      const clearPatch: WorkspacePatch = {
        ...taskPatch,
        selectedBatchTaskId: null,
        progress: taskPatch.runningJobs?.length ? currentRuntime.progress : null,
        streamPreview: taskPatch.runningJobs?.length ? prunedPreview.streamPreview : null,
        streamPreviews: taskPatch.runningJobs?.length ? prunedPreview.streamPreviews : {},
        lastLogLine: taskPatch.runningJobs?.length ? currentRuntime.lastLogLine : "",
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      store.setState((nextState) => ({
        batchTasksById,
        selectedBatchTaskId: null,
        runningJobMeta: nextMeta,
        workspaces: patchWorkspaceRuntime(nextState.workspaces, workspaceId, clearPatch),
        ...(nextState.activeWorkspaceId === workspaceId ? {
          ...activeRuntimePatch(clearPatch),
          resultGridOpen: true,
          historyGalleryOpen: false,
        } : {}),
      } as Partial<StudioState>));
      store.getState().pushToast(`已清空 ${clearedCount} 个生成失败/终图缺失任务`, "info", 3200);
    },

    async promoteBatchTask(taskId) {
      const state = store.getState();
      const workspaceId = state.activeWorkspaceId;
      const selectedId = typeof taskId === "string" ? taskId.trim() : "";
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      const taskIds = workspace?.batchTaskIds ?? [];
      const task = selectedId ? state.batchTasksById[selectedId] : null;
      if (!task || task.workspaceId !== workspaceId || !taskIds.includes(task.id)) {
        state.pushToast("没有找到对应的排队任务", "warn", 2400);
        return;
      }
      if (task.status !== "queued" || task.jobId || task.queuedReason !== "local_concurrency") {
        state.pushToast("这个排队任务当前不能立即插队", "warn", 3000);
        return;
      }

      const current = store.getState();
      const currentTask = current.batchTasksById[task.id] ?? task;
      if (currentTask.status !== "queued" || currentTask.jobId || currentTask.queuedReason !== "local_concurrency") {
        current.pushToast("这个排队任务状态已经变化，请刷新后重试", "warn", 2600);
        return;
      }
      if (runtime.isStartingTask(currentTask.id)) {
        current.pushToast("这个排队任务已经在启动中", "info", 2400);
        return;
      }
      const batchTasksById: Record<string, BatchTaskRecord> = {
        ...current.batchTasksById,
        [currentTask.id]: {
          ...currentTask,
          updatedAt: Date.now(),
        },
      };
      const taskPatch = taskRuntimePatchForWorkspace(workspaceId, taskIds, batchTasksById);
      const promotePatch: WorkspacePatch = {
        ...taskPatch,
        resultGridOpen: true,
        historyGalleryOpen: false,
      };
      store.setState((nextState) => ({
        batchTasksById,
        workspaces: patchWorkspaceRuntime(nextState.workspaces, workspaceId, promotePatch),
        ...(nextState.activeWorkspaceId === workspaceId ? {
          ...activeRuntimePatch(promotePatch),
          resultGridOpen: true,
          historyGalleryOpen: false,
        } : {}),
      } as Partial<StudioState>));
      const started = await runtime.startQueuedTask(currentTask.id);
      if (started) {
        store.getState().pushToast("已立即插队，新增一个并发任务", "success", 2800);
        return;
      }
      store.getState().pushToast("排队任务暂时无法立即启动，请稍后再试", "warn", 3200);
    },

    async cancelSelectedTask() {
      const selectedId = store.getState().selectedBatchTaskId;
      if (!selectedId) {
        store.getState().pushToast("没有选中的批次任务可取消", "warn", 2400);
        return;
      }
      await store.getState().cancelBatchTask(selectedId);
    },
  };
  return actions;
}
