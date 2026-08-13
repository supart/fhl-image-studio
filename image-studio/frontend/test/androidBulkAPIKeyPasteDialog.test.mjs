import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseBulkAPIKeyLines } from "../src/lib/bulkAPIKeys.ts";

const dialog = readFileSync(
  new URL("../src/platform/android/upstream/AndroidBulkAPIKeyPasteDialog.tsx", import.meta.url),
  "utf8",
);
const pool = readFileSync(
  new URL("../src/platform/android/upstream/AndroidFHLImagesPoolConfig.tsx", import.meta.url),
  "utf8",
);
const upstreamModal = readFileSync(
  new URL("../src/platform/android/upstream/AndroidUpstreamConfigModal.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles/_android-upstream.css", import.meta.url),
  "utf8",
);
const compatMatrix = readFileSync(
  new URL("../scripts/android-compat-matrix.mjs", import.meta.url),
  "utf8",
);

test("Android ten-slot bulk entry opens a controlled dialog without reading or persisting", () => {
  assert.match(pool, /<AndroidBulkAPIKeyPasteDialog/);
  assert.match(pool, /批量配置 10 个 API/);
  assert.match(pool, /onClick=\{\(\) => openBulkPasteDialog\(\)\}/);
  const openBlock = pool.slice(
    pool.indexOf("function openBulkPasteDialog"),
    pool.indexOf("function confirmBulkPaste"),
  );
  assert.match(openBlock, /onBulkPasteOpenChange\(true\)/);
  for (const forbidden of ["ReadClipboardText", "createProfile(", "updateProfile(", "testProfileConnection(", "saveSlots("]) {
    assert.doesNotMatch(openBlock, new RegExp(forbidden.replace("(", "\\(")));
  }
  assert.doesNotMatch(pool, /bulkPasteInitialText|setBulkPasteInitialText|initialText=\{/);
  assert.match(pool, /const bulkPasteDialogRef = useRef<AndroidBulkAPIKeyPasteDialogHandle>\(null\)/);
  assert.match(pool, /ref=\{bulkPasteDialogRef\}/);
  assert.doesNotMatch(pool, /bulkPasteReadClipboardOnOpen|readClipboardOnOpen=/);
  assert.doesNotMatch(dialog, /readClipboardOnOpen: boolean/);
  assert.doesNotMatch(dialog, /initialText: string/);
});

test("bulk dialog parses incoming text synchronously, releases it, and renders fixed masks only", () => {
  assert.match(dialog, /<textarea/);
  assert.match(dialog, /value=""/);
  assert.match(dialog, /rows=\{2\}/);
  assert.match(dialog, /onPaste=\{\(event\) => \{/);
  assert.match(dialog, /event\.preventDefault\(\)/);
  assert.match(dialog, /event\.clipboardData\.getData\("text"\)/);
  assert.doesNotMatch(dialog, /value=\{rawText\}/);
  assert.doesNotMatch(dialog, /useState\(\s*["']{2}\s*\).*rawText|\[rawText,\s*setRawText\]/);
  assert.doesNotMatch(dialog, /useMemo/);
  assert.match(dialog, /ReadClipboardText\(\)/);
  assert.match(dialog, /async function readSystemClipboard\(force = false\)/);
  assert.match(dialog, /function replaceWithIncomingText\(incomingText: string\)/);
  assert.match(dialog, /parseBulkAPIKeyLines\(incomingText, FHL_IMAGES_POOL_SLOT_COUNT\)/);
  assert.match(dialog, /finally \{\s*incomingText = "";\s*\}/);
  assert.match(dialog, /const apiKeysRef = useRef<readonly string\[\]>\(\[\]\)/);
  assert.match(dialog, /type BulkAPIKeyParseSummary = \{/);
  const summaryType = dialog.slice(
    dialog.indexOf("type BulkAPIKeyParseSummary"),
    dialog.indexOf("type StagedBulkAPIKeyParse"),
  );
  assert.doesNotMatch(summaryType, /keys\s*:/);
  assert.match(dialog, /apiKeysRef\.current = result\.inputTooLarge \|\| keyCount === 0 \? \[\] : result\.keys/);
  const pasteBlock = dialog.slice(
    dialog.indexOf("onPaste={(event) =>"),
    dialog.indexOf("placeholder={keyCount"),
  );
  assert.match(pasteBlock, /clearParsedInput\(\)[\s\S]*clipboardData\.getData\("text"\)/);
  assert.match(pasteBlock, /catch \{[\s\S]*clearParsedInput\(\)[\s\S]*粘贴内容读取失败，请重试/);
  assert.match(dialog, /const MASKED_API_KEY_PREVIEW = "sk-\*\*\*\*\*\*\*\*\*\*\*\*"/);
  assert.match(dialog, /有效 \{parsed\.validUniqueCount\} · 预填 \{parsed\.keyCount\}/);
  assert.match(dialog, /空行 \{parsed\.emptyLineCount\}/);
  assert.match(dialog, /重复 \{parsed\.duplicateCount\}/);
  assert.match(dialog, /忽略 \{parsed\.overflowCount\}/);
  assert.match(dialog, /invalidLineNumbers\.slice\(0, 8\)/);
  assert.match(dialog, /Array\.from\(\{ length: parsed\.keyCount \}/);
  assert.doesNotMatch(dialog, /parsed\.keys/);
  assert.doesNotMatch(dialog, /apiKey\.slice|rawText\.slice|console\./);
});

test("invalid, oversized, closed, confirmed, or failed replacements clear retained keys", () => {
  const clearBlock = dialog.slice(
    dialog.indexOf("function clearParsedInput"),
    dialog.indexOf("function replaceWithIncomingText"),
  );
  assert.match(clearBlock, /apiKeysRef\.current = \[\]/);
  assert.match(clearBlock, /setParsed\(null\)/);
  const replaceBlock = dialog.slice(
    dialog.indexOf("function replaceWithParsedResult"),
    dialog.indexOf("useEffect(() =>"),
  );
  assert.match(replaceBlock, /clearParsedInput\(\)/);
  assert.match(replaceBlock, /result\.inputTooLarge \|\| keyCount === 0 \? \[\] : result\.keys/);
  const closeBlock = dialog.slice(
    dialog.indexOf("function closeAndClear"),
    dialog.indexOf("async function readSystemClipboard"),
  );
  assert.match(closeBlock, /clearParsedInput\(\)/);
  const readBlock = dialog.slice(
    dialog.indexOf("async function readSystemClipboard"),
    dialog.indexOf("function confirmDrafts"),
  );
  assert.match(readBlock, /clipboardRequestIdRef\.current = requestId;\s*clearParsedInput\(\)/);
  assert.match(readBlock, /catch \{[\s\S]*clearParsedInput\(\)[\s\S]*读取剪贴板失败，请重试/);
  const confirmBlock = dialog.slice(
    dialog.indexOf("function confirmDrafts"),
    dialog.indexOf("const invalidLines"),
  );
  assert.match(confirmBlock, /try \{[\s\S]*onConfirm\(keys, result\)[\s\S]*\} finally \{[\s\S]*closeAndClear\(\)/);
  assert.match(dialog, /disabled=\{!parsed \|\| parsed\.inputTooLarge \|\| parsed\.keyCount === 0\}/);
});

test("closing the dialog invalidates an in-flight clipboard read", () => {
  assert.match(dialog, /const clipboardRequestIdRef = useRef\(0\)/);
  assert.match(dialog, /const openRef = useRef\(open\)/);
  assert.match(dialog, /clipboardRequestIdRef\.current \+= 1/);
  assert.match(dialog, /requestId !== clipboardRequestIdRef\.current \|\| !openRef\.current/);
  assert.match(dialog, /requestId === clipboardRequestIdRef\.current && openRef\.current/);
  assert.match(compatMatrix, /cancelled clipboard read repopulated the reopened bulk dialog/);
});

test("a staged single-slot bulk parse is discarded when the parent closes before opening", () => {
  const lifecycleBlock = dialog.slice(
    dialog.indexOf("useEffect(() =>"),
    dialog.indexOf("function closeAndClear"),
  );
  assert.match(lifecycleBlock, /if \(!open\) \{\s*stagedParseRef\.current = null/);
  assert.match(lifecycleBlock, /else if \(stagedParseRef\.current\)/);
});

test("dialog confirmation replaces drafts only after confirmation and collapses all slots", () => {
  const confirmBlock = pool.slice(
    pool.indexOf("function confirmBulkPaste"),
    pool.indexOf("async function activateFirstSuccessfulProfile"),
  );
  assert.match(confirmBlock, /const nextDrafts = createSlotDrafts\(\)/);
  assert.match(confirmBlock, /\{ apiKey, isBulkStaged: true \}/);
  assert.match(confirmBlock, /setSlotDrafts\(nextDrafts\)/);
  assert.match(confirmBlock, /setSlotResults\(\{\}\)/);
  assert.match(confirmBlock, /setExpandedIndex\(-1\)/);
  for (const forbidden of ["createProfile(", "updateProfile(", "testProfileConnection(", "saveSlots("]) {
    assert.doesNotMatch(confirmBlock, new RegExp(forbidden.replace("(", "\\(")));
  }
  assert.match(dialog, /pendingDraftCount > 0/);
  assert.match(dialog, /取消/);
  assert.match(dialog, /确认预填 \{keyCount\} 个/);
  assert.match(dialog, /disabled=\{!parsed \|\| parsed\.inputTooLarge \|\| parsed\.keyCount === 0\}/);
  assert.match(pool, /value=\{draft\.isBulkStaged \? "" : draft\.apiKey\}/);
  assert.match(pool, /批量预填已就绪；输入新值才替换/);
});

test("saved slot UI never renders stored API key hints or tails", () => {
  assert.doesNotMatch(pool, /function displayKeyHint/);
  assert.doesNotMatch(pool, /已保存 \$\{displayKeyHint/);
  assert.match(pool, /profileHasCredential\s*\? "已保存密钥"/);
  assert.match(pool, /\? "已保存密钥；输入新值才覆盖"/);
});

test("compat matrix audits the actual generated synthetic keys and their tails", () => {
  assert.match(compatMatrix, /fullKeyLeakCount: keys\.filter/);
  assert.match(compatMatrix, /tailLeakCount: keys\.filter/);
  assert.match(compatMatrix, /window\.__androidBulkMatrixClipboardText/);
  assert.match(compatMatrix, /bulk staged draft leaked synthetic API material/);
  assert.doesNotMatch(compatMatrix, /text\.includes\("android-bulk-matrix"\)/);
});

test("single-slot multiline or multi-key clipboard content is routed into the bulk dialog", () => {
  const singlePasteBlock = pool.slice(
    pool.indexOf("async function pasteSlot"),
    pool.indexOf("function openBulkPasteDialog"),
  );
  assert.match(singlePasteBlock, /parsed\.inputTooLarge/);
  assert.match(singlePasteBlock, /\/\\r\|\\n\/\.test\(text\)/);
  assert.match(singlePasteBlock, /tokenCount > 1/);
  assert.match(singlePasteBlock, /bulkPasteDialogRef\.current\?\.stageParsedResult\(parsed, text\.length > 0\)/);
  assert.match(singlePasteBlock, /text = "";\s*openBulkPasteDialog\(\)/);
  assert.equal((singlePasteBlock.match(/ReadClipboardText\(\)/g) ?? []).length, 1);
  assert.match(singlePasteBlock, /finally \{\s*text = "";/);
  assert.match(singlePasteBlock, /if \(parsed\.keys\.length !== 1\)/);
  assert.match(singlePasteBlock, /当前槽位未修改/);
  assert.match(singlePasteBlock, /patchSlot\(index, parsed\.keys\[0\]\)/);
});

test("Escape and parent close prefer the bulk child layer", () => {
  assert.match(upstreamModal, /const \[fhlBulkPasteOpen, setFHLBulkPasteOpen\] = useState\(false\)/);
  const closeBlock = upstreamModal.slice(
    upstreamModal.indexOf("function handleCloseTopLayer"),
    upstreamModal.indexOf("async function handleUseExistingFHLResponses"),
  );
  assert.match(closeBlock, /if \(fhlBulkPasteOpen\)/);
  assert.match(closeBlock, /setFHLBulkPasteOpen\(false\)/);
  assert.match(closeBlock, /return;/);
  assert.match(upstreamModal, /onClose=\{handleCloseTopLayer\}/);
  assert.match(upstreamModal, /onBulkPasteOpenChange=\{setFHLBulkPasteOpen\}/);
});

test("bulk dialog keeps preview and actions usable on Android without rendering raw input", () => {
  assert.match(styles, /\.android-fhl-bulk-secret-input[\s\S]*box-sizing: border-box[\s\S]*height: 64px[\s\S]*min-height: 64px[\s\S]*resize: none/);
  assert.doesNotMatch(styles, /-webkit-text-security/);
  assert.match(styles, /\.android-fhl-bulk-preview[\s\S]*max-height: 220px[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.android-fhl-bulk-actions[\s\S]*position: sticky/);
  assert.match(styles, /\.android-fhl-bulk-dialog-backdrop[\s\S]*z-index: 9200/);
});

test("ten synthetic keys remain ordered while the UI source contains none of them", () => {
  const keys = Array.from({ length: 10 }, (_, index) => `sk-dialog-test-${String(index + 1).padStart(2, "0")}-abcdefgh`);
  const parsed = parseBulkAPIKeyLines(keys.join("\n"), 10);
  assert.deepEqual(parsed.keys, keys);
  assert.equal(parsed.inputTooLarge, false);
  for (const key of keys) {
    assert.ok(!dialog.includes(key));
    assert.ok(!pool.includes(key));
  }
});
