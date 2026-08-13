import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AndroidSubmissionCoordinator,
  nextFHLImagesPoolCursor,
  orderedFHLImagesPoolCandidates,
  shouldUseAndroidFHLImagesPool,
} from "../src/state/androidSubmissionCoordinator.ts";
import { FHL_BASE_URL } from "../src/lib/profiles.ts";

const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const sharedStoreSource = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const profileActionsSource = readFileSync(new URL("../src/state/studioStore.profiles.ts", import.meta.url), "utf8");
const contractSource = readFileSync(new URL("../src/platform/runtime/browserJobContracts.ts", import.meta.url), "utf8");
const nativeSource = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobManager.kt", import.meta.url), "utf8");
const nativeBridgeSource = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidImageStudioBridge.kt", import.meta.url), "utf8");

function profile(slot) {
  return {
    id: `slot-${slot}`,
    name: `FHL${slot} Images`,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 4,
    continuousPoolEnabled: true,
    fhlImagesPoolSlot: slot,
    createdAt: slot,
  };
}

test("twenty concurrent calls for one workspace share one submission", async () => {
  const coordinator = new AndroidSubmissionCoordinator();
  let invocations = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = Array.from({ length: 20 }, () => coordinator.run("workspace-1", async () => {
    invocations += 1;
    await gate;
    return "group-1";
  }));

  await Promise.resolve();
  assert.equal(invocations, 1);
  release();
  assert.deepEqual(await Promise.all(calls), Array(20).fill("group-1"));
  assert.equal(await coordinator.run("workspace-1", async () => {
    invocations += 1;
    return "group-2";
  }), "group-2");
  assert.equal(invocations, 2);
});

