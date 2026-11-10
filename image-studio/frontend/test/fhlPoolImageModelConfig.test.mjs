import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: frontendRoot,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const {
  buildFHLPoolModelValidationSignature,
  buildFHLPoolModelAvailability,
  prepareFHLPoolImageModelConfig,
  selectConsistentFHLPoolImageModel,
} = await server.ssrLoadModule(
  "/src/platform/android/upstream/fhlPoolImageModelConfig.ts",
);
const {
  intersectFHLImageModelCatalogs,
  normalizeImageModelCatalog,
} = await server.ssrLoadModule("/src/lib/fhlImageModels.ts");
test.after(async () => server.close());

function makePoolProfile(id, slot, patch = {}) {
  return {
    id,
    name: `FHL${slot} Images`,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: "https://www.fhl.mom",
    textModelID: "",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 4,
    continuousPoolEnabled: true,
    imagesNewAPICompat: true,
    fhlImagesPoolSlot: slot,
    createdAt: slot,
    lastUsedAt: slot,
    ...patch,
  };
}

function catalog(models, fetchedAt) {
  return {
    ...normalizeImageModelCatalog(models, "https://www.fhl.mom", "fhl", fetchedAt),
    validationId: `catalog-receipt-${fetchedAt ?? "now"}`,
  };
}

test("validation signature is stable, ordered, and never includes credential contents", () => {
  const targets = [
    {
      profileId: "slot-2",
      slotNumber: 2,
      exists: true,
      enabled: true,
      credentialPresent: true,
      baseURL: "https://www.fhl.mom/v1/",
      provider: "fhl",
    },
    {
      profileId: "slot-1",
      slotNumber: 1,
      exists: true,
      enabled: true,
      credentialPresent: false,
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
    },
  ];
  const first = buildFHLPoolModelValidationSignature(targets, 3);
  const reversed = buildFHLPoolModelValidationSignature([...targets].reverse(), 3);
  assert.equal(first, reversed);
  assert.doesNotMatch(first, /sk-|secret|apiKey/i);

  for (const patch of [
    { slotNumber: 3 },
    { profileId: "slot-9" },
    { exists: false },
    { enabled: false },
    { credentialPresent: false },
    { baseURL: "https://other.example" },
    { provider: "other" },
  ]) {
    assert.notEqual(
      buildFHLPoolModelValidationSignature(
        [{ ...targets[0], ...patch }, targets[1]],
        3,
      ),
      first,
    );
  }
  assert.notEqual(buildFHLPoolModelValidationSignature(targets, 4), first);
});

test("current pool model is preselected only when every target has the same non-empty model", () => {
  const first = makePoolProfile("slot-1", 1, { imageModelID: "gpt-image-2.5-flare" });
  const second = makePoolProfile("slot-2", 2, { imageModelID: "gpt-image-2.5-flare" });
  assert.equal(
    selectConsistentFHLPoolImageModel([first, second], [first.id, second.id]),
    "gpt-image-2.5-flare",
  );
  assert.equal(
    selectConsistentFHLPoolImageModel([first, { ...second, imageModelID: "" }], [first.id, second.id]),
    "",
  );
  assert.equal(
    selectConsistentFHLPoolImageModel([first, { ...second, imageModelID: "gpt-image-2" }], [first.id, second.id]),
    "",
  );
  assert.equal(selectConsistentFHLPoolImageModel([first], [first.id, second.id]), "");
});

