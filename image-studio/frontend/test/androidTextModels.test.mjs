import assert from "node:assert/strict";
import test from "node:test";

const { chooseAndroidTextModel } = await import("../src/lib/profiles.ts");

test("Android text model selection preserves valid choices and replaces missing ones", () => {
  assert.equal(chooseAndroidTextModel(["gpt-5.6-sol", "gpt-5.5"], "gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(chooseAndroidTextModel(["gpt-5.6-sol", "gpt-5.5"], "retired-model"), "gpt-5.5");
  assert.equal(chooseAndroidTextModel(["gpt-image-2", "gpt-5.6-sol"], "retired-model"), "gpt-5.6-sol");
  assert.equal(chooseAndroidTextModel(["gpt-image-2"], ""), "gpt-image-2");
});
