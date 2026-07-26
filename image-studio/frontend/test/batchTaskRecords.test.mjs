import test from "node:test";
import assert from "node:assert/strict";
import {
  createBatchTaskRecord,
  currentBatchTaskViewCount,
  findTaskForJobSlot,
  isRetryableBatchTask,
  localQueuedTasksForWorkspace,
  markMissingJobTasksInterrupted,
  nextSlotIndexFromTasks,
  runningOrSubmittedTaskCountForWorkspace,
  sortedBatchTasksForCurrentView,
  sortedBatchTasksForWorkspace,
  updateTaskFromHistoryItem,
  updateTasksFromJobGroup,
} from "../src/state/batchTaskRecords.ts";

function task(slotIndex, prompt = `prompt ${slotIndex}`) {
  return createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex,
    mode: "generate",
    apiMode: "responses",
    prompt,
    size: "864x1536",
    quality: "medium",
    outputFormat: "png",
    seed: 100 + slotIndex,
  });
}

test("batch task records preserve API profile metadata", () => {
  const original = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 0,
    mode: "generate",
    apiMode: "apimart",
    apiProfileId: "apimart-1",
    apiProfileName: "APIMart main",
    prompt: "prompt",
    size: "1:1@1k",
    quality: "medium",
    outputFormat: "png",
  });
  assert.equal(original.apiProfileId, "apimart-1");
  assert.equal(original.apiProfileName, "APIMart main");

  const updated = updateTasksFromJobGroup({ [original.id]: original }, [original.id], {
    groupId: "group-1",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "apimart",
    apiProfileId: "apimart-2",
    apiProfileName: "APIMart retry",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    slotIds: ["job-1"],
    slots: [{
      jobId: "job-1",
      groupId: "group-1",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 1,
      updatedAt: 2,
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[original.id].apiProfileId, "apimart-2");
  assert.equal(updated[original.id].apiProfileName, "APIMart retry");
});

test("continuous pool task records retain their non-sensitive assignment snapshot", () => {
  const record = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 2,
    mode: "generate",
    apiMode: "images",
    apiProfileId: "images-a",
    apiProfileName: "Images A",
    apiBaseURL: "https://images-a.example/v1",
    continuousPoolTask: true,
    prompt: "pool task",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    queuedReason: "continuous_pool",
  });

  assert.equal(record.continuousPoolTask, true);
  assert.equal(record.apiProfileId, "images-a");
  assert.equal(record.apiProfileName, "Images A");
  assert.equal(record.apiBaseURL, "https://images-a.example/v1");
  assert.equal(record.queuedReason, "continuous_pool");
});

test("batch task records preserve every submitted slot before results return", () => {
  const tasks = [task(0), task(2), task(1)];
  const byId = Object.fromEntries(tasks.map((entry) => [entry.id, entry]));
  const sorted = sortedBatchTasksForWorkspace("ws-1", tasks.map((entry) => entry.id), byId);
  assert.deepEqual(sorted.map((entry) => entry.slotIndex), [0, 1, 2]);
  assert.equal(nextSlotIndexFromTasks(sorted), 3);
});