test("unified pool model preparation checks only enabled slots with real credentials", async () => {
  const first = makePoolProfile("slot-1", 1, { fhlImagesPoolKeyHint: "sk-...1111" });
  const disabled = makePoolProfile("slot-2", 2, {
    continuousPoolEnabled: false,
    fhlImagesPoolKeyHint: "sk-...2222",
  });
  const empty = makePoolProfile("slot-3", 3);
  const legacyWithoutHint = makePoolProfile("slot-4", 4);
  const keys = new Map([
    [first.id, "sk-fixture-placeholder-first-12345678"],
    [disabled.id, "sk-fixture-placeholder-disabled-12345678"],
    [legacyWithoutHint.id, "sk-fixture-placeholder-fourth-12345678"],
  ]);
  const credentialReads = [];
  const catalogFetches = [];

  const prepared = await prepareFHLPoolImageModelConfig({
    profiles: [disabled, empty, legacyWithoutHint, first],
    readCredential: async (profileId) => {
      credentialReads.push(profileId);
      return keys.get(profileId) ?? "";
    },
    fetchCatalog: async (profile, apiKey) => {
      catalogFetches.push({ profileId: profile.id, apiKey });
      return profile.id === first.id
        ? catalog([
            { id: "gpt-image-2" },
            { id: "gpt-image-2.5-flare", supportsTransparency: true },
          ], 1000)
        : catalog([
            { id: "gpt-image-2.5-flare", supportsTransparency: false },
            { id: "gpt-image-2.5-sunburst" },
          ], 2000);
    },
    sharedFetchedAt: 3000,
  });

  assert.deepEqual(credentialReads, [first.id, empty.id, legacyWithoutHint.id]);
  assert.deepEqual(catalogFetches.map(({ profileId }) => profileId), [first.id, legacyWithoutHint.id]);
  assert.deepEqual(catalogFetches.map(({ apiKey }) => apiKey), [
    "sk-fixture-placeholder-first-12345678",
    "sk-fixture-placeholder-fourth-12345678",
  ]);
  assert.deepEqual(prepared.targetProfileIds, [first.id, legacyWithoutHint.id]);
  assert.deepEqual(prepared.targetSlotNumbers, [1, 4]);
  assert.equal(prepared.catalog.fetchedAt, 3000);
  assert.deepEqual(prepared.catalog.models.map(({ id }) => id), ["gpt-image-2.5-flare"]);
  assert.equal(prepared.catalog.models[0].supportsTransparency, false);
  assert.doesNotMatch(JSON.stringify(prepared), /sk-fixture-placeholder-(?:first|fourth|disabled)/);
});

