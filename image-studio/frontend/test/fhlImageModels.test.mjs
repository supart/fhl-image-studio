import assert from "node:assert/strict";
import test from "node:test";

const models = await import("../src/lib/fhlImageModels.ts");
const profiles = await import("../src/lib/profiles.ts");

function installStorage() {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  return { values, restore: () => { globalThis.localStorage = previous; } };
}

test("image catalog accepts dynamic GPT Image 2.x IDs and keeps fuzzy aliases disabled", () => {
  const catalog = models.normalizeImageModelCatalog([
    { id: "gpt-image-2" },
    { id: "gpt-image-2.6" },
    { id: "gpt-image-2.7-sunburst" },
    { id: "gpt-image-2.5-flare" },
    { id: "gpt-image-2.5-sunburst", supportsTransparency: true },
    { id: "gpt-image-2.5" },
    { id: "GPT-IMAGE-2.5" },
    { id: "gpt-image-1" },
    { id: "gpt-5.5" },
    { id: "gpt-image-2.5-flare" },
    { id: "bad\u0000model" },
    { id: "gpt-image-2.6\u0085bad" },
    { id: `gpt-image-${"x".repeat(140)}` },
  ], "https://provider.invalid/v1", "fhl", 1234);

  assert.deepEqual(catalog.models.map((model) => model.id), [
    "gpt-image-2",
    "gpt-image-2.6",
    "gpt-image-2.7-sunburst",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5",
    "gpt-image-1",
  ]);
  assert.equal(catalog.models[0].supportsTransparency, false);
  assert.equal(catalog.models[1].supportsTransparency, true);
  assert.equal(catalog.models[4].available, true);
  assert.equal(catalog.models[5].available, false);
  assert.equal(catalog.models[5].disabledReason, "不可调用的模糊模型别名");
  assert.equal(catalog.models[6].available, false);
  assert.equal(catalog.models[6].disabledReason, "当前 Android 实现暂不支持");
  assert.equal(catalog.fetchedAt, 1234);
  assert.equal(models.isGPTImage2FamilyID(""), false);
  assert.equal(models.isGPTImage2FamilyID("gpt-image-2.6\u0000spoof"), false);
  assert.equal(models.isGPTImage2FamilyID(`gpt-image-2.6-${"x".repeat(129)}`), false);
  assert.equal(models.gptImage2Minor(`gpt-image-2.6-${"x".repeat(129)}`), null);
});

test("catalog filters non-image models but keeps explicit image candidates as disabled diagnostics", () => {
  const catalog = models.normalizeImageModelCatalog([
    { id: "gpt-5.5" },
    { id: "text-embedding-3-large" },
    { id: "text-image-encoder", imageCapable: true },
    { id: "chat-image-editor", imageCapable: true, supportsEdits: true },
    { id: "vision-edit-pro", imageCapable: true, supportsGenerations: true },
    { id: "audio-image-mix", imageCapable: true, supportsGenerations: true },
  ], "https://provider.invalid/v1", "fhl", 1234);

  assert.deepEqual(catalog.models.map((model) => model.id), [
    "vision-edit-pro",
  ]);
  assert.equal(catalog.models.every((model) => model.available === false), true);
  assert.equal(catalog.models[0].disabledReason, "当前 Android 实现暂不支持");
});

test("contradictory GPT Image family metadata remains visible but fail-closed", () => {
  const catalog = models.normalizeImageModelCatalog([
    { id: "gpt-image-2.6-text-route", imageCapable: false, supportsGenerations: false },
    { id: "gpt-image-2.7-input-only", imageCapable: false, supportsEdits: false },
  ], "https://provider.invalid/v1", "fhl", 1234);

  assert.deepEqual(catalog.models.map((model) => model.id), [
    "gpt-image-2.6-text-route",
    "gpt-image-2.7-input-only",
  ]);
  assert.equal(catalog.models.every((model) => model.available === false), true);
  assert.equal(catalog.models.every((model) => model.supportsTransparency === false), true);
  assert.equal(catalog.models[0].disabledReason, "Provider 未声明图像生成能力");
});

test("duplicate model rows merge capabilities conservatively", () => {
  const catalog = models.normalizeImageModelCatalog([
    { id: "gpt-image-2.6-flare", supportsTransparency: true },
    { id: "GPT-IMAGE-2.6-FLARE", supportsGenerations: false, supportsTransparency: false },
  ], "https://provider.invalid/v1", "fhl", 1234);
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].available, false);
  assert.equal(catalog.models[0].supportsGenerations, false);
  assert.equal(catalog.models[0].supportsTransparency, false);
});

