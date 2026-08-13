import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readBlobAsArrayBuffer,
  readBlobAsText,
  requireSecureRandomUUID,
  runtimeClearInterval,
  runtimeClearTimeout,
  runtimeSetInterval,
  runtimeSetTimeout,
  secureRandomUUID,
} from "../src/lib/runtimeCompat.ts";

test("secure UUID prefers randomUUID and falls back to getRandomValues", () => {
  let randomValuesCalls = 0;
  assert.equal(secureRandomUUID({
    randomUUID: () => "native-random-uuid",
    getRandomValues(array) {
      randomValuesCalls += 1;
      return array;
    },
  }), "native-random-uuid");
  assert.equal(randomValuesCalls, 0);

  const fallback = secureRandomUUID({
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1) array[index] = index;
      return array;
    },
  });
  assert.equal(fallback, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("paid work fails closed without a secure random source", () => {
  assert.equal(secureRandomUUID(null), null);
  assert.equal(secureRandomUUID({ getRandomValues() { throw new Error("broken"); } }), null);
  assert.throws(
    () => requireSecureRandomUUID("付费生图请求", null),
    /付费生图请求需要安全随机源/,
  );
});

test("timer compatibility wrappers use the runtime timer functions", async () => {
  await new Promise((resolve) => {
    const handle = runtimeSetTimeout(resolve, 0);
    assert.notEqual(handle, undefined);
  });
  const cancelledTimeout = runtimeSetTimeout(() => assert.fail("cancelled timeout fired"), 20);
  runtimeClearTimeout(cancelledTimeout);
  const cancelledInterval = runtimeSetInterval(() => assert.fail("cancelled interval fired"), 20);
  runtimeClearInterval(cancelledInterval);
});

test("Blob readers fall back to FileReader on Chrome 69", async () => {
  const originalFileReader = globalThis.FileReader;
  class LegacyFileReader {
    result = null;
    error = null;
    onload = null;
    onerror = null;
    onabort = null;

    readAsArrayBuffer() {
      this.result = Uint8Array.from([1, 2, 3]).buffer;
      queueMicrotask(() => this.onload?.());
    }

    readAsText() {
      this.result = "legacy text";
      queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.FileReader = LegacyFileReader;
  try {
    assert.deepEqual(new Uint8Array(await readBlobAsArrayBuffer({})), Uint8Array.from([1, 2, 3]));
    assert.equal(await readBlobAsText({}), "legacy text");
  } finally {
    if (originalFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalFileReader;
  }
});

test("Android API 28 reachable code avoids unsupported direct UUID and globalThis timer calls", () => {
  const files = [
    "../vite.config.ts",
    "../src/platform/android/canvas/AndroidCanvasStage.tsx",
    "../src/state/studioStore.ts",
    "../src/platform/runtime/host.ts",
    "../src/platform/runtime/remote-kernel/common.ts",
    "../src/platform/runtime/remote-kernel/images.ts",
    "../src/platform/runtime/remote-kernel/responses.ts",
    "../src/platform/runtime/remote-kernel/apimart.ts",
    "../src/lib/images.ts",
    "../src/lib/virtualHostStore.ts",
  ];
  const sources = files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
  assert.match(sources[0], /target: "chrome69"/);
  assert.doesNotMatch(sources.join("\n"), /crypto\.randomUUID\s*\(/);
  assert.doesNotMatch(sources.join("\n"), /globalThis\.(?:set|clear)(?:Timeout|Interval)\s*\(/);
  assert.doesNotMatch(sources.at(-1), /\bglobalThis\b/);
  assert.doesNotMatch(sources.at(-2), /\bblob\.arrayBuffer\s*\(/);
  assert.doesNotMatch(sources[3], /\bfile\.text\s*\(/);
  assert.match(sources[1], /bestEffortUUID\("annotation"\)/);
  assert.match(sources[2], /requireSecureRandomUUID\("付费生图请求"\)/);
  assert.match(sources[3], /secureRuntimeID\("submission", "Android付费生图请求"\)/);
});

test("Android modal styles do not depend on unsupported :has selectors", () => {
  const styleFiles = [
    "../src/styles/_android-upstream.css",
    "../src/styles/_android-phone-advanced.css",
    "../src/styles/_android-parameters.css",
  ];
  const styles = styleFiles.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(styles, /:has\s*\(/);
  for (const className of [
    "android-upstream-modal-card",
    "android-advanced-modal-card",
    "android-parameter-modal-card",
    "android-template-modal-card",
    "android-reverse-modal-card",
  ]) {
    assert.match(styles, new RegExp(`\\.${className}\\b`));
  }
});

test("Android critical sheets keep Chrome 69 size fallbacks before CSS min()", () => {
  const historyStyles = readFileSync(new URL("../src/styles/_android-history.css", import.meta.url), "utf8");
  const canvasStyles = readFileSync(new URL("../src/styles/_android-canvas.css", import.meta.url), "utf8");
  const settingsStyles = readFileSync(new URL("../src/styles/_android-settings.css", import.meta.url), "utf8");
  assert.match(historyStyles, /\.android-history-action-sheet[^}]*width: 100%;[^}]*max-width: 430px;[^}]*max-height: 86vh;[^}]*width: min\(100%, 430px\);/s);
  assert.match(historyStyles, /\.android-history-sheet-preview[^}]*height: 74px;[^}]*aspect-ratio: 1;/s);
  assert.match(canvasStyles, /\.android-canvas-action-sheet[^}]*width: 100%;[^}]*max-width: 760px;[^}]*max-height: 78vh;[^}]*width: min\(100%, 760px\);/s);
  assert.match(canvasStyles, /\.android-canvas-action-preview[^}]*height: 76px;[^}]*aspect-ratio: 1;/s);
  assert.match(settingsStyles, /\.android-settings-modal-card[^}]*width: calc\(100vw - 40px\) !important;[^}]*max-width: 1040px;[^}]*max-height: 88vh;[^}]*width: min\(1040px,/s);
});
