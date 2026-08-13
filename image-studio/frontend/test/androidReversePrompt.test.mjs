import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const phoneCompose = readFileSync(new URL("../src/platform/android/AndroidPhoneComposePanel.tsx", import.meta.url), "utf8");
const padCompose = readFileSync(new URL("../src/platform/android/AndroidPadComposePanel.tsx", import.meta.url), "utf8");
const reverseSheet = readFileSync(new URL("../src/platform/android/AndroidReversePromptSheet.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const imageActions = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const indexStyles = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");
const androidParameterCss = readFileSync(new URL("../src/styles/_android-parameters.css", import.meta.url), "utf8");
const mainActivity = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/MainActivity.kt", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidImageStudioBridge.kt", import.meta.url), "utf8");

test("Android reverse prompt starts work then closes the sheet", () => {
  assert.match(reverseSheet, /onReversePrompt\(\);\s*onClose\(\);/);
});

test("Android reverse prompt image picker accepts data and clipData uris", () => {
  assert.match(mainActivity, /bridge\.onOpenImageDialogResult\(pickedImageUri\(result\.data\)\)/);
  assert.match(mainActivity, /private fun pickedImageUri\(intent: Intent\?\): Uri\?/);
  assert.match(mainActivity, /intent\.data\?\.let \{ return it \}/);
  assert.match(mainActivity, /val clipData = intent\.clipData \?: return null/);
  assert.match(mainActivity, /clipData\.getItemAt\(index\)\?\.uri\?\.let \{ return it \}/);
});

test("Android reverse prompt primary action allows current image fallback", () => {
  assert.match(reverseSheet, /type AndroidReversePromptFallbackImage/);
  assert.match(reverseSheet, /const fallbackPreviewSrc = fallbackImage\?\.previewSrc \|\| ""/);
  assert.match(reverseSheet, /const canReverse = hasImage \|\| !!fallbackImage/);
  assert.match(reverseSheet, /disabled=\{!canReverse \|\| isReversingPrompt\}/);
  assert.match(indexStyles, /html\[data-ui-family="android"\] \.liquid-primary-button:disabled/);
});

test("Android compose panels pass the selected reverse image directly", () => {
  assert.match(phoneCompose, /reversePromptFromImage\(reversePromptImage\)/);
  assert.match(padCompose, /reversePromptFromImage\(reversePromptImage\)/);
});

test("Android reverse prompt remembers the selected image across the native picker boundary", () => {
  assert.match(imageActions, /rememberReversePromptImage\(reversePromptImage\)/);
  assert.match(imageActions, /rememberReversePromptImage\(null\)/);
  assert.match(store, /getRememberedReversePromptImage\(\)/);
});

test("Android reverse prompt uses desktop-like text profile and image fallback order", () => {
  assert.match(store, /async function resolvePromptTextProfile/);
  assert.match(store, /if \(s\.isOptimizingPrompt \|\| s\.isReversingPrompt\) return/);
  assert.match(store, /let optimizeProfile;[\s\S]*optimizeProfile = await resolvePromptTextProfile\(s\)/);
  assert.match(store, /apiKey: optimizeProfile\.apiKey/);
  assert.match(store, /baseURL: optimizeProfile\.baseURL/);
  assert.match(store, /textModelID: optimizeProfile\.textModelID/);
  assert.match(store, /let reverseProfile;[\s\S]*reverseProfile = await resolvePromptTextProfile\(s\)/);
  assert.match(store, /const reverseImage = imageOverride \|\| s\.reversePromptImage \|\| getRememberedReversePromptImage\(\)/);
  assert.match(store, /let current = s\.currentImage/);
  assert.match(store, /if \(current\?\.previewOnly\)/);
  assert.match(store, /await appendReverseSource\(reverseImage\)/);
  assert.match(store, /path: current\.savedPath \|\| ""/);
  assert.match(store, /const first = s\.sources\[0\]/);
  assert.match(store, /sourcePaths\.length === 0 && sourceImages\.length === 0/);
  assert.match(store, /apiKey: reverseProfile\.apiKey/);
  assert.match(store, /baseURL: reverseProfile\.baseURL/);
  assert.match(store, /textModelID: reverseProfile\.textModelID/);
});

