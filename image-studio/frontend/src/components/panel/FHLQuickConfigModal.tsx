import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { validateAPIKeyForHeader } from "../../lib/apiKey";
import {
  configureFHLProfilesWithSharedAPIKey,
  verifyFHLImageCapability,
  type FHLQuickVerifyResult,
} from "../../lib/fhlAPI";
import { usePlatform } from "../../platform/context";
import { FHLDesktopAPIConfig } from "./FHLDesktopAPIConfig";

type VerificationSummary = {
  responsesId: string;
  responsesName: string;
  imagesId: string;
  imagesName: string;
  responses: FHLQuickVerifyResult;
  images: FHLQuickVerifyResult;
};

const FHL_QUICK_KEY_RE = /^(?:sk|msk)-[A-Za-z0-9._-]{8,}$/i;

function validateFHLQuickAPIKey(value: string): string {
  const key = validateAPIKeyForHeader(value);
  if (!FHL_QUICK_KEY_RE.test(key)) {
    throw new Error("API Key 格式不正确，请只粘贴 sk-... 或 msk-... 密钥本身。");
  }
  return key;
}

type FHLQuickConfigModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenUpstream: (profileId: string) => void | Promise<void>;
};

export function FHLQuickConfigModal(props: FHLQuickConfigModalProps) {
  const { isAndroid } = usePlatform();
  if (!isAndroid) return <DesktopFHLQuickConfigModal {...props} />;
  return <LegacyFHLQuickConfigModal {...props} />;
}

function DesktopFHLQuickConfigModal({
  open,
  onClose,
  onOpenUpstream,
}: FHLQuickConfigModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="FHL API 配置" width={900}>
      <FHLDesktopAPIConfig
        active={open}
        onClose={onClose}
        onOpenAdvanced={() => void onOpenUpstream("")}
      />
    </Modal>
  );
}

