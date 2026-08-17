import type { BatchTaskRecord } from "../types/domain.ts";
import { referencedBatchTasksForWorkspaces } from "./batchTaskRecords.ts";
import type { StudioState } from "./studioStore.types.ts";

export type ContinuousPoolState = Pick<StudioState,
  | "workspaces"
  | "batchTasksById"
  | "runningJobMeta"
  | "isResettingApplication"
>;

type ContinuousPoolControllerRuntime = {
  getState: () => ContinuousPoolState;
  runPumpPass: () => Promise<void>;
};

export type ContinuousPoolController = {
  readonly startingTaskIds: ReadonlySet<string>;
  queuedTasks: (state: ContinuousPoolState) => BatchTaskRecord[];
  inFlightByProfile: (state: ContinuousPoolState) => Record<string, number>;
  isTaskStarting: (taskId: string) => boolean;
  reserveTaskStart: (taskId: string) => boolean;
  releaseTaskStart: (taskId: string) => void;
  markTasksScheduled: (queue: readonly BatchTaskRecord[], taskIds: readonly string[]) => void;
  profileCursor: () => number;
  setProfileCursor: (cursor: number) => void;
  requestPump: () => Promise<void>;
  reset: () => void;
};

function compareTasks(a: BatchTaskRecord, b: BatchTaskRecord) {
  return a.createdAt - b.createdAt
    || a.slotIndex - b.slotIndex
    || a.id.localeCompare(b.id);
}

function fairWorkspaceQueue(tasks: readonly BatchTaskRecord[], nextWorkspaceId: string | null) {
  const tasksByWorkspace = new Map<string, BatchTaskRecord[]>();
  for (const task of tasks) {
    const workspaceTasks = tasksByWorkspace.get(task.workspaceId) ?? [];
    workspaceTasks.push(task);
    tasksByWorkspace.set(task.workspaceId, workspaceTasks);
  }
  const workspaceQueues = [...tasksByWorkspace.entries()]
    .map(([workspaceId, workspaceTasks]) => ({
      workspaceId,
      tasks: workspaceTasks.sort(compareTasks),
    }))
    .sort((a, b) => compareTasks(a.tasks[0], b.tasks[0]) || a.workspaceId.localeCompare(b.workspaceId));
  if (workspaceQueues.length === 0) return [];

  const requestedStart = nextWorkspaceId
    ? workspaceQueues.findIndex((entry) => entry.workspaceId === nextWorkspaceId)
    : -1;
  const start = requestedStart >= 0 ? requestedStart : 0;
  const rotated = [
    ...workspaceQueues.slice(start),
    ...workspaceQueues.slice(0, start),
  ];
  const ordered: BatchTaskRecord[] = [];
  for (let depth = 0; ordered.length < tasks.length; depth += 1) {
    for (const workspace of rotated) {
      const task = workspace.tasks[depth];
      if (task) ordered.push(task);
    }
  }
  return ordered;
}

export function createContinuousPoolController(
  runtime: ContinuousPoolControllerRuntime,
): ContinuousPoolController {
  const startingTaskIds = new Set<string>();
  let nextWorkspaceId: string | null = null;
  let roundRobinProfileCursor = 0;
  let pumpPromise: Promise<void> | null = null;
  let pumpRequested = false;
  let generation = 0;

  const queuedTasks = (state: ContinuousPoolState) => fairWorkspaceQueue(
    referencedBatchTasksForWorkspaces(state.workspaces, state.batchTasksById)
      .filter((task) => (
        task.continuousPoolTask === true
        && task.status === "queued"
        && !task.jobId
        && task.launchState !== "submitting"
        && !startingTaskIds.has(task.id)
      )),
    nextWorkspaceId,
  );

  const inFlightByProfile = (state: ContinuousPoolState) => {
    const counts: Record<string, number> = {};
    const taskJobIds = new Set<string>();
    for (const task of referencedBatchTasksForWorkspaces(state.workspaces, state.batchTasksById)) {
      const profileId = String(task.apiProfileId || "").trim();
      if (!profileId) continue;
      const inFlight = task.launchState === "submitting"
        || startingTaskIds.has(task.id)
        || task.status === "running"
        || (task.status === "queued" && !!task.jobId);
      if (!inFlight) continue;
      counts[profileId] = (counts[profileId] ?? 0) + 1;
      if (task.jobId) taskJobIds.add(task.jobId);
    }
    // Cancelled native tasks retain metadata until settled, so their slot is
    // not reused while the backend may still be consuming it.
    for (const [jobId, meta] of Object.entries(state.runningJobMeta)) {
      const profileId = String(meta.apiProfileId || "").trim();
      if (!profileId || taskJobIds.has(jobId)) continue;
      counts[profileId] = (counts[profileId] ?? 0) + 1;
    }
    return counts;
  };

  const controller: ContinuousPoolController = {
    startingTaskIds,
    queuedTasks,
    inFlightByProfile,
    isTaskStarting: (taskId) => startingTaskIds.has(taskId),
    reserveTaskStart(taskId) {
      if (startingTaskIds.has(taskId)) return false;
      startingTaskIds.add(taskId);
      return true;
    },
    releaseTaskStart(taskId) {
      startingTaskIds.delete(taskId);
    },
    markTasksScheduled(queue, taskIds) {
      const scheduledIds = new Set(taskIds);
      const scheduled = queue.filter((task) => scheduledIds.has(task.id));
      const lastWorkspaceId = scheduled.at(-1)?.workspaceId;
      if (!lastWorkspaceId) return;
      const workspaceOrder = [...new Set(queue.map((task) => task.workspaceId))];
      const lastIndex = workspaceOrder.indexOf(lastWorkspaceId);
      nextWorkspaceId = lastIndex >= 0
        ? workspaceOrder[(lastIndex + 1) % workspaceOrder.length]
        : null;
    },
    profileCursor: () => roundRobinProfileCursor,
    setProfileCursor(cursor) {
      const normalized = Number(cursor);
      roundRobinProfileCursor = Number.isFinite(normalized) ? Math.max(0, Math.floor(normalized)) : 0;
    },
    requestPump() {
      if (runtime.getState().isResettingApplication) return Promise.resolve();
      pumpRequested = true;
      if (!pumpPromise) {
        const activeGeneration = generation;
        const activePromise = (async () => {
          while (activeGeneration === generation && pumpRequested) {
            pumpRequested = false;
            await runtime.runPumpPass();
          }
        })();
        pumpPromise = activePromise;
        void activePromise.then(
          () => { if (pumpPromise === activePromise) pumpPromise = null; },
          () => { if (pumpPromise === activePromise) pumpPromise = null; },
        );
      }
      return pumpPromise;
    },
    reset() {
      generation += 1;
      startingTaskIds.clear();
      nextWorkspaceId = null;
      roundRobinProfileCursor = 0;
      pumpRequested = false;
      pumpPromise = null;
    },
  };
  return controller;
}
