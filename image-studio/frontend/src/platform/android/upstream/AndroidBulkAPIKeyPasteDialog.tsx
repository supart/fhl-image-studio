import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ClipboardPaste, LoaderCircle } from "lucide-react";
import { Modal } from "../../../components/common/Modal";
import {
  BULK_API_KEY_MAX_CLIPBOARD_BYTES,
  parseBulkAPIKeyLines,
  type BulkAPIKeyParseResult,
} from "../../../lib/bulkAPIKeys";
import { FHL_IMAGES_POOL_SLOT_COUNT } from "../../../lib/profiles";
import { ReadClipboardText } from "../../runtime/host";

const MASKED_API_KEY_PREVIEW = "sk-************";

type BulkAPIKeyParseSummary = {
  keyCount: number;
  validUniqueCount: number;
  invalidLineNumbers: number[];
  emptyLineCount: number;
  duplicateCount: number;
  overflowCount: number;
  inputTooLarge: boolean;
  inputBytes: number;
  hasInput: boolean;
};

type StagedBulkAPIKeyParse = {
  result: BulkAPIKeyParseResult;
  hasInput: boolean;
};

export type AndroidBulkAPIKeyPasteDialogHandle = {
  stageParsedResult: (result: BulkAPIKeyParseResult, hasInput: boolean) => void;
};

