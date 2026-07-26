import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainSource = await readFile(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const canvasSource = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const gridSource = await readFile(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
const controlSource = await readFile(new URL("../src/components/panel/ControlPanel.tsx", import.meta.url), "utf8");

test("continuous pool cards and summary expose submitting and per-API occupancy", () => {
  assert.match(domainSource, /launchState\?: "submitting"/);
  assert.match(canvasSource, /task\.launchState === "submitting"[\s\S]+\? "submitting"/);
  assert.match(gridSource, /submitting: \{[\s\S]+label: "正在提交"[\s\S]+badge: "提交中"/);
  assert.match(controlSource, /data-audit-id="fhl-pool-live-status"/);
  assert.match(controlSource, /运行 \{poolRunningCount\}\/\{fhlPoolEffectiveTotalConcurrencyLimit\}/);
  assert.match(controlSource, /提交中 \{poolSubmittingCount\}/);
  assert.match(controlSource, /poolOccupancyByProfileId\.get\(profile\.id\)/);
  assert.match(controlSource, /effectivePoolLimitForProfile\(profile\.id\)/);
});
