import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storageSource = await readFile(
  new URL("../src/lib/storage.ts", import.meta.url),
  "utf8",
);

test("history storage indexes saved paths and exposes metadata-only source lookup", () => {
  assert.match(storageSource, /const DB_VERSION = 4/);
  assert.match(storageSource, /store\.createIndex\("savedPath", "savedPath", \{ unique: false \}\)/);
  assert.match(storageSource, /export async function loadHistoryItemsBySavedPaths\(paths: string\[\]\)/);
  assert.match(storageSource, /index\.get\(path\)/);
  assert.match(storageSource, /\.map\(stripHistoryRecord\)/);
});