test("catalog lookup and pool intersection treat model IDs case-insensitively", () => {
  const first = models.normalizeImageModelCatalog(
    [{ id: "GPT-IMAGE-2.6-FLARE" }],
    "https://provider.invalid/v1",
    "fhl",
    1000,
  );
  const second = models.normalizeImageModelCatalog(
    [{ id: "gpt-image-2.6-flare" }],
    "https://provider.invalid/v1",
    "fhl",
    1001,
  );
  const intersection = models.intersectFHLImageModelCatalogs([first, second], 1002);
  assert.equal(intersection.models.length, 1);
  assert.ok(models.imageModelCatalogEntry(intersection, "gPt-ImAgE-2.6-FlAre"));
});
test("catalog persistence strips URL credentials and keeps no provider response secrets", () => {
  const storage = installStorage();
  try {
    const catalog = models.normalizeImageModelCatalog(
      [{ id: "gpt-image-2.5-flare", description: "raw provider text", secret: "sk-hidden" }],
      "https://user:password@Provider.Invalid/v1?token=secret#fragment",
      "Bearer secret-token",
      4321,
    );
    models.persistImageModelCatalog(catalog);
    const serialized = storage.values.get(models.IMAGE_MODEL_CATALOG_LS_KEY);

    assert.equal(catalog.baseUrl, "https://provider.invalid");
    assert.equal(catalog.provider, "fhl");
    assert.doesNotMatch(serialized, /password|token=|fragment|sk-hidden|raw provider text|Bearer/i);
    assert.ok(models.loadImageModelCatalog("https://provider.invalid/v1", "fhl"));
    assert.equal(models.loadImageModelCatalog("https://other.invalid", "fhl"), null);
  } finally {
    storage.restore();
  }
});
test("v2 catalog cache ignores the legacy v1 snapshot", () => {
  const storage = installStorage();
  try {
    const legacyKey = models.IMAGE_MODEL_CATALOG_LS_KEY.replace(/\.v2$/, ".v1");
    storage.values.set(legacyKey, JSON.stringify({
      version: 1,
      baseUrl: "https://provider.invalid",
      provider: "fhl",
      fetchedAt: 100,
      models: [{ id: "gpt-image-2" }],
    }));
    assert.equal(models.loadImageModelCatalog("https://provider.invalid", "fhl"), null);
  } finally {
    storage.restore();
  }
});
test("legacy profiles remain unvalidated until model, timestamp, URL and provider all match", () => {
  const catalog = models.normalizeImageModelCatalog(
    [{ id: "gpt-image-2.5-sunburst" }],
    profiles.FHL_BASE_URL,
    "fhl",
    9000,
  );
  const complete = {
    imageModelID: "gpt-image-2.5-sunburst",
    imageModelValidatedAt: 9000,
    imageModelCatalogBaseUrl: profiles.FHL_BASE_URL,
    imageModelCatalogProvider: "fhl",
    imageModelAvailable: true,
    imageModelSupportsGenerations: true,
    imageModelSupportsEdits: true,
    imageModelSupportsTransparency: true,
    imageModelCatalogValidationId: "batch-proof-9000",
  };

  assert.equal(models.imageModelIsValidated(complete, catalog), true);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelValidatedAt: undefined }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelCatalogBaseUrl: undefined }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelCatalogProvider: "other" }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelID: "gpt-image-2.5" }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelCatalogValidationId: undefined }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelSupportsEdits: false }, catalog), false);
  assert.equal(models.imageModelIsValidated({ ...complete, imageModelSupportsTransparency: false }, catalog), false);
});

test("configured provider identity never comes from previous catalog metadata", () => {
  assert.equal(models.imageModelProviderForProfile({
    provider: " fhl-secondary ",
    imageModelCatalogProvider: "stale-provider",
  }), "fhl-secondary");
  assert.equal(models.imageModelProviderForProfile({
    imageModelCatalogProvider: "stale-provider",
  }), "fhl");
});

test("pool catalog intersection keeps only common models and ANDs capabilities", () => {
  const first = models.normalizeImageModelCatalog([
    { id: "gpt-image-2" },
    { id: "gpt-image-2.5-flare", supportsGenerations: true, supportsEdits: true, supportsTransparency: true },
  ], "https://www.fhl.mom/v1", "fhl", 1000);
  const second = models.normalizeImageModelCatalog([
    { id: "gpt-image-2.5-flare", supportsGenerations: true, supportsEdits: false, supportsTransparency: false },
    { id: "gpt-image-2.5-sunburst" },
  ], "https://www.fhl.mom", "fhl", 2000);

  const intersection = models.intersectFHLImageModelCatalogs([first, second], 3000);
  assert.equal(intersection.baseUrl, "https://www.fhl.mom");
  assert.equal(intersection.provider, "fhl");
  assert.equal(intersection.fetchedAt, 3000);
  assert.deepEqual(intersection.models.map((model) => model.id), ["gpt-image-2.5-flare"]);
  assert.equal(intersection.models[0].supportsGenerations, true);
  assert.equal(intersection.models[0].supportsEdits, false);
  assert.equal(intersection.models[0].supportsTransparency, false);
});

test("pool catalog intersection rejects route mismatch and an empty common set", () => {
  const base = models.normalizeImageModelCatalog(
    [{ id: "gpt-image-2" }],
    "https://www.fhl.mom",
    "fhl",
    1000,
  );
  const otherProvider = models.normalizeImageModelCatalog(
    [{ id: "gpt-image-2" }],
    "https://www.fhl.mom/v1",
    "fhl-secondary",
    2000,
  );
  const noCommonModel = models.normalizeImageModelCatalog(
    [{ id: "gpt-image-2.5-flare" }],
    "https://www.fhl.mom/v1",
    "fhl",
    2000,
  );

  assert.throws(
    () => models.intersectFHLImageModelCatalogs([base, otherProvider], 3000),
    /同一 Base URL 和 provider/,
  );
  assert.throws(
    () => models.intersectFHLImageModelCatalogs([base, noCommonModel], 3000),
    /没有共同可用/,
  );
});

test("image catalog fetch can defer persistence until a pool batch succeeds", async () => {
  const storage = installStorage();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      data: [
        { id: "gpt-image-2.5-flare", supportsTransparency: true },
        { id: "gpt-5.5" },
      ],
    }),
  });
  try {
    const catalog = await models.fetchFHLImageModelCatalog(
      "https://provider.invalid/v1",
      "sk-test-catalog-key",
      "fhl",
      "system",
      "",
      undefined,
      { persist: false, fetchedAt: 4567 },
    );

    assert.equal(catalog.fetchedAt, 4567);
    assert.deepEqual(catalog.models.map((model) => model.id), ["gpt-image-2.5-flare"]);
    assert.equal(storage.values.has(models.IMAGE_MODEL_CATALOG_LS_KEY), false);
  } finally {
    globalThis.fetch = previousFetch;
    storage.restore();
  }
});
