import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lib = await import("../src/state/materialLibrary.ts");
const managerSource = await readFile(new URL("../src/components/history/MaterialManagerModal.tsx", import.meta.url), "utf8");
const historyCss = await readFile(new URL("../src/styles/_history.css", import.meta.url), "utf8");

function historyItem(id, prompt, createdAt = Date.now()) {
  return {
    id,
    prompt,
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    createdAt,
  };
}

function source(path, name = "source.png") {
  return { path, name, size: 0, previewUrl: `/media/thumb/${name}` };
}

test("builds smart prompt groups from repeated prompts", () => {
  const history = [
    historyItem("a", "same prompt", 30),
    historyItem("b", "other prompt", 20),
    historyItem("c", "same   prompt", 10),
  ];

  const groups = lib.smartPromptMaterialGroups(history, []);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["a", "c"]);
});

test("ungrouped excludes manual folders but keeps smart prompt groups available", () => {
  const history = [
    historyItem("a", "same prompt", 30),
    historyItem("b", "single prompt", 20),
    historyItem("c", "same prompt", 10),
    historyItem("d", "manual only", 5),
  ];
  const folder = lib.createMaterialGroupInput("folder", "manual", [{ kind: "history", historyId: "d" }], 1);

  const ungrouped = lib.ungroupedHistoryItems(history, [folder]);

  assert.deepEqual(ungrouped.map((item) => item.id), ["a", "b", "c"]);
});

test("prunes deleted history refs from material groups", () => {
  const folder = lib.createMaterialGroupInput("folder", "manual", [
    { kind: "history", historyId: "keep" },
    { kind: "history", historyId: "remove" },
  ], 1);

  const [next] = lib.removeHistoryRefsFromMaterialGroups([folder], ["remove"]);

  assert.deepEqual(next.items, [{ kind: "history", historyId: "keep" }]);
});

test("source merge appends and replaces with dedupe", () => {
  const existing = [source("A.png", "A.png")];
  const incoming = [source("A.png", "A-copy.png"), source("B.png", "B.png")];

  assert.deepEqual(lib.mergeSources(existing, incoming, "append").map((item) => item.path), ["A.png", "B.png"]);
  assert.deepEqual(lib.mergeSources(existing, incoming, "replace").map((item) => item.path), ["A.png", "B.png"]);
});

test("reference helpers dedupe history and source refs", () => {
  assert.deepEqual(lib.refsFromHistoryIds(["a", "a", "b"]), [
    { kind: "history", historyId: "a" },
    { kind: "history", historyId: "b" },
  ]);

  assert.deepEqual(lib.refsFromSources([source("A.png"), source("A.png")]).map((ref) => ref.kind === "source" ? ref.source.path : ""), ["A.png"]);
});

test("material group description is persisted and normalized", () => {
  const folder = lib.createMaterialGroupInput("folder", "Project", [], 1, "  reusable style refs  ");

  assert.equal(folder.description, "reusable style refs");

  const [normalized] = lib.normalizeMaterialGroups([{
    id: "g1",
    name: "Legacy",
    kind: "folder",
    description: "  old note  ",
    items: [],
    createdAt: 1,
    updatedAt: 2,
  }]);

  assert.equal(normalized.description, "old note");
});

test("material group names get numbered when duplicated within same kind", () => {
  const folder = lib.createMaterialGroupInput("folder", "素材", [], 1);
  const folder2 = lib.createMaterialGroupInput("folder", "素材 2", [], 2);
  const reference = lib.createMaterialGroupInput("referenceSet", "素材", [], 3);

  assert.equal(lib.uniqueMaterialGroupName([folder, folder2, reference], "folder", "素材"), "素材 3");
  assert.equal(lib.uniqueMaterialGroupName([folder, folder2, reference], "referenceSet", "素材"), "素材 2");
  assert.equal(lib.uniqueMaterialGroupName([folder], "folder", "新项目"), "新项目");
});

test("loading material groups preserves history refs unless a history filter is explicit", () => {
  const stored = [lib.createMaterialGroupInput("folder", "saved", [
    { kind: "history", historyId: "history-1" },
  ], 1)];
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => key === lib.MATERIAL_LIBRARY_KEY ? JSON.stringify(stored) : null,
    setItem() {},
    removeItem() {},
    clear() {},
    key() { return null; },
    length: 1,
  };
  try {
    assert.deepEqual(lib.loadMaterialGroups()[0].items, [
      { kind: "history", historyId: "history-1" },
    ]);
    assert.deepEqual(lib.loadMaterialGroups([])[0].items, []);
    assert.deepEqual(lib.loadMaterialGroups([historyItem("history-1", "saved")])[0].items, [
      { kind: "history", historyId: "history-1" },
    ]);
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test("dropping into a sidebar folder collects assets without switching the center view", () => {
  const dropBlock = managerSource.match(/function dropHistoryIntoGroup\(groupId: string, event: React\.DragEvent\) \{[\s\S]+?\n  \}/)?.[0] ?? "";
  assert.match(dropBlock, /moveHistoryIdsToGroup\(groupId, ids\)/);
  assert.doesNotMatch(dropBlock, /selectFolderWorkspace\(groupId\)/);
  assert.match(managerSource, /onClick=\{\(\) => onSelectFolder\(group\.id\)\}/);
});

test("ungrouped detail uses a full-width image preview", () => {
  const detailBlock = managerSource.match(/function UngroupedDetail\([\s\S]+?\n\}/)?.[0] ?? "";

  assert.match(detailBlock, /<MaterialDetailImagePreview item=\{item\} \/>/);
  assert.doesNotMatch(detailBlock, /<PreviewThumb/);
  assert.match(managerSource, /function MaterialDetailImagePreview/);
  assert.match(historyCss, /\.material-manager-detail-preview\s*\{[\s\S]*?width:\s*100%/);
  assert.match(historyCss, /\.material-manager-detail-preview img\s*\{[\s\S]*?height:\s*auto/);
  assert.match(historyCss, /\.material-manager-detail-preview img\s*\{[\s\S]*?object-fit:\s*contain/);
});