export const AndroidBulkAPIKeyPasteDialog = forwardRef<AndroidBulkAPIKeyPasteDialogHandle, {
  open: boolean;
  pendingDraftCount: number;
  onClose: () => void;
  onConfirm: (keys: readonly string[], result: BulkAPIKeyParseResult) => void;
}>(function AndroidBulkAPIKeyPasteDialog({
  open,
  pendingDraftCount,
  onClose,
  onConfirm,
}, ref) {
  const [parsed, setParsed] = useState<BulkAPIKeyParseSummary | null>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const apiKeysRef = useRef<readonly string[]>([]);
  const stagedParseRef = useRef<StagedBulkAPIKeyParse | null>(null);
  const clipboardRequestIdRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  function clearParsedInput() {
    apiKeysRef.current = [];
    setParsed(null);
  }

  function replaceWithParsedResult(result: BulkAPIKeyParseResult, hasInput: boolean) {
    clearParsedInput();
    const keyCount = result.keys.length;
    apiKeysRef.current = result.inputTooLarge || keyCount === 0 ? [] : result.keys;
    setParsed({
      keyCount,
      validUniqueCount: result.validUniqueCount,
      invalidLineNumbers: result.invalidLineNumbers,
      emptyLineCount: result.emptyLineCount,
      duplicateCount: result.duplicateCount,
      overflowCount: result.overflowCount,
      inputTooLarge: result.inputTooLarge,
      inputBytes: result.inputBytes,
      hasInput,
    });
  }

  function replaceWithIncomingText(incomingText: string) {
    replaceWithParsedResult(
      parseBulkAPIKeyLines(incomingText, FHL_IMAGES_POOL_SLOT_COUNT),
      incomingText.length > 0,
    );
  }

  useImperativeHandle(ref, () => ({
    stageParsedResult(result, hasInput) {
      stagedParseRef.current = { result, hasInput };
    },
  }), []);

  useEffect(() => {
    clipboardRequestIdRef.current += 1;
    clearParsedInput();
    setClipboardError(null);
    setIsReadingClipboard(false);
    if (!open) {
      stagedParseRef.current = null;
    } else if (stagedParseRef.current) {
      const staged = stagedParseRef.current;
      stagedParseRef.current = null;
      replaceWithParsedResult(staged.result, staged.hasInput);
    }
  }, [open]);

  function closeAndClear() {
    clipboardRequestIdRef.current += 1;
    stagedParseRef.current = null;
    clearParsedInput();
    setClipboardError(null);
    setIsReadingClipboard(false);
    onClose();
  }

  async function readSystemClipboard(force = false) {
    if (isReadingClipboard && !force) return;
    const requestId = clipboardRequestIdRef.current + 1;
    clipboardRequestIdRef.current = requestId;
    clearParsedInput();
    setIsReadingClipboard(true);
    setClipboardError(null);
    let incomingText = "";
    try {
      incomingText = await ReadClipboardText();
      if (requestId !== clipboardRequestIdRef.current || !openRef.current) return;
      if (!incomingText.trim()) {
        clearParsedInput();
        setClipboardError("剪贴板里没有文本。");
        return;
      }
      replaceWithIncomingText(incomingText);
    } catch {
      if (requestId !== clipboardRequestIdRef.current || !openRef.current) return;
      clearParsedInput();
      setClipboardError("读取剪贴板失败，请重试。");
    } finally {
      incomingText = "";
      if (requestId === clipboardRequestIdRef.current && openRef.current) {
        setIsReadingClipboard(false);
      }
    }
  }

  function confirmDrafts() {
    if (!parsed || parsed.inputTooLarge || parsed.keyCount === 0) return;
    const keys = [...apiKeysRef.current];
    if (keys.length !== parsed.keyCount) return;
    const result: BulkAPIKeyParseResult = {
      keys,
      validUniqueCount: parsed.validUniqueCount,
      invalidLineNumbers: parsed.invalidLineNumbers,
      emptyLineCount: parsed.emptyLineCount,
      duplicateCount: parsed.duplicateCount,
      overflowCount: parsed.overflowCount,
      inputTooLarge: parsed.inputTooLarge,
      inputBytes: parsed.inputBytes,
    };
    try {
      onConfirm(keys, result);
    } finally {
      closeAndClear();
    }
  }

  const invalidLines = parsed?.invalidLineNumbers.slice(0, 8).join("、") ?? "";
  const invalidLineCount = parsed?.invalidLineNumbers.length ?? 0;
  const invalidLineSuffix = invalidLineCount > 8
    ? ` 等 ${invalidLineCount} 行`
    : "";
  const keyCount = parsed?.keyCount ?? 0;

  return (
    <Modal
      open={open}
      onClose={closeAndClear}
      title="批量配置 10 个 API"
      width={520}
      backdropClassName="android-fhl-bulk-dialog-backdrop"
      cardClassName="android-fhl-bulk-dialog-card"
      headerClassName="android-fhl-bulk-dialog-header"
      bodyClassName="android-fhl-bulk-dialog-body"
    >
      <div className="android-fhl-bulk-dialog" data-audit-id="fhl-bulk-api-dialog">
        <div className="android-fhl-bulk-dialog-intro">
          <strong>每行一个 API</strong>
          <span>可手动批量粘贴 API，或读取系统剪贴板。确认后只会预填草稿，不会保存或测试。</span>
        </div>

        <div className="android-fhl-bulk-input-block">
          <label htmlFor="android-fhl-bulk-api-input">API 粘贴板</label>
          <textarea
            id="android-fhl-bulk-api-input"
            className="android-fhl-bulk-secret-input"
            value=""
            onChange={(event) => {
              event.currentTarget.value = "";
            }}
            onPaste={(event) => {
              event.preventDefault();
              clipboardRequestIdRef.current += 1;
              setIsReadingClipboard(false);
              clearParsedInput();
              setClipboardError(null);
              let incomingText = "";
              try {
                incomingText = event.clipboardData.getData("text");
                replaceWithIncomingText(incomingText);
              } catch {
                clearParsedInput();
                setClipboardError("粘贴内容读取失败，请重试。");
              } finally {
                incomingText = "";
              }
            }}
            placeholder={keyCount > 0 ? `已识别 ${keyCount} 个 API，需修改请重新粘贴覆盖` : "长按此处粘贴 API，每行一个"}
            rows={2}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby="android-fhl-bulk-api-security-note"
            data-audit-id="fhl-bulk-api-input"
          />
          <span id="android-fhl-bulk-api-security-note">粘贴内容不会显示在输入框中，仅在当前浮窗内临时解析。</span>
          <button
            type="button"
            className="android-fhl-bulk-read-clipboard"
            onClick={() => void readSystemClipboard(false)}
            disabled={isReadingClipboard}
            data-audit-id="fhl-bulk-read-clipboard"
          >
            {isReadingClipboard
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <ClipboardPaste className="h-4 w-4" />}
            {isReadingClipboard ? "读取中..." : "读取系统剪贴板"}
          </button>
        </div>

        {parsed?.inputTooLarge ? (
          <div className="android-fhl-bulk-message error" role="alert">
            输入超过 {BULK_API_KEY_MAX_CLIPBOARD_BYTES / 1024} KiB，本批不会预填。
          </div>
        ) : null}
        {clipboardError ? <div className="android-fhl-bulk-message error" role="alert">{clipboardError}</div> : null}

        {parsed?.hasInput && !parsed.inputTooLarge ? (
          <div className="android-fhl-bulk-analysis" aria-live="polite">
            <div className="android-fhl-bulk-stats">
              <span>有效 {parsed.validUniqueCount} · 预填 {parsed.keyCount}/{FHL_IMAGES_POOL_SLOT_COUNT}</span>
              <span>空行 {parsed.emptyLineCount}</span>
              <span>重复 {parsed.duplicateCount}</span>
              <span>忽略 {parsed.overflowCount}</span>
            </div>
            {parsed.invalidLineNumbers.length > 0 ? (
              <div className="android-fhl-bulk-message warn">无效行：{invalidLines}{invalidLineSuffix}</div>
            ) : null}
            {parsed.keyCount > 0 ? (
              <div className="android-fhl-bulk-preview" aria-label={`已识别 ${parsed.keyCount} 个 API`}>
                {Array.from({ length: parsed.keyCount }, (_, index) => (
                  <div key={index} className="android-fhl-bulk-preview-row">
                    <strong>FHL{index + 1}</strong>
                    <span>{MASKED_API_KEY_PREVIEW}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="android-fhl-bulk-message error">没有识别到有效 API，当前草稿不会改变。</div>
            )}
          </div>
        ) : null}

        {pendingDraftCount > 0 ? (
          <div className="android-fhl-bulk-message warn">
            确认后将替换当前未保存的 {pendingDraftCount} 个草稿；已保存凭据不会在此步骤删除。
          </div>
        ) : null}

        <div className="android-fhl-bulk-actions">
          <button type="button" onClick={closeAndClear} data-audit-id="fhl-bulk-cancel">取消</button>
          <button
            type="button"
            className="primary"
            onClick={confirmDrafts}
            disabled={!parsed || parsed.inputTooLarge || parsed.keyCount === 0}
            data-audit-id="fhl-bulk-confirm"
          >
            确认预填 {keyCount} 个
          </button>
        </div>
      </div>
    </Modal>
  );
});
