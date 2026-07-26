import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const profiles = await import("../src/lib/profiles.ts");
const apiKey = await import("../src/lib/apiKey.ts");
const providerPolicy = await import("../src/lib/providerPolicy.ts");
const stateDir = path.resolve(import.meta.dirname, "../src/state");

function makeProfile(name) {
  return {
    id: name,
    name,
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    concurrencyLimit: 0,
    createdAt: 1,
  };
}

function makeOfficialFHLImagesProfile(id, overrides = {}) {
  return {
    id,
    name: id,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: profiles.FHL_BASE_URL,
    textModelID: "",
    imageModelID: profiles.FHL_IMAGE_MODEL_ID,
    concurrencyLimit: 4,
    continuousPoolEnabled: true,
    createdAt: 1,
    ...overrides,
  };
}

function makeConfigurationState(overrides = {}) {
  return {
    apiKey: "",
    apiMode: "responses",
    baseURL: "",
    profiles: [],
    ...overrides,
  };
}

test("desktop configuration gate keeps a blank state unconfigured", () => {
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState()),
    false,
  );
});

test("desktop configuration gate ignores a default FHL profile without credentials", () => {
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({
      profiles: [profiles.makeFHLResponsesProfile()],
    })),
    false,
  );
});

test("desktop configuration gate accepts current Responses and Images credentials", () => {
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({ apiKey: "memory-only", apiMode: "responses" })),
    true,
  );
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({ apiKey: "memory-only", apiMode: "images" })),
    true,
  );
});

test("desktop configuration gate accepts a RunningHub bridge URL without a local key", () => {
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({
      apiMode: "runninghub",
      baseURL: "http://127.0.0.1:8787",
    })),
    true,
  );
});

test("desktop configuration gate rejects an Images pool slot without a key hint", () => {
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({
      profiles: [makeOfficialFHLImagesProfile("slot-without-hint", { fhlImagesPoolSlot: 1 })],
    })),
    false,
  );
});

test("desktop configuration gate accepts an E2E-safe Images pool key hint", () => {
  const e2eHint = "last4:TEST";
  assert.equal(profiles.normalizeFHLImagesPoolKeyHint(e2eHint), "TEST");
  assert.equal(
    profiles.hasUsableFHLConfiguration(makeConfigurationState({
      profiles: [makeOfficialFHLImagesProfile("slot-with-hint", {
        fhlImagesPoolSlot: 1,
        fhlImagesPoolKeyHint: e2eHint,
      })],
    })),
    true,
  );
});

test("default profile names start from 配置1 even when 主配置 exists", () => {
  assert.equal(profiles.nextDefaultProfileName([makeProfile("主配置")]), "配置1");
});

test("default profile names use the first available numeric slot", () => {
  assert.equal(
    profiles.nextDefaultProfileName([
      makeProfile("主配置"),
      makeProfile("配置1"),
      makeProfile("配置3"),
    ]),
    "配置2",
  );
});

test("blank profiles use sequential default names", () => {
  const existing = [makeProfile("配置1")];
  assert.equal(profiles.makeBlankProfile("images", existing).name, "配置2");
});

test("new profiles default to 4 concurrency", () => {
  assert.equal(profiles.DEFAULT_CONCURRENCY_LIMIT, 4);
  assert.equal(profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, 5);
  assert.equal(profiles.makeFHLResponsesProfile().concurrencyLimit, 4);
  assert.equal(profiles.makeBlankProfile("responses").concurrencyLimit, 4);
});

test("FHL pool per-API concurrency normalizes and migrates legacy shared values", () => {
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(1), 1);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(2), 2);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(4), 4);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(5), 5);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(0), 5);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit(99), 5);
  assert.equal(profiles.normalizeFHLPoolPerAPIConcurrencyLimit("bad"), 4);

  assert.equal(profiles.resolveFHLPoolPerAPIConcurrencyLimit(4, 2), 4);
  assert.equal(profiles.resolveFHLPoolPerAPIConcurrencyLimit(null, 4), 4);
  assert.equal(profiles.resolveFHLPoolPerAPIConcurrencyLimit(null, 2), 2);
  assert.equal(profiles.resolveFHLPoolPerAPIConcurrencyLimit(null, 0), 5);
  assert.equal(profiles.resolveFHLPoolPerAPIConcurrencyLimit(null, null), 4);
});

