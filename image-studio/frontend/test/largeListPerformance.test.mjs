import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("large result and input lists use virtual rows with bounded overscan", () => {
  const grid = source("src/components/canvas/BatchResultGrid.tsx");
  const inputs = source("src/components/panel/BatchProcessSection.tsx");
  assert.match(grid, /useVirtualizer/);
  assert.match(grid, /overscan:\s*3/);
  assert.match(inputs, /useVirtualizer/);
  assert.match(inputs, /overscan:\s*4/);
});

test("browser result hydration registers media without reading full image bytes", () => {
  const store = source("src/state/studioStore.ts");
  const start = store.indexOf("async function buildHistoryItemFromBrowserSlot");
  const end = store.indexOf("async function hydrateHistoryFromBrowserGroups", start);
  assert.ok(start >= 0 && end > start, "buildHistoryItemFromBrowserSlot source block missing");
  const block = store.slice(start, end);
  assert.match(block, /RegisterMediaAsset/);
  assert.doesNotMatch(block, /ReadImageAsBase64/);
});

test("history and browser registry limits cover 397 and 500 item recovery", () => {
  const storage = source("src/lib/storage.ts");
  const contracts = source("src/platform/runtime/browserJobContracts.ts");
  assert.match(storage, /createdAt_id/);
  assert.match(storage, /loadHistoryItemsByIds/);
  assert.doesNotMatch(source("src/state/studioStore.shared.ts"), /MAX_HISTORY_ITEMS\s*=\s*120/);
  assert.match(contracts, /MAX_BROWSER_JOB_GROUPS\s*=\s*500/);
});

test("packaged E2E mode can construct a memory-only 397 item preview grid", () => {
  const harness = source("src/app/dev/e2eHarness.ts");
  const store = source("src/state/studioStore.ts");
  const namespace = source("src/lib/storageNamespace.ts");
  assert.match(harness, /openSyntheticBatchPreviewGridForE2E/);
  assert.match(harness, /Math\.min\(500/);
  assert.match(harness, /openSyntheticBatchPreviewGrid\?\.\(397\)/);
  assert.match(harness, /image-studio-e2e-synthetic-grid/);
  assert.match(harness, /e2e:\/\/synthetic-batch/);
  assert.match(store, /if \(isE2EOnlyBootstrap\(\)\)/);
  assert.match(store, /dataset\.e2eStoreReady = "true"/);
  assert.match(namespace, /-e2e-\$\{pid\}-\$\{startedAt\}/);
});
