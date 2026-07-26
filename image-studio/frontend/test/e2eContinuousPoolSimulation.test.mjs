import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const harnessSource = await readFile(new URL("../src/app/dev/e2eHarness.ts", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../src/state/continuousPoolScheduler.ts", import.meta.url), "utf8");

const schedulerModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(schedulerSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText).toString("base64")}`);

// The simulator is deliberately pure. Strip harness-only imports so this test
// can execute that exported function without initializing the browser bridge.
globalThis.__imageStudioE2EPoolTestSelector = schedulerModule.selectNextContinuousPoolProfile;
const isolatedHarnessSource = [
  "const selectNextContinuousPoolProfile = globalThis.__imageStudioE2EPoolTestSelector;",
  harnessSource
    .replace(/^(?:import[\s\S]*?;\r?\n)+/, "")
    .replace('const packageVersion = String(import.meta.env.PACKAGE_VERSION || "");', 'const packageVersion = "";'),
].join("\n");
const harnessModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(isolatedHarnessSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText).toString("base64")}`);
const { runE2EContinuousPoolSimulation } = harnessModule;

test("memory-only continuous pool simulation round-robins, drains, and releases cancelled capacity after settlement", () => {
  const result = runE2EContinuousPoolSimulation();

  assert.equal(result.memoryOnly, true);
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    profileAssignment: true,
    queueDrained: true,
    cancellation: true,
    profileIsolation: true,
    totalCapacity: true,
  });
  assert.deepEqual(result.tasks.map((task) => task.apiProfileId), [
    "e2e-images-alpha",
    "e2e-images-bravo",
    "e2e-images-bravo",
    "e2e-images-alpha",
  ]);
  assert.equal(result.summary.queued, 0);
  assert.equal(result.summary.running, 0);
  assert.equal(result.summary.cancelling, 0);
  assert.equal(result.summary.succeeded, 3);
  assert.equal(result.summary.cancelled, 1);
  assert.deepEqual(result.summary.inFlightByProfileId, {
    "e2e-images-alpha": 0,
    "e2e-images-bravo": 0,
    "e2e-responses-excluded": 0,
    "e2e-images-disabled": 0,
  });

  const cancellationRequest = result.events.find((event) => event.type === "cancel_requested");
  const cancellationSettlementIndex = result.events.findIndex((event) => (
    event.type === "settled" && event.taskId === "e2e-task-b" && event.status === "cancelled"
  ));
  const replacementAssignmentIndex = result.events.findIndex((event) => (
    event.type === "assigned" && event.taskId === "e2e-task-c"
  ));
  assert.equal(cancellationRequest?.inFlightByProfileId["e2e-images-bravo"], 1);
  assert.ok(replacementAssignmentIndex > cancellationSettlementIndex);
  assert.notEqual(result.tasks[0].apiProfileSnapshot, result.tasks[3].apiProfileSnapshot);
  assert.ok(result.tasks.every((task) => task.apiProfileId !== "e2e-responses-excluded"));
  assert.ok(result.tasks.every((task) => task.apiProfileId !== "e2e-images-disabled"));
});

test("simulation uses full FHL pool capacity at 5 per API", () => {
  const profiles = Array.from({ length: 10 }, (_, index) => ({
    id: `slot-${index + 1}`,
    name: `Slot ${index + 1}`,
    apiMode: "images",
    continuousPoolEnabled: true,
    concurrencyLimit: 5,
  }));
  const result = runE2EContinuousPoolSimulation({
    profiles,
    tasks: 500,
    perAPIConcurrencyLimit: 5,
    cancelTaskIds: [],
  });

  assert.equal(result.passed, true);
  assert.equal(result.perAPIConcurrencyLimit, 5);
  assert.equal(result.enabledAPICount, 10);
  assert.equal(result.totalConcurrencyLimit, 50);
  assert.equal(result.summary.maxTotalInFlight, 50);
  assert.equal(result.summary.succeeded, 500);
  assert.equal(result.checks.totalCapacity, true);
  assert.ok(result.events.every((event) => event.inFlightTotal <= 50));
  assert.deepEqual(result.tasks.slice(0, 20).map((task) => task.apiProfileId), [
    "slot-1",
    "slot-2",
    "slot-3",
    "slot-4",
    "slot-5",
    "slot-6",
    "slot-7",
    "slot-8",
    "slot-9",
    "slot-10",
    "slot-1",
    "slot-2",
    "slot-3",
    "slot-4",
    "slot-5",
    "slot-6",
    "slot-7",
    "slot-8",
    "slot-9",
    "slot-10",
  ]);
});

test("simulation treats 4 as a per-API limit and starts 40 of 50 tasks", () => {
  const profiles = Array.from({ length: 10 }, (_, index) => ({
    id: `slot-${index + 1}`,
    name: `Slot ${index + 1}`,
    apiMode: "images",
    continuousPoolEnabled: true,
    concurrencyLimit: 5,
  }));
  const result = runE2EContinuousPoolSimulation({
    profiles,
    tasks: 50,
    perAPIConcurrencyLimit: 4,
    cancelTaskIds: [],
  });

  assert.equal(result.passed, true);
  assert.equal(result.perAPIConcurrencyLimit, 4);
  assert.equal(result.enabledAPICount, 10);
  assert.equal(result.totalConcurrencyLimit, 40);
  assert.equal(result.summary.initialRunning, 40);
  assert.equal(result.summary.initialQueued, 10);
  assert.equal(result.summary.maxTotalInFlight, 40);
  assert.equal(result.checks.totalCapacity, true);
  assert.ok(result.events.every((event) => event.inFlightTotal <= 40));
  assert.ok(Object.values(result.summary.maxInFlightByProfileId).every((count) => count <= 4));
  assert.deepEqual(
    result.events.filter((event) => event.type === "assigned").slice(0, 40).map((event) => event.profileId),
    Array.from({ length: 40 }, (_, index) => `slot-${(index % 10) + 1}`),
  );
});