test("FHL pool persistence keeps the legacy key only as a migration source", () => {
  const sharedSource = fs.readFileSync(path.join(stateDir, "studioStore.shared.ts"), "utf8");
  const storeSource = fs.readFileSync(path.join(stateDir, "studioStore.ts"), "utf8");

  assert.match(sharedSource, /fhlImagesPool\.perApiConcurrencyLimit\.v1/);
  assert.match(sharedSource, /LEGACY_FHL_POOL_SHARED_CONCURRENCY_LS_KEY/);
  assert.match(sharedSource, /loadStoredFHLPoolPerAPIConcurrencyLimit/);
  assert.match(sharedSource, /loadLegacyFHLPoolSharedConcurrencyLimit/);
  assert.match(sharedSource, /persistFHLPoolPerAPIConcurrencyLimit/);
  assert.match(storeSource, /storedFHLPoolPerAPILimit === null[\s\S]+loadLegacyFHLPoolSharedConcurrencyLimit/);
  assert.doesNotMatch(sharedSource, /removeItem\(LEGACY_FHL_POOL_SHARED_CONCURRENCY_LS_KEY\)/);
});

test("profile cap preserves existing over-limit data without allowing another profile", () => {
  const savedOverLimit = Array.from({ length: 11 }, (_, index) => makeProfile(`配置${index + 1}`));
  const atLimit = Array.from({ length: 10 }, (_, index) => makeProfile(`配置${index + 1}`));
  const belowLimit = Array.from({ length: 9 }, (_, index) => makeProfile(`配置${index + 1}`));

  assert.equal(profiles.hasUpstreamProfileCapacity(savedOverLimit, 0), true);
  assert.equal(profiles.hasUpstreamProfileCapacity(savedOverLimit), false);
  assert.equal(profiles.hasUpstreamProfileCapacity(atLimit), false);
  assert.equal(profiles.hasUpstreamProfileCapacity(belowLimit), true);
});


test("FHL Responses companion profile remains available", () => {
  const profile = profiles.makeFHLResponsesProfile();
  assert.equal(profile.name, "FHL-1 Responses");
  assert.equal(profile.apiMode, "responses");
  assert.equal(profile.baseURL, profiles.FHL_BASE_URL);
  assert.equal(profile.imageModelID, profiles.FHL_IMAGE_MODEL_ID);
  assert.equal(profile.imagesNewAPICompat, false);
});

test("FHL images companion profile uses the official images mode", () => {
  const profile = profiles.makeFHLImagesProfile();
  assert.equal(profile.name, "FHL-1 Images");
  assert.equal(profile.apiMode, "images");
  assert.equal(profile.baseURL, profiles.FHL_BASE_URL);
  assert.equal(profile.imageModelID, profiles.FHL_IMAGE_MODEL_ID);
  assert.equal(profile.imagesNewAPICompat, true);
});

test("FHL Images pool slots parse only official Images profiles with an integer 1..10 slot", () => {
  const valid = profiles.tryParseProfile({
    ...makeOfficialFHLImagesProfile("fhl-slot-3"),
    fhlImagesPoolSlot: 3,
  });
  const outOfRange = profiles.tryParseProfile({
    ...makeOfficialFHLImagesProfile("fhl-slot-invalid"),
    fhlImagesPoolSlot: 11,
  });
  const nonOfficial = profiles.tryParseProfile({
    ...makeOfficialFHLImagesProfile("custom-images", { baseURL: "https://example.invalid" }),
    fhlImagesPoolSlot: 2,
  });

  assert.equal(valid?.fhlImagesPoolSlot, 3);
  assert.equal(valid?.concurrencyLimit, profiles.FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT);
  assert.equal(outOfRange?.fhlImagesPoolSlot, undefined);
  assert.equal(nonOfficial?.fhlImagesPoolSlot, undefined);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(1), 1);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(10), 10);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(0), undefined);
  assert.equal(profiles.normalizeFHLImagesPoolSlot(1.5), undefined);
  assert.equal(profiles.normalizeFHLImagesPoolSlot("1"), undefined);
});

