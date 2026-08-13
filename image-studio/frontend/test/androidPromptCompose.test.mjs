import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const phoneCompose = readFileSync(new URL("../src/platform/android/AndroidPhoneComposePanel.tsx", import.meta.url), "utf8");
const padCompose = readFileSync(new URL("../src/platform/android/AndroidPadComposePanel.tsx", import.meta.url), "utf8");
const templateModal = readFileSync(new URL("../src/platform/android/AndroidPromptTemplateModal.tsx", import.meta.url), "utf8");
const phoneSourceSection = readFileSync(new URL("../src/platform/android/AndroidPhoneSourceSection.tsx", import.meta.url), "utf8");
const padSourceSection = readFileSync(new URL("../src/platform/android/AndroidPadSourceSection.tsx", import.meta.url), "utf8");
const promptTouchScroll = readFileSync(new URL("../src/platform/android/AndroidPromptTouchScroll.ts", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("../src/styles/_layout.css", import.meta.url), "utf8");
const parameterCss = readFileSync(new URL("../src/styles/_android-parameters.css", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const storeTypes = readFileSync(new URL("../src/state/studioStore.types.ts", import.meta.url), "utf8");
const workspaces = readFileSync(new URL("../src/state/studioStore.workspaces.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/state/studioStore.runtime.ts", import.meta.url), "utf8");
const shared = readFileSync(new URL("../src/state/studioStore.shared.ts", import.meta.url), "utf8");
const imageActions = readFileSync(new URL("../src/state/studioStore.images.ts", import.meta.url), "utf8");
const domain = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
const promptComposition = readFileSync(new URL("../src/state/promptComposition.ts", import.meta.url), "utf8");

test("Android fixed-height compose keeps every card at its intrinsic height", () => {
  assert.match(
    layoutCss,
    /html\[data-target-platform="android"\] \.android-phone-compose > \* \{\s*flex-shrink: 0;\s*\}/,
  );
});

test("Android prompt editor can collapse and expand like desktop compose panels", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /ChevronDown/);
    assert.match(source, /ChevronRight/);
    assert.match(source, /const \[promptCollapsed, setPromptCollapsed\] = useState\(false\);/);
    assert.match(source, /resizePromptTextarea/);
    assert.match(source, /\[mode, prompt, promptCollapsed\]/);
    assert.match(source, /const promptCollapseLabel = promptCollapsed \? "展开提示词框" : "折叠提示词框";/);
    assert.match(source, /className="android-prompt-collapse-toggle"/);
    assert.match(source, /title=\{promptCollapseLabel\}/);
    assert.match(source, /aria-label=\{promptCollapseLabel\}/);
    assert.match(source, /<span>\{promptCollapseLabel\}<\/span>/);
    assert.match(source, /className="android-prompt-collapsed-preview"/);
    assert.match(source, /setPromptCollapsed\(false\)/);
  }
  assert.match(phoneCompose, /\)\}\s*<div className="android-phone-action-row">/);
  assert.match(padCompose, /\)\}\s*<div className="android-pad-action-row mt-3">/);
  assert.ok(
    phoneCompose.indexOf('className="android-prompt-collapsed-preview"') <
      phoneCompose.indexOf('className="android-phone-action-row"'),
    "phone prompt actions should stay outside the collapsed prompt preview",
  );
  assert.ok(
    padCompose.indexOf('className="android-prompt-collapsed-preview"') <
      padCompose.indexOf('className="android-pad-action-row mt-3"'),
    "pad prompt actions should stay outside the collapsed prompt preview",
  );
  assert.match(layoutCss, /\.android-prompt-collapse-toggle/);
  assert.match(layoutCss, /\.android-prompt-collapse-toggle[\s\S]*margin-top: 6px;/);
  assert.match(layoutCss, /\.android-prompt-collapse-toggle[\s\S]*white-space: nowrap;/);
  assert.match(layoutCss, /\.android-prompt-collapsed-preview/);
  assert.match(layoutCss, /\.android-prompt-collapsed-preview[\s\S]*max-height: 96px;/);
  assert.match(layoutCss, /\.android-prompt-collapsed-preview[\s\S]*overflow-y: auto;/);
  assert.match(layoutCss, /\.android-prompt-collapsed-preview[\s\S]*white-space: pre-wrap;/);
  assert.doesNotMatch(layoutCss, /\.android-prompt-collapsed-preview[\s\S]*-webkit-line-clamp: 2;/);
  assert.match(layoutCss, /\.android-phone-prompt-input[\s\S]*max-height: min\(88vh, 900px\);/);
  assert.match(layoutCss, /\.android-phone-prompt-input[\s\S]*overflow-y: auto;/);
  assert.match(layoutCss, /\.android-pad-prompt-textarea[\s\S]*max-height: min\(78vh, 900px\);/);
  assert.match(layoutCss, /\.android-pad-prompt-textarea[\s\S]*overflow-y: auto;/);
});

