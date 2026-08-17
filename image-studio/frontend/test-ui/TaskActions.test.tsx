import { describe, expect, it, vi } from "vitest";

import { useStudioStore } from "../src/state/studioStore.ts";
import { createTaskActions } from "../src/state/studioStore.tasks.ts";
import type { StudioState } from "../src/state/studioStore.types.ts";
import { createDefaultWorkspace } from "../src/state/workspaceDefaults.ts";
import type { BatchTaskRecord } from "../src/types/domain.ts";

function batchTask(
  id: string,
  status: BatchTaskRecord["status"] = "queued",
  overrides: Partial<BatchTaskRecord> = {},
): BatchTaskRecord {
  return {
    id,
    workspaceId: "workspace-1",
    slotIndex: 0,
    status,
    createdAt: 1,
    updatedAt: 1,
    mode: "generate",
    apiMode: "images",
    prompt: id,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    ...overrides,
  };
}

function createHarness(tasks: BatchTaskRecord[]) {
  const toasts: string[] = [];
  const taskMap = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const runningJobIds = tasks
    .filter((task) => task.status === "running" || (task.status === "queued" && !!task.jobId))
    .map((task) => task.jobId)
    .filter((jobId): jobId is string => !!jobId);
  const workspace = {
    ...createDefaultWorkspace("workspace-1", "png", "Workspace 1"),
    batchTaskIds: tasks.filter((task) => task.workspaceId === "workspace-1").map((task) => task.id),
    runningJobIds,
  };
  let state: StudioState = {
    ...useStudioStore.getState(),
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    batchTasksById: taskMap,
    selectedBatchTaskId: null,
    batchResults: [],
    history: [],
    runningJobs: runningJobIds,
    runningJobMeta: Object.fromEntries(runningJobIds.map((jobId) => [jobId, {
      workspaceId: workspace.id,
      apiMode: "images" as const,
    }])),
    streamPreview: null,
    streamPreviews: {},
    pushToast: (message) => { toasts.push(message); },
  };
  const store = {
    getState: () => state,
    setState: (patch: Partial<StudioState> | ((current: StudioState) => Partial<StudioState>)) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    },
  };
  const runtime: Parameters<typeof createTaskActions>[1] = {
    cancelJob: vi.fn(async () => undefined),
    clearAutoRetryTimer: vi.fn(),
    removeStartingTask: vi.fn(),
    isStartingTask: vi.fn(() => false),
    startQueuedTask: vi.fn(async () => true),
    requestPoolPump: vi.fn(),
    pumpQueue: vi.fn(),
    shouldRetainPoolCapacityOnCancel: vi.fn(() => false),
    syncEditAutoAspect: vi.fn(),
  };
  const actions = createTaskActions(store, runtime);
  state = { ...state, ...actions };
  return { actions, getState: store.getState, runtime, toasts };
}