test("FHL Images pool projection respects saved slots and fills legacy profiles by createdAt then id", () => {
  const legacyB = makeOfficialFHLImagesProfile("legacy-b", { createdAt: 8 });
  const legacyA = makeOfficialFHLImagesProfile("legacy-a", { createdAt: 8 });
  const savedTenth = makeOfficialFHLImagesProfile("saved-tenth", {
    createdAt: 20,
    fhlImagesPoolSlot: 10,
  });
  const customImages = makeOfficialFHLImagesProfile("custom-images", {
    baseURL: "https://example.invalid",
  });
  const slots = profiles.mapFHLImagesProfilesToPoolSlots([
    savedTenth,
    customImages,
    legacyB,
    makeProfile("Responses profile"),
    legacyA,
  ]);

  assert.equal(slots.length, profiles.FHL_IMAGES_POOL_SLOT_COUNT);
  assert.equal(slots[0]?.id, "legacy-a");
  assert.equal(slots[1]?.id, "legacy-b");
  assert.equal(slots[9]?.id, "saved-tenth");
  assert.equal(slots.includes(customImages), false);
  assert.equal(legacyA.fhlImagesPoolSlot, undefined);
  assert.equal(legacyB.fhlImagesPoolSlot, undefined);
});

test("FHL Images slot projection leaves profiles beyond ten and advanced profiles intact", () => {
  const legacyProfiles = Array.from({ length: 12 }, (_, index) => (
    makeOfficialFHLImagesProfile(`legacy-${index}`, { createdAt: index })
  ));
  const slots = profiles.mapFHLImagesProfilesToPoolSlots(legacyProfiles);

  assert.deepEqual(
    slots.map((profile) => profile?.id),
    Array.from({ length: 10 }, (_, index) => `legacy-${index}`),
  );
  assert.equal(legacyProfiles.length, 12);
  assert.equal(legacyProfiles[10].fhlImagesPoolSlot, undefined);
});

test("duplicating an FHL Images profile never copies its stable pool slot", () => {
  const original = makeOfficialFHLImagesProfile("fhl-slot-4", { fhlImagesPoolSlot: 4 });
  const duplicate = profiles.duplicateProfile(original);

  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.fhlImagesPoolSlot, undefined);
  assert.equal(profiles.isFHLImagesPoolSlotAvailable([original], 4), false);
  assert.equal(profiles.isFHLImagesPoolSlotAvailable([original], 4, original.id), true);
});

test("APIMart profiles use the official docs API root", () => {
  assert.equal(profiles.APIMART_BASE_URL, "https://api.apimart.ai");
  const profile = profiles.makeBlankProfile("apimart");
  assert.equal(profile.apiMode, "apimart");
  assert.equal(profile.baseURL, profiles.APIMART_BASE_URL);
  assert.equal(profile.imageModelID, profiles.APIMART_IMAGE_MODEL_ID);
});

test("APIMart official default keeps legacy domain as a valid route", () => {
  assert.equal(profiles.APIMART_BASE_URL, "https://api.apimart.ai");
  assert.equal(profiles.APIMART_LEGACY_BASE_URL, "https://api.apib.ai");
  assert.equal(profiles.normalizeAPIMartBaseURL("https://api.apib.ai"), profiles.APIMART_LEGACY_BASE_URL);
  assert.equal(profiles.normalizeAPIMartBaseURL("https://api.apib.ai/v1"), profiles.APIMART_LEGACY_BASE_URL);
  assert.equal(profiles.normalizeAPIMartBaseURL("https://api.apimart.ai/v1"), profiles.APIMART_BASE_URL);
  assert.equal(profiles.isAPIMartOfficialBaseURL("https://api.apimart.ai/v1"), true);
  assert.equal(profiles.isAPIMartOfficialBaseURL("https://api.apib.ai/v1"), true);

  const parsed = profiles.tryParseProfile({
    id: "apimart-legacy",
    name: "APIMart",
    apiMode: "apimart",
    requestPolicy: "openai",
    baseURL: "https://api.apib.ai/v1",
    textModelID: "",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 6,
    createdAt: 1,
  });
  assert.ok(parsed);
  assert.equal(parsed.baseURL, profiles.APIMART_LEGACY_BASE_URL);
});

