import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storageNamespace = await import("../src/lib/storageNamespace.ts");

function keyStorage(keys) {
  return {
    get length() { return keys.length; },
    key(index) { return keys[index] ?? null; },
  };
}

test("credential-only browser storage is not migration evidence", () => {
  const namespace = "legacy-release";
  const browserCredential = `image-studio.${namespace}.image-studio.browser-key.profile:${namespace}:fhl-text-assistant`;
  assert.equal(storageNamespace.hasMigratableNamespaceState(namespace, keyStorage([])), false);
  assert.equal(storageNamespace.hasMigratableNamespaceState(namespace, keyStorage([browserCredential])), false);
});

test("legacy workspace or profile metadata enables credential migration", () => {
  const namespace = "legacy-release";
  assert.equal(storageNamespace.hasMigratableNamespaceState(namespace, keyStorage([
    `image-studio.${namespace}.gptcodex.workspaceSession.v1`,
  ])), true);
  assert.equal(storageNamespace.hasMigratableNamespaceState(namespace, keyStorage([
    `image-studio.${namespace}.gptcodex.profiles`,
  ])), true);
});

test("migration only probes credentials backed by legacy namespace state", () => {
  const source = readFileSync(new URL("../src/lib/storageMigration.ts", import.meta.url), "utf8");
  assert.match(source, /for \(const profile of sourceProfiles\)/);
  assert.match(source, /if \(sourceHasState\) \{\s*await copyCredentialIfMissing\(sourceNamespace, TEXT_CREDENTIAL_ID, operations\)/s);
});
