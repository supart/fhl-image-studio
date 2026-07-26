import assert from "node:assert/strict";
import test from "node:test";

const clear = await import("../src/lib/apiCredentialClear.ts");

function profile(id, apiMode = "responses", overrides = {}) {
  return {
    id,
    name: id,
    apiMode,
    requestPolicy: "openai",
    baseURL: apiMode === "runninghub" ? "http://127.0.0.1:8117" : "https://example.test",
    textModelID: "",
    imageModelID: "",
    concurrencyLimit: 1,
    createdAt: 1,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    profiles: [profile("direct"), profile("bridge", "runninghub")],
    activeProfileId: "direct",
    apiKey: "memory-only",
    baseURL: "https://example.test",
    textModelID: "text",
    imageModelID: "image",
    apiMode: "responses",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    fhlTextAPIConfigured: true,
    fhlTextAPIKeyHint: "hint",
    fhlTextAPITestStatus: "success",
    fhlTextAPITestMessage: "ok",
    isRunning: false,
    runningJobs: [],
    batchTasksById: {},
    isTestingKey: false,
    isOptimizingPrompt: false,
    isReversingPrompt: false,
    ...overrides,
  };
}

function operations(overrides = {}) {
  return {
    deleteKey: async () => undefined,
    getKey: async () => "",
    clearRunningHub: async () => undefined,
    clearLocalFiles: async () => true,
    clearBrowserStorage: () => 2,
    clearLegacyKeys: () => undefined,
    persistProfiles: () => undefined,
    persistActiveProfileId: () => undefined,
    ...overrides,
  };
}

test("secure wipe refuses to touch credentials while tasks are queued", async () => {
  let deleted = 0;
  await assert.rejects(
    clear.clearAllAPIConfigurations(
      state({ batchTasksById: { queued: { status: "queued" } } }),
      () => undefined,
      operations({ deleteKey: async () => { deleted += 1; } }),
    ),
    /任务结束后才能清空/,
  );
  assert.equal(deleted, 0);
});

test("secure wipe retains metadata when keyring verification fails", async () => {
  let patched = false;
  let persisted = false;
  await assert.rejects(
    clear.clearAllAPIConfigurations(
      state(),
      () => { patched = true; },
      operations({
        getKey: async (user) => user === "responses" ? "still-present" : "",
        persistProfiles: () => { persisted = true; },
      }),
    ),
    /仍有 1 项未能删除/,
  );
  assert.equal(patched, false);
  assert.equal(persisted, false);
});

test("secure wipe clears every store credential field only after verification", async () => {
  const patches = [];
  const persistedProfiles = [];
  const persistedActiveIds = [];
  const clearedBridges = [];
  const result = await clear.clearAllAPIConfigurations(
    state(),
    (patch) => patches.push(patch),
    operations({
      clearRunningHub: async (baseURL) => { clearedBridges.push(baseURL); },
      persistProfiles: (profiles) => { persistedProfiles.push(profiles); },
      persistActiveProfileId: (id) => { persistedActiveIds.push(id); },
    }),
  );

  assert.equal(result.profilesCleared, 2);
  assert.equal(result.runningHubBridgesCleared, 1);
  assert.equal(result.localFilesCleared, true);
  assert.deepEqual(clearedBridges, ["http://127.0.0.1:8117"]);
  assert.deepEqual(persistedProfiles, [[]]);
  assert.deepEqual(persistedActiveIds, [""]);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], {
    profiles: [],
    activeProfileId: "",
    apiKey: "",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    apiMode: "responses",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    fhlTextAPIConfigured: false,
    fhlTextAPIKeyHint: "",
    fhlTextAPITestStatus: "unconfigured",
    fhlTextAPITestMessage: "",
  });
});

test("secure wipe keeps profile metadata when an external bridge cannot be verified", async () => {
  let patched = false;
  let persisted = false;
  await assert.rejects(
    clear.clearAllAPIConfigurations(
      state(),
      () => { patched = true; },
      operations({
        clearRunningHub: async () => { throw new Error("offline"); },
        persistProfiles: () => { persisted = true; },
      }),
    ),
    /本地凭据已清除，但 RunningHub 桥接清除失败：offline/,
  );
  assert.equal(patched, false);
  assert.equal(persisted, false);
});
