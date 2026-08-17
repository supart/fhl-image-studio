import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ClipboardPaste, LoaderCircle } from "lucide-react";
import { Modal } from "../common/Modal";
import {
  BULK_API_KEY_MAX_CLIPBOARD_BYTES,
  parseBulkAPIKeyLines,
  type BulkAPIKeyParseResult,
} from "../../lib/bulkAPIKeys";
import { FHL_IMAGES_POOL_SLOT_COUNT } from "../../lib/profiles";
import { usePlatform } from "../../platform/context";
import { ReadClipboardText } from "../../platform/runtime/host";

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

export type FHLBulkAPIKeyPasteDialogHandle = {
  stageParsedResult: (result: BulkAPIKeyParseResult, hasInput: boolean) => void;
};

export const FHLBulkAPIKeyPasteDialog = forwardRef<FHLBulkAPIKeyPasteDialogHandle, {
  open: boolean;
  pendingDraftCount: number;
  onClose: () => void;
  onConfirm: (keys: readonly string[], result: BulkAPIKeyParseResult) => void;
}>(function FHLBulkAPIKeyPasteDialog({
  open,
  pendingDraftCount,
  onClose,
  onConfirm,
}, ref) {
  const { usesFluentUI } = usePlatform();
  const [parsed, setParsed] = useState<BulkAPIKeyParseSummary | null>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const apiKeysRef = useRef<readonly string[]>([]);
  const stagedParseRef = useRef<StagedBulkAPIKeyParse | null>(null);
  const clipboardRequestIdRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  const clearParsedInput = useCallback(() => {
    apiKeysRef.current = [];
    setParsed(null);
  }, []);

  const replaceWithParsedResult = useCallback((result: BulkAPIKeyParseResult, hasInput: boolean) => {
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
  }, [clearParsedInput]);

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
  }, [clearParsedInput, open, replaceWithParsedResult]);

  function closeAndClear() {
    clipboardRequestIdRef.current += 1;
    stagedParseRef.current = null;
    clearParsedInput();
    setClipboardError(null);
    setIsReadingClipboard(false);
    onClose();
  }

  async function readSystemClipboard() {
    if (isReadingClipboard) return;
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
  const invalidLineSuffix = invalidLineCount > 8 ? ` 等 ${invalidLineCount} 行` : "";
  const keyCount = parsed?.keyCount ?? 0;
  const surfaceRadius = usesFluentUI ? "rounded-[8px]" : "rounded-[12px]";

  return (
    <Modal
      open={open}
      onClose={closeAndClear}
      title="批量配置 10 个 API"
      width={560}
      cardClassName="fhl-bulk-api-dialog"
      bodyClassName="fhl-bulk-api-dialog-body"
    >
      <div className="flex min-w-0 flex-col gap-3" data-audit-id="fhl-bulk-api-dialog">
        <div className={`border border-sky-200/80 bg-sky-50 px-3 py-2.5 text-sky-950 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-100 ${surfaceRadius}`}>
          <strong className="block text-[13px]">每行一个 API</strong>
          <span className="mt-0.5 block text-[11px] leading-5 opacity-85">确认后只会预填槽 1-10，不会保存、测试或联网。</span>
        </div>

        <div className={`border border-black/[0.08] bg-[var(--surface)]/70 p-3 dark:border-white/[0.08] ${surfaceRadius}`}>
          <label htmlFor="fhl-bulk-api-input" className="block text-[12px] font-medium text-zinc-800 dark:text-zinc-200">API 粘贴板</label>
          <textarea
            id="fhl-bulk-api-input"
            className={`focus-ring mt-2 h-16 min-h-16 w-full resize-none border border-black/[0.1] bg-white/85 px-3 py-2 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.1] dark:bg-black/15 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${surfaceRadius}`}
            value=""
            onChange={(event) => { event.currentTarget.value = ""; }}
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
            placeholder={keyCount > 0 ? `已识别 ${keyCount} 个 API，重新粘贴即可覆盖` : "在此粘贴 API，每行一个"}
            rows={2}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby="fhl-bulk-api-security-note"
            data-audit-id="fhl-bulk-api-input"
          />
          <span id="fhl-bulk-api-security-note" className="mt-1 block text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">原始内容不会显示在输入框中，只在当前弹窗内临时解析。</span>
          <button
            type="button"
            className={`platform-action-btn mt-2 inline-flex h-8 items-center gap-1.5 border border-black/[0.08] px-2.5 text-[11px] text-zinc-700 hover:bg-black/[0.04] disabled:opacity-55 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${surfaceRadius}`}
            onClick={() => void readSystemClipboard()}
            disabled={isReadingClipboard}
            data-audit-id="fhl-bulk-read-clipboard"
          >
            {isReadingClipboard ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
            {isReadingClipboard ? "读取中..." : "读取系统剪贴板"}
          </button>
        </div>

        {parsed?.inputTooLarge ? (
          <div className={`border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] text-red-900 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${surfaceRadius}`} role="alert">
            输入超过 {BULK_API_KEY_MAX_CLIPBOARD_BYTES / 1024} KiB，本批不会预填。
          </div>
        ) : null}
        {clipboardError ? <div className="text-[12px] text-red-600 dark:text-red-300" role="alert">{clipboardError}</div> : null}

        {parsed?.hasInput && !parsed.inputTooLarge ? (
          <div className={`border border-black/[0.08] bg-[var(--surface)]/55 p-3 dark:border-white/[0.08] ${surfaceRadius}`} aria-live="polite">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
              <span>有效 {parsed.validUniqueCount} · 预填 {parsed.keyCount}/{FHL_IMAGES_POOL_SLOT_COUNT}</span>
              <span>空行 {parsed.emptyLineCount}</span>
              <span>重复 {parsed.duplicateCount}</span>
              <span>忽略 {parsed.overflowCount}</span>
            </div>
            {parsed.invalidLineNumbers.length > 0 ? <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">无效行：{invalidLines}{invalidLineSuffix}</div> : null}
            {parsed.keyCount > 0 ? (
              <div className="mt-2 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto" aria-label={`已识别 ${parsed.keyCount} 个 API`}>
                {Array.from({ length: parsed.keyCount }, (_, index) => (
                  <div key={index} className={`flex min-w-0 items-center justify-between gap-2 border border-black/[0.06] bg-white/70 px-2.5 py-1.5 text-[11px] dark:border-white/[0.06] dark:bg-black/10 ${surfaceRadius}`}>
                    <strong>API {index + 1}</strong>
                    <span className="truncate font-mono-token text-zinc-500 dark:text-zinc-400">{MASKED_API_KEY_PREVIEW}</span>
                  </div>
                ))}
              </div>
            ) : <div className="mt-2 text-[11px] text-red-600 dark:text-red-300">没有识别到有效 API，当前草稿不会改变。</div>}
          </div>
        ) : null}

        {pendingDraftCount > 0 ? (
          <div className={`border border-amber-300/70 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${surfaceRadius}`}>
            确认后将替换当前未保存的 {pendingDraftCount} 个草稿；未覆盖槽的已保存凭据不会删除。
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={closeAndClear} className={`platform-action-btn h-9 border border-black/[0.08] px-3 text-[12px] text-zinc-700 dark:border-white/[0.08] dark:text-zinc-300 ${surfaceRadius}`} data-audit-id="fhl-bulk-cancel">取消</button>
          <button
            type="button"
            className={`liquid-primary-button h-9 bg-[var(--accent)] px-3 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${surfaceRadius}`}
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
