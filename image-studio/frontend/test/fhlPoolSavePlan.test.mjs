import assert from "node:assert/strict";
import test from "node:test";

import {
  createFHLPoolSavePlan,
  executeFHLPoolSavePlan,
  fhlPoolSaveConfirmation,
  normalizeFHLPoolTargetKeys,
  readFHLPoolStoredCredentials,
} from "../src/lib/fhlPoolSavePlan.ts";

function syntheticAPIKey(label) {
  return ["sk", label, "abcdefgh"].join("-");
}

test("stored credential snapshot reports unreadable slots without exposing values", async () => {
  const snapshot = await readFHLPoolStoredCredentials([
    { id: "slot-1" },
    { id: "slot-2" },
    null,
  ], async (profileId) => {
    if (profileId === "slot-2") throw new Error("blocked");
    return "sk-first-stored-key";
  });
  assert.deepEqual(snapshot.credentials, [{ index: 0, profileId: "slot-1", apiKey: "sk-first-stored-key" }]);
  assert.deepEqual(snapshot.readErrors, [{ index: 1, profileId: "slot-2" }]);
});

test("save plan reports overwrite and migration using slot names only", () => {
  const plan = createFHLPoolSavePlan(new Map([
    [0, "sk-shared-api-key"],
    [1, "sk-new-api-key"],
  ]), [
    { index: 0, profileId: "slot-1", apiKey: "sk-old-api-key" },
    { index: 7, profileId: "slot-8", apiKey: "sk-shared-api-key" },
  ]);
  assert.deepEqual(plan.overwriteIndexes, [0]);
  assert.deepEqual(plan.cleanupProfileIds, ["slot-8"]);
  const confirmation = fhlPoolSaveConfirmation(plan);
  assert.match(confirmation, /覆盖 API 1/);
  assert.match(confirmation, /迁移 API 8 到 API 1/);
  assert.equal(confirmation.includes("sk-shared-api-key"), false);
});

test("same key already in the target needs no overwrite or cleanup", () => {
  const plan = createFHLPoolSavePlan(
    new Map([[2, "sk-existing-api-key"]]),
    [{ index: 2, profileId: "slot-3", apiKey: "sk-existing-api-key" }],
  );
  assert.deepEqual(plan.overwriteIndexes, []);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.cleanupProfileIds, []);
  assert.equal(fhlPoolSaveConfirmation(plan), "");
});

test("duplicate draft targets keep the earliest slot", () => {
  const normalized = normalizeFHLPoolTargetKeys(new Map([
    [0, "sk-shared-api-key"],
    [3, "sk-shared-api-key"],
  ]));
  assert.deepEqual([...normalized.targetKeys], [[0, "sk-shared-api-key"]]);
  assert.deepEqual(normalized.draftMerges, [{ fromIndex: 3, toIndex: 0 }]);
});

function transactionFixture({ failWriteIndex = -1, mismatchReadIndex = -1, failCleanup = false } = {}) {
  const events = [];
  const values = new Map();
  return {
    events,
    values,
    transaction: {
      async writeTarget(index, apiKey) {
        events.push(`write:${index}`);
        if (index === failWriteIndex) throw new Error("secret write failure sk-never-log-this");
        values.set(`target-${index}`, apiKey);
        return `target-${index}`;
      },
      async readTarget(index, profileId) {
        events.push(`read:${index}`);
        return index === mismatchReadIndex ? "sk-mismatch" : values.get(profileId) ?? "";
      },
      async cleanupSource(profileId) {
        events.push(`cleanup:${profileId}`);
        if (failCleanup) throw new Error("secret cleanup failure sk-never-log-this");
      },
    },
  };
}

test("transaction verifies every target before cleaning duplicate sources", async () => {
  const targets = new Map([[0, "sk-first"], [1, "sk-second"]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: "sk-first" },
  ]);
  const fixture = transactionFixture();
  await executeFHLPoolSavePlan(targets, plan, fixture.transaction);
  assert.deepEqual(fixture.events, [
    "write:0",
    "write:1",
    "read:0",
    "read:1",
    "cleanup:source-8",
  ]);
});

test("write or readback failure never cleans an old duplicate or exposes secrets", async () => {
  const secret = syntheticAPIKey("sensitive-tail-12345678");
  const targets = new Map([[0, secret], [1, "sk-second"]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: secret },
  ]);
  for (const { options, expectedProgress } of [
    { options: { failWriteIndex: 1 }, expectedProgress: /此前可能已保存 1 个槽位/ },
    { options: { mismatchReadIndex: 0 }, expectedProgress: /已写入 2 个目标槽/ },
  ]) {
    const fixture = transactionFixture(options);
    await assert.rejects(executeFHLPoolSavePlan(targets, plan, fixture.transaction), (error) => {
      assert.match(error.message, expectedProgress);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(secret.slice(-8)), false);
      assert.equal(error.message.includes("sk-never-log-this"), false);
      return true;
    });
    assert.equal(fixture.events.some((event) => event.startsWith("cleanup:")), false);
  }
});

test("cleanup failure reports only the source slot", async () => {
  const secret = syntheticAPIKey("sensitive-tail-87654321");
  const targets = new Map([[0, secret]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: secret },
  ]);
  const fixture = transactionFixture({ failCleanup: true });
  await assert.rejects(executeFHLPoolSavePlan(targets, plan, fixture.transaction), (error) => {
    assert.match(error.message, /API 8/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
