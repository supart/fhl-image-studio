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
  assert.match(domain, /localEditRoundtrip\?: LocalEditRoundtripRef/);
  assert.match(shared, /localEditRoundtrip: raw\.localEditRoundtrip/);
  assert.match(sources, /localEditRoundtrip: source\.localEditRoundtrip/);
});

test("Windows UI exposes local edit and keeps panorama entry points", async () => {
  const toolbar = await read("components/canvas/Toolbar.tsx");
  const aligner = await read("components/panorama/PanoramaPastebackAlignModal.tsx");
  const menus = await read("components/history/historyMenus.ts");
  assert.match(toolbar, /startLocalEditRoundtrip/);
  assert.match(toolbar, /localEditAction/);
  assert.match(toolbar, /newest rectangle|reverse\(\)\.find\(\(a\) => a\.kind === "rect"\)/);
  assert.match(aligner, /repasteLocalEditRoundtrip/);
  assert.match(aligner, /importExternalLocalPastebackImage/);
  assert.match(aligner, /手动对齐贴回原图/);
  assert.match(menus, /局部裁切编辑/);
  assert.match(menus, /手动对齐贴回全景图/);
});

test("local edit store actions create a child crop and terminal pasteback result", async () => {
  const store = await read("state/studioStore.ts");
  assert.match(store, /startLocalEditRoundtrip: async \(rect\)/);
  assert.match(store, /createPlanarLocalEditLens/);
  assert.match(store, /请拖动镜头框定位区域/);
  assert.doesNotMatch(store, /startLocalEditRoundtrip: async \(rect\)[\s\S]{0,900}set\(\{ tool: "annotate"/);
  assert.match(store, /kind: "planar"/);
  assert.match(store, /repasteLocalEditRoundtrip: async/);
  assert.match(store, /autoPasteLocalEditRoundtripResult/);
  assert.match(store, /prompt: `\(局部贴回\)/);
  assert.match(store, /importExternalLocalPastebackImage: async/);
});
