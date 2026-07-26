import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imageActionsSource = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");

test("batch output directory picker uses a purpose-specific host capability", () => {
  assert.match(imageActionsSource, /ChooseBatchOutputDir\(\)/);
  assert.doesNotMatch(imageActionsSource, /const chosen = await ChooseOutputDir\(\)/);
});

test("browser directory selection avoids manual path prompt fallback", () => {
  assert.match(hostSource, /chooseProjectDirectory\("选择批处理输出目录"\)/);
  assert.doesNotMatch(hostSource, /window\.prompt/);
});
