import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  mergeAndroidJobGroupList,
  replaceAndroidWorkspaceJobGroups,
} from "../src/state/browserJobs.ts";
import { AndroidCanvasRecoveryRegistry } from "../src/state/androidCanvasRecovery.ts";

const studioStore = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");

function slot(jobId, status, updatedAt, extra = {}) {
  return {
    jobId,
    groupId: "group-1",
    workspaceId: "workspace-1",
    batchIndex: 0,
    status,
    createdAt: 1,
    updatedAt,
    ...extra,
  };
}

function group(groupId, slots, createdAt = 1) {
  return {
    groupId,
    workspaceId: "workspace-1",
    createdAt,
    mode: "generate",
    apiMode: "images",
    prompt: "test",
    batchCount: slots.length,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    slotIds: slots.map((entry) => entry.jobId),
    slots: slots.map((entry) => ({ ...entry, groupId })),
    statusSummary: {
      queued: 99,
      running: 99,
      succeeded: 99,
      failed: 99,
      cancelled: 99,
      interrupted: 99,
    },
  };
}

test("Android snapshots reject older slot state and recompute statusSummary", () => {
  const current = group("group-1", [slot("job-1", "succeeded", 30, { savedPath: "current.png" })]);
  const stale = group("group-1", [slot("job-1", "running", 20, { stage: "stale" })]);

  const [merged] = mergeAndroidJobGroupList([current], stale);
  assert.equal(merged.slots[0].status, "succeeded");
  assert.equal(merged.slots[0].savedPath, "current.png");
  assert.deepEqual(merged.statusSummary, {
    queued: 0,
    running: 0,
    succeeded: 1,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
  });
});

test("equal-time Android snapshots advance queued to running to terminal without flipping terminal outcomes", () => {
  const queued = group("group-1", [slot("job-1", "queued", 40)]);
  const running = group("group-1", [slot("job-1", "running", 40)]);
  const failed = group("group-1", [slot("job-1", "failed", 40, { errorMessage: "first terminal" })]);
  const succeeded = group("group-1", [slot("job-1", "succeeded", 40, { savedPath: "late.png" })]);

  const afterRunning = mergeAndroidJobGroupList([queued], running);
  assert.equal(afterRunning[0].slots[0].status, "running");
  const afterFailed = mergeAndroidJobGroupList(afterRunning, failed);
  assert.equal(afterFailed[0].slots[0].status, "failed");
  const afterCompetingTerminal = mergeAndroidJobGroupList(afterFailed, succeeded);
  assert.equal(afterCompetingTerminal[0].slots[0].status, "failed");
  assert.equal(afterCompetingTerminal[0].slots[0].errorMessage, "first terminal");
});

test("Android list replacement keeps concurrently added groups and merges listed groups monotonically", () => {
  const completed = group("group-1", [slot("job-1", "succeeded", 50)], 10);
  const concurrent = group("group-concurrent", [slot("job-concurrent", "queued", 60)], 20);
  const staleListed = group("group-1", [slot("job-1", "running", 40)], 10);
  const registryOnly = group("group-registry", [slot("job-registry", "queued", 55)], 15);
  const current = { "workspace-1": [concurrent, completed] };

  const replaced = replaceAndroidWorkspaceJobGroups(
    current,
    "workspace-1",
    [staleListed, registryOnly],
  )["workspace-1"];

  assert.deepEqual(
    replaced.map((entry) => entry.groupId),
    ["group-concurrent", "group-registry", "group-1"],
  );
  assert.equal(replaced.find((entry) => entry.groupId === "group-1").slots[0].status, "succeeded");
});

