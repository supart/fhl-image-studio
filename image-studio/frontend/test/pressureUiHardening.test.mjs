import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const toastSource = await readFile(new URL("../src/components/common/ToastContainer.tsx", import.meta.url), "utf8");
const mediaStoreSource = await readFile(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
const statusBarSource = await readFile(new URL("../src/components/canvas/StatusBar.tsx", import.meta.url), "utf8");
const canvasCssSource = await readFile(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");

test("toast container does not inject keyframes into every toast", () => {
  assert.doesNotMatch(toastSource, /<style>/);
  assert.doesNotMatch(toastSource, /@keyframes toast-in/);
});

test("pushToast deduplicates repeated pressure warnings", () => {
  assert.match(mediaStoreSource, /TOAST_DEDUPE_MS/);
  assert.match(mediaStoreSource, /toastLastShownAt/);
  assert.match(mediaStoreSource, /alreadyVisible/);
  assert.match(mediaStoreSource, /now - lastShownAt < TOAST_DEDUPE_MS/);
});

test("continuous status bar uses current batch task records", () => {
  assert.match(statusBarSource, /activeBatchTasks/);
  assert.match(statusBarSource, /taskStatusCounts/);
  assert.match(statusBarSource, /continuousQueuedCount/);
  assert.match(statusBarSource, /成功 \{continuousSucceededCount\}/);
  assert.match(statusBarSource, /失败 \{continuousFailedCount\}/);
  assert.match(statusBarSource, /continuousCancelledCount/);
  assert.match(statusBarSource, /取消/);
});

test("status bar stays single-line and truncates overflow", () => {
  assert.match(statusBarSource, /flex-nowrap/);
  assert.match(statusBarSource, /whitespace-nowrap/);
  assert.match(canvasCssSource, /\.statusbar \{[\s\S]*flex-wrap: nowrap;/);
  assert.match(canvasCssSource, /\.statusbar \{[\s\S]*white-space: nowrap;/);
  assert.match(canvasCssSource, /\.statusbar > span \{[\s\S]*text-overflow: ellipsis;/);
  assert.match(canvasCssSource, /\.statusbar > \* \{[\s\S]*min-width: 0;/);
});

test("direct launch submit failures update the exact claimed task", () => {
  assert.match(storeSource, /const message = `提交失败:\$\{e\?\.message \?\? e\}`/);
  assert.match(storeSource, /updateTaskById\([\s\S]+snapshot\.taskId/);
  assert.match(storeSource, /errorMessage: message/);
  assert.match(storeSource, /lastLogLine: runtime\.lastLogLine \|\| message/);
  assert.match(storeSource, /jobsCompleted: runtime\.jobsCompleted \+ 1/);
});