test("RunningHub blank profiles default to the local bridge", () => {
  const profile = profiles.makeBlankProfile("runninghub");
  assert.equal(profile.apiMode, "runninghub");
  assert.equal(profile.baseURL, profiles.RUNNINGHUB_BASE_URL);
  assert.equal(profile.imageModelID, profiles.RUNNINGHUB_DEFAULT_MODEL_ID);
  assert.match(profiles.apiModeLabel("runninghub"), /RunningHub/);
});

test("RunningHub profiles round-trip through parser with their model key intact", () => {
  const parsed = profiles.tryParseProfile({
    id: "runninghub-1",
    name: "RH-1 全能图像2",
    apiMode: "runninghub",
    requestPolicy: "openai",
    baseURL: "http://127.0.0.1:8117",
    textModelID: "",
    imageModelID: "image_g2",
    concurrencyLimit: 2,
    createdAt: 1,
  });
  assert.ok(parsed);
  assert.equal(parsed.apiMode, "runninghub");
  assert.equal(parsed.imageModelID, "image_g2");
  assert.equal(parsed.baseURL, "http://127.0.0.1:8117");
});

test("API key input accepts APIMart env and bearer forms without loose extraction", () => {
  assert.equal(apiKey.normalizeAPIKeyInput("APIMART_API_KEY=sk-apimart123456"), "sk-apimart123456");
  assert.equal(apiKey.normalizeAPIKeyInput("Bearer sk-bearer123456"), "sk-bearer123456");
  assert.equal(apiKey.normalizeAPIKeyInput("  sk-direct123456  "), "sk-direct123456");
  assert.throws(() => apiKey.validateAPIKeyForHeader("说明 sk-apimart123456"), /API Key/);
  assert.throws(() => apiKey.validateAPIKeyForHeader("APIMART_API_KEY=sk-good123456\nEXTRA=1"), /API Key/);
});

test("bootstrap defaults fresh FHL setup to Images without rewriting saved profiles", () => {
  const storeSource = fs.readFileSync(path.join(stateDir, "studioStore.ts"), "utf8");
  assert.equal(providerPolicy.isOfficialFHLProfile({ apiMode: "images", baseURL: `${profiles.FHL_BASE_URL}/` }), true);
  assert.ok(storeSource.includes('const localFHLAPIMode: APIMode = localFHLConfig?.apiMode || "images";'));
  assert.ok(storeSource.includes('makeFHLImagesProfile()'));
  assert.ok(storeSource.includes('if (fhlProfileId && localFHLConfig)'));
  assert.ok(storeSource.includes("apiMode: localFHLAPIMode"));
  assert.ok(storeSource.includes("requestPolicy: localFHLRequestPolicy"));
  assert.ok(storeSource.includes('imagesNewAPICompat: localFHLAPIMode === "images"'));
  assert.match(storeSource, /!fhlProfileId[\s\S]{0,160}hasUpstreamProfileCapacity\(profiles\)/);
});

test("profile create and update preserve FHL-like API mode", () => {
  const profilesSource = fs.readFileSync(path.join(stateDir, "studioStore.profiles.ts"), "utf8");
  assert.ok(profilesSource.includes("function isFHLProfileConfig"));
  assert.ok(profilesSource.includes('isOfficialFHLProfile({ apiMode: "images", baseURL: profile.baseURL })'));
  assert.ok(profilesSource.includes("imageModelID.trim() === ProviderPolicy.fhl.imageModelID"));
  assert.doesNotMatch(profilesSource, /apiMode:\s*"images",\s*requestPolicy:\s*"openai"/);
  assert.ok(profilesSource.includes('imagesNewAPICompat: rawProfile.apiMode === "images"'));
  assert.ok(profilesSource.includes('imagesNewAPICompat: rawNext.apiMode === "images"'));
  assert.ok(profilesSource.includes("const fhlImagesPoolSlot = isOfficialFHLImagesProfile"));
  assert.ok(profilesSource.includes("const nextFHLImagesPoolSlot = isOfficialFHLImagesProfile"));
  assert.ok(profilesSource.includes("!isFHLImagesPoolSlotAvailable(list, next.fhlImagesPoolSlot, id)"));
});

