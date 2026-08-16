import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceRoot = new URL("../../..", import.meta.url);

test("active product metadata matches the canonical version manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("product-version.json", sourceRoot), "utf8"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.displayVersion, `V${manifest.version}`);
  assert.equal(manifest.windowsTag, `windows-v${manifest.version}-release`);

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["scripts/sync-version-metadata.mjs", "--check"],
    { cwd: sourceRoot },
  );
  assert.equal(stderr, "");
  assert.match(stdout, new RegExp(`metadata is synchronized: ${manifest.displayVersion.replaceAll(".", "\\.")}`));
});
