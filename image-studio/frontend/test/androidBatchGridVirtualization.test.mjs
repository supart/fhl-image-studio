import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANDROID_BATCH_GRID_COLUMNS,
  androidBatchGridMetrics,
  androidBatchGridWindow,
} from "../src/components/canvas/androidBatchGridVirtualization.ts";

const batchGridSource = readFileSync(
  new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url),
  "utf8",
);
const androidCanvasSource = readFileSync(
  new URL("../src/platform/android/canvas/AndroidCanvasStage.tsx", import.meta.url),
  "utf8",
);
const canvasStyles = readFileSync(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");
const androidCanvasStyles = readFileSync(new URL("../src/styles/_android-canvas.css", import.meta.url), "utf8");

test("Android batch grid uses exactly two columns and bounded phone/tablet row heights", () => {
  assert.equal(ANDROID_BATCH_GRID_COLUMNS, 2);
  assert.deepEqual(androidBatchGridMetrics(360), {
    columnWidth: 176,
    rowHeight: 194,
    rowStride: 202,
  });
  assert.equal(androidBatchGridMetrics(390).rowHeight, 210);
  assert.equal(androidBatchGridMetrics(430).rowHeight, 232);
  assert.equal(androidBatchGridMetrics(800).rowHeight, 260);
});
test("Android batch grid windows 2 through 200 items without mounting the full batch", () => {
  const metrics = androidBatchGridMetrics(360);
  for (const itemCount of [2, 4, 10, 30, 60, 200]) {
    const result = androidBatchGridWindow({
      itemCount,
      scrollTop: 0,
      viewportHeight: 600,
      rowStride: metrics.rowStride,
      rowHeight: metrics.rowHeight,
    });
    assert.equal(result.totalRows, Math.ceil(itemCount / 2));
    assert.ok(result.endRow - result.startRow <= Math.ceil(600 / metrics.rowStride) + 4);
    if (itemCount >= 30) assert.ok((result.endRow - result.startRow) * 2 < itemCount);
  }
});

test("Android batch grid keeps a bounded overscan window at the bottom", () => {
  const metrics = androidBatchGridMetrics(360);
  const totalRows = 100;
  const totalHeight = ((totalRows - 1) * metrics.rowStride) + metrics.rowHeight;
  const result = androidBatchGridWindow({
    itemCount: 200,
    scrollTop: totalHeight - 600,
    viewportHeight: 600,
    rowStride: metrics.rowStride,
    rowHeight: metrics.rowHeight,
  });
  assert.equal(result.endRow, totalRows);
  assert.ok(result.startRow > 0);
  assert.ok((result.endRow - result.startRow) * 2 < 200);
});

test("Android batch grid allows one extra partially visible row at fractional scroll offsets", () => {
  const metrics = androidBatchGridMetrics(360);
  const viewportHeight = metrics.rowStride * 2;
  const scrollTop = metrics.rowStride * 10 + 1;
  const result = androidBatchGridWindow({
    itemCount: 60,
    scrollTop,
    viewportHeight,
    rowStride: metrics.rowStride,
    rowHeight: metrics.rowHeight,
  });
  const firstVisibleRow = Math.floor(scrollTop / metrics.rowStride);
  const lastVisibleRowExclusive = Math.ceil((scrollTop + viewportHeight) / metrics.rowStride);
  assert.equal(lastVisibleRowExclusive - firstVisibleRow, 3);
  assert.deepEqual(result, {
    startRow: 8,
    endRow: 15,
    totalRows: 30,
    totalHeight: 6052,
  });
  assert.equal((result.endRow - result.startRow) * ANDROID_BATCH_GRID_COLUMNS, 14);
});

test("Android canvas opts into virtualized layout while desktop remains adaptive by default", () => {
  assert.match(batchGridSource, /layoutMode = "adaptive"/);
  assert.match(batchGridSource, /layoutMode === "android-virtualized"/);
  assert.match(batchGridSource, /loading=\{lazyImage \? "lazy" : "eager"\}/);
  assert.match(androidCanvasSource, /layoutMode="android-virtualized"/);
  assert.match(androidCanvasSource, /batchIdentity=\{batchIdentity\}/);
  assert.match(androidCanvasSource, /data-batch-grid-open=\{showingResultGrid \? "true" : "false"\}/);
});

test("virtual rows are the only Android slot render path and scrolling is isolated from canvas gestures", () => {
  assert.match(batchGridSource, /slots\.slice\(firstItemIndex, firstItemIndex \+ ANDROID_BATCH_GRID_COLUMNS\)/);
  assert.match(batchGridSource, /requestAnimationFrame/);
  assert.match(batchGridSource, /addEventListener\("scroll", handleScroll, \{ passive: true \}\)/);
  assert.match(canvasStyles, /\.batch-grid-virtual-row[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(canvasStyles, /\.batch-grid-virtual-scroll[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain[\s\S]*touch-action: pan-y/);
  assert.match(androidCanvasStyles, /\.android-stage-host\[data-batch-grid-open="true"\][\s\S]*touch-action: pan-y/);
  assert.doesNotMatch(batchGridSource, /content-visibility|aspect-ratio/);
});