test("simulation scales total capacity by enabled API count", () => {
  const oneAPI = runE2EContinuousPoolSimulation({
    profiles: [{
      id: "only-slot",
      name: "Only slot",
      apiMode: "images",
      continuousPoolEnabled: true,
      concurrencyLimit: 5,
    }],
    tasks: 10,
    perAPIConcurrencyLimit: 4,
    cancelTaskIds: [],
  });
  assert.equal(oneAPI.totalConcurrencyLimit, 4);
  assert.equal(oneAPI.summary.initialRunning, 4);

  const threeEnabled = runE2EContinuousPoolSimulation({
    profiles: Array.from({ length: 4 }, (_, index) => ({
      id: `mixed-slot-${index + 1}`,
      name: `Mixed slot ${index + 1}`,
      apiMode: "images",
      continuousPoolEnabled: index < 3,
      concurrencyLimit: 5,
    })),
    tasks: 20,
    perAPIConcurrencyLimit: 4,
    cancelTaskIds: [],
  });
  assert.equal(threeEnabled.enabledAPICount, 3);
  assert.equal(threeEnabled.totalConcurrencyLimit, 12);
  assert.equal(threeEnabled.summary.initialRunning, 12);
});

test("simulation starts all eleven batch tasks when ten APIs use 4 per API", () => {
  const result = runE2EContinuousPoolSimulation({
    profiles: Array.from({ length: 10 }, (_, index) => ({
      id: `batch-slot-${index + 1}`,
      name: `Batch slot ${index + 1}`,
      apiMode: "images",
      continuousPoolEnabled: true,
      concurrencyLimit: 5,
    })),
    tasks: 11,
    perAPIConcurrencyLimit: 4,
    cancelTaskIds: [],
  });

  assert.equal(result.totalConcurrencyLimit, 40);
  assert.equal(result.summary.initialRunning, 11);
  assert.equal(result.summary.initialQueued, 0);
  assert.deepEqual(
    result.events.filter((event) => event.type === "assigned").slice(0, 11).map((event) => event.profileId),
    [
      "batch-slot-1", "batch-slot-2", "batch-slot-3", "batch-slot-4", "batch-slot-5",
      "batch-slot-6", "batch-slot-7", "batch-slot-8", "batch-slot-9", "batch-slot-10",
      "batch-slot-1",
    ],
  );
});

test("simulation accepts only safe profile fields and keeps queued cancellation isolated", () => {
  const result = runE2EContinuousPoolSimulation({
    profiles: [
      {
        id: "images-only",
        name: "Images Only",
        apiMode: "images",
        continuousPoolEnabled: true,
        concurrencyLimit: 1,
        ignoredField: "must-not-be-read-or-returned",
      },
      {
        id: "responses-excluded",
        apiMode: "responses",
        continuousPoolEnabled: true,
        concurrencyLimit: 1,
      },
    ],
    tasks: [
      { id: "first", workspaceId: "workspace-one" },
      { id: "cancelled-before-start", workspaceId: "workspace-two" },
    ],
    cancelTaskIds: ["cancelled-before-start"],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.tasks.map((task) => [task.id, task.status, task.apiProfileId]), [
    ["first", "succeeded", "images-only"],
    ["cancelled-before-start", "cancelled", undefined],
  ]);
  assert.deepEqual(result.profiles.map((profile) => Object.keys(profile).sort()), [
    ["apiMode", "concurrencyLimit", "continuousPoolEnabled", "id", "name"],
    ["apiMode", "concurrencyLimit", "continuousPoolEnabled", "id", "name"],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-read-or-returned/);
});

test("simulation snapshots the selected Responses transport without changing Images slot metadata", () => {
  const result = runE2EContinuousPoolSimulation({
    fhlTransportMode: "responses",
    profiles: [
      {
        id: "slot-one",
        name: "FHL slot 1",
        apiMode: "images",
        continuousPoolEnabled: true,
        concurrencyLimit: 1,
      },
      {
        id: "slot-two",
        name: "FHL slot 2",
        apiMode: "images",
        continuousPoolEnabled: true,
        concurrencyLimit: 1,
      },
    ],
    tasks: [
      { id: "one", workspaceId: "workspace-one" },
      { id: "two", workspaceId: "workspace-two" },
    ],
  });

  assert.equal(result.passed, true);
  assert.equal(result.fhlTransportMode, "responses");
  assert.ok(result.profiles.every((profile) => profile.apiMode === "images"));
  assert.ok(result.tasks.every((task) => task.apiMode === "responses"));
  assert.ok(result.tasks.every((task) => task.apiProfileSnapshot?.apiMode === "responses"));
});

test("harness exposes the simulation through postMessage only for --e2e-only", () => {
  assert.match(harnessSource, /selectNextContinuousPoolProfile/);
  assert.match(harnessSource, /runContinuousPoolSimulation/);
  assert.match(harnessSource, /status\.e2eOnly === true/);
  assert.match(harnessSource, /Continuous pool simulation is only available in --e2e-only mode/);
});
