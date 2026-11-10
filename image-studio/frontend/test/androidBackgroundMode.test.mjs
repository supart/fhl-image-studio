import assert from "node:assert/strict";
import test from "node:test";

const {
  normalizeImageModelCatalog,
} = await import("../src/lib/fhlImageModels.ts");
const {
  resolveAndroidTransparentEligibility,
} = await import("../src/platform/android/androidBackgroundMode.ts");

const fetchedAt = 1_796_000_000_000;
const baseURL = "https://www.fhl.mom";
const catalog = normalizeImageModelCatalog([
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.6",
  "gpt-image-2.7-future",
  "gpt-image-2.5",
], baseURL, "fhl", fetchedAt);

function profile(imageModelID = "gpt-image-2.5-flare", sourceCatalog = catalog) {
  const entry = sourceCatalog.models.find((model) => model.id === imageModelID);
  return {
    id: "fhl-images-1",
    name: "FHL1",
    apiMode: "images",
    requestPolicy: "openai",
    baseURL,
    textModelID: "gpt-5.5",
    imageModelID,
    imageModelValidatedAt: fetchedAt,
    imageModelCatalogBaseUrl: baseURL,
    imageModelCatalogProvider: "fhl",
    imageModelAvailable: entry?.available,
    imageModelSupportsGenerations: entry?.supportsGenerations,
    imageModelSupportsEdits: entry?.supportsEdits,
    imageModelSupportsTransparency: entry?.supportsTransparency,
    imageModelCatalogValidationId: "catalog-proof-1234",
    provider: "fhl",
    concurrencyLimit: 4,
    fhlImagesPoolSlot: 1,
    createdAt: fetchedAt,
  };
}

test("transparent PNG is available to validated exact GPT Image 2.5+ models", () => {
  for (const imageModelID of [
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2.6",
    "gpt-image-2.7-future",
  ]) {
    assert.deepEqual(resolveAndroidTransparentEligibility({
      activeProfile: profile(imageModelID),
      apiMode: "images",
      baseURL,
      catalog,
      imageModelID,
    }), {
      enabled: true,
      reason: "原生 Alpha 输出，格式将锁定为 PNG。",
    });
  }
});

test("validated FHL Responses keeps the same transparent eligibility", () => {
  assert.equal(resolveAndroidTransparentEligibility({
    activeProfile: profile(),
    apiMode: "responses",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2.5-flare",
  }).enabled, true);
});

test("legacy model and non-FHL routes expose a precise disabled reason", () => {
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile("gpt-image-2"),
    apiMode: "images",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2",
  }).reason, /V2\.0/);
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile(),
    apiMode: "apimart",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2.5-flare",
  }).reason, /APIMart/);
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile(),
    apiMode: "runninghub",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2.5-flare",
  }).reason, /RunningHub/);
});

test("missing validation and a provider catalog without the selected model stay disabled", () => {
  const unvalidated = { ...profile(), imageModelValidatedAt: undefined };
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: unvalidated,
    apiMode: "images",
    baseURL,
    catalog,
    imageModelID: unvalidated.imageModelID,
  }).reason, /FHL API 10\s*槽.*模型面板完成验证并保存统一模型/);

  const missingModelCatalog = normalizeImageModelCatalog(
    ["gpt-image-2"],
    baseURL,
    "fhl",
    fetchedAt,
  );
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile(),
    apiMode: "images",
    baseURL,
    catalog: missingModelCatalog,
    imageModelID: "gpt-image-2.5-flare",
  }).reason, /未提供/);
});

test("fuzzy alias and provider transparency opt-out remain disabled", () => {
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile("gpt-image-2.5"),
    apiMode: "images",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2.5",
  }).reason, /模糊模型别名/);

  const optedOutCatalog = normalizeImageModelCatalog([
    { id: "gpt-image-2.6-flare", supportsTransparency: false },
  ], baseURL, "fhl", fetchedAt);
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: profile("gpt-image-2.6-flare", optedOutCatalog),
    apiMode: "images",
    baseURL,
    catalog: optedOutCatalog,
    imageModelID: "gpt-image-2.6-flare",
  }).reason, /Provider.*透明/);
});

test("legacy profile without a capability proof must revalidate", () => {
  const legacy = profile("gpt-image-2.6");
  delete legacy.imageModelCatalogValidationId;
  assert.match(resolveAndroidTransparentEligibility({
    activeProfile: legacy,
    apiMode: "images",
    baseURL,
    catalog,
    imageModelID: "gpt-image-2.6",
  }).reason, /能力证明/);
});
