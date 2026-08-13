import assert from "node:assert/strict";
import test from "node:test";

import {
  createFHLPoolSavePlan,
  executeFHLPoolSavePlan,
  fhlPoolSaveConfirmation,
  normalizeFHLPoolTargetKeys,
  readFHLPoolStoredCredentials,
} from "../src/platform/android/upstream/fhlPoolSavePlan.ts";

test("stored credential snapshot keeps values local and reports unreadable slots", async () => {
  const values = new Map([
    ["slot-1", "sk-first-stored-key"],
    ["slot-3", ""],
  ]);
  const snapshot = await readFHLPoolStoredCredentials([
    { id: "slot-1" },
    { id: "slot-2" },
    { id: "slot-3" },
  ], async (profileId) => {
    if (profileId === "slot-2") throw new Error("read blocked");
    return values.get(profileId) ?? "";
  });
  assert.deepEqual(snapshot.credentials, [{ index: 0, profileId: "slot-1", apiKey: "sk-first-stored-key" }]);
  assert.deepEqual(snapshot.readErrors, [{ index: 1, profileId: "slot-2", message: "credential read failed" }]);
});

test("save plan overwrites target slots and moves matching keys out of old slots", () => {
  const targets = new Map([
    [0, "sk-shared-api-key"],
    [1, "sk-new-api-key"],
  ]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 0, profileId: "slot-1", apiKey: "sk-old-api-key" },
    { index: 7, profileId: "slot-8", apiKey: "sk-shared-api-key" },
  ]);

  assert.deepEqual(plan.targetIndexes, [0, 1]);
  assert.deepEqual(plan.overwriteIndexes, [0]);
  assert.deepEqual(plan.moves, [{ fromIndex: 7, fromProfileId: "slot-8", toIndex: 0 }]);
  assert.deepEqual(plan.cleanupProfileIds, ["slot-8"]);
  assert.equal(
    fhlPoolSaveConfirmation(plan),
    "将覆盖 FHL1；合并 FHL8 到 FHL1。同一 API 只保留新槽位，是否继续？",
  );
});

test("same key already in the target slot needs neither overwrite nor cleanup", () => {
  const plan = createFHLPoolSavePlan(
    new Map([[2, "sk-existing-api-key"]]),
    [{ index: 2, profileId: "slot-3", apiKey: "sk-existing-api-key" }],
  );
  assert.deepEqual(plan.overwriteIndexes, []);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.cleanupProfileIds, []);
  assert.equal(fhlPoolSaveConfirmation(plan), "");
});

test("a duplicate source overwritten by this batch is retained with its replacement key", async () => {
  const plan = createFHLPoolSavePlan(new Map([
    [0, "sk-shared-api-key"],
    [7, "sk-replacement-api-key"],
  ]), [
    { index: 7, profileId: "slot-8", apiKey: "sk-shared-api-key" },
  ]);
  assert.deepEqual(plan.overwriteIndexes, [7]);
  assert.deepEqual(plan.moves, [{ fromIndex: 7, fromProfileId: "slot-8", toIndex: 0 }]);
  assert.deepEqual(plan.cleanupProfileIds, []);

  const fixture = transactionFixture();
  fixture.values.set("slot-8", "sk-shared-api-key");
  await executeFHLPoolSavePlan(new Map([
    [0, "sk-shared-api-key"],
    [7, "sk-replacement-api-key"],
  ]), plan, fixture.transaction);
  assert.equal(fixture.events.some((event) => event.startsWith("delete-credential:")), false);
  assert.equal(fixture.events.some((event) => event.startsWith("delete-profile:")), false);
  assert.equal(fixture.values.get("target-7"), "sk-replacement-api-key");
});

test("a duplicate source targeted with the same key remains the canonical target", () => {
  const plan = createFHLPoolSavePlan(new Map([
    [0, "sk-shared-api-key"],
    [7, "sk-shared-api-key"],
  ]), [
    { index: 7, profileId: "slot-8", apiKey: "sk-shared-api-key" },
  ]);
  assert.deepEqual(plan.overwriteIndexes, []);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.cleanupProfileIds, []);
});

test("multiple old duplicates collapse into one target without exposing key text", () => {
  const secret = "fixture-never-render-this-value";
  const plan = createFHLPoolSavePlan(new Map([[4, secret]]), [
    { index: 5, profileId: "slot-6", apiKey: secret },
    { index: 8, profileId: "slot-9", apiKey: secret },
  ]);
  const message = fhlPoolSaveConfirmation(plan);
  assert.deepEqual(plan.cleanupProfileIds, ["slot-6", "slot-9"]);
  assert.match(message, /FHL6 到 FHL5、FHL9 到 FHL5/);
  assert.equal(message.includes(secret), false);
  assert.equal(message.includes(secret.slice(-8)), false);
});

