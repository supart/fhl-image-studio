import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profiles = await import("../src/lib/profiles.ts");
const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const profileActionsSource = readFileSync(new URL("../src/state/studioStore.profiles.ts", import.meta.url), "utf8");

function makeImagesProfile(id, patch = {}) {
  return {
    id,
    name: id,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: profiles.FHL_BASE_URL,
    textModelID: "",
    imageModelID: profiles.FHL_IMAGE_MODEL_ID,
    concurrencyLimit: profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT,
    continuousPoolEnabled: true,
    imagesNewAPICompat: true,
    createdAt: 1,
    ...patch,
  };
}

test("Android FHL Images pool exposes ten slots with four runs per slot", () => {
  assert.equal(profiles.FHL_IMAGES_POOL_SLOT_COUNT, 10);
  assert.equal(profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, 4);
});

test("pool key metadata is always redacted", () => {
  const hint = profiles.normalizeFHLImagesPoolKeyHint("sk-abcdef123456");
  assert.equal(hint, "sk-abc...3456");
  assert.equal(hint.includes("abcdef123456"), false);
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint("abc"), undefined);
});

test("pool slot parser accepts only official FHL Images slots 1 through 10", () => {
  const parsed = profiles.tryParseProfile(makeImagesProfile("slot-4", {
    fhlImagesPoolSlot: 4,
    fhlImagesPoolKeyHint: "sk-abc...3456",
    concurrencyLimit: 99,
  }));
  const nonOfficial = profiles.tryParseProfile(makeImagesProfile("custom", {
    baseURL: "https://example.invalid",
    fhlImagesPoolSlot: 4,
    fhlImagesPoolKeyHint: "sk-abc...3456",
  }));

  assert.equal(parsed?.fhlImagesPoolSlot, 4);
  assert.equal(parsed?.concurrencyLimit, 4);
  assert.equal(nonOfficial?.fhlImagesPoolSlot, undefined);
  assert.equal(nonOfficial?.fhlImagesPoolKeyHint, undefined);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(0), undefined);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(10), 10);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(11), undefined);
});

test("legacy Images profiles map deterministically without mutating their saved data", () => {
  const legacyB = makeImagesProfile("legacy-b", { createdAt: 8 });
  const legacyA = makeImagesProfile("legacy-a", { createdAt: 8 });
  const fixed = makeImagesProfile("fixed", { createdAt: 2, fhlImagesPoolSlot: 10 });
  const slots = profiles.mapFHLImagesProfilesToPoolSlots([fixed, legacyB, legacyA]);

  assert.equal(slots.length, 10);
  assert.equal(slots[0]?.id, "legacy-a");
  assert.equal(slots[1]?.id, "legacy-b");
  assert.equal(slots[9]?.id, "fixed");
  assert.equal(legacyA.fhlImagesPoolSlot, undefined);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity([legacyA], 1), false);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity([legacyA], 2), true);
});

test("conditional activation preserves a usable active profile and otherwise picks first successful slot", () => {
  const first = makeImagesProfile("first", { fhlImagesPoolSlot: 1 });
  const second = makeImagesProfile("second", { fhlImagesPoolSlot: 2 });
  const input = {
    profiles: [first, second],
    activeProfileId: "first",
    successfulProfileIds: ["second", "first"],
  };

  assert.equal(profiles.chooseFHLImagesPoolActivationTarget({ ...input, activeProfileReady: true }), null);
  assert.equal(profiles.chooseFHLImagesPoolActivationTarget({ ...input, activeProfileReady: false }), "first");
  assert.equal(profiles.chooseFHLImagesPoolActivationTarget({
    ...input,
    activeProfileId: "",
    activeProfileReady: false,
    successfulProfileIds: ["second"],
  }), "second");
  assert.equal(profiles.chooseFHLImagesPoolActivationTarget({
    ...input,
    activeProfileReady: false,
    successfulProfileIds: [],
  }), null);
  assert.equal(profiles.chooseFHLImagesPoolActivationTarget({
    ...input,
    activeProfileReady: true,
    testedProfileIds: ["first", "second"],
    successfulProfileIds: ["second"],
  }), "second");
});

test("FHL Responses candidate matching never selects an Images pool slot", () => {
  const images = makeImagesProfile("fhl-slot-1", { fhlImagesPoolSlot: 1 });
  const responses = {
    ...images,
    id: "fhl-responses",
    apiMode: "responses",
    fhlImagesPoolSlot: undefined,
  };

  assert.equal(profiles.isOfficialFHLResponsesProfile(images), false);
  assert.equal(profiles.isOfficialFHLResponsesProfile(responses), true);
});

test("duplicating a pool profile clears stable slot metadata", () => {
  const cloned = profiles.duplicateProfile(makeImagesProfile("source", {
    fhlImagesPoolSlot: 3,
    fhlImagesPoolKeyHint: "sk-abc...3456",
  }));
  assert.equal(cloned.fhlImagesPoolSlot, undefined);
  assert.equal(cloned.fhlImagesPoolKeyHint, undefined);
});

test("profile CRUD persists pool metadata and fixes pool concurrency", () => {
  assert.match(profileActionsSource, /fhlImagesPoolSlot\?:\s*number/);
  assert.match(profileActionsSource, /FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT/);
  assert.match(profileActionsSource, /normalizeFHLImagesPoolKeyHint\(input\.fhlImagesPoolKeyHint \?\? input\.apiKey\)/);
  assert.match(profileActionsSource, /isFHLImagesPoolSlotAvailable\(list, nextFHLImagesPoolSlot, id\)/);
});

test("target profile testing reads its own credential without switching active profile", () => {
  const block = storeSource.match(/testProfileConnection:\s*async \(profileId\) => \{[\s\S]*?\r?\n\s*\},\r?\n\r?\n\s*testAPIKey:/)?.[0] ?? "";
  assert.match(block, /GetStoredAPIKey\(keyringUserFor\(profile\.id\)\)/);
  assert.match(block, /profile\.id === s\.activeProfileId \? s\.apiKey\.trim\(\) : ""/);
  assert.match(block, /profile\.apiMode/);
  assert.doesNotMatch(block, /setActiveProfile/);
});

test("Android bootstrap preserves Images slots and text tools require FHL Responses", () => {
  assert.match(storeSource, /localFHLConfig\?\.apiMode \?\? profile\.apiMode/);
  assert.match(storeSource, /profile\.fhlImagesPoolSlot === undefined/);
  assert.match(storeSource, /isOfficialFHLTextProfile/);
  assert.doesNotMatch(storeSource, /activeStateIsFHLResponses/);
});
