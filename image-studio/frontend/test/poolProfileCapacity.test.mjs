import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const profiles = await import("../src/lib/profiles.ts");

test("FHL Images pool key hints retain only a redacted prefix and suffix", () => {
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint("  demo-key_9zQ7  "), "9zQ7");
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint("sk-d16abcdef7685"), "sk-d16...7685");
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint("msk-xyZ...9zQ7"), "msk-xyZ...9zQ7");
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint("abc"), undefined);
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint(null), undefined);

  const parsedPoolProfile = profiles.tryParseProfile({
    id: "pool-1",
    name: "FHL-1 Images",
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: profiles.FHL_BASE_URL,
    textModelID: "",
    imageModelID: profiles.FHL_IMAGE_MODEL_ID,
    concurrencyLimit: 4,
    fhlImagesPoolSlot: 1,
    fhlImagesPoolKeyHint: "sk-d16...7685",
    createdAt: 1,
  });
  assert.equal(parsedPoolProfile?.fhlImagesPoolKeyHint, "sk-d16...7685");
  assert.equal(parsedPoolProfile?.concurrencyLimit, profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT);

  const parsedNonPoolProfile = profiles.tryParseProfile({
    ...parsedPoolProfile,
    id: "custom-1",
    baseURL: "https://example.invalid",
  });
  assert.equal(parsedNonPoolProfile?.fhlImagesPoolKeyHint, undefined);

  const duplicate = profiles.duplicateProfile(parsedPoolProfile);
  assert.equal(duplicate.fhlImagesPoolKeyHint, undefined);
});

test("an unused official Images pool slot can be created after the generic cap", async () => {
  const genericProfiles = Array.from({ length: 10 }, (_, index) => ({
    id: `generic-${index}`,
    name: `配置${index}`,
    apiMode: "responses",
    baseURL: "https://example.invalid",
  }));
  const occupiedPoolSlot = {
    id: "pool-1",
    name: "FHL-1 Images",
    apiMode: "images",
    baseURL: profiles.FHL_BASE_URL,
    fhlImagesPoolSlot: 1,
  };

  assert.equal(profiles.hasUpstreamProfileCapacity(genericProfiles), false);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity(genericProfiles, 1), true);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity([...genericProfiles, occupiedPoolSlot], 1), false);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity(genericProfiles, 11), false);

  const legacyImagesProfile = {
    ...occupiedPoolSlot,
    id: "legacy-images",
    fhlImagesPoolSlot: undefined,
    createdAt: 1,
  };
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity([legacyImagesProfile], 1), false);
  assert.equal(profiles.hasFHLImagesPoolSlotCapacity([legacyImagesProfile], 2), true);

  const actionSource = readFileSync(
    path.resolve(import.meta.dirname, "../src/state/studioStore.profiles.ts"),
    "utf8",
  );
  assert.match(actionSource, /const fhlImagesPoolSlot = isOfficialFHLImagesProfile/);
  assert.match(actionSource, /if \(fhlImagesPoolSlot !== undefined\) \{[\s\S]*hasFHLImagesPoolSlotCapacity/);
  assert.match(actionSource, /else if \(!hasUpstreamProfileCapacity\(list\)\)/);
  assert.match(actionSource, /fhlImagesPoolKeyHint: fhlImagesPoolSlot !== undefined/);
  assert.match(actionSource, /const nextFHLImagesPoolKeyHint = nextFHLImagesPoolSlot !== undefined/);
});
