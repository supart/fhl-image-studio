import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../src/lib/fhlTextAPIModel.ts");

function storage(entries = []) {
  const data = new Map(entries);
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test("FHL text model defaults and built-in values are stable", () => {
  assert.equal(model.FHL_TEXT_API_DEFAULT_MODEL_ID, "gpt-5.6-sol");
  assert.equal(model.FHL_TEXT_API_LEGACY_MODEL_ID, "gpt-5.5");
  assert.equal(model.normalizeFHLTextAPIModelID("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(model.normalizeFHLTextAPIModelID(" gpt-5.5 "), "gpt-5.5");
});

test("custom FHL text model IDs trim valid values and reject invalid values", () => {
  assert.deepEqual(model.validateFHLTextAPIModelInput("  vendor/model  "), {
    value: "vendor/model",
    valid: true,
    message: "",
  });
  assert.match(model.validateFHLTextAPIModelInput("").message, /不能为空/);
  assert.match(model.validateFHLTextAPIModelInput("x".repeat(129)).message, /128/);
  assert.match(model.validateFHLTextAPIModelInput("model\u0000id").message, /控制字符/);
  assert.equal(model.normalizeFHLTextAPIModelID("\u0000"), "gpt-5.6-sol");
});

test("first load uses the default model even with an existing FHL text key", () => {
  const target = storage();
  assert.equal(model.loadFHLTextAPIModelID(true, target), "gpt-5.6-sol");
  assert.equal(target.data.get(model.FHL_TEXT_API_MODEL_STORAGE_KEY), "gpt-5.6-sol");
});

test("first load uses the new model without an existing FHL text key", () => {
  const target = storage();
  assert.equal(model.loadFHLTextAPIModelID(false, target), "gpt-5.6-sol");
  assert.equal(target.data.get(model.FHL_TEXT_API_MODEL_STORAGE_KEY), "gpt-5.6-sol");
});

test("an explicit model choice is never overwritten by migration", () => {
  const target = storage([[model.FHL_TEXT_API_MODEL_STORAGE_KEY, "custom/model"]]);
  assert.equal(model.loadFHLTextAPIModelID(true, target), "custom/model");
  assert.equal(model.resetFHLTextAPIModelID(target), "gpt-5.6-sol");
});
