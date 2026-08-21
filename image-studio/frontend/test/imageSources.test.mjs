import assert from "node:assert/strict";
import test from "node:test";

const images = await import("../src/lib/images.ts");
const virtualHostStore = await import("../src/lib/virtualHostStore.ts");

test("historyFullSrc prefers full image sources for selected canvas images", () => {
  const item = {
    id: "img-1",
    previewOnly: true,
    fullUrl: "/media/full/img-1",
    previewUrl: "/media/preview/img-1",
  };

  assert.equal(images.historyFullSrc(item, null), "/media/full/img-1");
});

test("historyFullSrc derives full media URL from persisted image id", () => {
  const item = {
    id: "img-2",
    imageId: "asset-2",
    previewOnly: true,
    previewUrl: "/media/preview/asset-2",
  };

  assert.equal(images.historyFullSrc(item, null), "/media/full/asset-2");
});

test("historyFullSrc rejects a thumbnail URL incorrectly stored in fullUrl", () => {
  const item = {
    id: "img-thumb-full",
    fullUrl: "/media/thumb/asset-thumb-full",
    previewUrl: "/media/thumb/asset-thumb-full",
    imageId: "asset-thumb-full",
  };

  assert.equal(images.historyFullSrc(item, null), "/media/full/asset-thumb-full");
});

test("historyFullSrc keeps transient stream previews on preview media", () => {
  const item = {
    id: "preview-job-1",
    imageId: "partial-1",
    previewOnly: true,
    previewUrl: "/media/preview/partial-1",
  };

  assert.equal(images.historyFullSrc(item, null), "/media/preview/partial-1");
});

test("historyPreviewSrc remains preview-first for grids and thumbnails", () => {
  const item = {
    id: "img-3",
    previewOnly: true,
    fullUrl: "/media/full/img-3",
    previewUrl: "/media/preview/img-3",
  };

  assert.equal(images.historyPreviewSrc(item, null), "/media/preview/img-3");
});

test("sourceToDataURL can read project image paths through local preview endpoint", async () => {
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  globalThis.window = { location: { hostname: "127.0.0.1" } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/__image-studio-files/read-image");
    assert.deepEqual(JSON.parse(init.body), { path: "I:\\AI\\Image-Studio\\input\\ref.png" });
    return {
      ok: true,
      async json() {
        return { imageB64: "iVBORw0KGgo=" };
      },
    };
  };
  try {
    assert.equal(
      await virtualHostStore.sourceToDataURL({ path: "I:\\AI\\Image-Studio\\input\\ref.png", name: "ref.png" }),
      "data:image/png;base64,iVBORw0KGgo=",
    );
  } finally {
    if (oldWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = oldWindow;
    }
    if (oldFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = oldFetch;
    }
  }
});
