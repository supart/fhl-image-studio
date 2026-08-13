import assert from "node:assert/strict";
import test from "node:test";

const storageNamespace = await import("../src/lib/storageNamespace.ts");
const profiles = await import("../src/lib/profiles.ts");

test("storage namespace scopes localStorage keys", () => {
  assert.equal(storageNamespace.STORAGE_NAMESPACE, "default");
  assert.equal(
    storageNamespace.storageKey("gptcodex.profiles"),
    "image-studio.default.gptcodex.profiles",
  );
});

test("storage namespace scopes IndexedDB names", () => {
  assert.equal(
    storageNamespace.storageDBName("image-studio"),
    "image-studio-default",
  );
});

test("profile keyring users are scoped by storage namespace", () => {
  assert.equal(
    profiles.keyringUserFor("fhl-responses-default"),
    "profile:default:fhl-responses-default",
  );
});

test("purgeForeignAPIKeyStorageKeys removes foreign browser keys only", () => {
  const data = new Map([
    ["image-studio.default.image-studio.browser-key.profile:default:fhl-responses-default", "keep"],
    ["image-studio.old.image-studio.browser-key.profile:fhl-responses-default", "drop"],
    ["image-studio.browser-key.profile:fhl-responses-default", "drop"],
    ["image-studio.default.gptcodex.responses.apiKey", "drop"],
  ]);
  globalThis.localStorage = {
    get length() { return data.size; },
    key(index) { return Array.from(data.keys())[index] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
  try {
    storageNamespace.purgeForeignAPIKeyStorageKeys();
    assert.equal(data.get("image-studio.default.image-studio.browser-key.profile:default:fhl-responses-default"), "keep");
    assert.equal(data.has("image-studio.old.image-studio.browser-key.profile:fhl-responses-default"), false);
    assert.equal(data.has("image-studio.browser-key.profile:fhl-responses-default"), false);
    assert.equal(data.has("image-studio.default.gptcodex.responses.apiKey"), false);
  } finally {
    delete globalThis.localStorage;
  }
});