describe("task action domain module", () => {
  it("restores edit sources for a valid selection and isolates an unknown selection", () => {
    const task = batchTask("edit-task", "succeeded", {
      mode: "edit",
      sourceImagePaths: ["C:\\images\\reference.png"],
      sourceImages: [{
        path: "C:\\images\\reference.png",
        name: "reference.png",
        size: 10,
      }],
      savedPath: "C:\\images\\result.png",
    });
    const harness = createHarness([task]);

    harness.actions.selectBatchTask(task.id);

    expect(harness.getState().selectedBatchTaskId).toBe(task.id);
    expect(harness.getState().mode).toBe("edit");
    expect(harness.getState().sources.map((source) => source.path)).toEqual(task.sourceImagePaths);
    expect(harness.runtime.syncEditAutoAspect).toHaveBeenCalledOnce();

    harness.actions.selectBatchTask("unknown-task");

    expect(harness.getState().selectedBatchTaskId).toBe("unknown-task");
    expect(harness.getState().workspaces[0].selectedBatchTaskId).toBe("unknown-task");
    expect(harness.runtime.syncEditAutoAspect).toHaveBeenCalledOnce();
  });

  it("records cancellation before calling the host and removes ordinary job metadata", async () => {
    const task = batchTask("running-task", "running", { jobId: "job-1" });
    const harness = createHarness([task]);
    vi.mocked(harness.runtime.cancelJob).mockImplementation(async (jobId) => {
      expect(jobId).toBe("job-1");
      expect(harness.getState().batchTasksById[task.id].status).toBe("cancelled");
    });

    await harness.actions.cancelBatchTask(task.id);

    expect(harness.getState().batchTasksById[task.id].status).toBe("cancelled");
    expect(harness.getState().runningJobMeta).not.toHaveProperty("job-1");
    expect(harness.runtime.clearAutoRetryTimer).toHaveBeenCalledWith(task.id);
    expect(harness.runtime.pumpQueue).toHaveBeenCalledWith("workspace-1", "images");
  });

  it("does not overwrite a task that becomes terminal during cancellation", async () => {
    const task = batchTask("racing-task", "queued");
    const harness = createHarness([task]);
    vi.mocked(harness.runtime.clearAutoRetryTimer).mockImplementation(() => {
      harness.getState().batchTasksById = {
        ...harness.getState().batchTasksById,
        [task.id]: {
          ...harness.getState().batchTasksById[task.id],
          status: "succeeded",
          savedPath: "C:\\images\\complete.png",
        },
      };
    });

    await harness.actions.cancelBatchTask(task.id);

    expect(harness.getState().batchTasksById[task.id].status).toBe("succeeded");
    expect(harness.runtime.cancelJob).not.toHaveBeenCalled();
    expect(harness.runtime.pumpQueue).not.toHaveBeenCalled();
  });

  it("retains continuous-pool capacity metadata when cancellation requires it", async () => {
    const task = batchTask("pool-task", "running", {
      jobId: "pool-job",
      continuousPoolTask: true,
    });
    const harness = createHarness([task]);
    vi.mocked(harness.runtime.shouldRetainPoolCapacityOnCancel).mockReturnValue(true);

    await harness.actions.cancelBatchTask(task.id);

    expect(harness.getState().runningJobMeta).toHaveProperty("pool-job");
    expect(harness.runtime.requestPoolPump).toHaveBeenCalledOnce();
    expect(harness.runtime.pumpQueue).not.toHaveBeenCalled();
  });

  it("bulk-cancels only queued tasks in the active workspace", async () => {
    const queued = batchTask("queued-task", "queued", {
      jobId: "queued-job",
      queuedReason: "local_concurrency",
      queuePriority: 3,
    });
    const running = batchTask("running-task", "running", { jobId: "running-job", slotIndex: 1 });
    const harness = createHarness([queued, running]);

    await harness.actions.cancelQueuedBatchTasks();

    expect(harness.getState().batchTasksById[queued.id]).toMatchObject({ status: "cancelled" });
    expect(harness.getState().batchTasksById[queued.id].queuedReason).toBeUndefined();
    expect(harness.getState().batchTasksById[running.id].status).toBe("running");
    expect(harness.runtime.removeStartingTask).toHaveBeenCalledWith(queued.id);
    expect(harness.runtime.clearAutoRetryTimer).toHaveBeenCalledTimes(1);
    expect(harness.runtime.cancelJob).toHaveBeenCalledWith("queued-job");
    expect(harness.runtime.cancelJob).not.toHaveBeenCalledWith("running-job");
  });

  it("clears failed, interrupted, and missing-result tasks without deleting records", async () => {
    const failed = batchTask("failed", "failed", {
      groupId: "group-failed",
      jobId: "job-failed",
      autoRetryScheduledAt: 10,
      autoRetryReason: "temporary",
      autoRetryCount: 2,
    });
    const interrupted = batchTask("interrupted", "interrupted", { slotIndex: 1 });
    const missingResult = batchTask("missing-result", "succeeded", { slotIndex: 2 });
    const completed = batchTask("completed", "succeeded", {
      slotIndex: 3,
      savedPath: "C:\\images\\complete.png",
    });
    const harness = createHarness([failed, interrupted, missingResult, completed]);

    await harness.actions.clearFailedBatchTasks();

    expect(Object.keys(harness.getState().batchTasksById)).toHaveLength(4);
    expect(harness.getState().batchTasksById[failed.id]).toMatchObject({
      status: "cancelled",
      autoRetryCount: 0,
    });
    expect(harness.getState().batchTasksById[failed.id].jobId).toBeUndefined();
    expect(harness.getState().batchTasksById[failed.id].groupId).toBeUndefined();
    expect(harness.getState().batchTasksById[interrupted.id].status).toBe("cancelled");
    expect(harness.getState().batchTasksById[missingResult.id].status).toBe("cancelled");
    expect(harness.getState().batchTasksById[completed.id].status).toBe("succeeded");
    expect(harness.runtime.clearAutoRetryTimer).toHaveBeenCalledTimes(3);
  });

  it("promotes only a local queued task that is not already starting", async () => {
    const promotable = batchTask("promotable", "queued", { queuedReason: "local_concurrency" });
    const blocked = batchTask("blocked", "queued", { slotIndex: 1, queuedReason: "continuous_pool" });
    const harness = createHarness([promotable, blocked]);

    await harness.actions.promoteBatchTask(blocked.id);
    expect(harness.runtime.startQueuedTask).not.toHaveBeenCalled();

    await harness.actions.promoteBatchTask(promotable.id);
    expect(harness.runtime.startQueuedTask).toHaveBeenCalledWith(promotable.id);

    vi.mocked(harness.runtime.isStartingTask).mockReturnValue(true);
    await harness.actions.promoteBatchTask(promotable.id);
    expect(harness.runtime.startQueuedTask).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected-task compatibility action as a store-level delegate", async () => {
    const task = batchTask("selected-task");
    const harness = createHarness([task]);
    const cancelBatchTask = vi.fn(async () => undefined);
    harness.getState().selectedBatchTaskId = task.id;
    harness.getState().cancelBatchTask = cancelBatchTask;

    await harness.actions.cancelSelectedTask();

    expect(cancelBatchTask).toHaveBeenCalledOnce();
    expect(cancelBatchTask).toHaveBeenCalledWith(task.id);
  });

  it("keeps the legacy cancel-selection entry as a store-level selection delegate", () => {
    const task = batchTask("select-for-cancel");
    const harness = createHarness([task]);
    const selectBatchTask = vi.fn();
    harness.getState().selectBatchTask = selectBatchTask;

    harness.actions.selectBatchTaskForCancel(task.id);

    expect(selectBatchTask).toHaveBeenCalledOnce();
    expect(selectBatchTask).toHaveBeenCalledWith(task.id);
  });
});
