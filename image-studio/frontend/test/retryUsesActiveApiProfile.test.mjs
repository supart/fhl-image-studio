import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../src/state/studioStore.profiles.ts", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../src/components/layout/AppHeaderBrand.tsx", import.meta.url), "utf8");

function blockFor(name) {
  const match = storeSource.match(new RegExp(`${name}: async \\([^)]*\\) => \\{[\\s\\S]+?\\n  \\},`));
  return match?.[0] ?? "";
}

test("manual retry rebuilds the request from the currently active API profile", () => {
  assert.match(storeSource, /function retrySubmitContextFromState/);
  assert.match(storeSource, /const apiMode = effectiveAPIModeForSubmit\(state, activeProfile, activeProfile\?\.apiMode \?\? state\.apiMode\)/);
  assert.match(storeSource, /const activeProfileUsesFHLTransport = isOfficialFHLTransportProfile\([\s\S]+?activeProfile,\s*state\.baseURL,\s*activeProfile\?\.apiMode \?\? state\.apiMode/);
  assert.match(storeSource, /activeProfileUsesFHLTransport && apiMode === "responses"/);
  assert.match(storeSource, /apiProfileSnapshot: apiProfileSnapshotForSubmit\(activeProfile, state\.activeProfileId\)/);

  const retryFailedJob = blockFor("retryFailedJob");
  assert.match(retryFailedJob, /const retryContext = retrySubmitContextFromState\(s, group\.mode\)/);
  assert.match(retryFailedJob, /size: retrySize/);
  assert.match(retryFailedJob, /apiMode: retryContext\.apiMode/);
  assert.match(retryFailedJob, /\.\.\.retryContext\.apiProfileSnapshot/);
  assert.doesNotMatch(retryFailedJob, /apiMode: group\.apiMode/);
  assert.doesNotMatch(retryFailedJob, /apiProfileId: group\.apiProfileId/);

  const retryBatchTask = blockFor("retryBatchTask");
  assert.match(retryBatchTask, /const useTaskProfile = options\?\.useTaskProfile === true \|\| task\.continuousPoolTask === true/);
  assert.match(retryBatchTask, /const retryContext = useTaskProfile \? retryContextFromOriginalTask\(s, task\) : retrySubmitContextFromState\(s, task\.mode\)/);
  assert.match(retryBatchTask, /const retryAPIKey = useTaskProfile \? await apiKeyForProfileOrState\(s, task\.apiProfileId\) : s\.apiKey/);
  assert.match(retryBatchTask, /const independentRetry = options\?\.independent === true/);
  assert.match(retryBatchTask, /const batchSharedTask = !independentRetry && !!task\.batchOutputMode/);
  assert.match(retryBatchTask, /apiMode: retryContext\.apiMode/);
  assert.match(retryBatchTask, /\.\.\.retryContext\.apiProfileSnapshot/);
  assert.match(retryBatchTask, /void pumpContinuousQueue\(workspaceId, queuedTask\.apiMode\)/);
  assert.match(retryBatchTask, /const retryQueueLimit = batchSharedTask[\s\S]+continuousQueueLimitForState\(s, retryContext\.apiMode, retryContext\.apiProfileSnapshot\.apiProfileId\)/);
  assert.match(retryBatchTask, /const continuousPoolTask = task\.continuousPoolTask === true/);
  assert.match(retryBatchTask, /queuedReason: continuousPoolTask[\s\S]+"continuous_pool"[\s\S]+batchSharedTask \? "batch_shared_concurrency" : retryQueueLimit > 0 \? "local_concurrency" : undefined/);
  assert.match(retryBatchTask, /apiBaseURL: retryContext\.baseURL/);
  assert.match(retryBatchTask, /if \(queuedTask\.continuousPoolTask\) \{[\s\S]+requestContinuousPoolPump/);
  assert.match(retryBatchTask, /const limit = continuousQueueLimitForState\(get\(\), queuedTask\.apiMode, queuedTask\.apiProfileId\)/);
  assert.match(retryBatchTask, /apiMode: queuedTask\.apiMode/);
  assert.match(retryBatchTask, /historyItemId: undefined/);
  assert.match(retryBatchTask, /savedPath: undefined/);
  assert.match(retryBatchTask, /rawPath: undefined/);
  assert.match(retryBatchTask, /lastLogLine: undefined/);
  assert.match(retryBatchTask, /elapsedSec: undefined/);
  assert.doesNotMatch(retryBatchTask, /apiMode: task\.apiMode/);
  assert.doesNotMatch(retryBatchTask, /apiProfileId: task\.apiProfileId/);
});

test("switching API profiles keeps batch previews visible", () => {
  const setActiveProfileBlock = profileSource.match(/async setActiveProfile\(id: string\) \{[\s\S]+?\n    \},/)?.[0] ?? "";
  assert.match(setActiveProfileBlock, /activeProfileId: id/);
  assert.match(setActiveProfileBlock, /activeProfileRuntimePatch\(profile, before\.fhlTransportMode\)/);
  assert.doesNotMatch(setActiveProfileBlock, /resultGridOpen:\s*false/);
  assert.doesNotMatch(setActiveProfileBlock, /selectedBatchTaskId:\s*null/);
  assert.doesNotMatch(setActiveProfileBlock, /patchWorkspaceRuntime/);
});

test("header FHL entry opens one group configuration without switching profiles", () => {
  assert.match(headerSource, /import \{ hasUsableFHLConfiguration \} from "\.\.\/\.\.\/lib\/profiles"/);
  assert.match(headerSource, /const hasFHLConfiguration = hasUsableFHLConfiguration\(\{\s*apiKey,\s*apiMode,\s*baseURL,\s*profiles,\s*\}\);/);
  assert.match(headerSource, /if \(hasFHLConfiguration\) \{\s*useStudioStore\.getState\(\)\.openUpstreamConfig\("app"\);/);
  assert.match(headerSource, /data-audit-id="fhl-config"/);
  assert.match(headerSource, /修改统一 FHL 配置/);
  assert.doesNotMatch(headerSource, /fhlProfiles/);
  assert.doesNotMatch(headerSource, /switchingProfileId/);
  assert.doesNotMatch(headerSource, /handleProfileSelect/);
  assert.doesNotMatch(headerSource, /<select/);
  assert.doesNotMatch(headerSource, /setActiveProfile/);
});

test("queued batch tasks fall back to the active profile API key when keyring is empty", () => {
  assert.match(storeSource, /async function apiKeyForProfileOrState/);
  assert.match(storeSource, /const stored = await GetStoredAPIKey\(keyringUserFor\(cleanProfileId\)\)\.catch\(\(\) => ""\)/);
  assert.match(storeSource, /if \(stored\.trim\(\)\) return stored;/);
  assert.match(storeSource, /cleanProfileId === String\(state\.activeProfileId \|\| ""\)\.trim\(\) \? state\.apiKey : ""/);

  assert.match(storeSource, /const taskAPIKey = await apiKeyForProfileOrState\(s, task\.apiProfileId\)/);
  assert.match(storeSource, /cleanedAPIKey = validateAPIKeyForHeader\(taskAPIKey\)/);
});

test("retry restores auto-aspect size before normalizing for the active API", () => {
  assert.match(storeSource, /function retryAutoAspectResolutionForContext/);
  assert.match(storeSource, /context\.mode === "edit" && context\.batchSourcePath && workspace\?\.editSourceMode === "batch"/);
  assert.match(storeSource, /function sourceForRetryAutoAspect/);
  assert.match(storeSource, /findWorkspaceSourceForAutoAspect\(workspace, batchPath\) \?\? \{ path: batchPath \}/);

  const retryFailedJob = blockFor("retryFailedJob");
  assert.match(retryFailedJob, /const retryAutoAspectResolution = retryAutoAspectResolutionForContext\(group, workspace\)/);
  assert.match(retryFailedJob, /if \(shouldRebuildRetryAutoAspectSize && !retryAutoAspectSize\)/);
  assert.match(retryFailedJob, /const retrySize = normalizeSizeSelection\(retryAutoAspectSize \?\? group\.size/);

  const retryBatchTask = blockFor("retryBatchTask");
  assert.match(retryBatchTask, /const retryAutoAspectResolution = retryAutoAspectResolutionForContext\(task, workspace\)/);
  assert.match(retryBatchTask, /if \(shouldRebuildRetryAutoAspectSize && !retryAutoAspectSize\)/);
  assert.match(retryBatchTask, /const retrySize = normalizeSizeSelection\(retryAutoAspectSize \?\? task\.size/);
  assert.match(retryBatchTask, /autoAspectResolution: retryAutoAspectResolution/);
});
