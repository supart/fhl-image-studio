// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { cropLocalImageFile, validateLocalCropRequest } from "../dev/localCrop";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-studio-local-crop-"));
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, "source.png");
  const outputPath = path.join(directory, "crop.png");
  await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  }).png().toFile(sourcePath);
  return { directory, sourcePath, outputPath };
}

describe("local Vite crop path", () => {
  it("crops natural pixels and leaves the source untouched", async () => {
    const { sourcePath, outputPath } = await createFixture();
    const sourceBefore = await fs.readFile(sourcePath);
    const result = await cropLocalImageFile(sourcePath, outputPath, { x: 2, y: 1, width: 4, height: 3 });
    expect(result).toMatchObject({ path: outputPath, acceleration: "node-sharp", width: 4, height: 3 });
    await expect(sharp(outputPath).metadata()).resolves.toMatchObject({ width: 4, height: 3 });
    await expect(fs.readFile(sourcePath)).resolves.toEqual(sourceBefore);
  });

  it("rejects out-of-bounds rectangles before creating output", async () => {
    const { sourcePath, outputPath } = await createFixture();
    await expect(cropLocalImageFile(sourcePath, outputPath, { x: 7, y: 5, width: 2, height: 2 }))
      .rejects.toThrow(/超出原图/);
    await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized dimensions during preflight", () => {
    expect(() => validateLocalCropRequest({ width: 20_000, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }))
      .toThrow(/单边/);
    expect(() => validateLocalCropRequest({ width: 10_000, height: 10_000 }, { x: 0, y: 0, width: 10_000, height: 10_000 }))
      .toThrow(/工作内存/);
  });
});