test("different workspaces enter the native acknowledgement section serially", async () => {
  const coordinator = new AndroidSubmissionCoordinator();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coordinator.run("workspace-1", async () => {
    order.push("first-start");
    await gate;
    order.push("first-end");
  });
  const second = coordinator.run("workspace-2", async () => {
    order.push("second-start");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
});

test("pool candidates wrap by stable FHL slot without changing profile order", () => {
  const profiles = [profile(10), profile(1), profile(3), profile(2)];
  assert.deepEqual(
    orderedFHLImagesPoolCandidates(profiles, 3).map((item) => item.fhlImagesPoolSlot),
    [3, 10, 1, 2],
  );
  assert.equal(nextFHLImagesPoolCursor(10), 1);
  assert.equal(nextFHLImagesPoolCursor(4), 5);
});

test("a disabled active FHL slot keeps the Android continuous pool enabled", () => {
  const disabledActiveProfile = { ...profile(1), continuousPoolEnabled: false };
  const enabledProfile = profile(2);

  assert.equal(shouldUseAndroidFHLImagesPool(true, true, disabledActiveProfile), true);
  assert.deepEqual(
    orderedFHLImagesPoolCandidates([disabledActiveProfile, enabledProfile], 1)
      .map((item) => item.fhlImagesPoolSlot),
    [2],
  );
  assert.deepEqual(orderedFHLImagesPoolCandidates([disabledActiveProfile], 1), []);
});

test("Android pool routing accepts official slotted Responses but rejects non-pool profiles", () => {
  const enabledProfile = profile(1);
  assert.equal(shouldUseAndroidFHLImagesPool(false, true, enabledProfile), false);
  assert.equal(shouldUseAndroidFHLImagesPool(true, false, enabledProfile), false);
  assert.equal(shouldUseAndroidFHLImagesPool(true, true, {
    ...enabledProfile,
    apiMode: "responses",
  }), true);
  assert.equal(shouldUseAndroidFHLImagesPool(true, true, {
    ...enabledProfile,
    apiMode: "responses",
    fhlImagesPoolSlot: undefined,
  }), false);
  assert.equal(shouldUseAndroidFHLImagesPool(true, true, {
    ...enabledProfile,
    apiMode: "responses",
    baseURL: "https://example.invalid",
  }), false);
});

test("store freezes the selected pool assignment until native acknowledgement", () => {
  assert.match(storeSource, /androidSubmissionCoordinator\.run\(submissionWorkspaceId, performSubmit\)/);
  assert.match(storeSource, /clientSubmissionId = requireSecureRandomUUID\("付费生图请求"\)/);
  assert.match(storeSource, /clientSubmissionId,/);
  assert.match(storeSource, /apiProfileId: activeProfile\?\.id/);
  assert.match(storeSource, /const fhlImagesPoolSlot = normalizeFHLImagesPoolSlot\(/);
  assert.match(storeSource, /fhlImagesPoolSlot,/);
  assert.match(storeSource, /const acknowledgedPoolSlot = response\.group\?\.fhlImagesPoolSlot/);
  assert.match(storeSource, /persistAndroidFHLPoolCursor\(acknowledgedPoolSlot\)/);
  assert.doesNotMatch(storeSource, /if \(poolAssignment\) persistAndroidFHLPoolCursor\(poolAssignment\.slot\)/);
  assert.match(storeSource, /连续生成一次只能创建一个任务/);
});

test("pool cursor only advances from a valid acknowledged slot", () => {
  assert.match(storeSource, /typeof acknowledgedPoolSlot === "number"/);
  assert.match(storeSource, /Number\.isInteger\(acknowledgedPoolSlot\)/);
  assert.match(storeSource, /acknowledgedPoolSlot >= 1/);
  assert.match(storeSource, /acknowledgedPoolSlot <= 10/);
});

test("Android retry state and restored workspace sessions cannot retain API keys", () => {
  assert.match(storeSource, /const persistedPayload: RuntimeGenerateOptions = \{[\s\S]*apiKey: readRuntimePlatformState\(\)\.isAndroid \? "" : basePayload\.apiKey/);
  assert.match(sharedStoreSource, /function toPersistedWorkspace\([\s\S]*lastPayload: null/);
  assert.match(sharedStoreSource, /const hadPersistedLastPayload = Array\.isArray\(parsed\?\.workspaces\)/);
  assert.match(sharedStoreSource, /if \(hadPersistedLastPayload\) \{[\s\S]*workspaces: workspaces\.map\(toPersistedWorkspace\)/);
  assert.match(sharedStoreSource, /function normalizeWorkspace\([\s\S]*lastPayload: null/);
});

test("Android profile writes and paid submissions fail closed through the credential store", () => {
  assert.match(profileActionsSource, /catch \(e: any\) \{\s*if \(readRuntimePlatformState\(\)\.isAndroid\) \{\s*throw new Error/);
  assert.match(profileActionsSource, /if \(patch\.apiKey !== undefined\) \{[\s\S]*await SetStoredAPIKey[\s\S]*persistProfiles\(nextList\)/);
  assert.match(storeSource, /if \(readRuntimePlatformState\(\)\.isAndroid\) \{\s*try \{\s*await SetStoredAPIKey\(keyringUserFor\(activeId\), trimmed\);[\s\S]*set\(\{ apiKey: "" \}\);\s*throw error;/);
  assert.match(storeSource, /readRuntimePlatformState\(\)\.isAndroid\s*&& !poolAssignment\s*&& !runningHubBridgeSubmit/);
  assert.match(storeSource, /submittedAPIKey = await GetStoredAPIKey\(keyringUserFor\(activeProfile\.id\)\)/);
  assert.match(storeSource, /set\(\{ apiKey: "", errorMessage: error\?\.message/);
});

test("native submit rejects unsafe requests and returns the persisted idempotent group", () => {
  assert.match(contractSource, /clientSubmissionId: string/);
  assert.match(contractSource, /apiProfileId\?: string/);
  assert.match(contractSource, /fhlImagesPoolSlot\?: number/);
  assert.match(nativeSource, /clientSubmissionId\.isBlank\(\)/);
  assert.match(nativeSource, /continuousGenerateTest && batchCount != 1/);
  assert.match(nativeSource, /existing\.optString\("clientSubmissionId"\) == clientSubmissionId/);
  assert.match(nativeSource, /buildSubmitResponse\(existing, deduplicated = true\)/);
  assert.match(nativeSource, /\.put\("apiLabel", apiLabel\)/);
  assert.match(nativeSource, /\.put\("clientSubmissionId", clientSubmissionId\)/);
});

test("native persistence and transport stay fail closed around paid work", () => {
  const payloadWrite = nativeSource.indexOf("persistGroupPayload(appContext, groupId, storedPayload)");
  const credentialWrite = nativeSource.indexOf("setTemporaryJobCredential(groupId, submittedCredential)");
  const registryCommit = nativeSource.indexOf("saveRegistry(", credentialWrite);
  assert.ok(payloadWrite >= 0 && payloadWrite < credentialWrite && credentialWrite < registryCommit);
  assert.match(nativeSource, /cleanupOrphanedPayloads\(context, groups\)/);
  assert.match(nativeSource, /AtomicFile\(file\)\.openRead\(\)\.bufferedReader/);
  assert.match(nativeSource, /AtomicFile\(file\)\.delete\(\)/);
  assert.match(nativeSource, /fileName\.endsWith\("\.json\.bak"\)/);
  assert.match(nativeSource, /fileName\.endsWith\("\.json\.new"\)/);
  assert.match(nativeSource, /private fun saveRegistry[\s\S]*writeAtomicUTF8/);
  assert.match(nativeSource, /private fun persistGroupPayload[\s\S]*writeAtomicUTF8/);
  assert.match(nativeSource, /if \(!activeWorkerJobIds\.add\(candidate\.jobId\)\) return null[\s\S]*liveSlot\.put\("status", "running"\)/);
  assert.match(nativeSource, /val droppedGroupIds = trimTerminalGroups\(registry\)/);
  assert.ok((nativeSource.match(/setFixedLengthStreamingMode\(/g) ?? []).length >= 3);
  assert.match(nativeBridgeSource, /setFixedLengthStreamingMode\(requestBytes\.size\)/);
});