test("duplicate new targets keep the first slot and write or test the API only once", async () => {
  const secret = "fixture-shared-multi-target-key";
  const normalized = normalizeFHLPoolTargetKeys(new Map([[0, secret], [1, secret]]));
  assert.deepEqual([...normalized.targetKeys], [[0, secret]]);
  assert.deepEqual(normalized.draftMerges, [{ fromIndex: 1, toIndex: 0 }]);
  const plan = createFHLPoolSavePlan(normalized.targetKeys, [
    { index: 7, profileId: "slot-8", apiKey: secret },
  ], normalized.draftMerges);
  assert.equal(plan.moves.length, 1);
  assert.deepEqual(plan.cleanupProfileIds, ["slot-8"]);
  const fixture = transactionFixture();
  fixture.values.set("slot-8", secret);
  await executeFHLPoolSavePlan(normalized.targetKeys, plan, fixture.transaction);
  assert.equal(fixture.events.filter((event) => event.startsWith("write:")).length, 1);
  assert.equal(fixture.events.filter((event) => event === "delete-credential:slot-8").length, 1);
  assert.equal(fixture.events.filter((event) => event === "delete-profile:slot-8").length, 1);
  assert.match(fhlPoolSaveConfirmation(plan), /FHL2 到 FHL1/);
});

function transactionFixture({
  failWriteIndex = -1,
  mismatchReadIndex = -1,
  failDeleteCredential = false,
  failDeleteProfile = false,
} = {}) {
  const events = [];
  const values = new Map();
  const deletedProfiles = [];
  return {
    events,
    values,
    deletedProfiles,
    transaction: {
      async writeTarget(index, apiKey) {
        events.push(`write:${index}`);
        if (index === failWriteIndex) throw new Error("secret write failure sk-never-log-this");
        values.set(`target-${index}`, apiKey);
        return `target-${index}`;
      },
      async readTarget(index, profileId) {
        events.push(`read-target:${index}`);
        return index === mismatchReadIndex ? "sk-mismatch" : values.get(profileId) ?? "";
      },
      async deleteCredential(profileId) {
        events.push(`delete-credential:${profileId}`);
        if (failDeleteCredential) throw new Error("secret delete failure sk-never-log-this");
        values.delete(profileId);
      },
      async readCredential(profileId) {
        events.push(`read-credential:${profileId}`);
        return values.get(profileId) ?? "";
      },
      async deleteProfile(profileId, expectedEmpty) {
        events.push(`delete-profile:${profileId}`);
        assert.equal(expectedEmpty, true);
        if (failDeleteProfile) throw new Error("secret profile failure sk-never-log-this");
        deletedProfiles.push(profileId);
      },
    },
  };
}

test("credential transaction verifies every target before deleting duplicate sources", async () => {
  const targets = new Map([[0, "sk-first"], [1, "sk-second"]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: "sk-first" },
  ]);
  const fixture = transactionFixture();
  fixture.values.set("source-8", "sk-first");

  await executeFHLPoolSavePlan(targets, plan, fixture.transaction);
  assert.deepEqual(fixture.events, [
    "write:0",
    "write:1",
    "read-target:0",
    "read-target:1",
    "delete-credential:source-8",
    "read-credential:source-8",
    "delete-profile:source-8",
  ]);
  assert.deepEqual(fixture.deletedProfiles, ["source-8"]);
});

test("target write or readback failure never cleans an old duplicate", async () => {
  const secret = "fixture-sensitive-tail-12345678";
  const targets = new Map([[0, secret], [1, "sk-second"]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: secret },
  ]);

  for (const options of [{ failWriteIndex: 1 }, { mismatchReadIndex: 0 }]) {
    const fixture = transactionFixture(options);
    fixture.values.set("source-8", secret);
    await assert.rejects(
      executeFHLPoolSavePlan(targets, plan, fixture.transaction),
      (error) => {
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes(secret.slice(-8)), false);
        assert.equal(error.message.includes("sk-never-log-this"), false);
        return true;
      },
    );
    assert.equal(fixture.events.some((event) => event.startsWith("delete-credential:")), false);
    assert.deepEqual(fixture.deletedProfiles, []);
  }
});

test("credential cleanup and profile cleanup failures stop without testing or exposing secrets", async () => {
  const secret = "fixture-sensitive-tail-87654321";
  const targets = new Map([[0, secret]]);
  const plan = createFHLPoolSavePlan(targets, [
    { index: 7, profileId: "source-8", apiKey: secret },
  ]);

  for (const options of [{ failDeleteCredential: true }, { failDeleteProfile: true }]) {
    const fixture = transactionFixture(options);
    fixture.values.set("source-8", secret);
    await assert.rejects(
      executeFHLPoolSavePlan(targets, plan, fixture.transaction),
      (error) => {
        assert.match(error.message, /FHL8/);
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes(secret.slice(-8)), false);
        return true;
      },
    );
    if (options.failDeleteCredential) {
      assert.deepEqual(fixture.deletedProfiles, []);
    }
  }
});

test("confirmation cancellation can happen before the transaction performs any side effect", async () => {
  const secret = "fixture-cancelled-before-write";
  const plan = createFHLPoolSavePlan(new Map([[0, secret]]), [
    { index: 7, profileId: "source-8", apiKey: secret },
  ]);
  const fixture = transactionFixture();
  const confirmationAccepted = false;
  if (confirmationAccepted) {
    await executeFHLPoolSavePlan(new Map([[0, secret]]), plan, fixture.transaction);
  }
  assert.deepEqual(fixture.events, []);
  assert.deepEqual(fixture.deletedProfiles, []);
});
