import assert from "node:assert/strict";
import test from "node:test";

const settings = await import("../src/state/studioStore.settings.ts");
const namespace = await import("../src/lib/storageNamespace.ts");

function fakeStorage(entries = []) {
  const data = new Map(entries);
  return {
    data,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test("application settings use the stable namespaced keys and defaults", () => {
  const key = namespace.storageKey;
  assert.deepEqual(settings.APPLICATION_SETTING_STORAGE_KEYS, {
    theme: key("gptcodex.theme"),
    fontScale: key("gptcodex.fontScale"),
    kernelRuntimeMode: key("gptcodex.kernelRuntimeMode"),
    outputFormat: key("gptcodex.outputFormat"),
    proxyMode: key("gptcodex.proxyMode"),
    proxyURL: key("gptcodex.proxyURL"),
  });
  assert.deepEqual(settings.loadApplicationSettings(fakeStorage()), settings.APPLICATION_SETTINGS_DEFAULTS);
});

test("application settings load valid values and normalize invalid values", () => {
  const key = namespace.storageKey;
  const valid = fakeStorage([
    [key("gptcodex.theme"), "dark"],
    [key("gptcodex.fontScale"), "1.25"],
    [key("gptcodex.kernelRuntimeMode"), "remote"],
    [key("gptcodex.outputFormat"), "webp"],
    [key("gptcodex.proxyMode"), "custom"],
    [key("gptcodex.proxyURL"), "  http://127.0.0.1:7890  "],
  ]);
  assert.deepEqual(settings.loadApplicationSettings(valid), {
    theme: "dark",
    fontScale: 1.25,
    kernelRuntimeMode: "remote",
    outputFormat: "webp",
    proxyMode: "custom",
    proxyURL: "http://127.0.0.1:7890",
  });

  const invalid = fakeStorage([
    [key("gptcodex.theme"), "purple"],
    [key("gptcodex.fontScale"), "4"],
    [key("gptcodex.kernelRuntimeMode"), "cloud"],
    [key("gptcodex.outputFormat"), "gif"],
    [key("gptcodex.proxyMode"), "manual"],
    [key("gptcodex.proxyURL"), "  proxy.example  "],
  ]);
  assert.deepEqual(settings.loadApplicationSettings(invalid), {
    ...settings.APPLICATION_SETTINGS_DEFAULTS,
    proxyURL: "proxy.example",
  });
});

test("settings actions persist only ordinary settings and apply runtime effects", () => {
  const storage = fakeStorage([
    [namespace.storageKey("gptcodex.profiles"), "api-profile-data"],
  ]);
  const state = {
    theme: "system",
    fontScale: 1,
    kernelRuntimeMode: "auto",
    outputFormat: "png",
    proxyMode: "system",
    proxyURL: "http://existing-proxy",
  };
  const effects = [];
  const actions = settings.createSettingsActions({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
  }, {
    storage,
    applyTheme: (value) => effects.push(["theme", value]),
    applyFontScale: (value) => effects.push(["fontScale", value]),
    setKernelRuntimeMode: (value) => effects.push(["kernel", value]),
  });

  actions.setTheme("dark");
  actions.setFontScale(1.2);
  actions.setProxyConfig("custom", "  http://127.0.0.1:7890  ");
  assert.equal(actions.persistField("kernelRuntimeMode", "remote"), true);
  assert.equal(actions.persistField("outputFormat", "webp"), true);
  assert.equal(actions.persistField("prompt", "must not persist"), false);

  assert.deepEqual(state, {
    theme: "dark",
    fontScale: 1.2,
    kernelRuntimeMode: "auto",
    outputFormat: "png",
    proxyMode: "custom",
    proxyURL: "http://127.0.0.1:7890",
  });
  assert.deepEqual(effects, [
    ["theme", "dark"],
    ["fontScale", 1.2],
    ["kernel", "remote"],
  ]);
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.theme")), "dark");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.fontScale")), "1.2");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.proxyMode")), "custom");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.proxyURL")), "http://127.0.0.1:7890");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.kernelRuntimeMode")), "remote");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.outputFormat")), "webp");
  assert.equal(storage.data.get(namespace.storageKey("gptcodex.profiles")), "api-profile-data");
});
