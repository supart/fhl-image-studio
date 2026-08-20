import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../src/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("local edit roundtrip is persisted on both history and source records", async () => {
  const domain = await read("types/domain.ts");
  const shared = await read("state/studioStore.shared.ts");
  const sources = await read("state/historySourceImages.ts");
  assert.match(domain, /export type LocalEditRoundtripRef/);
  assert.match(domain, /export interface LocalEditLens/);
  assert.match(domain, /lens\?: LocalEditLens/);
  assert.match(domain, /lensActive\?: boolean/);
  assert.match(domain, /localEditRoundtrip\?: LocalEditRoundtripRef/);
  assert.match(shared, /localEditRoundtrip: raw\.localEditRoundtrip/);
  assert.match(sources, /localEditRoundtrip: source\.localEditRoundtrip/);
});

test("Windows UI exposes local edit and keeps panorama entry points", async () => {
  const toolbar = await read("components/canvas/Toolbar.tsx");
  const aligner = await read("components/panorama/PanoramaPastebackAlignModal.tsx");
  const menus = await read("components/history/historyMenus.ts");
  const modal = await read("components/localEdit/LocalEditWorkspaceModal.tsx");
  assert.match(toolbar, /startLocalEditRoundtrip/);
  assert.match(toolbar, /localEditAction/);
  assert.match(toolbar, /newest rectangle|reverse\(\)\.find\(\(a\) => a\.kind === "rect"\)/);
  assert.match(aligner, /repasteLocalEditRoundtrip/);
  assert.match(aligner, /importExternalLocalPastebackImage/);
  assert.match(aligner, /手动对齐贴回原图/);
  assert.match(menus, /裁切局部重绘/);
  assert.match(menus, /手动对齐贴回全景图/);
  assert.match(modal, /输出管理/);
  assert.match(modal, /镜头参数/);
  assert.match(modal, /AspectRatioPicker/);
  assert.match(modal, /aspectPresetsForAPIMode/);
  assert.match(modal, /autoLabel="自由"/);
  assert.doesNotMatch(modal, /横竖切换|RotateCw|lew-rotate-aspect/);
  assert.match(modal, /保存并编辑/);
  assert.match(modal, /保存镜头（不修改）/);
  assert.match(modal, /lew-floating-bottom/);
  assert.match(modal, /镜头预览/);
  assert.match(modal, /清除镜头/);
  assert.match(modal, /重置镜头/);
  assert.doesNotMatch(modal, /开始局部生成|导入 PNG \/ JPG \/ WebP|进入对齐贴回|promptPrefix|optimizationGuidance|<textarea/);
});

test("local edit store actions create a child crop and terminal pasteback result", async () => {
  const store = await read("state/studioStore.ts");
  const shared = await read("state/studioStore.shared.ts");
  assert.match(store, /startLocalEditRoundtrip: async \(rect\)/);
  assert.match(store, /createPlanarLocalEditLens/);
  assert.match(store, /请拖动镜头框定位区域/);
  assert.doesNotMatch(store, /startLocalEditRoundtrip: async \(rect\)[\s\S]{0,900}set\(\{ tool: "annotate"/);
  assert.match(store, /kind: "planar"/);
  assert.match(store, /repasteLocalEditRoundtrip: async/);
  assert.match(store, /autoPasteLocalEditRoundtripResult/);
  assert.match(store, /function normalizePlanarPastebackRoundtrip/);
  assert.match(store, /cropX: normalizedRoundtrip\.cropRect\.x/);
  assert.match(store, /prompt: `\(局部贴回\)/);
  assert.match(store, /裁切局部重绘失败/);
  assert.match(store, /importExternalLocalPastebackImage: async/);
  assert.match(store, /commitLocalEditWorkbenchCrop: async \(intent = "edit"\)/);
  assert.match(store, /saveLocalEditWorkbenchCrop: async/);
  assert.match(store, /SaveImagePathToOutput/);
  assert.match(store, /保持构图不变修改画面，将\.\.\.改为\.\.\./);
  assert.match(store, /autoAspectResolution: ""/);
  assert.match(store, /outputPath/);
  assert.match(store, /localEditWorkbenchDraft: null/);
  assert.match(store, /const sourceNeedsHistory = !!source\.savedPath/);
  assert.match(store, /history: trimHistory\(\[source, \.\.\.currentState\.history/);
  assert.match(store, /persistHistoryItem\(source\)/);
  assert.doesNotMatch(store, /promptPrefix: state\.promptPrefix/);
  assert.match(shared, /raw\.phase === "edit" \|\| raw\.phase === "align"\) return null/);
  assert.match(shared, /lensActive: raw\.lensActive !== false/);
  assert.match(store, /draft\.lensActive === false/);
});
