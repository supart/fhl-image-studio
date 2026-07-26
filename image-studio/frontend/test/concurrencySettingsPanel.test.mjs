import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/panel/ControlPanel.tsx", import.meta.url), "utf8");

test("control panel hides per-API concurrency when continuous generation is off", () => {
  assert.match(source, /const showPerAPIConcurrency = continuousGenerateTest;/);
  assert.match(source, /showPerAPIConcurrency \? \(/);
  assert.doesNotMatch(source, /continuousGenerateTest \|\| batchImageToImageMode/);
});

test("control panel presents API 1 single-image capacity and calculated batch capacity", () => {
  assert.match(source, /每 API 并发/);
  assert.match(source, /\[2, 4, 5\]/);
  assert.match(source, /5\/API 满载/);
  assert.match(source, /单图固定首个启用 API/);
  assert.match(source, /批量总上限 \{fhlPoolTotalConcurrencyLimit\}/);
  assert.match(source, /连续单图每次只向首个启用 API 新增 1 张/);
  assert.match(source, /\{enabledFHLPoolAPICount\} 个已启用 API 轮询/);
  assert.match(source, /max=\{5\}/);
  assert.doesNotMatch(source, /共享并发设置/);
});

test("control panel no longer exposes the pressure helper shortcuts", () => {
  assert.doesNotMatch(source, /鍘嬪姏鍔╂墜/);
  assert.doesNotMatch(source, /闅忔満鎻愪氦/);
  assert.doesNotMatch(source, /鍙湪娴嬭瘯鐗堜娇鐢?/);
});