test("Android foreground events are hook-driven and attach only requested job IDs", () => {
  const client = readFileSync(
    new URL("../src/platform/runtime/androidJobClient.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /registerAndroidJobForegroundResumeHandler/);
  assert.match(client, /attachAndroidJobEvents\(jobIds: string\[\] = \[\]\)/);
  assert.match(client, /invokeAndroidNative\("AttachAndroidJobEvents", requestedJobIds\)/);
  assert.match(client, /attachAndroidJobEvents\(\[jobId\]\)/);
  assert.doesNotMatch(client, /void attachAndroidJobEvents\(\)\.catch\(\(\) => undefined\)/);
});

test("Android bootstrap monotonically merges jobs before filtered event replay", () => {
  const start = studioStore.indexOf("const deferredContentTask");
  const end = studioStore.indexOf("await Promise.allSettled", start);
  const deferred = studioStore.slice(start, end);
  const listIndex = deferred.indexOf("const [initialHistoryPage, loadedGroups]");
  const mergeIndex = deferred.indexOf("replaceAndroidWorkspaceJobGroups(nextJobGroups");
  const mergedBootstrapIndex = deferred.indexOf("const mergedBootstrapState = get()");
  const terminalCleanupIndex = deferred.indexOf("releaseAndroidUnsuccessfulTerminalJobs(mergedGroups)");
  const recoveryIndex = deferred.indexOf("recoverAndroidSuccessfulJob(group, slot, false)");
  const subscriptionIndex = deferred.indexOf("const attachedJobIds = syncBrowserJobSubscriptions");
  const attachIndex = deferred.indexOf("await attachAndroidJobEvents(attachedJobIds)");

  assert.ok(listIndex >= 0 && mergeIndex > listIndex);
  assert.ok(mergedBootstrapIndex > mergeIndex && terminalCleanupIndex > mergedBootstrapIndex);
  assert.ok(recoveryIndex > mergeIndex && subscriptionIndex > recoveryIndex && attachIndex > subscriptionIndex);
  assert.match(deferred, /rememberAndroidJobsLiveBeforeForeground\(get\(\)\)/);
  assert.match(deferred, /slot\.status === "succeeded" && androidCanvasRecovery\.isEligible\(slot\.jobId\)/);
  assert.match(deferred, /mergedBootstrapState\.jobGroupsByWorkspace\[workspaceId\][\s\S]*filter\(\(group\) => listedGroupIds\.has\(group\.groupId\)\)/);
  assert.match(deferred, /markRunningCanvasEligible: false/);
  assert.match(deferred, /attachedJobIds\.length > 0/);
  assert.doesNotMatch(deferred, /attachAndroidJobEvents\(\[\]\)/);
  assert.match(studioStore, /if \(!nextItem\) \{[\s\S]*pendingAndroidSuccessfulJobs\.set\(slot\.jobId, \{ group, slot \}\)/);
  assert.match(studioStore, /catch \{\s*if \(isAndroidTaskProxyMode\(\)\) pendingAndroidSuccessfulJobs\.set\(slot\.jobId, \{ group, slot \}\)/);
});

test("Android canvas recovery accepts an edit source anchor and advances across live groups", () => {
  const registry = new AndroidCanvasRecoveryRegistry();
  const state = {
    activeWorkspaceId: "workspace-1",
    currentImage: { id: "edit-source" },
    workspaces: [{
      id: "workspace-1",
      currentImageId: "edit-source",
      batchResultIds: [],
    }],
  };
  registry.markEligible(state, "workspace-1", ["job-1", "job-2"]);

  assert.equal(registry.canUpdate(state, "workspace-1", "job-1"), true);
  state.currentImage = { id: "history-job-1" };
  state.workspaces[0].currentImageId = "history-job-1";
  state.workspaces[0].batchResultIds = ["history-job-1"];
  registry.advance("workspace-1", "history-job-1", ["history-job-1"], "history-job-1");
  assert.equal(registry.canUpdate(state, "workspace-1", "job-2"), true);
});

test("Android canvas recovery tolerates the saved source before history hydration", () => {
  const registry = new AndroidCanvasRecoveryRegistry();
  const state = {
    activeWorkspaceId: "workspace-1",
    currentImage: null,
    workspaces: [{
      id: "workspace-1",
      currentImageId: "saved-source",
      batchResultIds: [],
    }],
  };
  registry.markEligible(state, "workspace-1", ["job-live"]);
  assert.equal(registry.canUpdate(state, "workspace-1", "job-live"), true);

  state.currentImage = { id: "saved-source" };
  assert.equal(registry.canUpdate(state, "workspace-1", "job-live"), true);
});

test("Android canvas recovery rejects manual selection and jobs that were not originally live", () => {
  const registry = new AndroidCanvasRecoveryRegistry();
  const state = {
    activeWorkspaceId: "workspace-1",
    currentImage: { id: "edit-source" },
    workspaces: [{
      id: "workspace-1",
      currentImageId: "edit-source",
      batchResultIds: [],
    }],
  };
  registry.markEligible(state, "workspace-1", ["job-live"]);
  state.currentImage = { id: "manual-selection" };
  state.workspaces[0].currentImageId = "manual-selection";

  assert.equal(registry.canUpdate(state, "workspace-1", "job-live"), false);
  assert.equal(registry.canUpdate(state, "workspace-1", "job-old-terminal"), false);
  registry.markEligible(state, "workspace-1", ["job-later-seen"]);
  assert.equal(registry.canUpdate(state, "workspace-1", "job-later-seen"), false);
});

test("Android canvas recovery cleanup removes terminal job eligibility", () => {
  const registry = new AndroidCanvasRecoveryRegistry();
  const state = {
    activeWorkspaceId: "workspace-1",
    currentImage: null,
    workspaces: [{ id: "workspace-1", currentImageId: null, batchResultIds: [] }],
  };
  registry.markEligible(state, "workspace-1", ["job-1", "job-2"]);
  registry.release("job-1");
  assert.equal(registry.isEligible("job-1"), false);
  assert.equal(registry.isEligible("job-2"), true);
  registry.release("job-2");
  assert.equal(registry.isEligible("job-2"), false);
});

test("Android registry cleanup releases unsuccessful terminal jobs before subscriptions", () => {
  const start = studioStore.indexOf("function releaseAndroidUnsuccessfulTerminalJobs");
  const end = studioStore.indexOf("async function reconcileAndroidJobRegistry", start);
  const cleanup = studioStore.slice(start, end);
  assert.match(cleanup, /isTerminalJobStatus\(slot\.status\)/);
  assert.match(cleanup, /slot\.status === "succeeded"/);
  assert.match(cleanup, /pendingAndroidSuccessfulJobs\.delete\(slot\.jobId\)/);
  assert.match(cleanup, /androidCanvasRecovery\.release\(slot\.jobId\)/);
  assert.match(cleanup, /clearBrowserJobSubscription\(slot\.jobId\)/);

  const reconcileStart = studioStore.indexOf("async function reconcileAndroidJobRegistry");
  const reconcileEnd = studioStore.indexOf("function ensureAndroidForegroundRegistryHandler", reconcileStart);
  const reconcile = studioStore.slice(reconcileStart, reconcileEnd);
  const mergedStateIndex = reconcile.indexOf("const mergedState = useStudioStore.getState()");
  const cleanupIndex = reconcile.indexOf("releaseAndroidUnsuccessfulTerminalJobs(mergedListedGroups)");
  assert.ok(mergedStateIndex >= 0 && cleanupIndex > mergedStateIndex);
  assert.match(reconcile, /mergedListedGroups\.push\(group\)/);
  assert.doesNotMatch(reconcile.slice(0, mergedStateIndex), /releaseAndroidUnsuccessfulTerminalJobs/);
});

test("Android foreground recovery hydrates before subscribing and guards the canvas by eligible job", () => {
  const start = studioStore.indexOf("async function reconcileAndroidJobRegistry");
  const end = studioStore.indexOf("function ensureAndroidForegroundRegistryHandler", start);
  const reconcile = studioStore.slice(start, end);
  const listIndex = reconcile.indexOf("await listAndroidJobGroups");
  const mergeIndex = reconcile.indexOf("replaceAndroidWorkspaceJobGroups");
  const recoveryIndex = reconcile.indexOf("recoverAndroidSuccessfulJob(group, slot, false)");
  const subscriptionIndex = reconcile.indexOf("const attachJobIds = syncBrowserJobSubscriptions");
  const attachIndex = reconcile.indexOf("await attachAndroidJobEvents(attachJobIds)");

  assert.ok(listIndex >= 0 && mergeIndex > listIndex);
  assert.ok(recoveryIndex > mergeIndex && subscriptionIndex > recoveryIndex && attachIndex > subscriptionIndex);
  assert.match(studioStore, /updateWorkspaceSelection: androidCanvasRecovery\.isEligible\(slot\.jobId\)/);
  assert.match(studioStore, /androidCanvasRecovery\.canUpdate\(state, group\.workspaceId, slot\.jobId\)/);
  assert.match(studioStore, /androidCanvasRecovery\.advance/);
  assert.match(studioStore, /androidCanvasRecovery\.release\(slot\.jobId\)/);
});
