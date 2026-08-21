import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compareSourceSelection = await import("../src/state/compareSourceSelection.ts");
const compareSourceSource = readFileSync(new URL("../src/state/compareSourceSelection.ts", import.meta.url), "utf8");
const mediaSource = readFileSync(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");

test("primaryCompareSourceFromCurrentImage prefers current image sources before workspace fallback", () => {
  const currentImage = {
    id: "result-1",
    prompt: "prompt",
    mode: "edit",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    createdAt: 1,
    sourceImages: [
      { path: "I:\\picked\\a.png", name: "a.png", size: 1, previewUrl: "preview://a" },
      { path: "I:\\picked\\b.png", name: "b.png", size: 1, previewUrl: "preview://b" },
    ],
  };

  const source = compareSourceSelection.primaryCompareSourceFromCurrentImage(currentImage, [
    { path: "I:\\workspace\\fallback.png", name: "fallback.png", size: 1, previewUrl: "preview://fallback" },
  ]);

  assert.equal(source?.path, "I:\\picked\\a.png");
  assert.equal(source?.previewUrl, "preview://a");
});

test("primaryCompareSourceFromCurrentImage falls back to restored parent source before workspace sources", () => {
  const currentImage = {
    id: "result-2",
    prompt: "prompt",
    mode: "edit",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    createdAt: 1,
    parentId: "I:\\parent\\original.png",
  };

  const source = compareSourceSelection.primaryCompareSourceFromCurrentImage(currentImage, [
    { path: "I:\\workspace\\fallback.png", name: "fallback.png", size: 1, previewUrl: "preview://fallback" },
  ]);

  assert.equal(source?.path, "I:\\parent\\original.png");
  assert.equal(source?.name, "original.png");
});

test("materializeCompareSourceAsHistoryItem resolves full media even when a thumbnail already exists", async () => {
  const currentImage = {
    id: "result-3",
    prompt: "prompt",
    revisedPrompt: "revised",
    mode: "edit",
    size: "1536x1024",
    quality: "high",
    outputFormat: "webp",
    createdAt: 1,
  };

  const previousWindow = globalThis.window;
  let registerCalls = 0;
  globalThis.window = {
    go: {
      backend: {
        DesktopAPI: {
          async RegisterImportedImageAsset(path) {
            registerCalls += 1;
            return {
              savedPath: path,
              imageId: "asset-original",
              previewUrl: "/media/preview/asset-original",
              fullUrl: "/media/full/asset-original",
            };
          },
        },
      },
    },
  };
  try {
    const item = await compareSourceSelection.materializeCompareSourceAsHistoryItem({
      path: "I:\\picked\\original.png",
      name: "original.png",
      size: 1,
      previewUrl: "/media/thumb/source-preview",
    }, currentImage);

    assert.ok(item?.id.startsWith("compare-source:result-3:"));
    assert.equal(registerCalls, 1);
    assert.equal(item?.fullUrl, "/media/full/asset-original");
    assert.equal(item?.previewUrl, "/media/preview/asset-original");
    assert.equal(item?.imageId, "asset-original");
    assert.equal(item?.savedPath, "I:\\picked\\original.png");
    assert.equal(item?.mode, "edit");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("materializeCompareSourceAsHistoryItem keeps a preview-only fallback when full media is unavailable", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    go: {
      backend: {
        DesktopAPI: {
          async RegisterImportedImageAsset() {
            throw new Error("host unavailable");
          },
          async ImportImagePath() {
            throw new Error("host unavailable");
          },
        },
      },
    },
  };
  try {
    const item = await compareSourceSelection.materializeCompareSourceAsHistoryItem({
      path: "I:\\picked\\fallback.png",
      name: "fallback.png",
      size: 1,
      previewUrl: "/media/thumb/fallback",
    }, {
      id: "result-fallback",
      prompt: "prompt",
      mode: "edit",
      size: "1024x1024",
      quality: "medium",
      outputFormat: "png",
      createdAt: 1,
    });

    assert.equal(item?.fullUrl, undefined);
    assert.equal(item?.previewUrl, "/media/thumb/fallback");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("temporary compare ids are detectable", () => {
  assert.equal(compareSourceSelection.isTemporarySourceCompareItem({ id: "compare-source:abc" }), true);
  assert.equal(compareSourceSelection.isTemporarySourceCompareItem({ id: "history-1" }), false);
});

test("compare source materialization falls back to reading source bytes when host preview urls are unavailable", () => {
  assert.match(compareSourceSource, /ReadImageAsBase64/);
  assert.match(compareSourceSource, /base64ToBlob/);
});

test("media actions expose primary source compare entry with temporary compare materialization", () => {
  assert.match(mediaSource, /async openCompareWithPrimarySource\(mode: CompareMode = "curtain"\)/);
  assert.match(mediaSource, /primaryCompareSourceFromCurrentImage/);
  assert.match(mediaSource, /materializeCompareSourceAsHistoryItem/);
  assert.match(mediaSource, /compareSplit: 0\.5/);
  assert.match(mediaSource, /当前图片没有可用原图可对比/);
});
