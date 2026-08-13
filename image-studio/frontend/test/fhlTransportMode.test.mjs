import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = await import("../src/lib/providerPolicy.ts");
const profiles = await import("../src/lib/profiles.ts");
const fhlAPI = await import("../src/lib/fhlAPI.ts");

const fhlAPISource = readFileSync(new URL("../src/lib/fhlAPI.ts", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const profileActionsSource = readFileSync(new URL("../src/state/studioStore.profiles.ts", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../src/components/layout/AppHeader.tsx", import.meta.url), "utf8");
const quickProfileSource = readFileSync(new URL("../src/platform/android/AndroidQuickProfileSheet.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/platform/android/settings/AndroidSettingsPanel.tsx", import.meta.url), "utf8");
const settingsContainerSource = readFileSync(new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url), "utf8");
const upstreamConfigSource = readFileSync(new URL("../src/platform/android/upstream/useAndroidUpstreamConfig.ts", import.meta.url), "utf8");
const upstreamFormSource = readFileSync(new URL("../src/platform/android/upstream/AndroidUpstreamProfileForm.tsx", import.meta.url), "utf8");

function makeProfile(id, apiMode, patch = {}) {
  return {
    id,
    name: id,
    apiMode,
    requestPolicy: "openai",
    baseURL: profiles.FHL_BASE_URL,
    textModelID: profiles.FHL_TEXT_MODEL_ID,
    imageModelID: profiles.FHL_IMAGE_MODEL_ID,
    concurrencyLimit: 1,
    imagesNewAPICompat: apiMode === "images",
    createdAt: 1,
    ...patch,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("FHL transport preference defaults invalid and missing values to Images", () => {
  for (const value of [null, undefined, "", "images", "Responses", "damaged"]) {
    assert.equal(policy.normalizeFHLTransportModePreference(value), "images");
  }
  assert.equal(policy.normalizeFHLTransportModePreference("responses"), "responses");
});

test("an explicit Responses preference persists and restores exactly", () => {
  const storage = memoryStorage();
  const key = "test.fhlTransportMode";

  assert.equal(policy.readFHLTransportModePreference(storage, key), "images");
  policy.writeFHLTransportModePreference(storage, key, "responses");
  assert.equal(policy.readFHLTransportModePreference(storage, key), "responses");
  policy.writeFHLTransportModePreference(storage, key, "images");
  assert.equal(policy.readFHLTransportModePreference(storage, key), "images");

  assert.match(sharedSource, /gptcodex\.fhlTransportMode\.v1/);
  assert.match(sharedSource, /readFHLTransportModePreference\(localStorage, FHL_TRANSPORT_MODE_LS_KEY\)/);
  assert.match(sharedSource, /writeFHLTransportModePreference\(localStorage, FHL_TRANSPORT_MODE_LS_KEY, mode\)/);
});

test("only FHL image-generation profiles follow the global transport", () => {
  const images = makeProfile("images", "images");
  const slottedResponses = makeProfile("slot", "responses", { fhlImagesPoolSlot: 4 });
  const textResponses = makeProfile("text", "responses");
  const thirdParty = makeProfile("third-party", "responses", { baseURL: "https://example.invalid" });

  assert.equal(policy.effectiveProviderMode(images, "images", "responses"), "responses");
  assert.equal(policy.effectiveProviderMode(slottedResponses, "responses", "images"), "images");
  assert.equal(policy.effectiveProviderMode(textResponses, "responses", "images"), "responses");
  assert.equal(policy.effectiveProviderMode(thirdParty, "responses", "images"), "responses");
});

test("official FHL recognition matches the native pool URL boundary", () => {
  for (const baseURL of [
    "https://www.fhl.mom",
    "https://www.fhl.mom/",
    "https://www.fhl.mom/v1",
    "https://www.fhl.mom/v1/",
    "https://www.fhl.mom:443",
    "https://www.fhl.mom:443/v1",
    "https://WWW.FHL.MOM:443/v1",
  ]) {
    assert.equal(policy.isOfficialFHLProfile({ apiMode: "responses", baseURL }), true, baseURL);
  }
  for (const baseURL of [
    "http://www.fhl.mom",
    "https://fhl.mom",
    "https://www.fhl.mom.evil.test",
    "https://www.fhl.mom/v1/images",
    "https://www.fhl.mom/v%31",
    "https://www.fhl.mom?redirect=https://evil.test",
    "https://www.fhl.mom/#fragment",
    "https://user@www.fhl.mom",
    "https://www.fhl.mom:444/v1",
  ]) {
    assert.equal(policy.isOfficialFHLProfile({ apiMode: "responses", baseURL }), false, baseURL);
  }
});

test("text profiles and FHL pool profiles remain disjoint", () => {
  const textResponses = makeProfile("text", "responses");
  const explicitPortTextResponses = makeProfile("text-443", "responses", {
    baseURL: "https://www.fhl.mom:443/v1",
  });
  const slottedResponses = makeProfile("slot", "responses", { fhlImagesPoolSlot: 7 });
  const images = makeProfile("images", "images");

  assert.equal(profiles.isOfficialFHLTextProfile(textResponses), true);
  assert.equal(profiles.isOfficialFHLTextProfile(explicitPortTextResponses), true);
  assert.equal(profiles.isOfficialFHLPoolProfile(textResponses), false);
  assert.equal(profiles.isSelectableGenerationProfile(textResponses), false);
  assert.equal(profiles.isSelectableGenerationProfile(explicitPortTextResponses), false);
  assert.equal(profiles.isOfficialFHLTextProfile(slottedResponses), false);
  assert.equal(profiles.isOfficialFHLPoolProfile(slottedResponses), true);
  assert.equal(profiles.isSelectableGenerationProfile(slottedResponses), true);
  assert.equal(profiles.isOfficialFHLTextProfile(images), false);
  assert.equal(profiles.isOfficialFHLPoolProfile(images), true);
  assert.equal(profiles.isSelectableGenerationProfile(images), true);

  const restored = profiles.tryParseProfile(slottedResponses);
  assert.equal(restored?.apiMode, "responses");
  assert.equal(restored?.fhlImagesPoolSlot, 7);
  assert.equal(restored?.concurrencyLimit, profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT);

  assert.match(fhlAPISource, /store\.profiles\.find\(isOfficialFHLTextProfile\)/);
  assert.match(fhlAPISource, /isOfficialFHLPoolProfile\(profile\)/);
});

test("ensuring an Android text profile never activates it during create or reuse", async () => {
  const createCalls = [];
  const createActivations = [];
  const createStore = {
    profiles: [],
    activeProfileId: "generation-profile",
    async createProfile(input) {
      createCalls.push(input);
      return "text-created";
    },
    async updateProfile() {
      assert.fail("a missing text profile must be created instead of updated");
    },
    async setActiveProfile(id) {
      createActivations.push(id);
    },
  };

  assert.equal(
    await fhlAPI.ensureFHLResponsesProfile(createStore, { setActive: false }),
    "text-created",
  );
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].setActive, false);
  assert.deepEqual(createActivations, []);

  const existing = makeProfile("text-existing", "responses", {
    baseURL: "https://www.fhl.mom:443/v1",
  });
  const updateCalls = [];
  const reuseActivations = [];
  const reuseStore = {
    profiles: [existing],
    activeProfileId: "generation-profile",
    async createProfile() {
      assert.fail("an existing official text profile must be reused");
    },
    async updateProfile(id, patch) {
      updateCalls.push({ id, patch });
      return true;
    },
    async setActiveProfile(id) {
      reuseActivations.push(id);
    },
  };

  assert.equal(
    await fhlAPI.ensureFHLResponsesProfile(reuseStore, { setActive: false }),
    existing.id,
  );
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].id, existing.id);
  assert.deepEqual(reuseActivations, []);
});

test("Android selection surfaces and the store reject text-only profiles", () => {
  assert.match(storeSource, /const selectableProfiles = runtimePlatform\.isAndroid\s*\? profiles\.filter\(isSelectableGenerationProfile\)/);
  assert.match(profileActionsSource, /readRuntimePlatformState\(\)\.isAndroid && isOfficialFHLTextProfile\(profile\)/);
  assert.match(profileActionsSource, /nextList\.filter\(isSelectableGenerationProfile\)/);
  assert.match(headerSource, /const generationProfiles = profiles\.filter\(isSelectableGenerationProfile\);/);
  assert.match(quickProfileSource, /const generationProfiles = profiles\.filter\(isSelectableGenerationProfile\);/);
  assert.match(settingsSource, /const generationProfiles = profiles\.filter\(isSelectableGenerationProfile\);/);
  assert.match(settingsSource, /effectiveProviderMode\(profile, profile\.apiMode, fhlTransportMode\)/);
  assert.match(settingsContainerSource, /fhlTransportMode=\{fhlTransportMode\}/);
  assert.match(upstreamConfigSource, /ensureFHLResponsesProfile\(useStudioStore\.getState\(\), \{ setActive: false \}\)/);
  assert.match(upstreamConfigSource, /if \(isOfficialFHLTextProfile\(draft\)\)/);
  assert.match(upstreamFormSource, /fixedFHLTextProfile \? \(\s*<strong>文本专用<\/strong>/);
  assert.match(upstreamFormSource, /\{!fixedFHLTextProfile \? \(/);
  assert.match(upstreamFormSource, /onClick=\{\(\) => void onSaveAndSetActive\(\)\}/);
});
