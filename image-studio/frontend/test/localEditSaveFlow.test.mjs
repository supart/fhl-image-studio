import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../src/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("local edit save intents and output metadata are part of the persisted contract", async () => {
  const domain = await read("types/domain.ts");
  const types = await read("state/studioStore.types.ts");
  const store = await read("state/studioStore.ts");
  const security = await read("lib/security.ts");

  assert.match(domain, /export type LocalEditSaveIntent = "edit" \| "lens"/);
  assert.match(domain, /outputPath\?: string/);
  assert.match(types, /commitLocalEditWorkbenchCrop: \(intent\?: LocalEditSaveIntent\)/);
  assert.match(types, /saveLocalEditWorkbenchCrop: \(intent: LocalEditSaveIntent\)/);
  assert.match(store, /SaveImagePathToOutput\(/);
  assert.match(store, /const LOCAL_EDIT_DEFAULT_PROMPT = "保持构图不变修改画面，将\.\.\.改为\.\.\."/);
  assert.match(security, /sourcePath: undefined, outputPath: undefined/);
});

test("edit and lens saves have distinct state effects", async () => {
  const store = await read("state/studioStore.ts");
  assert.match(store, /commitLocalEditWorkbenchCrop: async \(intent = "edit"\)/);
  assert.match(store, /saveLocalEditWorkbenchCrop: async \(intent\)/);
  assert.match(store, /autoAspectResolution: "" as const/);
  assert.match(store, /editAutoAspectUserLocked: nextEditAutoAspectUserLocked/);
  assert.match(store, /sources: saveIntent === "edit" \? \[cropSource\] : currentState\.sources/);
  assert.match(store, /const nextPrompt = saveIntent === "edit" \? LOCAL_EDIT_DEFAULT_PROMPT : latestState\.prompt/);
  assert.match(store, /未修改编辑参数/);
  assert.match(store, /function isCurrentLocalEditDraft\(/);
  assert.match(store, /const latestState = get\(\);/);
  assert.match(store, /if \(!isCurrentLocalEditDraft\(currentState, workspaceId, draft\)\) return currentState/);
  assert.match(store, /const draftSourceFallback: HistoryItem \| null = draft\.sourcePath/);
});