test("Android prompt templates are presented as prompt composition", () => {
  assert.match(phoneCompose, /title="prompt 模板与历史"/);
  assert.match(phoneCompose, /> 模板 \/ 历史/);
  assert.match(padCompose, /title="prompt 模板与历史"/);
  assert.match(padCompose, /> 模板 \/ 历史/);
  assert.match(templateModal, /title="模板与历史"/);
  assert.match(templateModal, /android-template-helper/);
  assert.match(templateModal, /追加到主提示词末尾/);
  assert.match(templateModal, /主体、场景、镜头、材质和光照分段组合/);
  assert.match(templateModal, /还没有提交过 prompt/);
  assert.match(templateModal, /onPick\(text\)/);
  assert.match(parameterCss, /\.android-template-helper/);
});

test("Android prompt optimization remains available while image generation is running", () => {
  assert.doesNotMatch(store, /optimizePrompt:[\s\S]*?if \(s\.isRunning/);
  assert.match(phoneCompose, /const optimizeReady = !!prompt\.trim\(\);/);
  assert.match(padCompose, /const optimizeReady = !!prompt\.trim\(\);/);
  assert.doesNotMatch(phoneCompose, /hasUsableResponsesProfile/);
  assert.doesNotMatch(padCompose, /hasUsableResponsesProfile/);
  assert.doesNotMatch(phoneCompose, /apiKey\.trim\(\) && baseURL\.trim\(\)/);
  assert.doesNotMatch(padCompose, /apiKey\.trim\(\) && baseURL\.trim\(\)/);
  assert.match(phoneCompose, /disabled=\{!optimizeReady \|\| isOptimizingPrompt\}/);
  assert.match(padCompose, /disabled=\{!optimizeReady \|\| isOptimizingPrompt\}/);
});

test("Android prompt textarea swipes can scroll the compose page on real phones", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /AndroidPromptTouchScroll/);
    assert.match(source, /const promptTouchRef = useRef<\{ y: number \} \| null>\(null\);/);
    assert.match(source, /onTouchStart=\{\(event\) => handlePromptTextareaTouchStart\(event, promptTouchRef\)\}/);
    assert.match(source, /onTouchMove=\{\(event\) => handlePromptTextareaTouchMove\(event, promptTouchRef\)\}/);
    assert.match(source, /onTouchEnd=\{\(\) => handlePromptTextareaTouchEnd\(promptTouchRef\)\}/);
    assert.match(source, /onTouchCancel=\{\(\) => handlePromptTextareaTouchEnd\(promptTouchRef\)\}/);
  }
  assert.match(promptTouchScroll, /closest\("\.android-phone-compose, \.android-pad-compose, \.control-panel"\)/);
  assert.match(promptTouchScroll, /event\.preventDefault\(\);/);
  assert.match(promptTouchScroll, /panel\.scrollTop -= dy;/);
  assert.match(layoutCss, /\.android-phone-prompt-input[\s\S]*overscroll-behavior-y: auto;/);
  assert.match(layoutCss, /\.android-phone-prompt-input[\s\S]*touch-action: pan-y;/);
  assert.match(layoutCss, /\.android-pad-prompt-textarea[\s\S]*overscroll-behavior-y: auto;/);
  assert.match(layoutCss, /\.android-pad-prompt-textarea[\s\S]*touch-action: pan-y;/);
});

test("Android prompt guidance rewrite mirrors the desktop prompt editor", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /optimizationGuidance/);
    assert.match(source, /const rewriteReady = optimizeReady && optimizationGuidance\.trim\(\)\.length > 0;/);
    assert.match(source, /optimizePrompt\(\{ useGuidance: false \}\)/);
    assert.match(source, /optimizePrompt\(\{ useGuidance: true \}\)/);
    assert.match(source, /aria-label="指令改写提示词"/);
    assert.match(source, />指令改写提示词<\/label>/);
    assert.match(source, /placeholder="输入精准修改指令：去掉帽子 \/ 天上加一只老鹰\.\.\."/);
    assert.match(source, /setField\("optimizationGuidance", event\.target\.value\)/);
    assert.match(source, /setField\("optimizationGuidance", ""\)/);
    assert.match(source, />\s*清除\s*<\/button>/);
    assert.match(source, /disabled=\{!rewriteReady \|\| isOptimizingPrompt \|\| isReversingPrompt\}/);
    assert.match(source, /isOptimizingPrompt \? "优化中\.\.\." : "精准修改"/);
    assert.doesNotMatch(source, /disabled=\{!rewriteReady \|\| isRunning/);
    assert.ok(
      source.indexOf('className="android-prompt-collapsed-preview"') <
        source.indexOf('className="android-prompt-guidance-block"'),
      "guidance rewrite block should remain outside the collapsed prompt preview",
    );
  }
  assert.match(layoutCss, /\.android-prompt-guidance-block/);
  assert.match(layoutCss, /\.android-prompt-guidance-input/);
  assert.match(layoutCss, /\.android-prompt-guidance-button/);
});

