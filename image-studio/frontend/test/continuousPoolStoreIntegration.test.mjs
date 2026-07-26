import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const recordsSource = await readFile(new URL("../src/state/batchTaskRecords.ts", import.meta.url), "utf8");
const domainSource = await readFile(new URL("../src/types/domain.ts", import.meta.url), "utf8");

test("continuous single-image submission creates one task pinned to the first enabled FHL API", () => {
  assert.match(storeSource, /const enabledFHLPool = enabledFHLPoolProfiles\(s\)/);
  assert.match(storeSource, /const firstContinuousFHLPoolProfile = continuousGenerateTest \? enabledFHLPool\[0\] : undefined/);
  assert.match(storeSource, /const fhlPoolSubmit = continuousGenerateTest \|\| batchUsesFHLPool/);
  assert.match(storeSource, /const batchCount = batchProcessMode[\s\S]+: \(continuousGenerateTest \? 1 : normalizeBatchCount\(s\.batchCount\)\)/);
  assert.match(storeSource, /const effectiveAPIMode = fhlPoolSubmit[\s\S]+\? fhlTransportModeForState\(s\)/);
  assert.match(storeSource, /const apiProfileSnapshot: \{ apiProfileId\?: string; apiProfileName\?: string \} = continuousGenerateTest[\s\S]+apiProfileSnapshotForSubmit\(firstContinuousFHLPoolProfile/);
  assert.match(storeSource, /continuousPoolTask: fhlPoolSubmit/);
  assert.match(storeSource, /queuedReason: fhlPoolSubmit \? "continuous_pool" : undefined/);
  assert.match(storeSource, /if \(continuousGenerateTest\) \{[\s\S]+void requestContinuousPoolPump\(\);[\s\S]+return;/);
  assert.doesNotMatch(storeSource, /continuousGenerateTest \? fhlPoolTaskCount/);
  assert.doesNotMatch(storeSource, /if \(continuousGenerateTest && concurrencyLimit > 0\)/);
});

test("batch image-to-image can route through the same FHL pool assignment path", () => {
  assert.match(storeSource, /const batchUsesFHLPool = batchProcessMode && activeProfileUsesFHLTransport && hasEnabledFHLPool/);
  assert.match(storeSource, /: batchUsesFHLPool[\s\S]+\? \{\}[\s\S]+: apiProfileSnapshotForSubmit\(activeProfile/);
  assert.match(storeSource, /continuousPoolTask: batchUsesFHLPool/);
  assert.match(storeSource, /queuedReason: batchUsesFHLPool \? "continuous_pool" : "batch_shared_concurrency"/);
  assert.match(storeSource, /if \(batchUsesFHLPool\) \{[\s\S]+void requestContinuousPoolPump\(\);[\s\S]+return;/);
});

test("global pool pump round-robins enabled FHL slots and sums per-API capacity across workspaces", () => {
  assert.match(storeSource, /planContinuousPoolWave,[\s\S]+selectNextContinuousPoolProfile,[\s\S]+selectNextFailoverPoolProfile/);
  assert.match(storeSource, /function continuousPoolInFlightByProfile/);
  assert.match(storeSource, /for \(const task of Object\.values\(state\.batchTasksById\)\)/);
  assert.match(storeSource, /for \(const \[jobId, meta\] of Object\.entries\(state\.runningJobMeta\)\)/);
  assert.match(storeSource, /async function pumpContinuousPoolQueuePass\(\)/);
  assert.match(storeSource, /function reserveContinuousPoolWave\(\)/);
  assert.match(storeSource, /function requestContinuousPoolPump\(\)/);
  assert.match(storeSource, /function fhlPoolTotalCapacity/);
  assert.match(storeSource, /normalizeFHLPoolPerAPIConcurrencyLimit\(state\.fhlPoolPerAPIConcurrencyLimit\)/);
  assert.doesNotMatch(storeSource, /shared image limit/);
  assert.doesNotMatch(storeSource, /shared FHL API pool/);
  assert.match(storeSource, /planContinuousPoolWave\([\s\S]+continuousPoolInFlightByProfile\(state\)/);
  assert.doesNotMatch(storeSource, /Math\.min\(sharedLimit, totalCapacity\)/);
  assert.match(storeSource, /continuousPoolRoundRobinCursor,[\s\S]+totalLimit/);
  assert.match(storeSource, /const actualProfiles = new Map\(enabledFHLPoolProfiles\(state\)/);
  assert.match(storeSource, /task\.launchState === "submitting"/);
  assert.match(storeSource, /apiBaseURL: cleanBaseURL\(profile\.baseURL\)/);
  assert.match(storeSource, /apiProfileName: profile\.name/);
  assert.match(storeSource, /continuousPoolEnabled === true/);
  assert.doesNotMatch(storeSource, /if \(task\.apiMode !== "images" \|\| !profileId\) continue;/);
});

test("assigned pool tasks use non-sensitive snapshots and multi-reference transient retries fail over once", () => {
  assert.match(domainSource, /apiBaseURL\?: string;/);
  assert.match(domainSource, /continuousPoolTask\?: boolean;/);
  assert.match(storeSource, /baseURL: task\.apiBaseURL \?\? profile\?\.baseURL \?\? state\.baseURL/);
  assert.match(storeSource, /apiBaseURL: retryContext\.baseURL/);
  assert.match(storeSource, /apiMode: taskAPIMode/);
  assert.match(storeSource, /imagesNewAPICompat: taskAPIMode === "images" && profile\.imagesNewAPICompat === true/);
  assert.match(storeSource, /textModelID: taskAPIMode === "responses" \? FHL_TEXT_MODEL_ID : profile\.textModelID/);
  assert.match(storeSource, /if \(queuedTask\.continuousPoolTask\) \{[\s\S]+requestContinuousPoolPump/);
  assert.match(storeSource, /function nextFHLPoolProfileForMultiReferenceRetry/);
  assert.match(storeSource, /\(task\.sourceImagePaths\?\.length \?\? 0\) < 2/);
  assert.match(storeSource, /selectNextFailoverPoolProfile\(projected/);
  assert.match(storeSource, /const failoverProfile = nextFHLPoolProfileForMultiReferenceRetry\(latestState, latestTask\)/);
  assert.match(storeSource, /apiProfileId: failoverProfile\.id/);
  assert.match(storeSource, /retryBatchTask\(latestTask\.id, \{ automatic: true, useTaskProfile: true \}\)/);
});

test("cancelled task events cannot restore task state and FHL slot capacity is freed only after settled", () => {
  assert.match(storeSource, /EventsOn\(`settled:\$\{jobId\}`/);
  assert.match(storeSource, /if \(isCancelledTaskForJob\(\)\) return;/);
  assert.match(storeSource, /const retainedFHLPoolJobIds = new Set\([\s\S]+shouldRetainFHLPoolCapacityOnCancel/);
  assert.match(storeSource, /const notifySettled = \(status: "success" \| "error" \| "cancelled"\) => \{[\s\S]+isFHLImagesPoolProfileId\(store\.getState\(\), snapshot\.apiProfileId\)[\s\S]+requestContinuousPoolPump/);
  assert.match(recordsSource, /if \(task\.status === "cancelled"\) continue;/);
  assert.match(recordsSource, /if \(task\.status === "cancelled"\) return current;/);
  assert.match(recordsSource, /if \(task\.status === "cancelled" && patch\.status !== "cancelled"\) return current;/);
});

test("per-API setting pumps new capacity without cancelling active tasks", () => {
  const start = storeSource.indexOf("setFHLPoolPerAPIConcurrencyLimit: async");
  const end = storeSource.indexOf("runContinuousPressureTest: async", start);
  const action = storeSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(action, /normalizeFHLPoolPerAPIConcurrencyLimit\(limit\)/);
  assert.match(action, /persistFHLPoolPerAPIConcurrencyLimit\(normalized\)/);
  assert.match(action, /requestContinuousPoolPump\(\)/);
  assert.doesNotMatch(action, /cancel|Cancel/);
});

test("temporary FHL slot downgrade starts from the selected per-API limit", () => {
  const start = storeSource.indexOf("function recordTransientFailureForTask");
  const end = storeSource.indexOf("function retryContextFromOriginalTask", start);
  const failurePolicy = storeSource.slice(start, end);

  assert.match(failurePolicy, /normalizeFHLPoolPerAPIConcurrencyLimit\(state\.fhlPoolPerAPIConcurrencyLimit\)/);
  assert.match(failurePolicy, /temporaryConcurrencyCapsByProfile\.set\(key/);
  assert.doesNotMatch(failurePolicy, /fhlPoolPerAPIConcurrencyLimit:/);
});

test("zero effective FHL capacity is never treated as unlimited pool capacity", () => {
  assert.match(storeSource, /const concurrencyLimit = fhlPoolSlotConcurrencyLimit\(state, apiMode, profile\.id\)/);
  assert.match(storeSource, /continuousPoolEnabled: concurrencyLimit > 0,[\s\S]+concurrencyLimit,/);
  assert.match(storeSource, /if \(limit <= 0 \|\| \(inFlightByProfileId\[profile\.id\] \?\? 0\) >= limit\) continue;/);
});

test("one pool wave reads each profile key once and retries one transport request with stable task ids", () => {
  const start = storeSource.indexOf("async function submitContinuousPoolWave");
  const end = storeSource.indexOf("function reservedLaunchAttempt", start);
  const waveSubmit = storeSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(waveSubmit, /const profileIds = \[\.\.\.new Set\(wave\.tasks\.map/);
  assert.match(waveSubmit, /Promise\.all\(profileIds\.map\(async \(profileId\)/);
  assert.equal((waveSubmit.match(/apiKeyForProfileOrState\(/g) ?? []).length, 1);
  assert.equal((waveSubmit.match(/response = await submitBrowserJobGroups\(request\)/g) ?? []).length, 2);
  assert.match(waveSubmit, /clientTaskId: task\.id/);
  assert.match(waveSubmit, /task\.launchState === "submitting"/);
});
