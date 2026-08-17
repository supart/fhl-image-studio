import { expect, test, vi } from "vitest";

import { planContinuousPoolWave } from "../src/state/continuousPoolScheduler.ts";
import {
  createContinuousPoolController,
  type ContinuousPoolState,
} from "../src/state/studioStore.continuousPool.ts";
import type { BatchTaskRecord } from "../src/types/domain.ts";

function task(
  id: string,
  workspaceId: string,
  createdAt: number,
  overrides: Partial<BatchTaskRecord> = {},
): BatchTaskRecord {
  return {
    id,
    workspaceId,
    slotIndex: createdAt,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    mode: "generate",
    apiMode: "images",
    continuousPoolTask: true,
    prompt: id,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    ...overrides,
  };
}

function state(
  workspaceTasks: Record<string, BatchTaskRecord[]>,
  extras: Partial<ContinuousPoolState> = {},
): ContinuousPoolState {
  const workspaces = Object.entries(workspaceTasks).map(([id, tasks]) => ({
    id,
    batchTaskIds: tasks.map((entry) => entry.id),
  }));
  return {
    workspaces,
    batchTasksById: Object.fromEntries(Object.values(workspaceTasks).flat().map((entry) => [entry.id, entry])),
    runningJobMeta: {},
    isResettingApplication: false,
    ...extras,
  } as ContinuousPoolState;
}

function controllerFor(getState: () => ContinuousPoolState, runPumpPass = vi.fn(async () => undefined)) {
  return {
    controller: createContinuousPoolController({ getState, runPumpPass }),
    runPumpPass,
  };
}

test("excludes orphan tasks and active start reservations from candidates", () => {
  const live = task("live", "workspace-one", 2);
  const orphan = task("orphan", "workspace-one", 1);
  const snapshot = state({ "workspace-one": [live] }, {
    batchTasksById: { live, orphan },
  });
  const { controller } = controllerFor(() => snapshot);

  expect(controller.queuedTasks(snapshot).map((entry) => entry.id)).toEqual(["live"]);
  expect(controller.reserveTaskStart("live")).toBe(true);
  expect(controller.reserveTaskStart("live")).toBe(false);
  expect(controller.queuedTasks(snapshot)).toEqual([]);
  controller.releaseTaskStart("live");
  expect(controller.queuedTasks(snapshot).map((entry) => entry.id)).toEqual(["live"]);
});

test("rotates the first candidate across workspaces when capacity opens one slot at a time", () => {
  const oneA = task("one-a", "workspace-one", 1);
  const oneB = task("one-b", "workspace-one", 2);
  const twoA = task("two-a", "workspace-two", 3);
  let snapshot = state({
    "workspace-one": [oneA, oneB],
    "workspace-two": [twoA],
  });
  const { controller } = controllerFor(() => snapshot);

  const firstQueue = controller.queuedTasks(snapshot);
  expect(firstQueue.map((entry) => entry.id)).toEqual(["one-a", "two-a", "one-b"]);
  controller.markTasksScheduled(firstQueue, [firstQueue[0].id]);
  snapshot = state({
    "workspace-one": [{ ...oneA, status: "running" }, oneB],
    "workspace-two": [twoA],
  });

  expect(controller.queuedTasks(snapshot)[0]?.id).toBe("two-a");
});

test("counts retained cancellation metadata until settled and never overbooks a profile or total limit", () => {
  const running = task("running", "workspace-one", 1, {
    status: "running",
    apiProfileId: "api-one",
    jobId: "job-running",
  });
  const queued = [
    task("queued-one", "workspace-two", 2),
    task("queued-two", "workspace-two", 3),
    task("queued-three", "workspace-two", 4),
  ];
  const snapshot = state({
    "workspace-one": [running],
    "workspace-two": queued,
  }, {
    runningJobMeta: {
      "job-running": { workspaceId: "workspace-one", apiProfileId: "api-one" },
      "job-cancelled-awaiting-settled": { workspaceId: "workspace-old", apiProfileId: "api-two" },
    },
  } as Partial<ContinuousPoolState>);
  const { controller } = controllerFor(() => snapshot);
  const counts = controller.inFlightByProfile(snapshot);

  expect(counts).toEqual({ "api-one": 1, "api-two": 1 });
  const plan = planContinuousPoolWave(controller.queuedTasks(snapshot), [
    { id: "api-one", apiMode: "images", continuousPoolEnabled: true, concurrencyLimit: 1 },
    { id: "api-two", apiMode: "images", continuousPoolEnabled: true, concurrencyLimit: 2 },
  ], counts, controller.profileCursor(), 3);
  expect(plan.assignments).toHaveLength(1);
  expect(plan.assignments[0]?.profile.id).toBe("api-two");
  expect(plan.inFlightByProfileId).toEqual({ "api-one": 1, "api-two": 2 });
});

test("counts starting and submitting placeholders before a job id exists", () => {
  const starting = task("starting", "workspace-one", 1, { apiProfileId: "api-one" });
  const submitting = task("submitting", "workspace-one", 2, {
    apiProfileId: "api-two",
    launchState: "submitting",
  });
  const snapshot = state({ "workspace-one": [starting, submitting] });
  const { controller } = controllerFor(() => snapshot);

  expect(controller.reserveTaskStart(starting.id)).toBe(true);
  expect(controller.inFlightByProfile(snapshot)).toEqual({ "api-one": 1, "api-two": 1 });
});

test("coalesces concurrent pump requests without dropping a request made during a pass", async () => {
  let releaseFirstPass!: () => void;
  const firstPass = new Promise<void>((resolve) => { releaseFirstPass = resolve; });
  let passCount = 0;
  const snapshot = state({});
  const runPumpPass = vi.fn(async () => {
    passCount += 1;
    if (passCount === 1) await firstPass;
  });
  const { controller } = controllerFor(() => snapshot, runPumpPass);

  const first = controller.requestPump();
  const duplicate = controller.requestPump();
  expect(duplicate).toBe(first);
  expect(runPumpPass).toHaveBeenCalledTimes(1);
  releaseFirstPass();
  await first;

  expect(runPumpPass).toHaveBeenCalledTimes(2);
});

test("reset isolates an old pass and permits a new pump before the old pass settles", async () => {
  let releasePass!: () => void;
  const pendingPass = new Promise<void>((resolve) => { releasePass = resolve; });
  let passCount = 0;
  const snapshot = state({});
  const runPumpPass = vi.fn(async () => {
    passCount += 1;
    if (passCount === 1) await pendingPass;
  });
  const { controller } = controllerFor(() => snapshot, runPumpPass);

  controller.reserveTaskStart("reserved");
  const pumping = controller.requestPump();
  controller.requestPump();
  controller.setProfileCursor(7);
  controller.reset();
  const afterReset = controller.requestPump();
  expect(afterReset).not.toBe(pumping);
  expect(runPumpPass).toHaveBeenCalledTimes(2);
  releasePass();
  await Promise.all([pumping, afterReset]);

  expect(runPumpPass).toHaveBeenCalledTimes(2);
  expect(controller.isTaskStarting("reserved")).toBe(false);
  expect(controller.profileCursor()).toBe(0);
  await controller.requestPump();
  expect(runPumpPass).toHaveBeenCalledTimes(3);
});
