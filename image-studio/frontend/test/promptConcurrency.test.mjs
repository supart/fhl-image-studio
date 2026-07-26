import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const promptEditorSource = await readFile(new URL("../src/components/panel/PromptEditorSection.tsx", import.meta.url), "utf8");
const contextMenuSource = await readFile(new URL("../src/components/common/ContextMenu.tsx", import.meta.url), "utf8");
const controlPanelSource = await readFile(new URL("../src/components/panel/ControlPanel.tsx", import.meta.url), "utf8");
const submitBarSource = await readFile(new URL("../src/components/panel/SubmitBar.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");

function firstGuardFor(actionName) {
  const start = storeSource.indexOf(`${actionName}: async`);
  assert.notEqual(start, -1, `${actionName} action should exist`);
  const rest = storeSource.slice(start);
  const match = rest.match(/if \(([^)]*)\) return;/);
  assert.ok(match, `${actionName} should keep an explicit busy guard`);
  return match[1];
}

test("reverse prompt preview shows the whole image without cropping", () => {
  assert.match(promptEditorSource, /alt="反推参考图预览" className="h-full w-full object-contain object-center"/);
});

test("reverse prompt image slot exposes right-click clipboard paste", () => {
  assert.match(promptEditorSource, /import \{ ContextMenu \} from "\.\.\/common\/ContextMenu";/);
  assert.match(promptEditorSource, /const \[reverseImageMenu, setReverseImageMenu\] = useState<\{ x: number; y: number \} \| null>\(null\);/);
  assert.match(promptEditorSource, /const openReverseImageMenu = \(event: MouseEvent\) => \{/);
  assert.match(promptEditorSource, /event\.preventDefault\(\);[\s\S]+event\.stopPropagation\(\);[\s\S]+setReverseImageMenu\(\{ x: event\.clientX, y: event\.clientY \}\);/);
  assert.match(promptEditorSource, /const pasteReversePromptImageFromClipboard = async \(\) => \{/);
  assert.match(promptEditorSource, /navigator\.clipboard\?\.read/);
  assert.match(promptEditorSource, /const items = await navigator\.clipboard\.read\(\);/);
  assert.match(promptEditorSource, /item\.types\.find\(\(type\) => type\.startsWith\("image\/"\)\)/);
  assert.match(promptEditorSource, /new File\(\[blob\], `clipboard-image\.\$\{clipboardImageExtension\(imageType\)\}`, \{ type: imageType \}\)/);
  assert.match(promptEditorSource, /await onImportReversePromptImageFile\(file\);/);
  assert.match(promptEditorSource, /剪贴板里没有可用图片/);
  assert.match(promptEditorSource, /无法读取剪贴板图片，请使用 Ctrl\+V 或拖入图片/);
  assert.match(promptEditorSource, /label: "粘贴图像"/);
  const contextMenuBindings = promptEditorSource.match(/onContextMenu=\{openReverseImageMenu\}/g) ?? [];
  assert.equal(contextMenuBindings.length, 2);
});

test("context menu uses clipboard icon for image paste", () => {
  assert.match(contextMenuSource, /matchesAny\(label, \[[\s\S]*"复制 prompt"[\s\S]*"复制图像"[\s\S]*"粘贴图像"[\s\S]*\]\)/);
});

test("supplementary prompt header keeps a visible expand control", () => {
  assert.match(promptEditorSource, /ChevronDown/);
  assert.match(promptEditorSource, /aria-expanded=\{promptPrefixOpen\}/);
  assert.match(promptEditorSource, /prompt-prefix-toggle-action/);
  assert.match(promptEditorSource, /\{promptPrefixOpen \? "收起" : "展开"\}/);
});

test("main prompt editor stays collapsed until the expand button is used", () => {
  assert.match(promptEditorSource, /const \[promptExpanded, setPromptExpanded\] = useState\(false\);/);
  assert.match(promptEditorSource, /onClick=\{togglePromptExpanded\}/);
  assert.match(promptEditorSource, /absolute right-1\.5 top-1\.5 z-10 inline-flex h-5 w-5/);
  assert.match(promptEditorSource, /h-2\.5 w-2\.5/);
  assert.match(promptEditorSource, /rows=\{4\}/);
  assert.match(promptEditorSource, /promptExpanded \? "overflow-y-hidden" : "overflow-y-auto"/);
});

test("prompt helper actions can run while image generation is running", () => {
  for (const actionName of ["optimizePrompt", "reversePromptFromImage"]) {
    const guard = firstGuardFor(actionName);
    assert.doesNotMatch(guard, /isRunning/);
    assert.match(guard, /isOptimizingPrompt/);
    assert.match(guard, /isReversingPrompt/);
  }
});

test("single generate mode blocks repeated generate clicks while active tasks are running", () => {
  assert.match(storeSource, /function hasActiveGenerationForWorkspace\(state: StudioState, workspaceId: string\): boolean/);
  assert.match(storeSource, /task\.status === "queued"[\s\S]+task\.status === "running"[\s\S]+task\.launchState === "submitting"[\s\S]+startingContinuousTaskIds\.has\(task\.id\)/);
  assert.match(storeSource, /state\.runningJobs\.length > 0/);
  assert.match(storeSource, /Object\.values\(state\.runningJobMeta\)\.some\(\(meta\) => meta\.workspaceId === workspaceId\)/);
  assert.match(storeSource, /state\.jobGroupsByWorkspace\[workspaceId\]/);
  assert.match(storeSource, /!continuousGenerateTest && !batchProcessMode && hasActiveGenerationForWorkspace\(s, s\.activeWorkspaceId\)/);
  assert.match(storeSource, /连续生成模式关闭时不会并发提交/);

  assert.match(controlPanelSource, /const \[continuousSubmitHintOpen, setContinuousSubmitHintOpen\] = useState\(false\);/);
  assert.match(controlPanelSource, /const submitBlockedByActiveGeneration = !continuousGenerateTest && !batchImageToImageMode/);
  assert.match(controlPanelSource, /activeGenerationTaskCount > 0/);
  assert.match(controlPanelSource, /activeBrowserJobCount > 0/);
  assert.match(controlPanelSource, /function handleSubmit\(\) \{/);
  assert.match(controlPanelSource, /setContinuousSubmitHintOpen\(true\)/);
  assert.match(controlPanelSource, /title="连续生成模式未开启"/);
  assert.match(controlPanelSource, /data-audit-id="enable-continuous-generate-from-submit-hint"/);
  assert.match(controlPanelSource, /setField\("continuousGenerateTest", true as any\)/);
  assert.match(controlPanelSource, /onSubmit=\{handleSubmit\}/);

  assert.match(submitBarSource, /title=\{mainPromptMissing \? "主提示词未输入" : "当前正在生成，点击查看连续生成模式提示"\}/);
  assert.doesNotMatch(submitBarSource, /disabled\s+title="生成进行中"/);
});

test("workspace init button stays right-aligned and uses a solid blue style", () => {
  assert.match(controlPanelSource, /flex items-center justify-between gap-3/);
  assert.match(controlPanelSource, /workspace-init-button platform-pill no-drag inline-flex shrink-0 items-center gap-1\.5 border px-3 py-1\.5 text-\[11px\] font-semibold/);
  assert.match(controlPanelSource, /disabled=\{isRunning \|\| isOptimizingPrompt \|\| isReversingPrompt\}/);
});
