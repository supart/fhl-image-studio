import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harnessSource = readFileSync(new URL("../src/app/dev/e2eHarness.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("desktop E2E harness exposes a safe automation state summary", () => {
  assert.match(harnessSource, /__imageStudioE2E/);
  assert.match(harnessSource, /getStateSummary/);
  assert.match(harnessSource, /waitForIdle/);
  assert.match(harnessSource, /summarizeImage/);
  assert.match(harnessSource, /data(?:set)?\.e2eHarness|dataset\.e2eHarness/);
  assert.doesNotMatch(harnessSource, /getState:\s*\(\)\s*=>\s*useStudioStore\.getState/);
});

test("desktop E2E harness supports browser-visible postMessage commands", () => {
  assert.match(harnessSource, /image-studio-e2e/);
  assert.match(harnessSource, /direction:\s*"response"/);
  assert.match(harnessSource, /commandHandlers/);
  assert.match(harnessSource, /window\.addEventListener\("message"/);
});

test("desktop E2E harness can load packaged batch input directories", () => {
  assert.match(harnessSource, /ListBatchInputImages/);
  assert.match(harnessSource, /loadBatchInputDir/);
  assert.match(harnessSource, /mountE2EBatchControls/);
  assert.match(harnessSource, /image-studio-e2e-load-batch-dir/);
  assert.match(harnessSource, /editSourceMode:\s*"batch"/);
  assert.match(harnessSource, /selected:\s*true/);
});

test("runtime host can read backend or injected E2E automation status", () => {
  assert.match(hostSource, /export function GetAutomationStatus/);
  assert.match(hostSource, /__IMAGE_STUDIO_E2E_BOOTSTRAP/);
  assert.match(hostSource, /hasServiceMethod\("GetAutomationStatus"\)/);
});

test("main entry installs E2E harness before rendering the app", () => {
  assert.match(mainSource, /import \{ installE2EHarness \}/);
  assert.match(mainSource, /void installE2EHarness\(\)/);
});