test("Android prompt guidance is workspace scoped and persisted with tabs", () => {
  assert.match(storeTypes, /optimizationGuidance: string;/);
  assert.match(storeTypes, /optimizePrompt: \(options\?: \{ useGuidance\?: boolean \}\) => Promise<void>;/);
  assert.match(domain, /optimizationGuidance\?: string;/);
  assert.match(store, /optimizationGuidance: "",/);
  assert.match(store, /key === "optimizationGuidance"/);
  assert.match(store, /optimizationGuidance: options\.useGuidance === false \? "" : s\.optimizationGuidance/);
  assert.match(workspaces, /optimizationGuidance: "",/);
  assert.match(workspaces, /optimizationGuidance: newWorkspace\.optimizationGuidance \?\? ""/);
  assert.match(workspaces, /optimizationGuidance: target\.optimizationGuidance \?\? ""/);
  assert.match(runtime, /optimizationGuidance: s\.optimizationGuidance/);
  assert.match(shared, /optimizationGuidance: typeof raw\.optimizationGuidance === "string" \? raw\.optimizationGuidance : ""/);
});

test("Android prompt text tools require FHL GPT-5.5 instead of APIMart", () => {
  const androidResolver = store.match(/async function resolveAndroidFHLPromptTextProfile[\s\S]*?\r?\n}\r?\nconst HISTORY_MEDIA_HYDRATE_CONCURRENCY/)?.[0] ?? "";
  assert.ok(androidResolver, "Android FHL text profile resolver should be present");
  assert.match(store, /ANDROID_FHL_TEXT_TOOLS_NOTICE = "AI 优化、提示词反推和指令改写需要调用 FHL GPT-5\.5，请先配置 FHL API。"/);
  assert.match(store, /if \(readRuntimePlatformState\(\)\.isAndroid\) \{\s*return resolveAndroidFHLPromptTextProfile\(s\);/);
  assert.match(store, /async function resolveAndroidFHLPromptTextProfile/);
  assert.match(androidResolver, /s\.profiles\s*\.filter\(isOfficialFHLTextProfile\)/);
  assert.match(androidResolver, /Number\(right\.id === s\.activeProfileId\) - Number\(left\.id === s\.activeProfileId\)/);
  assert.match(androidResolver, /for \(const fhlProfile of fhlProfiles\)/);
  assert.match(androidResolver, /if \(!storedKey\.trim\(\)\) continue;/);
  assert.doesNotMatch(androidResolver, /normalizeFHLImagesPoolSlot|fhlImagesPoolSlot/);
  assert.match(androidResolver, /GetStoredAPIKey\(keyringUserFor\(fhlProfile\.id\)\)/);
  assert.doesNotMatch(androidResolver, /GetStoredAPIKey\(keyringUserFor\(fhlProfile\.id\)\)\.catch/);
  assert.doesNotMatch(androidResolver, /storedKey \|\| .*s\.apiKey/);
  assert.doesNotMatch(androidResolver, /s\.apiMode|s\.baseURL|s\.textModelID/);
  assert.match(androidResolver, /textModelID: \(fhlProfile\.textModelID \|\| FHL_TEXT_MODEL_ID\)\.trim\(\)/);
  assert.match(androidResolver, /return \{ apiKey: "", baseURL: "", textModelID: "" \};/);
  assert.doesNotMatch(androidResolver, /apiMode === "apimart"|APIMart/);
  assert.match(store, /s\.pushToast\(ANDROID_FHL_TEXT_TOOLS_NOTICE, "warn", 5200\)/);
  assert.match(store, /optimizeProfile = await resolvePromptTextProfile\(s\);[\s\S]*set\(\{ apiKey: "", errorMessage: message, errorRawPath: null \}\)/);
  assert.match(store, /reverseProfile = await resolvePromptTextProfile\(s\);[\s\S]*set\(\{ apiKey: "", errorMessage: message, errorRawPath: null \}\)/);
});

