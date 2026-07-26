import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const drawerSource = readFileSync(new URL("../src/components/panel/ResultDetailDrawer.tsx", import.meta.url), "utf8");
const mediaStoreSource = readFileSync(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
const harnessSource = readFileSync(new URL("../src/app/dev/e2eHarness.ts", import.meta.url), "utf8");

test("result detail falls back to the managed result path after its preview URL fails", () => {
  assert.match(drawerSource, /ReadImageAsBase64\(detail\.savedPath\)/);
  assert.match(drawerSource, /setFailedPreviewKey\(previewKey\)/);
  assert.match(drawerSource, /previewUrlFailed\s*\?\s*fallbackImageSrc/);
  assert.match(drawerSource, /onError=\{handlePreviewLoadError\}/);
  assert.match(drawerSource, /data-testid="image-studio-result-detail-preview"/);
  assert.match(drawerSource, /data-preview-fallback=/);
  assert.match(mediaStoreSource, /const preview = toPreviewOnlyHistoryItem\(item\)/);
  assert.match(mediaStoreSource, /ensureFullHistoryItem\(preview/);
});

test("managed result-detail fixture is restricted to --e2e-only and does not import paths", () => {
  const fixture = harnessSource.match(
    /async function openManagedResultDetailFromPathForE2E[\s\S]*?\n}\n\nasync function openBatchPreviewGridFromDirForE2E/,
  )?.[0] ?? "";

  assert.match(fixture, /RegisterImportedImageAsset\(cleanPath\)/);
  assert.match(fixture, /mode: "generate"/);
  assert.match(fixture, /e2e-stale-result/);
  assert.doesNotMatch(fixture, /ImportImagePath/);
  assert.doesNotMatch(fixture, /ReadImageAsBase64/);
  assert.match(harnessSource, /status\.e2eOnly === true\s*\?\s*\{ openManagedResultDetailFromPath/);
  assert.match(harnessSource, /Managed result-detail fixture is only available in --e2e-only mode/);
});
