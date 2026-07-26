import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const harnessSource = await readFile(new URL("../src/app/dev/e2eHarness.ts", import.meta.url), "utf8");

// The slot simulator is deliberately pure. Leave the unrelated continuous-pool
// dependency inert while executing the exported E2E-only fixture in Node.
const isolatedHarnessSource = [
  "const selectNextContinuousPoolProfile = () => ({ profile: null, nextCursor: 0 });",
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
const { runE2EImagesPoolSlotSimulation } = harnessModule;

test("memory-only Images pool slot simulation always returns ten rows and preserves blank saved slots", () => {
  const result = runE2EImagesPoolSlotSimulation();

  assert.equal(result.memoryOnly, true);
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    tenRows: true,
    blankNewSlotsDoNotCreate: true,
    savedBlankKeepsProfile: true,
    legacyMapping: true,
    capRespected: true,
    deleteGuard: true,
  });
  assert.equal(result.initialRows.length, 10);
  assert.equal(result.rows.length, 10);
  assert.equal(result.initialImagesPoolProfileCount, 3);
  assert.deepEqual(result.initialRows.slice(0, 4).map((row) => [row.slot, row.profileId, row.origin]), [
    [1, "e2e-slot-legacy-alpha", "saved"],
    [2, "e2e-slot-legacy-running", "saved"],
    [3, "e2e-slot-pinned", "saved"],
    [4, undefined, "empty"],
  ]);
  assert.equal(result.rows[0].profileId, "e2e-slot-legacy-alpha");
  assert.equal(result.rows[3].profileId, "e2e-created-slot-4");
  assert.equal(result.rows[3].origin, "created");
  assert.equal(result.rows[3].keyHint, "last4:0004");
  assert.deepEqual(result.createdProfileIds, ["e2e-created-slot-4"]);
  assert.deepEqual(result.updatedProfileIds, []);
  assert.deepEqual(result.blockedCreateSlots, []);
  assert.deepEqual(result.persistedSlotAssignments, {
    "e2e-slot-legacy-alpha": 1,
    "e2e-slot-legacy-running": 2,
    "e2e-slot-pinned": 3,
    "e2e-created-slot-4": 4,
  });
  assert.deepEqual(result.delete, {
    slot: 2,
    profileId: "e2e-slot-legacy-running",
    status: "blocked_running",
  });
  assert.ok(result.profiles.some((profile) => profile.id === "e2e-slot-legacy-running"));
  assert.ok(result.rows.slice(4).every((row) => row.origin === "empty"));
});

test("slot fixture maps legacy Images profiles deterministically and accepts only safe metadata", () => {
  const result = runE2EImagesPoolSlotSimulation({
    profiles: [
      {
        id: "pinned",
        name: "Pinned",
        apiMode: "images",
        officialImages: true,
        fhlImagesPoolSlot: 2,
        createdAt: 30,
      },
      {
        id: "legacy-later",
        name: "Legacy Later",
        apiMode: "images",
        officialImages: true,
        createdAt: 20,
      },
      {
        id: "legacy-first",
        name: "Legacy First",
        apiMode: "images",
        officialImages: true,
        createdAt: 10,
      },
      {
        id: "responses-excluded",
        name: "Responses",
        apiMode: "responses",
        officialImages: false,
        createdAt: 1,
      },
    ],
    slotEdits: [
      { slot: 1, newValuePresent: false },
      { slot: 4, newValuePresent: true, keyHint: "last4:ABCD" },
    ],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.initialRows.slice(0, 4).map((row) => row.profileId), [
    "legacy-first",
    "pinned",
    "legacy-later",
    undefined,
  ]);
  assert.equal(result.rows[0].profileId, "legacy-first");
  assert.equal(result.rows[3].origin, "created");
  assert.deepEqual(result.createdProfileIds, ["e2e-created-slot-4"]);
  assert.deepEqual(result.persistedSlotAssignments, {
    "legacy-first": 1,
    pinned: 2,
    "legacy-later": 3,
    "e2e-created-slot-4": 4,
  });
  assert.equal(result.rows[3].keyHint, "last4:ABCD");
  assert.throws(() => runE2EImagesPoolSlotSimulation({
    profiles: [{
      id: "unsafe",
      name: "Unsafe",
      apiMode: "images",
      officialImages: true,
      createdAt: 1,
      credential: "not-accepted",
    }],
  }), /Unsupported E2E Images pool simulation field/);
});

test("legacy general profiles do not consume the ten independent Images pool slots", () => {
  const profiles = Array.from({ length: 11 }, (_, index) => ({
    id: `legacy-${index + 1}`,
    name: `Legacy ${index + 1}`,
    apiMode: "responses",
    officialImages: false,
    createdAt: index + 1,
  }));
  const result = runE2EImagesPoolSlotSimulation({
    profiles,
    slotEdits: [{ slot: 1, newValuePresent: true }],
  });

  assert.equal(result.initialProfileCount, 11);
  assert.equal(result.initialImagesPoolProfileCount, 0);
  assert.equal(result.profiles.length, 12);
  assert.deepEqual(result.createdProfileIds, ["e2e-created-slot-1"]);
  assert.deepEqual(result.blockedCreateSlots, []);
  assert.equal(result.rows[0].origin, "created");
  assert.equal(result.checks.capRespected, true);
  assert.equal(result.passed, true);
});

test("slot fixture permits explicit deletion only after the running-task guard is clear", () => {
  const result = runE2EImagesPoolSlotSimulation({
    profiles: [{
      id: "deletable",
      name: "Deletable",
      apiMode: "images",
      officialImages: true,
      fhlImagesPoolSlot: 1,
      createdAt: 1,
      running: false,
    }],
    slotEdits: [],
    deleteSlot: 1,
  });

  assert.equal(result.delete.status, "deleted");
  assert.equal(result.delete.profileId, "deletable");
  assert.equal(result.profiles.length, 0);
  assert.equal(result.rows[0].origin, "empty");
  assert.equal(result.checks.deleteGuard, true);
  assert.equal(result.passed, true);
});

test("slot fixture command remains gated to --e2e-only", () => {
  assert.match(harnessSource, /runImagesPoolSlotSimulation/);
  assert.match(harnessSource, /Images pool slot simulation is only available in --e2e-only mode/);
  assert.match(harnessSource, /status\.e2eOnly === true[\s\S]{0,360}runImagesPoolSlotSimulation/);
});
