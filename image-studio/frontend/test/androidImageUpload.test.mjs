import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const mainActivity = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/MainActivity.kt", import.meta.url),
  "utf8",
);
const bridge = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidImageStudioBridge.kt", import.meta.url),
  "utf8",
);

test("Android edit submit materializes visible inline reference images before path validation", () => {
  assert.match(store, /import \{ ensureBase64FromSource \} from "\.\.\/lib\/images";/);
  assert.match(store, /async function inlineSourceImageBase64\(source: SourceImage\): Promise<string>/);
  assert.match(store, /ensureBase64FromSource\(source\)/);
  assert.match(store, /previewUrl\.includes\(","\)[\s\S]*stripDataURLPrefix\(previewUrl\)/);
  assert.match(store, /async function materializeInlineEditSources\(sources: SourceImage\[\]\): Promise<SourceImage\[\]>/);
  assert.match(store, /const imported = await ImportImageFromB64\(imageB64, source\.name \|\| "source\.png"\)\.catch\(\(\) => null\)/);
  assert.match(store, /path: nextPath/);
  assert.match(store, /imageBlob: null/);

  const submitBlock = store.match(/let editSourcePaths: string\[\] = \[\];[\s\S]*?editSourcePaths = preparedSources\.map/)?.[0] ?? "";
  assert.match(submitBlock, /const inlineMaterializedSources = await materializeInlineEditSources\(preparedSources\)/);
  assert.match(submitBlock, /set\(\{ sources: inlineMaterializedSources \}\)/);
});

test("Android current native picker is single-result, so multiple references are added by repeated adds", () => {
  assert.match(mainActivity, /ActivityResultContracts\.OpenDocument\(\)/);
  assert.match(mainActivity, /bridge\.onOpenImageDialogResult\(pickedImageUri\(result\.data\)\)/);
  assert.match(mainActivity, /private fun pickedImageUri\(intent: Intent\?\): Uri\?/);
  assert.match(mainActivity, /clipData\.getItemAt\(index\)\?\.uri\?\.let \{ return it \}/);
  assert.doesNotMatch(mainActivity, /OpenMultipleDocuments|PickMultipleVisualMedia|ACTION_PICK_IMAGES[\s\S]*EXTRA_PICK_IMAGES_MAX|EXTRA_ALLOW_MULTIPLE/);
});

test("Android imported source images use unique file paths even for same-second duplicate names", () => {
  assert.match(bridge, /val target = uniqueTargetFile\(importsDir\(\), "\$\{timestamp\(\)\}-\$name"\)/);
  assert.match(bridge, /val file = uniqueTargetFile\(importsDir\(\), "\$\{timestamp\(\)\}-\$safeName"\)/);
  assert.doesNotMatch(bridge, /val target = File\(importsDir\(\), "\$\{timestamp\(\)\}-\$name"\)/);
  assert.doesNotMatch(bridge, /val file = File\(importsDir\(\), "\$\{timestamp\(\)\}-\$safeName"\)/);
});

test("Android picker previews keep 1536px detail for reverse prompt readability", () => {
  assert.match(bridge, /private const val maxDialogPreviewEdge = 1536/);
  assert.match(bridge, /private const val dialogPreviewJpegQuality = 92/);
  assert.match(bridge, /createPreviewB64\(file, maxDialogPreviewEdge, dialogPreviewJpegQuality\)/);
  assert.match(bridge, /private const val maxCanvasPreviewEdge = 1280/);
  assert.match(bridge, /private const val defaultPreviewJpegQuality = 74/);
});