function LegacyFHLQuickConfigModal({
  open,
  onClose,
  onOpenUpstream,
}: FHLQuickConfigModalProps) {
  const { usesFluentUI } = usePlatform();
  const pushToast = useStudioStore((state) => state.pushToast);
  const [apiKeyInput, setAPIKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [stageText, setStageText] = useState("");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setAPIKeyInput("");
    setShowKey(false);
    setIsRunning(false);
    setStageText("");
    setFatalError(null);
    setSummary(null);
  }, [open]);

  const apiKeyError = useMemo(() => {
    if (!apiKeyInput.trim()) return null;
    try {
      validateFHLQuickAPIKey(apiKeyInput);
      return null;
    } catch (error: any) {
      return error?.message ?? "API Key 格式不正确";
    }
  }, [apiKeyInput]);

  const canSubmit = !!apiKeyInput.trim() && !apiKeyError && !isRunning && !summary;

  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }

  async function handleSubmit() {
    let cleanedAPIKey = "";
    try {
      cleanedAPIKey = validateFHLQuickAPIKey(apiKeyInput);
    } catch (error: any) {
      setFatalError(error?.message ?? "API Key 格式不正确");
      return;
    }

    if (cleanedAPIKey !== apiKeyInput) setAPIKeyInput(cleanedAPIKey);
    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setFatalError(null);
    setSummary(null);

    try {
      const store = useStudioStore.getState();
      setStageText("正在配置 Responses...");
      const pair = await configureFHLProfilesWithSharedAPIKey(store, cleanedAPIKey);
      const currentStore = useStudioStore.getState();
      const responsesProfile = currentStore.profiles.find((profile) => profile.id === pair.responsesId);
      const imagesProfile = currentStore.profiles.find((profile) => profile.id === pair.imagesId);
      if (!responsesProfile || !imagesProfile) {
        throw new Error("FHL 配置创建成功，但读取配置结果失败");
      }

      setStageText("正在连接验证 Responses...");
      const responses = await verifyFHLImageCapability(responsesProfile, cleanedAPIKey, {
        proxyMode: currentStore.proxyMode,
        proxyURL: currentStore.proxyURL,
        signal: controller.signal,
      });

      setStageText("正在连接验证 Images...");
      const images = await verifyFHLImageCapability(imagesProfile, cleanedAPIKey, {
        proxyMode: currentStore.proxyMode,
        proxyURL: currentStore.proxyURL,
        signal: controller.signal,
      });

      if (runTokenRef.current !== runToken) return;
      const nextSummary: VerificationSummary = {
        responsesId: pair.responsesId,
        responsesName: responsesProfile.name,
        imagesId: pair.imagesId,
        imagesName: imagesProfile.name,
        responses,
        images,
      };
      setSummary(nextSummary);
      setStageText("");
      if (responses.ok && images.ok) {
        pushToast("FHL Responses / Images 两套配置已完成连接验证。", "success", 4200);
      } else {
        pushToast("FHL 双配置已写入，请查看两套连接验证结果。", "warn", 5200);
      }
    } catch (error: any) {
      if (controller.signal.aborted) return;
      if (runTokenRef.current !== runToken) return;
      setFatalError(error?.message ?? "配置失败");
      setStageText("");
      pushToast(`FHL 快速配置失败：${error?.message ?? error}`, "error", 6000);
    } finally {
      if (runTokenRef.current === runToken) setIsRunning(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function handleOpenUpstream() {
    if (!summary) return;
    await onOpenUpstream(summary.imagesId);
    onClose();
  }

  function renderVerifyRow(label: string, result: FHLQuickVerifyResult, profileName: string) {
    const success = result.ok;
    return (
      <div
        className={`border px-3 py-2 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"} ${
          success
            ? "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
            : "border-red-300/70 bg-red-50 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100"
        }`}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
          {success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{label}：{success ? "成功" : "失败"}</span>
        </div>
        <div className="mt-1 text-[11px] leading-5 opacity-90">{profileName}</div>
        <div className="mt-1 break-words text-[12px] leading-5 [overflow-wrap:anywhere]">{result.detail}</div>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="FHL API Key 快速配置" width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <div className="text-[13px] font-semibold tracking-[0]">粘贴 1 个 FHL API Key</div>
          <div className="mt-1 text-[12px] leading-5">
            我们会自动把同一个 Key 写入 `Responses` 和 `Images` 两套 FHL 配置，并依次做连接验证，不生成测试图。
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold tracking-[0] text-zinc-700 dark:text-zinc-200">API Key</label>
          <div className="relative min-w-0">
            <input
              type="text"
              value={apiKeyInput}
              placeholder="sk-..."
              onChange={(event) => setAPIKeyInput(event.target.value)}
              spellCheck={false}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              name="fhl-quick-config-api-key"
              data-lpignore="true"
              data-1p-ignore="true"
              disabled={isRunning || !!summary}
              style={{ WebkitTextSecurity: showKey ? "none" : "disc" } as CSSProperties & { WebkitTextSecurity: string }}
              className={`focus-ring w-full min-w-0 border bg-[var(--surface)] py-2 pl-3 pr-10 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token disabled:cursor-not-allowed disabled:opacity-70 ${
                apiKeyError || fatalError
                  ? "border-red-400 text-red-700 dark:border-red-500 dark:text-red-200"
                  : "border-black/[0.08] dark:border-white/[0.08]"
              } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              disabled={isRunning}
              title={showKey ? "隐藏" : "显示"}
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {apiKeyError ? <div className="text-[11px] leading-5 text-red-600 dark:text-red-300">{apiKeyError}</div> : null}
          {!apiKeyError ? (
            <div className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              这次粘贴的 Key 会覆盖写入当前 FHL 的 Responses / Images 两套配置。
            </div>
          ) : null}
        </div>

        {isRunning ? (
          <div className={`border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{stageText || "正在处理..."}</span>
            </div>
            <div className="mt-1 text-[11px] leading-5 opacity-90">两套连接验证会顺序执行，只探测 /v1/models，不生成测试图。</div>
          </div>
        ) : null}

        {fatalError ? (
          <div className={`border border-red-300/70 bg-red-50 px-3 py-2 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0]">
              <AlertCircle className="h-4 w-4" />
              <span>配置失败</span>
            </div>
            <div className="mt-1 break-words text-[12px] leading-5 [overflow-wrap:anywhere]">{fatalError}</div>
          </div>
        ) : null}

        {summary ? (
          <div className="flex flex-col gap-3">
            <div className={`border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
              <div className="text-[13px] font-semibold tracking-[0]">两套配置已写入</div>
              <div className="mt-1 text-[12px] leading-5">{summary.responsesName} / {summary.imagesName}</div>
            </div>
            {renderVerifyRow("Responses API", summary.responses, summary.responsesName)}
            {renderVerifyRow("Images API", summary.images, summary.imagesName)}
          </div>
        ) : null}

        <div className="flex gap-2 pt-1 justify-end">
          <button
            type="button"
            onClick={handleClose}
            className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            {summary ? "关闭" : "取消"}
          </button>
          {summary ? (
            <button
              type="button"
              onClick={() => void handleOpenUpstream()}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              打开上游配置
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              {isRunning ? "配置中..." : "确认并配置两套"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
