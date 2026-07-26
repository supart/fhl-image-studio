import assert from "node:assert/strict";
import test from "node:test";

const library = await import("../src/lib/apiCredentialLibrary.ts");
const profiles = await import("../src/lib/profiles.ts");

function profile(id, apiMode = "responses", overrides = {}) {
  return {
    id,
    name: id,
    apiMode,
    requestPolicy: "openai",
    baseURL: "https://example.test",
    textModelID: "",
    imageModelID: "",
    concurrencyLimit: 1,
    createdAt: 1,
    ...overrides,
  };
}

test("credential inventory groups FHL pool, direct profiles, and RunningHub", () => {
  const inventory = library.buildAPICredentialInventory([
    profile("fhl-slot", "images", {
      baseURL: profiles.FHL_BASE_URL,
      imageModelID: profiles.FHL_IMAGE_MODEL_ID,
      fhlImagesPoolSlot: 1,
    }),
    profile("apimart", "apimart"),
    profile("runninghub", "runninghub"),
  ], true);

  assert.equal(inventory.fhlTextConfigured, true);
  assert.deepEqual(inventory.fhlImagesProfiles.map((item) => item.id), ["fhl-slot"]);
  assert.deepEqual(inventory.directProfiles.map((item) => item.id), ["apimart"]);
  assert.deepEqual(inventory.runningHubProfiles.map((item) => item.id), ["runninghub"]);
  assert.equal(inventory.profileCount, 3);
});

test("credential user list includes dedicated, legacy, and every profile target once", () => {
  const users = library.apiCredentialUsersForProfiles([
    profile("one"),
    profile("one"),
    profile("two", "images"),
  ]);
  assert.equal(users.includes("responses"), true);
  assert.equal(users.includes("images"), true);
  assert.equal(users.some((user) => user.endsWith(":fhl-text-assistant")), true);
  assert.equal(users.filter((user) => user.endsWith(":one")).length, 1);
  assert.equal(users.filter((user) => user.endsWith(":two")).length, 1);
});

test("secure wipe is blocked by queued, running, or ordinary active work", () => {
  assert.equal(library.hasActiveAPIWork({ isRunning: false, runningJobs: [], batchTasksById: {} }), false);
  assert.equal(library.hasActiveAPIWork({
    isRunning: false,
    runningJobs: [],
    batchTasksById: { queued: { status: "queued" } },
  }), true);
  assert.equal(library.hasActiveAPIWork({
    isRunning: false,
    runningJobs: [],
    batchTasksById: { running: { status: "running" } },
  }), true);
  assert.equal(library.hasActiveAPIWork({ isRunning: true, runningJobs: [], batchTasksById: {} }), true);
  assert.equal(library.hasActiveAPIWork({ isRunning: false, runningJobs: ["job"], batchTasksById: {} }), true);
  assert.equal(library.hasActiveAPIWork({
    isRunning: false,
    runningJobs: [],
    batchTasksById: {},
    fhlTextAPITestStatus: "testing",
  }), true);
  assert.equal(library.hasActiveAPIWork({
    isRunning: false,
    runningJobs: [],
    batchTasksById: {},
    isOptimizingPrompt: true,
  }), true);
});

test("credential deletion verifies every target and reports partial failures", async () => {
  const stored = new Map([
    ["ok", "secret-a"],
    ["stuck", "secret-b"],
    ["throws", "secret-c"],
  ]);
  const result = await library.deleteAndVerifyAPIKeyUsers(
    ["ok", "stuck", "throws", "ok"],
    {
      deleteKey: async (user) => {
        if (user === "throws") throw new Error("blocked");
        if (user !== "stuck") stored.delete(user);
      },
      getKey: async (user) => stored.get(user) || "",
    },
  );

  assert.equal(result.attempted, 3);
  assert.deepEqual(result.failedUsers, ["stuck", "throws"]);
  assert.equal(stored.has("ok"), false);
});