test("job group updates prefer job id over slot when retry records share a slot", () => {
  const staleFailure = { ...task(4, "stale failure"), status: "failed", createdAt: 10, updatedAt: 20 };
  const activeRetry = { ...task(4, "active retry"), status: "queued", jobId: "job-retry", createdAt: 30, updatedAt: 40 };
  const byId = Object.fromEntries([staleFailure, activeRetry].map((entry) => [entry.id, entry]));
  const ids = [staleFailure.id, activeRetry.id];

  assert.equal(findTaskForJobSlot(ids, byId, "ws-1", 4, "job-retry")?.id, activeRetry.id);

  const updated = updateTasksFromJobGroup(byId, ids, {
    groupId: "group-retry",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: activeRetry.prompt,
    batchCount: 1,
    size: activeRetry.size,
    quality: activeRetry.quality,
    outputFormat: activeRetry.outputFormat,
    continuousBatchIndex: 4,
    slotIds: ["job-retry"],
    slots: [{
      jobId: "job-retry",
      groupId: "group-retry",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 1,
      updatedAt: 50,
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[activeRetry.id].status, "running");
  assert.equal(updated[staleFailure.id].status, "failed");
});

test("history updates prefer job id over slot when retry records share a slot", () => {
  const staleFailure = { ...task(4, "stale failure"), status: "failed", createdAt: 10, updatedAt: 20 };
  const activeRetry = { ...task(4, "active retry"), status: "running", jobId: "job-retry", createdAt: 30, updatedAt: 40 };
  const byId = Object.fromEntries([staleFailure, activeRetry].map((entry) => [entry.id, entry]));
  const ids = [staleFailure.id, activeRetry.id];

  const updated = updateTaskFromHistoryItem(byId, ids, "ws-1", {
    id: "job:job-retry",
    prompt: activeRetry.prompt,
    mode: "generate",
    size: activeRetry.size,
    quality: activeRetry.quality,
    outputFormat: activeRetry.outputFormat,
    createdAt: 50,
    batchIndex: 4,
    savedPath: "I:/tmp/retry.png",
    rawPath: "I:/tmp/retry.json",
  });

  assert.equal(updated[activeRetry.id].status, "succeeded");
  assert.equal(updated[activeRetry.id].historyItemId, "job:job-retry");
  assert.equal(updated[staleFailure.id].status, "failed");
});

test("current batch task view prioritizes running and queued tasks before terminal slots", () => {
  const cancelledNewest = { ...task(9, "cancelled newest"), status: "cancelled", createdAt: 100, updatedAt: 900 };
  const runningOld = { ...task(8, "running old"), status: "running", createdAt: 95, updatedAt: 120 };
  const queuedRetry = { ...task(2, "queued retry"), status: "queued", createdAt: 90, updatedAt: 400 };
  const failedOld = { ...task(4, "failed old"), status: "failed", createdAt: 80, updatedAt: 200 };
  const successRecent = { ...task(6, "success recent"), status: "succeeded", createdAt: 70, updatedAt: 800 };
  const staleResult = { ...task(7, "stale result"), status: "running", historyItemId: "hist-7", savedPath: "I:/tmp/out.png", createdAt: 60, updatedAt: 1000 };
  const byId = Object.fromEntries([cancelledNewest, runningOld, queuedRetry, failedOld, successRecent, staleResult].map((entry) => [entry.id, entry]));
  const sorted = sortedBatchTasksForCurrentView("ws-1", [cancelledNewest.id, runningOld.id, queuedRetry.id, failedOld.id, successRecent.id, staleResult.id], byId);

  assert.deepEqual(sorted.map((entry) => entry.id), [runningOld.id, queuedRetry.id, failedOld.id, successRecent.id, staleResult.id, cancelledNewest.id]);
  assert.deepEqual(sorted.map((entry) => entry.slotIndex), [8, 2, 4, 6, 7, 9]);
});

test("retryable batch tasks include missing final images but not completed results", () => {
  const failed = { ...task(0, "failed"), status: "failed" };
  const interrupted = { ...task(1, "interrupted"), status: "interrupted" };
  const missingFinalImage = { ...task(2, "missing final image"), status: "succeeded" };
  const completed = { ...task(3, "completed"), status: "succeeded", historyItemId: "hist-3", savedPath: "I:/tmp/out.png" };
  const cancelled = { ...task(4, "cancelled"), status: "cancelled" };

  assert.equal(isRetryableBatchTask(failed), true);
  assert.equal(isRetryableBatchTask(interrupted), true);
  assert.equal(isRetryableBatchTask(missingFinalImage), true);
  assert.deepEqual([failed, interrupted, missingFinalImage, completed, cancelled].filter(isRetryableBatchTask), [failed, interrupted, missingFinalImage]);
  assert.equal(isRetryableBatchTask(completed), false);
  assert.equal(isRetryableBatchTask(cancelled), false);
});

test("retryable batch tasks accept a durable task output path when history metadata is not loaded", () => {
  const missingHistoryItem = { ...task(5, "missing linked history"), status: "succeeded", historyItemId: "hist-missing" };
  const emptyHistoryItem = { ...task(6, "empty linked history"), status: "succeeded", historyItemId: "hist-empty" };
  const visibleHistoryItem = { ...task(7, "visible linked history"), status: "succeeded", historyItemId: "hist-visible" };
  const pathOnlyTask = { ...task(8, "path only"), status: "succeeded", savedPath: "I:/tmp/stale.png" };
  const historyById = new Map([
    ["hist-empty", { id: "hist-empty", prompt: "empty", mode: "generate", size: "1024x1024", quality: "medium", createdAt: 1 }],
    ["hist-visible", { id: "hist-visible", prompt: "visible", mode: "generate", size: "1024x1024", quality: "medium", createdAt: 2, savedPath: "I:/tmp/visible.png" }],
  ]);

  assert.equal(isRetryableBatchTask(missingHistoryItem), false);
  assert.equal(isRetryableBatchTask(missingHistoryItem, historyById), true);
  assert.equal(isRetryableBatchTask(emptyHistoryItem, historyById), true);
  assert.equal(isRetryableBatchTask(visibleHistoryItem, historyById), false);
  assert.equal(isRetryableBatchTask(pathOnlyTask), false);
  assert.equal(isRetryableBatchTask(pathOnlyTask, historyById), false);
});
test("current batch task view count prefers task records and falls back to legacy results", () => {
  const failed = { ...task(0, "failed"), status: "failed" };
  const cancelled = { ...task(1, "cancelled"), status: "cancelled" };
  const byId = Object.fromEntries([failed, cancelled].map((entry) => [entry.id, entry]));
  assert.equal(currentBatchTaskViewCount("ws-1", [failed.id, cancelled.id], byId, 0, []), 2);

  const legacyResults = [
    { id: "hist-1", prompt: "one", mode: "generate", size: "864x1536", quality: "medium", outputFormat: "png", createdAt: 1 },
    { id: "hist-2", prompt: "two", mode: "generate", size: "864x1536", quality: "medium", outputFormat: "png", createdAt: 2 },
  ];
  assert.equal(currentBatchTaskViewCount("ws-1", [], {}, 0, legacyResults), 2);
  assert.equal(currentBatchTaskViewCount("ws-1", [], {}, 5, legacyResults), 5);
  assert.equal(currentBatchTaskViewCount("ws-1", [], {}, 0, []), 0);

  const continuousGroups = [0, 2].map((slotIndex) => ({
    groupId: `group-${slotIndex}`,
    workspaceId: "ws-1",
    createdAt: slotIndex + 1,
    mode: "generate",
    apiMode: "responses",
    prompt: `prompt ${slotIndex}`,
    batchCount: 1,
    size: "864x1536",
    quality: "medium",
    outputFormat: "png",
    continuousGenerateTest: true,
    continuousBatchIndex: slotIndex,
    slotIds: [`job-${slotIndex}`],
    slots: [{
      jobId: `job-${slotIndex}`,
      groupId: `group-${slotIndex}`,
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "succeeded",
      createdAt: slotIndex + 1,
      updatedAt: slotIndex + 2,
    }],
    statusSummary: { queued: 0, running: 0, succeeded: 1, failed: 0, cancelled: 0, interrupted: 0 },
  }));
  assert.equal(currentBatchTaskViewCount("ws-1", [], {}, 0, [], continuousGroups), 3);
  assert.equal(currentBatchTaskViewCount("ws-2", [], {}, 0, [], continuousGroups), 0);
});

test("job group updates bind running and failed states to the original slot", () => {
  const original = task(18, "slot 18 prompt");
  const byId = { [original.id]: original };
  const updated = updateTasksFromJobGroup(byId, [original.id], {
    groupId: "group-1",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    seed: original.seed,
    sourceImagePaths: ["I:/fixed/template.png", "I:/batch/product.png"],
    batchSourcePath: "I:/batch/product.png",
    batchSourceSlotIndex: 1,
    continuousGenerateTest: true,
    continuousBatchIndex: 18,
    slotIds: ["job-18"],
    slots: [{
      jobId: "job-18",
      groupId: "group-1",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
      errorMessage: "timeout",
    }],
    statusSummary: { queued: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0, interrupted: 0 },
  });
  assert.equal(updated[original.id].slotIndex, 18);
  assert.equal(updated[original.id].status, "failed");
  assert.equal(updated[original.id].jobId, "job-18");
  assert.equal(updated[original.id].errorMessage, "timeout");
  assert.equal(updated[original.id].batchSourcePath, "I:/batch/product.png");
  assert.equal(updated[original.id].batchSourceSlotIndex, 1);
});

test("queued proxy snapshots do not knock an optimistically started task back into queue", () => {
  const original = {
    ...task(6, "slot 6 prompt"),
    status: "running",
    updatedAt: 20,
    lastLogLine: "starting",
  };
  const updated = updateTasksFromJobGroup({ [original.id]: original }, [original.id], {
    groupId: "group-6",
    workspaceId: "ws-1",
    createdAt: 10,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 6,
    slotIds: ["job-6"],
    slots: [{
      jobId: "job-6",
      groupId: "group-6",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "queued",
      createdAt: 10,
      updatedAt: 11,
      stage: "queued",
    }],
    statusSummary: { queued: 1, running: 0, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[original.id].status, "running");
  assert.equal(updated[original.id].jobId, "job-6");
  assert.equal(updated[original.id].lastLogLine, "starting");
  assert.equal(updated[original.id].updatedAt, 20);
});

test("missing browser job records interrupt restored running tasks", () => {
  const running = { ...task(5, "stale running"), status: "running", jobId: "job-missing", groupId: "group-missing" };
  const knownQueued = { ...task(6, "known queued"), status: "queued", jobId: "job-known", groupId: "group-known" };
  const localQueued = { ...task(7, "local queued"), status: "queued", queuedReason: "local_concurrency" };
  const byId = Object.fromEntries([running, knownQueued, localQueued].map((entry) => [entry.id, entry]));

  const updated = markMissingJobTasksInterrupted(
    byId,
    [running.id, knownQueued.id, localQueued.id],
    new Set(["job-known"]),
    1234,
  );

  assert.equal(updated[running.id].status, "interrupted");
  assert.equal(updated[running.id].updatedAt, 1234);
  assert.match(updated[running.id].errorMessage, /任务记录已失效/);
  assert.equal(updated[knownQueued.id].status, "queued");
  assert.equal(updated[localQueued.id].status, "queued");
});

test("ordinary multi-image groups append into the current session without overwriting earlier slots", () => {
  const first = task(4, "slot 4 prompt");
  const second = task(5, "slot 5 prompt");
  const byId = { [first.id]: first, [second.id]: second };
  const updated = updateTasksFromJobGroup(byId, [first.id, second.id], {
    groupId: "group-multi",
    workspaceId: "ws-1",
    createdAt: 10,
    mode: "generate",
    apiMode: "responses",
    prompt: "multi prompt",
    batchCount: 2,
    size: first.size,
    quality: first.quality,
    outputFormat: first.outputFormat,
    continuousBatchIndex: 4,
    slotIds: ["job-4", "job-5"],
    slots: [{
      jobId: "job-4",
      groupId: "group-multi",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 10,
      updatedAt: 11,
    }, {
      jobId: "job-5",
      groupId: "group-multi",
      workspaceId: "ws-1",
      batchIndex: 1,
      status: "failed",
      createdAt: 10,
      updatedAt: 12,
      errorMessage: "bad slot",
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 1, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[first.id].slotIndex, 4);
  assert.equal(updated[first.id].status, "running");
  assert.equal(updated[first.id].jobId, "job-4");
  assert.equal(updated[second.id].slotIndex, 5);
  assert.equal(updated[second.id].status, "failed");
  assert.equal(updated[second.id].jobId, "job-5");
  assert.equal(updated[second.id].errorMessage, "bad slot");
});

test("cancelled task records ignore every late job update", () => {
  const original = { ...task(3, "cancelled prompt"), status: "cancelled", jobId: "job-3", groupId: "group-3" };
  const runningUpdate = updateTasksFromJobGroup({ [original.id]: original }, [original.id], {
    groupId: "group-3",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 3,
    slotIds: ["job-3"],
    slots: [{
      jobId: "job-3",
      groupId: "group-3",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 1,
      updatedAt: 2,
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });
  assert.equal(runningUpdate[original.id].status, "cancelled");

  const successUpdate = updateTasksFromJobGroup(runningUpdate, [original.id], {
    groupId: "group-3",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 3,
    slotIds: ["job-3"],
    slots: [{
      jobId: "job-3",
      groupId: "group-3",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "succeeded",
      createdAt: 1,
      updatedAt: 3,
      savedPath: "I:/tmp/success.png",
    }],
    statusSummary: { queued: 0, running: 0, succeeded: 1, failed: 0, cancelled: 0, interrupted: 0 },
  });
  assert.equal(successUpdate[original.id].status, "cancelled");
  assert.equal(successUpdate[original.id].savedPath, undefined);
});

test("successful history item links back to its task record", () => {
  const original = task(4, "linked prompt");
  const updated = updateTaskFromHistoryItem(
    { [original.id]: original },
    [original.id],
    "ws-1",
    {
      id: "hist-4",
      prompt: original.prompt,
      mode: "generate",
      size: original.size,
      quality: original.quality,
      outputFormat: original.outputFormat,
      createdAt: 3,
      batchIndex: 4,
      savedPath: "I:/tmp/out.png",
      rawPath: "I:/tmp/raw.json",
    },
  );
  assert.equal(updated[original.id].status, "succeeded");
  assert.equal(updated[original.id].historyItemId, "hist-4");
  assert.equal(updated[original.id].savedPath, "I:/tmp/out.png");
});

test("local queued tasks wait for a concurrency slot without counting as active", () => {
  const waiting = { ...task(0, "waiting"), queuedReason: "local_concurrency" };
  const batchWaiting = { ...task(3, "batch waiting"), queuedReason: "batch_shared_concurrency" };
  const submitted = { ...task(1, "submitted"), jobId: "job-1", groupId: "group-1" };
  const running = { ...task(2, "running"), status: "running", jobId: "job-2", groupId: "group-2" };
  const byId = Object.fromEntries([waiting, batchWaiting, submitted, running].map((entry) => [entry.id, entry]));
  const ids = [waiting.id, batchWaiting.id, submitted.id, running.id];
  assert.deepEqual(localQueuedTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [waiting.id, batchWaiting.id]);
  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses"), 2);
  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses", new Set([waiting.id])), 3);
});

test("profile-scoped local capacity counts both FHL transport snapshots", () => {
  const images = { ...task(0, "images"), apiMode: "images", apiProfileId: "fhl-slot-one", status: "running", jobId: "images-job" };
  const responses = { ...task(1, "responses"), apiMode: "responses", apiProfileId: "fhl-slot-one", status: "running", jobId: "responses-job" };
  const unrelated = { ...task(2, "unrelated"), apiMode: "responses", apiProfileId: "other-slot", status: "running", jobId: "other-job" };
  const byId = Object.fromEntries([images, responses, unrelated].map((entry) => [entry.id, entry]));
  const ids = [images.id, responses.id, unrelated.id];

  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses", "fhl-slot-one"), 2);
  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses"), 2);
});

test("local queued tasks use promotion priority without changing display order", () => {
  const first = { ...task(0, "first"), queuedReason: "local_concurrency" };
  const second = { ...task(1, "second"), queuedReason: "local_concurrency", queuePriority: 50 };
  const third = { ...task(2, "third"), queuedReason: "local_concurrency", queuePriority: 10 };
  const byId = Object.fromEntries([first, second, third].map((entry) => [entry.id, entry]));
  const ids = [first.id, second.id, third.id];

  assert.deepEqual(sortedBatchTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [first.id, second.id, third.id]);
  assert.deepEqual(localQueuedTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [second.id, third.id, first.id]);
});
test("batch task records preserve auto-aspect retry metadata", () => {
  const auto = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 0,
    mode: "edit",
    apiMode: "responses",
    prompt: "prompt",
    size: "864x1536",
    autoAspectResolution: "1k",
    quality: "medium",
    outputFormat: "png",
  });
  const manual = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 1,
    mode: "edit",
    apiMode: "responses",
    prompt: "prompt",
    size: "1024x1024",
    autoAspectResolution: "",
    quality: "medium",
    outputFormat: "png",
  });

  assert.equal(auto.autoAspectResolution, "1k");
  assert.equal(manual.autoAspectResolution, undefined);
});
test("job group updates bind running and failed states to the original slot", () => {
  const original = task(18, "slot 18 prompt");
  const byId = { [original.id]: original };
  const updated = updateTasksFromJobGroup(byId, [original.id], {
    groupId: "group-1",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    seed: original.seed,
    sourceImagePaths: ["I:/fixed/template.png", "I:/batch/product.png"],
    batchSourcePath: "I:/batch/product.png",
    batchSourceSlotIndex: 1,
    continuousGenerateTest: true,
    continuousBatchIndex: 18,
    slotIds: ["job-18"],
    slots: [{
      jobId: "job-18",
      groupId: "group-1",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
      errorMessage: "timeout",
    }],
    statusSummary: { queued: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0, interrupted: 0 },
  });
  assert.equal(updated[original.id].slotIndex, 18);
  assert.equal(updated[original.id].status, "failed");
  assert.equal(updated[original.id].jobId, "job-18");
  assert.equal(updated[original.id].errorMessage, "timeout");
  assert.equal(updated[original.id].batchSourcePath, "I:/batch/product.png");
  assert.equal(updated[original.id].batchSourceSlotIndex, 1);
});

test("queued proxy snapshots do not knock an optimistically started task back into queue", () => {
  const original = {
    ...task(6, "slot 6 prompt"),
    status: "running",
    updatedAt: 20,
    lastLogLine: "starting",
  };
  const updated = updateTasksFromJobGroup({ [original.id]: original }, [original.id], {
    groupId: "group-6",
    workspaceId: "ws-1",
    createdAt: 10,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 6,
    slotIds: ["job-6"],
    slots: [{
      jobId: "job-6",
      groupId: "group-6",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "queued",
      createdAt: 10,
      updatedAt: 11,
      stage: "queued",
    }],
    statusSummary: { queued: 1, running: 0, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[original.id].status, "running");
  assert.equal(updated[original.id].jobId, "job-6");
  assert.equal(updated[original.id].lastLogLine, "starting");
  assert.equal(updated[original.id].updatedAt, 20);
});

test("missing browser job records interrupt restored running tasks", () => {
  const running = { ...task(5, "stale running"), status: "running", jobId: "job-missing", groupId: "group-missing" };
  const knownQueued = { ...task(6, "known queued"), status: "queued", jobId: "job-known", groupId: "group-known" };
  const localQueued = { ...task(7, "local queued"), status: "queued", queuedReason: "local_concurrency" };
  const byId = Object.fromEntries([running, knownQueued, localQueued].map((entry) => [entry.id, entry]));

  const updated = markMissingJobTasksInterrupted(
    byId,
    [running.id, knownQueued.id, localQueued.id],
    new Set(["job-known"]),
    1234,
  );

  assert.equal(updated[running.id].status, "interrupted");
  assert.equal(updated[running.id].updatedAt, 1234);
  assert.match(updated[running.id].errorMessage, /任务记录已失效/);
  assert.equal(updated[knownQueued.id].status, "queued");
  assert.equal(updated[localQueued.id].status, "queued");
});

test("ordinary multi-image groups append into the current session without overwriting earlier slots", () => {
  const first = task(4, "slot 4 prompt");
  const second = task(5, "slot 5 prompt");
  const byId = { [first.id]: first, [second.id]: second };
  const updated = updateTasksFromJobGroup(byId, [first.id, second.id], {
    groupId: "group-multi",
    workspaceId: "ws-1",
    createdAt: 10,
    mode: "generate",
    apiMode: "responses",
    prompt: "multi prompt",
    batchCount: 2,
    size: first.size,
    quality: first.quality,
    outputFormat: first.outputFormat,
    continuousBatchIndex: 4,
    slotIds: ["job-4", "job-5"],
    slots: [{
      jobId: "job-4",
      groupId: "group-multi",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 10,
      updatedAt: 11,
    }, {
      jobId: "job-5",
      groupId: "group-multi",
      workspaceId: "ws-1",
      batchIndex: 1,
      status: "failed",
      createdAt: 10,
      updatedAt: 12,
      errorMessage: "bad slot",
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 1, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[first.id].slotIndex, 4);
  assert.equal(updated[first.id].status, "running");
  assert.equal(updated[first.id].jobId, "job-4");
  assert.equal(updated[second.id].slotIndex, 5);
  assert.equal(updated[second.id].status, "failed");
  assert.equal(updated[second.id].jobId, "job-5");
  assert.equal(updated[second.id].errorMessage, "bad slot");
});

test("cancelled task records ignore every late job update after restore", () => {
  const original = { ...task(3, "cancelled prompt"), status: "cancelled", jobId: "job-3", groupId: "group-3" };
  const runningUpdate = updateTasksFromJobGroup({ [original.id]: original }, [original.id], {
    groupId: "group-3",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 3,
    slotIds: ["job-3"],
    slots: [{
      jobId: "job-3",
      groupId: "group-3",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 1,
      updatedAt: 2,
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });
  assert.equal(runningUpdate[original.id].status, "cancelled");

  const successUpdate = updateTasksFromJobGroup(runningUpdate, [original.id], {
    groupId: "group-3",
    workspaceId: "ws-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "responses",
    prompt: original.prompt,
    batchCount: 1,
    size: original.size,
    quality: original.quality,
    outputFormat: original.outputFormat,
    continuousGenerateTest: true,
    continuousBatchIndex: 3,
    slotIds: ["job-3"],
    slots: [{
      jobId: "job-3",
      groupId: "group-3",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "succeeded",
      createdAt: 1,
      updatedAt: 3,
      savedPath: "I:/tmp/success.png",
    }],
    statusSummary: { queued: 0, running: 0, succeeded: 1, failed: 0, cancelled: 0, interrupted: 0 },
  });
  assert.equal(successUpdate[original.id].status, "cancelled");
  assert.equal(successUpdate[original.id].savedPath, undefined);
});

test("successful history item links back to its task record", () => {
  const original = task(4, "linked prompt");
  const updated = updateTaskFromHistoryItem(
    { [original.id]: original },
    [original.id],
    "ws-1",
    {
      id: "hist-4",
      prompt: original.prompt,
      mode: "generate",
      size: original.size,
      quality: original.quality,
      outputFormat: original.outputFormat,
      createdAt: 3,
      batchIndex: 4,
      savedPath: "I:/tmp/out.png",
      rawPath: "I:/tmp/raw.json",
    },
  );
  assert.equal(updated[original.id].status, "succeeded");
  assert.equal(updated[original.id].historyItemId, "hist-4");
  assert.equal(updated[original.id].savedPath, "I:/tmp/out.png");
});

test("local queued tasks wait for a concurrency slot without counting as active", () => {
  const waiting = { ...task(0, "waiting"), queuedReason: "local_concurrency" };
  const batchWaiting = { ...task(3, "batch waiting"), queuedReason: "batch_shared_concurrency" };
  const submitted = { ...task(1, "submitted"), jobId: "job-1", groupId: "group-1" };
  const running = { ...task(2, "running"), status: "running", jobId: "job-2", groupId: "group-2" };
  const byId = Object.fromEntries([waiting, batchWaiting, submitted, running].map((entry) => [entry.id, entry]));
  const ids = [waiting.id, batchWaiting.id, submitted.id, running.id];
  assert.deepEqual(localQueuedTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [waiting.id, batchWaiting.id]);
  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses"), 2);
  assert.equal(runningOrSubmittedTaskCountForWorkspace("ws-1", ids, byId, "responses", new Set([waiting.id])), 3);
});

test("local queued tasks use promotion priority without changing display order", () => {
  const first = { ...task(0, "first"), queuedReason: "local_concurrency" };
  const second = { ...task(1, "second"), queuedReason: "local_concurrency", queuePriority: 50 };
  const third = { ...task(2, "third"), queuedReason: "local_concurrency", queuePriority: 10 };
  const byId = Object.fromEntries([first, second, third].map((entry) => [entry.id, entry]));
  const ids = [first.id, second.id, third.id];

  assert.deepEqual(sortedBatchTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [first.id, second.id, third.id]);
  assert.deepEqual(localQueuedTasksForWorkspace("ws-1", ids, byId).map((entry) => entry.id), [second.id, third.id, first.id]);
});
test("batch task records preserve auto-aspect retry metadata", () => {
  const auto = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 0,
    mode: "edit",
    apiMode: "responses",
    prompt: "prompt",
    size: "864x1536",
    autoAspectResolution: "1k",
    quality: "medium",
    outputFormat: "png",
  });
  const manual = createBatchTaskRecord({
    workspaceId: "ws-1",
    slotIndex: 1,
    mode: "edit",
    apiMode: "responses",
    prompt: "prompt",
    size: "1024x1024",
    autoAspectResolution: "",
    quality: "medium",
    outputFormat: "png",
  });

  assert.equal(auto.autoAspectResolution, "1k");
  assert.equal(manual.autoAspectResolution, undefined);
});
test("current batch task view keeps every submitted slot visible", () => {
  const first = { ...task(4, "first slot 4"), status: "failed", createdAt: 10, updatedAt: 20 };
  const second = { ...task(4, "second slot 4"), status: "queued", queuedReason: "local_concurrency", createdAt: 11, updatedAt: 30 };
  const third = { ...task(4, "third slot 4"), status: "running", createdAt: 12, updatedAt: 40 };
  const byId = Object.fromEntries([first, second, third].map((entry) => [entry.id, entry]));
  const sorted = sortedBatchTasksForCurrentView("ws-1", [first.id, second.id, third.id], byId);

  assert.equal(sorted.length, 3);
  assert.deepEqual(sorted.map((entry) => entry.id), [third.id, second.id, first.id]);
});

test("batch task view count uses record count instead of unique slot count", () => {
  const first = { ...task(4, "first slot 4"), status: "failed" };
  const second = { ...task(4, "second slot 4"), status: "queued", queuedReason: "local_concurrency" };
  const byId = Object.fromEntries([first, second].map((entry) => [entry.id, entry]));

  assert.equal(currentBatchTaskViewCount("ws-1", [first.id, second.id], byId, 0, []), 2);
});

test("current batch task view keeps same-slot records visible", () => {
  const failedOld = { ...task(4, "failed old"), status: "failed", createdAt: 80, updatedAt: 200 };
  const queuedRetry = { ...task(4, "queued retry"), status: "queued", queuedReason: "local_concurrency", createdAt: 90, updatedAt: 400 };
  const runningOther = { ...task(2, "running other"), status: "running", createdAt: 70, updatedAt: 300 };
  const byId = Object.fromEntries([failedOld, queuedRetry, runningOther].map((entry) => [entry.id, entry]));
  const sorted = sortedBatchTasksForCurrentView("ws-1", [failedOld.id, queuedRetry.id, runningOther.id], byId);

  assert.deepEqual(sorted.map((entry) => entry.id), [runningOther.id, queuedRetry.id, failedOld.id]);
  assert.equal(sorted.filter((entry) => entry.slotIndex === 4).length, 2);
});

test("current batch task view count keeps same-slot records", () => {
  const failedOld = { ...task(4, "failed old"), status: "failed", createdAt: 80, updatedAt: 200 };
  const queuedRetry = { ...task(4, "queued retry"), status: "queued", queuedReason: "local_concurrency", createdAt: 90, updatedAt: 400 };
  const runningOther = { ...task(2, "running other"), status: "running", createdAt: 70, updatedAt: 300 };
  const byId = Object.fromEntries([failedOld, queuedRetry, runningOther].map((entry) => [entry.id, entry]));

  assert.equal(currentBatchTaskViewCount("ws-1", [failedOld.id, queuedRetry.id, runningOther.id], byId, 0, []), 3);
});

test("browser groups correlate by clientTaskId before slot position", () => {
  const first = { ...task(0, "first"), launchState: "submitting", launchStartedAt: 100 };
  const second = { ...task(0, "second"), launchState: "submitting", launchStartedAt: 100 };
  const byId = Object.fromEntries([first, second].map((entry) => [entry.id, entry]));
  const updated = updateTasksFromJobGroup(byId, [first.id, second.id], {
    groupId: "group-client-task",
    runId: "run-1",
    clientTaskId: second.id,
    workspaceId: "ws-1",
    createdAt: 100,
    mode: "generate",
    apiMode: "images",
    prompt: "second",
    batchCount: 1,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    slotIds: ["job-client-task"],
    slots: [{
      jobId: "job-client-task",
      groupId: "group-client-task",
      workspaceId: "ws-1",
      batchIndex: 0,
      status: "running",
      createdAt: 100,
      updatedAt: 101,
    }],
    statusSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0, interrupted: 0 },
  });

  assert.equal(updated[first.id].jobId, undefined);
  assert.equal(updated[second.id].jobId, "job-client-task");
  assert.equal(updated[second.id].launchState, undefined);
  assert.equal(updated[second.id].runId, "run-1");
});
