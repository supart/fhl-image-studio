import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { prepareFHLBrowserEditSources } from "../dev/browserJobProxy.ts";

test("browser FHL edit preparation normalizes camera-sized JPEGs before CLI upload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fhl-browser-upload-"));
  const source = path.join(root, "camera.jpg");
  const output = path.join(root, "output", "log");
  try {
    await sharp({
      create: {
        width: 5168,
        height: 3448,
        channels: 3,
        background: { r: 80, g: 120, b: 160 },
      },
    }).jpeg({ quality: 88 }).withMetadata({ density: 350 }).toFile(source);

    const prepared = await prepareFHLBrowserEditSources(
      {
        mode: "edit",
        apiMode: "images",
        baseURL: "https://www.fhl.mom",
        sourceImagePaths: [source],
      },
      root,
      path.join(root, "input"),
      output,
      "job-camera",
    );

    assert.equal(prepared.paths.length, 1);
    assert.equal(prepared.temporaryPaths.length, 1);
    assert.match(prepared.messages[0], /规范化为 1600x1067px JPEG 上传副本/);
    const sourceMeta = await sharp(source).metadata();
    const uploadMeta = await sharp(prepared.paths[0]).metadata();
    assert.deepEqual(
      { width: uploadMeta.width, height: uploadMeta.height, format: uploadMeta.format, exif: uploadMeta.exif?.length || 0 },
      { width: 1600, height: 1067, format: "jpeg", exif: 0 },
    );
    assert.deepEqual({ width: sourceMeta.width, height: sourceMeta.height }, { width: 5168, height: 3448 });
    assert.ok((await stat(source)).size > 0);
    await Promise.all(prepared.temporaryPaths.map((file) => rm(file, { force: true })));
    await assert.rejects(() => readFile(prepared.paths[0]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser FHL edit preparation leaves already safe JPEGs untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fhl-browser-upload-safe-"));
  const source = path.join(root, "safe.jpg");
  try {
    await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
      },
    }).jpeg({ quality: 80 }).toFile(source);
    const prepared = await prepareFHLBrowserEditSources(
      {
        mode: "edit",
        apiMode: "images",
        baseURL: "https://www.fhl.mom",
        sourceImagePaths: [source],
      },
      root,
      path.join(root, "input"),
      path.join(root, "output", "log"),
      "job-safe",
    );
    assert.deepEqual(prepared.paths, [source]);
    assert.deepEqual(prepared.temporaryPaths, []);
    assert.deepEqual(prepared.messages, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser FHL edit preparation does not alter non-FHL providers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fhl-browser-upload-provider-"));
  const source = path.join(root, "camera.jpg");
  try {
    await sharp({
      create: {
        width: 5168,
        height: 3448,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
      },
    }).jpeg({ quality: 88 }).toFile(source);
    const prepared = await prepareFHLBrowserEditSources(
      {
        mode: "edit",
        apiMode: "apimart",
        baseURL: "https://api.apimart.ai",
        sourceImagePaths: [source],
      },
      root,
      path.join(root, "input"),
      path.join(root, "output", "log"),
      "job-apimart",
    );
    assert.deepEqual(prepared.paths, [source]);
    assert.deepEqual(prepared.temporaryPaths, []);
    assert.deepEqual(prepared.messages, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
