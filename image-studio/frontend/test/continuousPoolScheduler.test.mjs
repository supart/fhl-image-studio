import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const schedulerSource = await readFile(new URL("../src/state/continuousPoolScheduler.ts", import.meta.url), "utf8");
const schedulerModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(schedulerSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText).toString("base64")}`);

const {
  planContinuousPoolWave,
  selectNextContinuousPoolProfile,
  selectNextFailoverPoolProfile,
} = schedulerModule;

function profile(id, overrides = {}) {
  return {
    id,
    apiMode: "images",
    continuousPoolEnabled: true,
    concurrencyLimit: 1,
    ...overrides,
  };
}

test("round-robins across three caller-approved pool profiles", () => {
  const profiles = [profile("one"), profile("two"), profile("three")];
  let cursor = 0;
  const selectedIds = [];

  for (let index = 0; index < 4; index += 1) {
    const selection = selectNextContinuousPoolProfile(profiles, {}, cursor);
    selectedIds.push(selection.profile?.id);
    cursor = selection.nextCursor;
  }

  assert.deepEqual(selectedIds, ["one", "two", "three", "one"]);
  assert.equal(cursor, 1);
});

test("skips pool profiles whose finite capacity is exhausted", () => {
  const profiles = [
    profile("full", { concurrencyLimit: 1 }),
    profile("available", { concurrencyLimit: 2 }),
  ];

  const selection = selectNextContinuousPoolProfile(profiles, { full: 1, available: 1 }, 0);

  assert.equal(selection.profile?.id, "available");
  assert.equal(selection.nextCursor, 0);
});

test("treats a concurrency limit of zero as unlimited", () => {
  const profiles = [profile("unlimited", { concurrencyLimit: 0 })];

  const selection = selectNextContinuousPoolProfile(profiles, { unlimited: 999 }, 0);

  assert.equal(selection.profile?.id, "unlimited");
  assert.equal(selection.nextCursor, 0);
});

test("accepts either transport snapshot and excludes disabled profiles", () => {
  const profiles = [
    profile("responses", { apiMode: "responses", concurrencyLimit: 0 }),
    profile("disabled", { continuousPoolEnabled: false, concurrencyLimit: 0 }),
  ];

  const selection = selectNextContinuousPoolProfile(profiles, {}, 0);

  assert.equal(selection.profile?.id, "responses");
  assert.equal(selection.nextCursor, 1);
});

test("returns no profile and preserves the normalized cursor when none are available", () => {
  const profiles = [
    profile("full", { concurrencyLimit: 1 }),
    profile("disabled", { continuousPoolEnabled: false, concurrencyLimit: 0 }),
  ];

  const selection = selectNextContinuousPoolProfile(profiles, { full: 1 }, 5);

  assert.equal(selection.profile, null);
  assert.equal(selection.nextCursor, 1);
});

test("selects the next enabled profile for retry without returning the failed profile", () => {
  const profiles = [
    profile("one", { concurrencyLimit: 4 }),
    profile("two", { concurrencyLimit: 4 }),
    profile("three", { concurrencyLimit: 4 }),
  ];

  assert.equal(selectNextFailoverPoolProfile(profiles, "one")?.id, "two");
  assert.equal(selectNextFailoverPoolProfile(profiles, "three")?.id, "one");
});

test("failover skips disabled or temporarily unavailable profiles", () => {
  const profiles = [
    profile("one", { concurrencyLimit: 4 }),
    profile("disabled", { continuousPoolEnabled: false, concurrencyLimit: 4 }),
    profile("degraded", { concurrencyLimit: 0 }),
    profile("healthy", { concurrencyLimit: 2 }),
  ];

  assert.equal(selectNextFailoverPoolProfile(profiles, "one")?.id, "healthy");
  assert.equal(selectNextFailoverPoolProfile([profile("one")], "one"), null);
});

test("plans all 40 free slots as four API1-to-API10 rounds", () => {
  const profiles = Array.from({ length: 10 }, (_, index) => profile(`api-${index + 1}`, { concurrencyLimit: 4 }));
  const tasks = Array.from({ length: 50 }, (_, index) => ({ id: `task-${index + 1}` }));

  const plan = planContinuousPoolWave(tasks, profiles, {}, 0, 40);

  assert.equal(plan.assignments.length, 40);
  assert.deepEqual(
    plan.assignments.map((assignment) => assignment.profile.id),
    Array.from({ length: 4 }, () => profiles.map((entry) => entry.id)).flat(),
  );
  assert.deepEqual(
    Object.fromEntries(profiles.map((entry) => [entry.id, plan.inFlightByProfileId[entry.id]])),
    Object.fromEntries(profiles.map((entry) => [entry.id, 4])),
  );
});

test("plans all 37 vacancies when only three of 40 slots are occupied", () => {
  const profiles = Array.from({ length: 10 }, (_, index) => profile(`api-${index + 1}`, { concurrencyLimit: 4 }));
  const tasks = Array.from({ length: 50 }, (_, index) => ({ id: `task-${index + 1}` }));

  const plan = planContinuousPoolWave(tasks, profiles, {
    "api-1": 1,
    "api-2": 1,
    "api-3": 1,
  }, 0, 40);

  assert.equal(plan.assignments.length, 37);
  for (const profile of profiles) {
    assert.equal(plan.inFlightByProfileId[profile.id], 4);
  }
});

test("a 397-task simulation keeps 40 reserved until the final drain", () => {
  const profiles = Array.from({ length: 10 }, (_, index) => profile(`api-${index + 1}`, { concurrencyLimit: 4 }));
  const tasks = Array.from({ length: 397 }, (_, index) => ({ id: `task-${index + 1}` }));
  const counts = Object.fromEntries(profiles.map((entry) => [entry.id, 0]));
  let cursor = 0;
  let nextTask = 0;
  let active = [];
  const occupancy = [];

  const refill = () => {
    const plan = planContinuousPoolWave(tasks.slice(nextTask), profiles, counts, cursor, 40);
    cursor = plan.nextCursor;
    nextTask += plan.assignments.length;
    for (const assignment of plan.assignments) {
      counts[assignment.profile.id] += 1;
      active.push(assignment);
    }
    occupancy.push(active.length);
  };

  refill();
  while (active.length > 0) {
    const [finished, ...remaining] = active;
    active = remaining;
    counts[finished.profile.id] -= 1;
    refill();
  }

  assert.equal(nextTask, 397);
  assert.equal(Math.max(...occupancy), 40);
  assert.ok(occupancy.slice(0, 358).every((value) => value === 40));
  assert.deepEqual(occupancy.slice(-5), [4, 3, 2, 1, 0]);
});
