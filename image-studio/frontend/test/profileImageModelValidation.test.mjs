import assert from "node:assert/strict";
import test from "node:test";

const validation = await import("../src/lib/profileImageModelValidation.ts");

test("explicit undefined metadata clears a previous image model validation", () => {
  assert.equal(validation.resolveImageModelValidatedAt(
    { imageModelValidatedAt: undefined },
    1234,
    false,
  ), undefined);
  assert.equal(validation.resolveImageModelCatalogBaseUrl(
    { imageModelCatalogBaseUrl: undefined },
    "https://provider.invalid",
    false,
  ), undefined);
  assert.equal(validation.resolveImageModelCatalogProvider(
    { imageModelCatalogProvider: undefined },
    "fhl",
    false,
  ), undefined);
});

test("credential, URL, provider or model invalidation clears unpatched metadata", () => {
  assert.equal(validation.resolveImageModelValidatedAt({}, 1234, true), undefined);
  assert.equal(validation.resolveImageModelCatalogBaseUrl({}, "https://provider.invalid", true), undefined);
  assert.equal(validation.resolveImageModelCatalogProvider({}, "fhl", true), undefined);
  assert.equal(validation.resolveImageModelValidatedAt({}, 1234, false), 1234);
});

test("catalog metadata is normalized before it can be persisted", () => {
  assert.equal(validation.resolveImageModelValidatedAt(
    { imageModelValidatedAt: 5678.9 },
    undefined,
    false,
  ), 5678);
  assert.equal(validation.resolveImageModelCatalogBaseUrl(
    { imageModelCatalogBaseUrl: "https://user:secret@Provider.Invalid/v1?token=x" },
    undefined,
    false,
  ), "https://provider.invalid");
  assert.equal(validation.resolveImageModelCatalogProvider(
    { imageModelCatalogProvider: " FHL Provider " },
    undefined,
    false,
  ), "FHL_Provider");
});