test("Android reverse prompt remains available while image generation is running", () => {
  assert.doesNotMatch(store, /reversePromptFromImage:[\s\S]*?if \(s\.isRunning/);
  assert.match(phoneCompose, /disabled=\{isOptimizingPrompt \|\| isReversingPrompt\}/);
  assert.match(padCompose, /disabled=\{isOptimizingPrompt \|\| isReversingPrompt\}/);
});

test("Android reverse prompt running button uses a bright breathing work state", () => {
  assert.match(phoneCompose, /android-reverse-working-action/);
  assert.match(padCompose, /android-reverse-working-action/);
  assert.match(layoutCss, /@keyframes android-reverse-working-breathe/);
  assert.match(layoutCss, /\.android-reverse-working-action:disabled/);
  assert.match(layoutCss, /animation: android-reverse-working-breathe 1\.2s ease-in-out infinite alternate/);
  assert.match(layoutCss, /color: rgb\(254 240 138\)/);
  assert.match(layoutCss, /opacity: 1;/);
});

test("Android reverse prompt converts native paths to sourceImages before remote reverse", () => {
  assert.match(store, /const appendReverseSource = async/);
  assert.match(store, /let imageB64 = source\.imageB64 \|\| ""/);
  assert.match(store, /imageB64 = await ReadImageAsBase64\(path\)\.catch\(\(\) => ""\)/);
  assert.match(store, /sourceImages\.push\(\{/);
  assert.match(store, /imageB64: imageB64 \|\| null/);
  assert.match(store, /sourceImages,/);
});

test("Android reverse prompt keeps compressed preview out of upload payload", () => {
  assert.match(imageActions, /const imageB64 = res\.imageB64 \|\| ""/);
  assert.doesNotMatch(imageActions, /const previewB64 = res\.previewUrl/);
  assert.doesNotMatch(imageActions, /res\.previewUrl[\s\S]*?slice\(res\.previewUrl\.indexOf\(","\) \+ 1\)/);
  assert.match(store, /imageB64 = await ReadImageAsBase64\(path\)\.catch\(\(\) => ""\)/);
});

test("Android picker uses a 1536px high quality dialog preview", () => {
  assert.match(bridge, /private const val maxDialogPreviewEdge = 1536/);
  assert.match(bridge, /private const val dialogPreviewJpegQuality = 92/);
  assert.match(bridge, /createPreviewB64\(file, maxDialogPreviewEdge, dialogPreviewJpegQuality\)/);
  assert.doesNotMatch(bridge, /private const val maxPreviewEdge = 384/);
});

test("Android compose panels expose a short reverse prompt entry", () => {
  assert.match(phoneCompose, /反推/);
  assert.match(padCompose, /反推/);
  assert.match(phoneCompose, /AndroidReversePromptSheet/);
  assert.match(padCompose, /AndroidReversePromptSheet/);
  assert.match(phoneCompose, /fallbackImage=\{reverseFallbackImage \|\| null\}/);
  assert.match(padCompose, /fallbackImage=\{reverseFallbackImage \|\| null\}/);
  assert.match(phoneCompose, /label: "当前画板图片"/);
  assert.match(phoneCompose, /label: "第一张参考图"/);
  assert.match(phoneCompose, /previewSrc: currentImage\.previewUrl \|\| currentImage\.fullUrl/);
  assert.match(phoneCompose, /previewSrc: sources\[0\]\?\.previewUrl/);
});

test("Android reverse prompt sheet keeps the mobile bottom-sheet flow", () => {
  assert.match(reverseSheet, /title="反推提示词"/);
  assert.match(reverseSheet, /选择一张图片/);
  assert.match(reverseSheet, /反推中\.\.\./);
  assert.match(reverseSheet, /把图片反推成中文文生图提示词/);
  assert.match(reverseSheet, /关闭此窗口，反推会继续进行/);
  assert.match(reverseSheet, /开始反推后可以关闭此窗口/);
});

test("Android reverse prompt sheet has dark-mode surface styles", () => {
  assert.match(androidParameterCss, /html\.dark\[data-platform="android"\] \.app-modal-card-phone\.android-reverse-modal-card/);
  assert.match(androidParameterCss, /html\.dark\[data-platform="android"\] \.app-modal-card-desktop\.android-reverse-modal-card/);
  assert.match(androidParameterCss, /\.android-reverse-image-card/);
  assert.match(androidParameterCss, /\.android-reverse-preview-frame/);
  assert.match(androidParameterCss, /\.android-reverse-upload-drop/);
  assert.match(androidParameterCss, /\.android-reverse-secondary-action/);
  assert.match(androidParameterCss, /\.android-reverse-danger-action/);
  assert.match(androidParameterCss, /\.android-reverse-primary-action:disabled/);
  assert.match(androidParameterCss, /\.android-reverse-helper/);
});

test("Android compose panels tell users reverse prompt continues after closing", () => {
  assert.match(phoneCompose, /handleCloseReverse/);
  assert.match(padCompose, /handleCloseReverse/);
  assert.match(phoneCompose, /反推仍在后台进行，完成后会写入主提示词/);
  assert.match(padCompose, /反推仍在后台进行，完成后会写入主提示词/);
});
