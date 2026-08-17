import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imageActionsSource = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const hostFilesSource = readFileSync(new URL("../src/platform/runtime/hostFiles.ts", import.meta.url), "utf8");

test("batch output directory picker uses a purpose-specific host capability", () => {
  assert.match(imageActionsSource, /ChooseBatchOutputDir\(\)/);
  assert.doesNotMatch(imageActionsSource, /const chosen = await ChooseOutputDir\(\)/);
});

test("browser directory selection avoids manual path prompt fallback", () => {
  assert.match(hostFilesSource, /chooseProjectDirectory\("选择批处理输出目录"\)/);
  assert.doesNotMatch(hostFilesSource, /window\.prompt/);
});
