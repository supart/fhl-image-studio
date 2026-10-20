import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hostMedia = await readFile(new URL("../src/platform/runtime/hostMedia.ts", import.meta.url), "utf8");
const localProjectFiles = await readFile(new URL("../src/platform/runtime/localProjectFiles.ts", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

test("browser Output sync copies managed paths without a base64 request", () => {
  assert.match(localProjectFiles, /copyProjectImageToOutput/);
  assert.match(localProjectFiles, /\/copy-image-to-output/);
  assert.match(hostMedia, /copyProjectImageToOutput\(path, name\)/);
  assert.match(hostMedia, /Keep compatibility with older preview servers/);
  assert.match(viteConfig, /url\.pathname === "\/copy-image-to-output"/);
  assert.match(viteConfig, /assertProjectImagePath/);
  assert.match(viteConfig, /fs\.copyFile\(sourcePath, targetPath\)/);
});

test("browser annotation composites can save PNG bytes directly", () => {
  assert.match(localProjectFiles, /saveProjectImageBlob/);
  assert.match(localProjectFiles, /\/save-image-binary/);
  assert.match(hostMedia, /SaveImageBlobToOutput/);
  assert.match(hostMedia, /saveProjectImageBlob\("output"/);
  assert.match(viteConfig, /url\.pathname === "\/save-image-binary"/);
  assert.match(viteConfig, /readRawBody\(req, ANNOTATION_BINARY_SAVE_MAX_BYTES\)/);
  assert.match(viteConfig, /ANNOTATION_BINARY_SAVE_MAX_BYTES = 512 \* 1024 \* 1024/);
});