test("Android error notice recommends APIMart for unstable upstream errors", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /title="关闭"/);
    assert.match(source, /function shouldRecommendAPISwitch\(message: string\)/);
    assert.match(source, /502\|503\|504\|524\|429/);
    assert.match(source, /const recommendAPIMart = recommendAPISwitch && apiMode !== "apimart";/);
    assert.match(source, /const hasMultipleProfiles = profiles\.length > 1;/);
    assert.match(source, /const \[quickProfileOpen, setQuickProfileOpen\] = useState\(false\);/);
    assert.match(source, /const handleSwitchAPIConfig = \(\) => \{/);
    assert.match(source, /if \(hasMultipleProfiles\) \{\s*setQuickProfileOpen\(true\);/);
    assert.match(source, /当前上游可能不稳定，建议切换 API 配置，优先试试 APIMart 异步 API。/);
    assert.match(source, /当前上游可能不稳定，建议切换 API 配置。/);
    assert.match(source, /onClick=\{handleSwitchAPIConfig\}/);
    assert.match(source, /<Settings2 className="h-3 w-3" \/> 切换 API 配置/);
    assert.match(source, /<AndroidQuickProfileSheet open=\{quickProfileOpen\} onClose=\{\(\) => setQuickProfileOpen\(false\)\} \/>/);
    assert.match(source, /openUpstreamConfig\("app"\)/);
    assert.doesNotMatch(source, /鍏抽棴|褰撳墠涓婃父|鍒囨崲 API 閰嶇疆|鏌ョ湅鏃ュ織|锟斤拷|�/);
  }
});

test("Android prompt prefix follows desktop supplemental prompt layout", () => {
  for (const source of [phoneCompose, padCompose]) {
    assert.match(source, /promptPrefix/);
    assert.match(source, /const \[promptPrefixCollapsed, setPromptPrefixCollapsed\] = useState\(true\);/);
    assert.match(source, /补充提示词/);
    assert.match(source, /生成时自动放在主提示词前面/);
    assert.match(source, /可选：输入固定前置提示词，例如画风、角色设定、固定关键词\.\.\./);
    assert.match(source, /主提示词/);
    assert.match(source, /主要描述画面内容，会和补充提示词一起生成/);
    assert.match(source, /setField\("promptPrefix", e\.target\.value\)/);
    assert.match(source, /const effectivePromptReady = promptPrefixActive \|\| prompt\.trim\(\)\.length > 0;/);
    assert.match(source, /disabled=\{!hasUsableUpstream \|\| !hasBaseURL \|\| !effectivePromptReady\}/);
  }
  assert.match(promptComposition, /export function buildEffectivePrompt\(promptPrefix: string, prompt: string\)/);
  assert.match(promptComposition, /return `\$\{prefix\}\\n\$\{main\}`;/);
  assert.match(store, /const effectivePrompt = buildEffectivePrompt\(s\.promptPrefix, s\.prompt\);/);
  assert.match(store, /augmentPromptWithAnnotations\(effectivePrompt,/);
  assert.match(layoutCss, /\.android-prompt-prefix-toggle/);
  assert.match(layoutCss, /\.android-prompt-prefix-input/);
  assert.match(layoutCss, /\.android-prompt-main-block/);
});

test("Android edit mode keeps the desktop-style source image upload area visible", () => {
  assert.match(phoneCompose, /mode === "edit" \? \(/);
  assert.match(phoneCompose, /<AndroidPhoneSourceSection/);
  assert.ok(
    phoneCompose.indexOf("<AndroidPhoneSourceSection") < phoneCompose.indexOf("<AndroidPhoneParameterSection"),
    "phone source upload area should stay near the prompt instead of below all parameters",
  );
  assert.match(padCompose, /mode === "edit" \? \(/);
  assert.match(padCompose, /<AndroidPadSourceSection/);
  assert.doesNotMatch(padCompose, /android-pad-source-placeholder/);
  assert.doesNotMatch(padCompose, /无需参考图/);
  for (const source of [phoneSourceSection, padSourceSection]) {
    assert.match(source, /源图片 \/ 参考图/);
    assert.match(source, /sources\.length > 0 \? ` · \$\{sources\.length\} 张` : ""/);
    assert.match(source, /画板当前图 · 隐式源图/);
    assert.match(source, /> 添加图片/);
    assert.doesNotMatch(source, /使用方式/);
    assert.doesNotMatch(source, /从相册添加/);
  }
  assert.match(parameterCss, /\.android-source-implicit-note/);
});

test("Android removing all reference images keeps explicit image-to-image mode", () => {
  assert.match(imageActions, /removeSource\(index: number\)/);
  assert.match(imageActions, /store\.setState\(\{ sources: next \}\)/);
  assert.match(imageActions, /clearSources\(\)/);
  assert.match(imageActions, /store\.setState\(\{ sources: \[\] \}\)/);
  assert.doesNotMatch(imageActions, /removeSource\(index: number\)[\s\S]*mode: next\.length > 0 \? "edit" : "generate"/);
  assert.doesNotMatch(imageActions, /clearSources\(\)[\s\S]*mode: "generate"/);
});