test("unified pool model preparation fails closed when a Keystore read fails", async () => {
  const first = makePoolProfile("slot-1", 1);
  const second = makePoolProfile("slot-2", 2);
  const leakedKey = "sk-fixture-placeholder-read-failure-12345678";
  let fetchCount = 0;
  let thrown;

  try {
    await prepareFHLPoolImageModelConfig({
      profiles: [first, second],
      readCredential: async (profileId) => {
        if (profileId === second.id) throw new Error(`Keystore failed: ${leakedKey}`);
        return "sk-fixture-placeholder-first-12345678";
      },
      fetchCatalog: async () => {
        fetchCount += 1;
        return catalog([{ id: "gpt-image-2" }], 1000);
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.message, "FHL2 无法读取已保存凭据，统一配置未生效。");
  assert.doesNotMatch(String(thrown?.message), new RegExp(leakedKey));
  assert.equal(fetchCount, 0, "directory GET must not start after an incomplete credential scan");
});

test("unified pool model preparation hides provider failures and returns no partial result", async () => {
  const first = makePoolProfile("slot-1", 1);
  const second = makePoolProfile("slot-2", 2);
  const leakedKey = "sk-fixture-placeholder-provider-failure-12345678";
  const rawProviderBody = "upstream 503 raw-provider-channel-detail";
  const fetchedProfiles = [];
  let result;
  let thrown;

  try {
    result = await prepareFHLPoolImageModelConfig({
      profiles: [first, second],
      readCredential: async (profileId) => (
        profileId === first.id ? "sk-fixture-placeholder-first-12345678" : leakedKey
      ),
      fetchCatalog: async (profile) => {
        fetchedProfiles.push(profile.id);
        if (profile.id === second.id) throw new Error(`${rawProviderBody}; ${leakedKey}`);
        return catalog([{ id: "gpt-image-2.5-flare" }], 1000);
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(result, undefined);
  assert.deepEqual(fetchedProfiles, [first.id, second.id]);
  assert.equal(thrown?.message, "FHL2 模型目录验证失败，统一配置未生效。");
  assert.doesNotMatch(String(thrown?.message), /sk-provider|raw-provider|503/i);
});

test("a stale key hint without a Keystore value blocks unified validation", async () => {
  const profile = makePoolProfile("slot-5", 5, { fhlImagesPoolKeyHint: "sk-...5555" });
  await assert.rejects(
    prepareFHLPoolImageModelConfig({
      profiles: [profile],
      readCredential: async () => "",
      fetchCatalog: async () => catalog([{ id: "gpt-image-2" }], 1000),
    }),
    (error) => error?.message === "FHL5 已保存凭据不可用，统一配置未生效。",
  );
});

test("unified pool model preparation skips network work when no enabled credential exists", async () => {
  const disabled = makePoolProfile("slot-disabled", 1, { continuousPoolEnabled: false });
  const empty = makePoolProfile("slot-empty", 2);
  let fetchCount = 0;
  await assert.rejects(
    prepareFHLPoolImageModelConfig({
      profiles: [disabled, empty],
      readCredential: async () => "",
      fetchCatalog: async () => {
        fetchCount += 1;
        return catalog([{ id: "gpt-image-2" }], 1000);
      },
    }),
    (error) => error?.message === "没有已配置且启用的 FHL Images 槽位可验证。",
  );
  assert.equal(fetchCount, 0);
});

test("invalid saved credentials fail closed before any catalog request", async () => {
  const profile = makePoolProfile("slot-invalid", 3, { fhlImagesPoolKeyHint: "sk-...3333" });
  let fetchCount = 0;
  await assert.rejects(
    prepareFHLPoolImageModelConfig({
      profiles: [profile],
      readCredential: async () => "not a valid api key",
      fetchCatalog: async () => {
        fetchCount += 1;
        return catalog([{ id: "gpt-image-2" }], 1000);
      },
    }),
    (error) => error?.message === "FHL3 已保存凭据格式无效，统一配置未生效。",
  );
  assert.equal(fetchCount, 0);
});

test("base URL and provider mismatches fail closed before catalog requests", async () => {
  assert.throws(
    () => intersectFHLImageModelCatalogs([
      catalog([{ id: "gpt-image-2" }], 1000),
      normalizeImageModelCatalog([{ id: "gpt-image-2" }], "https://other.example", "fhl", 1000),
    ]),
    (error) => error?.message === "已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。",
  );

  const first = makePoolProfile("slot-first", 1);
  const second = makePoolProfile("slot-second", 2, { provider: "other" });
  let fetchCount = 0;
  const readCredential = async () => "sk-fixture-placeholder-valid-12345678";
  const fetchCatalog = async () => {
    fetchCount += 1;
    return catalog([{ id: "gpt-image-2" }], 1000);
  };

  await assert.rejects(
    prepareFHLPoolImageModelConfig({ profiles: [first, second], readCredential, fetchCatalog }),
    (error) => error?.message === "已配置且启用的 FHL Images 槽位必须使用同一 Base URL 和 provider。",
  );
  assert.equal(fetchCount, 0);
});

test("pool model availability exposes a safe union while keeping only the common intersection selectable", () => {
  const first = catalog([
    { id: "gpt-image-2.6-flare", supportsTransparency: true },
    { id: "gpt-image-2.7", supportsTransparency: true },
    { id: "gpt-image-2.5", available: false, disabledReason: "不可调用的模糊模型别名" },
  ], 1000);
  const second = catalog([
    { id: "gpt-image-2.6-flare", supportsTransparency: false },
    { id: "gpt-image-2.5", available: false, disabledReason: "不可调用的模糊模型别名" },
  ], 1000);
  const availability = buildFHLPoolModelAvailability([first, second], [1, 4]);
  const flare = availability.find((model) => model.id === "gpt-image-2.6-flare");
  const future = availability.find((model) => model.id === "gpt-image-2.7");
  const alias = availability.find((model) => model.id === "gpt-image-2.5");
  assert.equal(flare?.selectable, true);
  assert.equal(flare?.supportsTransparency, false);
  assert.equal(future?.selectable, false);
  assert.deepEqual(future?.missingSlotNumbers, [4]);
  assert.match(future?.disabledReason ?? "", /FHL4/);
  assert.equal(alias?.selectable, false);
  assert.match(alias?.disabledReason ?? "", /模糊模型别名/);
});

test("no common model keeps a diagnostic union and returns an empty commit catalog", async () => {
  const first = makePoolProfile("slot-1", 1);
  const second = makePoolProfile("slot-2", 2);
  const prepared = await prepareFHLPoolImageModelConfig({
    profiles: [first, second],
    readCredential: async () => "sk-fixture-placeholder-valid-12345678",
    fetchCatalog: async (profile) => catalog([
      { id: profile.id === first.id ? "gpt-image-2.6-flare" : "gpt-image-2.7" },
    ], 1000),
    sharedFetchedAt: 3000,
  });
  assert.deepEqual(prepared.catalog.models, []);
  assert.equal(prepared.availability.length, 2);
  assert.ok(prepared.availability.every((model) => !model.selectable));
});
