import assert from "node:assert/strict";
import test from "node:test";

const realLocalStorage = globalThis.localStorage;
const cleanup = await import("../src/lib/browserCredentialCleanup.ts");

function installStorage(entries) {
  const values = new Map(entries);
  globalThis.localStorage = {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
  return values;
}

test.afterEach(() => {
  globalThis.localStorage = realLocalStorage;
});

test("browser secure wipe removes every API credential namespace but keeps ordinary settings", () => {
  const values = installStorage([
    ["image-studio.current.image-studio.browser-key.profile:one", "credential-a"],
    ["image-studio.old.image-studio.browser-key.profile:two", "credential-b"],
    ["image-studio.current.gptcodex.responses.apiKey", "credential-c"],
    ["image-studio.current.gptcodex.theme", "dark"],
    ["image-studio.current.gptcodex.profiles", "[]"],
  ]);

  assert.equal(cleanup.clearBrowserCredentialStorage(), 3);
  assert.deepEqual(Array.from(values.keys()).sort(), [
    "image-studio.current.gptcodex.profiles",
    "image-studio.current.gptcodex.theme",
  ]);
});
