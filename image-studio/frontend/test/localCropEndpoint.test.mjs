import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("local crop endpoint stays path-only and applies project containment", () => {
  const vite = source("vite.config.ts");
  const crop = source("dev/localCrop.ts");
  const projectFiles = source("src/platform/runtime/localProjectFiles.ts");
  const hostMedia = source("src/platform/runtime/hostMedia.ts");

  assert.match(vite, /import \{ cropLocalImageFile, type LocalCropRequest \} from "\.\/dev\/localCrop"/);
  assert.match(vite, /url\.pathname === "\/crop-image"/);
  assert.match(vite, /assertProjectImagePath\(String\(body\?\.path \|\| ""\)\)/);
  assert.match(vite, /await fs\.rm\(outputPath, \{ force: true \}\)/);
  assert.match(vite, /cropLocalImageFile\(/);

  assert.match(crop, /await sharp\(filePath\)\.metadata\(\)/);
  assert.match(crop, /maxSourcePixels: 100_000_000/);
  assert.match(crop, /maxDimension: 16_384/);
  assert.match(crop, /maxWorkingBytes: 768 \* 1024 \* 1024/);
  assert.match(crop, /x \+ width > source\.width/);
  assert.match(crop, /\.extract\(\{ left: crop\.x, top: crop\.y, width: crop\.width, height: crop\.height \}\)/);
  assert.match(crop, /await fs\.rename\(tempPath, outputPath\)/);
  assert.match(crop, /await fs\.rm\(tempPath, \{ force: true \}\)/);

  assert.match(projectFiles, /fetch\(`\$\{PROJECT_FILES_PREFIX\}\/crop-image`/);
  assert.match(projectFiles, /body: JSON\.stringify\(\{ path: sourcePath, x, y, width, height \}\)/);
  assert.match(hostMedia, /if \(isLocalPreviewHost\(\)\) \{\s*return cropProjectImage\(path, x, y, width, height\);/s);
});

test("local crop keeps native service precedence and does not alter Android fallback", () => {
  const hostMedia = source("src/platform/runtime/hostMedia.ts");
  const cropStart = hostMedia.indexOf("export function CropImage(");
  const cropBlock = hostMedia.slice(cropStart, hostMedia.indexOf("\n}\n\nexport function PasteLocalEdit", cropStart));
  assert.ok(cropStart >= 0);
  assert.ok(cropBlock.indexOf('hasServiceMethod("CropImage")') < cropBlock.indexOf("isLocalPreviewHost()"));
  assert.ok(cropBlock.includes("runPersistedVirtualTransform(path"));
  assert.doesNotMatch(cropBlock, /canInvokeAndroidMethod\(\"CropImage\"\)/);
});

test("local pasteback endpoint stays path-only and keeps native precedence", () => {
  const vite = source("vite.config.ts");
  const projectFiles = source("src/platform/runtime/localProjectFiles.ts");
  const hostMedia = source("src/platform/runtime/hostMedia.ts");
  const paste = source("dev/localPasteback.ts");

  assert.match(vite, /url\.pathname === "\/paste-local-edit"/);
  assert.match(vite, /assertProjectImagePath\(String\(body\?\.sourcePath \|\| ""\)\)/);
  assert.match(vite, /assertProjectImagePath\(String\(body\?\.editedPath \|\| ""\)\)/);
  assert.match(vite, /pasteLocalEditFile\(/);
  assert.match(projectFiles, /body: JSON\.stringify\(\{ sourcePath, editedPath, options \}\)/);
  assert.match(hostMedia, /if \(isLocalPreviewHost\(\)\) \{\s*return pasteProjectLocalEdit\(sourcePath, editedPath, options\);/s);
  assert.match(paste, /await sharp\(sourcePath\)\.metadata\(\)/);
  assert.match(paste, /await sharp\(editedPath\)\.metadata\(\)/);
  assert.doesNotMatch(vite.slice(vite.indexOf('url.pathname === "/paste-local-edit"'), vite.indexOf('url.pathname === "/read-text"')), /imageB64/);

  const pasteStart = hostMedia.indexOf("export function PasteLocalEdit(");
  const pasteBlock = hostMedia.slice(pasteStart, hostMedia.indexOf("\n}\n\nexport function ReadImageAsBase64", pasteStart));
  assert.ok(pasteBlock.indexOf('hasServiceMethod("PasteLocalEdit")') < pasteBlock.indexOf("isLocalPreviewHost()"));
});
