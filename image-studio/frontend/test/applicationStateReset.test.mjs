import assert from "node:assert/strict";
import test from "node:test";

const reset = await import("../src/state/applicationStateReset.ts");
const namespace = await import("../src/lib/storageNamespace.ts");

function fakeStorage(entries) {
  const data = new Map(entries);
  return {
    data,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

test("reset policy clears only named non-API content and writes ordinary defaults", () => {
  const key = namespace.storageKey;
  const apiEntries = [
    [key("gptcodex.profiles"), "profiles-byte-for-byte"],
    [key("gptcodex.activeProfileId"), "active-profile"],
    [key("image-studio.browser-key.profile:default:active-profile"), "secret-value"],
    [key("gptcodex.fhlTransportMode.v1"), "responses"],
    [key("gptcodex.profileConcurrencyDefaultV4Migrated"), "1"],
    [key("migration.desktop-v2.0.3"), "1"],
  ];
  const contentEntries = [
    [key("gptcodex.promptHistory"), "prompts"],
    [key("gptcodex.presets"), "presets"],
    [key("gptcodex.materialLibrary.v1"), "materials"],
    [key("gptcodex.workspaceSession.v1"), "workspace"],
    [key("gptcodex.starPrompted"), "1"],
    [key("gptcodex.quote.idx"), "4"],
  ];
  const storage = fakeStorage([
    ...apiEntries,
    ...contentEntries,
    [key("gptcodex.theme"), "dark"],
    [key("gptcodex.proxyMode"), "custom"],
    [key("gptcodex.proxyURL"), "http://127.0.0.1:7890"],
  ]);

  const summary = reset.resetNonAPIStorage(storage);

  assert.equal(summary.contentEntriesCleared, contentEntries.length);
  for (const [entryKey, value] of apiEntries) assert.equal(storage.data.get(entryKey), value);
  for (const [entryKey] of contentEntries) assert.equal(storage.data.has(entryKey), false);
  assert.equal(storage.data.get(key("gptcodex.theme")), "system");
  assert.equal(storage.data.get(key("gptcodex.fontScale")), "1");
  assert.equal(storage.data.get(key("gptcodex.kernelRuntimeMode")), "auto");
  assert.equal(storage.data.get(key("gptcodex.outputFormat")), "png");
  assert.equal(storage.data.get(key("gptcodex.proxyMode")), "system");
  assert.equal(storage.data.get(key("gptcodex.proxyURL")), "");
  assert.equal(storage.data.get(key("gptcodex.fhlImagesPool.perApiConcurrencyLimit.v1")), "4");
});

test("reset patch returns a blank application state without owning API fields", () => {
  const workspace = reset.createDefaultWorkspace("ws-reset", "png");
  const patch = reset.createApplicationResetPatch(workspace);

  assert.equal(workspace.prompt, "");
  assert.equal(workspace.mode, "generate");
  assert.equal(workspace.outputFormat, "png");
  assert.deepEqual(workspace.batchTaskIds, []);
  assert.deepEqual(patch.workspaces, [workspace]);
  assert.deepEqual(patch.history, []);
  assert.deepEqual(patch.materialGroups, []);
  assert.equal(patch.theme, "system");
  assert.equal(patch.proxyMode, "system");
  assert.equal(patch.fhlPoolPerAPIConcurrencyLimit, 4);

  for (const apiField of [
    "profiles",
    "activeProfileId",
    "apiKey",
    "baseURL",
    "textModelID",
    "imageModelID",
    "apiMode",
    "requestPolicy",
    "imagesNewAPICompat",
    "fhlTransportMode",
    "fhlTextAPIConfigured",
    "fhlTextAPIKeyHint",
  ]) {
    assert.equal(Object.hasOwn(patch, apiField), false, `${apiField} must be preserved by omission`);
  }
});

test("preserved API count uses non-sensitive metadata only", () => {
  assert.equal(reset.countPreservedAPIConfigurations({
    profiles: [{ id: "one" }, { id: "two" }],
    fhlTextAPIConfigured: true,
  }), 3);
});

test("state epoch invalidates asynchronous work captured before reset", async () => {
  const epoch = new reset.ApplicationStateEpoch();
  const captured = epoch.capture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let launched = false;
  const preparedSubmit = (async () => {
    await gate;
    if (epoch.isCurrent(captured)) launched = true;
  })();

  epoch.advance();
  release();
  await preparedSubmit;
  assert.equal(launched, false);
});
