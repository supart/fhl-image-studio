import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const { pasteLocalEditFile } = await import("../dev/localPasteback.ts");

const pastebackOptions = {
  cropX: 2,
  cropY: 1,
  cropWidth: 3,
  cropHeight: 2,
  offsetXRatio: 0,
  offsetYRatio: 0,
  scale: 1,
  rotationDeg: 0,
  featherFraction: 0,
  brightness: 1,
  contrast: 1,
  hueRotationDeg: 0,
};

async function createFixtureDir() {
  return mkdtemp(path.join(tmpdir(), "fhl-local-pasteback-"));
}

async function writeSolidPng(filePath, width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

async function readRgba(filePath) {
  const result = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * image.channels;
  return Array.from(image.data.subarray(offset, offset + 4));
}

async function assertNoPastebackTempFiles(dir, outputPath) {
  const outputName = path.basename(outputPath);
  const entries = await readdir(dir);
  assert.equal(entries.includes(outputName), false, `failed pasteback left ${outputName}`);
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith(`.${outputName}.`) && entry.endsWith(".tmp")),
    [],
    "failed pasteback left a temporary output",
  );
}

async function writeInputs(dir) {
  const sourcePath = path.join(dir, "source.png");
  const editedPath = path.join(dir, "edited.png");
  await writeSolidPng(sourcePath, 8, 6, [12, 34, 56, 255]);
  await writeSolidPng(editedPath, 2, 2, [240, 80, 40, 255]);
  return { sourcePath, editedPath };
}

test("local pasteback keeps full source dimensions and leaves pixels outside the crop unchanged", async () => {
  const dir = await createFixtureDir();
  try {
    const { sourcePath, editedPath } = await writeInputs(dir);
    const outputPath = path.join(dir, "result.png");
    const sourceBefore = createHash("sha256").update(await readFile(sourcePath)).digest("hex");

    const result = await pasteLocalEditFile(sourcePath, editedPath, outputPath, pastebackOptions);
    assert.equal(result.path, outputPath);
    assert.equal(result.acceleration, "node-sharp");

    const output = await readRgba(outputPath);
    assert.deepEqual([output.width, output.height], [8, 6]);
    assert.deepEqual(pixelAt(output, 0, 0), [12, 34, 56, 255]);
    assert.deepEqual(pixelAt(output, 1, 1), [12, 34, 56, 255]);
    assert.deepEqual(pixelAt(output, 5, 2), [12, 34, 56, 255]);
    assert.deepEqual(pixelAt(output, 7, 5), [12, 34, 56, 255]);
    for (const [x, y] of [[2, 1], [4, 2]]) {
      const [red, green, blue, alpha] = pixelAt(output, x, y);
      assert.ok(red >= 230 && green >= 70 && blue <= 50 && alpha === 255, `crop pixel ${x},${y} was not composited: ${red},${green},${blue},${alpha}`);
    }

    const sourceAfter = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    assert.equal(sourceAfter, sourceBefore, "pasteback must not overwrite the source file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local pasteback rejects non-finite, fractional, and out-of-bounds crop parameters", async () => {
  const dir = await createFixtureDir();
  try {
    const { sourcePath, editedPath } = await writeInputs(dir);
    const cases = [
      ["nan", { cropX: Number.NaN }],
      ["fractional", { cropWidth: 1.5 }],
      ["negative", { cropY: -1 }],
      ["overflow-x", { cropX: 7, cropWidth: 2 }],
      ["overflow-y", { cropY: 5, cropHeight: 2 }],
    ];

    for (const [name, override] of cases) {
      const outputPath = path.join(dir, `${name}.png`);
      await assert.rejects(
        () => pasteLocalEditFile(sourcePath, editedPath, outputPath, { ...pastebackOptions, ...override }),
        `${name} crop parameters must be rejected`,
      );
      await assertNoPastebackTempFiles(dir, outputPath);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local pasteback removes partial output when encoding fails after a write", async () => {
  const dir = await createFixtureDir();
  try {
    const { sourcePath, editedPath } = await writeInputs(dir);
    const outputPath = path.join(dir, "result.png");
    const originalToFile = sharp.prototype.toFile;
    const scopedDir = `${path.resolve(dir)}${path.sep}`;
    let injected = false;
    sharp.prototype.toFile = async function (...args) {
      const target = args[0];
      const result = await originalToFile.apply(this, args);
      if (typeof target === "string" && path.resolve(target).startsWith(scopedDir)) {
        injected = true;
        throw new Error("injected pasteback write failure");
      }
      return result;
    };
    try {
      await assert.rejects(
        () => pasteLocalEditFile(sourcePath, editedPath, outputPath, pastebackOptions),
        "a post-write failure must reject the pasteback",
      );
    } finally {
      sharp.prototype.toFile = originalToFile;
    }
    assert.equal(injected, true, "the write-failure injection must run");
    await assertNoPastebackTempFiles(dir, outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
