import { useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, ClipboardCopy, FileText, ImageUp, ListPlus, RotateCw, Search, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { copyText } from "../../lib/fhlAPI";
import { FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, isOfficialFHLPoolProfile } from "../../lib/profiles";
import { dataURLFromBase64 } from "../../lib/images";
import { OpenFile } from "../runtime/host";
import { QUALITY_TIERS, STYLE_CHIPS } from "../../components/panel/panelOptions";
import type { Mode } from "../../types/domain";
import { AndroidModeSwitch } from "./AndroidModeSwitch";
import { usePlatform } from "../context";
import { vibrateForPlatform } from "./bridge";
import { AndroidAdvancedSection } from "./AndroidAdvancedSection";
import { AndroidPadParameterSection } from "./AndroidPadParameterSection";
import { AndroidPadSourceSection } from "./AndroidPadSourceSection";
import { AndroidPromptTemplateModal } from "./AndroidPromptTemplateModal";
import { AndroidQuickProfileSheet } from "./AndroidQuickProfileSheet";
import { AndroidReversePromptSheet } from "./AndroidReversePromptSheet";
import {
  handlePromptTextareaTouchEnd,
  handlePromptTextareaTouchMove,
  handlePromptTextareaTouchStart,
} from "./AndroidPromptTouchScroll";
import {
  availableResolutionPresets,
  deriveAspectPreset,
  deriveResolutionPreset,
} from "../../components/panel/sizeCapabilities";
import {
  buildAndroidAspectSizeSelection,
  buildAndroidResolutionSizeSelection,
} from "./parameters/androidSizeSelection";

function resizePromptTextarea(input: HTMLTextAreaElement | null) {
  if (!input) return;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
  const maxHeight = Math.max(420, Math.min(900, Math.round(viewportHeight * 0.78)));
  input.style.height = "auto";
  const nextHeight = Math.min(input.scrollHeight, maxHeight);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function shouldRecommendAPISwitch(message: string): boolean {
  const normalized = message.toLowerCase();
  return /账号池|繁忙|稍后重试|自动重试|超时|耗时|排队|未返回|没有返回|返回图缺失|生成失败|502|503|504|524|429/.test(message)
    || /busy|timeout|timed out|overloaded|rate limit|too many requests|service unavailable|gateway timeout|no image|no result/.test(normalized);
}

export function AndroidPadComposePanel() {
  const {
    apiKey, mode, promptPrefix, prompt, optimizationGuidance, negativePrompt, size, quality, seed, styleTag, outputFormat,
    batchCount, continuousGenerateTest, sources, currentImage, errorMessage, errorRawPath, apimartRecoveryTask,
    isRunning, lastPayload, isOptimizingPrompt, isReversingPrompt, reversePromptImage,
    apiMode, requestPolicy, baseURL, imageModelID, activeProfileId,
    profiles, setField, updateProfile, selectSourceImage, removeSource, clearSources,
    openUpstreamConfig, submit, cancel, retryLast, optimizePrompt, pushToast, clearError,
    selectReversePromptImage, clearReversePromptImage, reversePromptFromImage, queryAPIMartRecoveryTask,
  } = useStudioStore();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [quickProfileOpen, setQuickProfileOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [promptPrefixCollapsed, setPromptPrefixCollapsed] = useState(true);
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptTouchRef = useRef<{ y: number } | null>(null);
  const promptPrefixLen = promptPrefix.length;
  const promptLen = prompt.length;
  const promptPrefixActive = promptPrefix.trim().length > 0;
  const effectivePromptReady = promptPrefixActive || prompt.trim().length > 0;
  const promptCollapsedPreview = prompt.trim() || "主提示词未输入";
  const promptCollapseLabel = promptCollapsed ? "展开提示词框" : "折叠提示词框";
  const recommendAPISwitch = errorMessage ? shouldRecommendAPISwitch(errorMessage) : false;
  const recommendAPIMart = recommendAPISwitch && apiMode !== "apimart";
  const hasMultipleProfiles = profiles.length > 1;
  const { androidOrientation, androidWidthClass } = usePlatform();
  const isMediumPad = androidWidthClass === "medium";
  const isLandscapePad = androidOrientation === "landscape";
  const hasAPIKey = apiKey.trim().length > 0;
  const hasBaseURL = baseURL.trim().length > 0;
  const runningHubBridgeConfigured = apiMode === "runninghub" && hasBaseURL;
  const hasUsableUpstream = hasAPIKey || runningHubBridgeConfigured;
  const needsUpstreamSetup = !hasUsableUpstream;
  const needsBaseURLSetup = hasUsableUpstream && !hasBaseURL;
  const optimizeReady = !!prompt.trim();
  const rewriteReady = optimizeReady && optimizationGuidance.trim().length > 0;
  const activeStyleLabel = STYLE_CHIPS.find((item) => item.id === styleTag)?.label ?? "默认风格";
  const activeAspect = deriveAspectPreset(size);
  const activeResolution = deriveResolutionPreset(size);
  const availableResolutions = availableResolutionPresets({ apiMode, requestPolicy, imageModelID });
  const activeAspectLabel = activeAspect === "auto" ? "Auto" : activeAspect;
  const activeResolutionLabel = activeResolution === "auto" ? "自动" : activeResolution.toUpperCase();
  const activeQualityLabel = QUALITY_TIERS.find((item) => item.value === quality)?.label ?? quality;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const fhlImagesPoolActive = !!activeProfile && isOfficialFHLPoolProfile(activeProfile);
  const activeProfileConcurrencyLimit = activeProfile?.concurrencyLimit ?? 1;
  const activeConcurrencyLimit = fhlImagesPoolActive
    ? FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT
    : Math.min(2, Math.max(1, Math.floor(Number(activeProfileConcurrencyLimit) || 1)));
  const showAPIMartRecovery = apiMode === "apimart" && !!apimartRecoveryTask?.taskId;
  const reverseFallbackImage = reversePromptImage
    ? ""
    : currentImage
      ? {
          label: "当前画板图片",
          name: currentImage.prompt || currentImage.savedPath?.split(/[\\/]/).pop() || "当前图片",
          previewSrc: currentImage.previewUrl || currentImage.fullUrl || (currentImage.imageB64 ? dataURLFromBase64(currentImage.imageB64) : ""),
        }
      : sources.length > 0
        ? {
            label: "第一张参考图",
            name: sources[0]?.name || sources[0]?.path?.split(/[\\/]/).pop() || "参考图",
            previewSrc: sources[0]?.previewUrl || (sources[0]?.imageB64 ? dataURLFromBase64(sources[0].imageB64) : ""),
            size: sources[0]?.size,
          }
        : null;

  const handleAspectSelect = (aspect: typeof activeAspect) => {
    setField("size", buildAndroidAspectSizeSelection(
      aspect,
      activeResolution,
      { apiMode, requestPolicy, imageModelID },
    ));
  };

  const handleResolutionSelect = (resolution: typeof activeResolution) => {
    setField("size", buildAndroidResolutionSizeSelection(
      activeAspect,
      resolution,
      { apiMode, requestPolicy, imageModelID },
    ));
  };

  useLayoutEffect(() => {
    if (promptCollapsed) return;
    const input = promptInputRef.current;
    resizePromptTextarea(input);
    const frame = window.requestAnimationFrame(() => resizePromptTextarea(input));
    const handleResize = () => resizePromptTextarea(input);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [mode, prompt, promptCollapsed]);

  const handleModeChange = (next: Mode) => {
    vibrateForPlatform(12);
    setField("mode", next);
  };

  const handleSubmit = () => {
    vibrateForPlatform(15);
    submit();
  };

  const handleOptimize = () => {
    vibrateForPlatform(10);
    optimizePrompt({ useGuidance: false });
  };

  const handleRewritePrompt = () => {
    vibrateForPlatform(10);
    optimizePrompt({ useGuidance: true });
  };

  const handleOpenReverse = () => {
    vibrateForPlatform(8);
    setTemplateOpen(false);
    setAdvancedOpen(false);
    setReverseOpen(true);
  };

  const handleCloseReverse = () => {
    if (isReversingPrompt) {
      pushToast("反推仍在后台进行，完成后会写入主提示词", "info", 3600);
    }
    setReverseOpen(false);
  };

  const handleCopyPrompt = async () => {
    if (!prompt.trim()) return;
    vibrateForPlatform(6);
    try {
      await copyText(prompt);
      pushToast("已复制提示词", "success");
    } catch (error: any) {
      pushToast(`复制失败:${error?.message ?? error}`, "error");
    }
  };

  const handleClearPrompt = () => {
    if (!prompt) return;
    vibrateForPlatform(6);
    setField("prompt", "");
    pushToast("已清空", "success");
  };

  const handleSelectSource = () => {
    vibrateForPlatform(8);
    selectSourceImage();
  };

  const handleConcurrencyLimitChange = (next: number) => {
    if (fhlImagesPoolActive) return;
    const normalized = Math.min(2, Math.max(1, Math.floor(Number(next) || 1)));
    if (!activeProfileId) {
      pushToast("请先选择上游配置，再设置连续并发", "warn", 3600);
      return;
    }
    void updateProfile(activeProfileId, { concurrencyLimit: normalized }).catch((error: any) => {
      pushToast(`连续并发保存失败:${error?.message ?? error}`, "error", 4200);
    });
  };

  const handleSwitchAPIConfig = () => {
    vibrateForPlatform(8);
    if (hasMultipleProfiles) {
      setQuickProfileOpen(true);
      return;
    }
    openUpstreamConfig("app");
  };

  const submitButton = needsUpstreamSetup ? (
    <button
      type="button"
      onClick={() => { vibrateForPlatform(10); openUpstreamConfig("app"); }}
      className="liquid-primary-button h-[52px] w-full text-[15px] font-semibold text-white"
    >
      配置上游
    </button>
  ) : needsBaseURLSetup ? (
    <button
      type="button"
      onClick={() => { vibrateForPlatform(10); openUpstreamConfig("app"); }}
      className="liquid-primary-button h-[52px] w-full text-[15px] font-semibold text-white"
    >
      补全上游地址
    </button>
  ) : isRunning ? (
    continuousGenerateTest ? (
      <div className="android-running-cta-row">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasUsableUpstream || !hasBaseURL || !effectivePromptReady}
          className="liquid-primary-button android-running-append-button h-[52px] min-w-0 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
        >
          追加生成
        </button>
        <button
          type="button"
          onClick={() => { vibrateForPlatform(10); cancel(); }}
          className="android-running-cancel-button h-[52px]"
        >
          取消
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => { vibrateForPlatform(10); cancel(); }}
        className="android-running-cancel-button h-[52px] w-full"
      >
        取消生成
      </button>
    )
  ) : (
    <button
      type="button"
      onClick={handleSubmit}
      disabled={!hasUsableUpstream || !hasBaseURL || !effectivePromptReady}
      className="liquid-primary-button h-[52px] w-full text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
    >
      {mode === "edit" ? "开始编辑" : "开始生成"}
    </button>
  );

  return (
    <div
      className="control-panel android-pad-compose flex w-full flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] px-4 py-4"
      data-mode={mode}
      data-orientation={androidOrientation}
      style={{ paddingLeft: "calc(var(--android-safe-left-value, 0px) + 16px)", paddingRight: "calc(var(--android-safe-right-value, 0px) + 16px)" }}
    >
      {errorMessage ? (
        <section className="platform-card border border-red-500/18 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed">{errorMessage}</div>
            <button
              type="button"
              onClick={clearError}
              className="rounded-full p-1 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {recommendAPISwitch ? (
            <div className="mt-2 rounded-[12px] border border-red-500/20 bg-white/65 px-2.5 py-2 text-[11px] leading-5 text-red-700 dark:bg-white/[0.06] dark:text-red-100">
              <div className="font-semibold">
                {recommendAPIMart
                  ? "当前上游可能不稳定，建议切换 API 配置，优先试试 APIMart 异步 API。"
                  : "当前上游可能不稳定，建议切换 API 配置。"}
              </div>
              <button
                type="button"
                onClick={handleSwitchAPIConfig}
                className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-red-500/18"
              >
                <Settings2 className="h-3 w-3" /> 切换 API 配置
              </button>
            </div>
          ) : null}
          {(lastPayload && !isRunning) || errorRawPath || showAPIMartRecovery ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {lastPayload && !isRunning ? (
                <button
                  type="button"
                  onClick={retryLast}
                  className="platform-pill inline-flex items-center gap-1 bg-red-500/15 px-2.5 py-1 text-[11px] transition-colors hover:bg-red-500/25"
                >
                  <RotateCw className="h-3 w-3" /> 重试
                </button>
              ) : null}
              {showAPIMartRecovery ? (
                <button
                  type="button"
                  onClick={() => { void queryAPIMartRecoveryTask(); }}
                  className="platform-pill inline-flex items-center gap-1 bg-red-500/15 px-2.5 py-1 text-[11px] transition-colors hover:bg-red-500/25"
                  title="继续查询 APIMart 后台任务，不重新生成，不重新扣费"
                >
                  <Search className="h-3 w-3" /> 查后台
                </button>
              ) : null}
              {errorRawPath ? (
                <button
                  type="button"
                  onClick={() => OpenFile(errorRawPath).catch((e: any) => pushToast(`无法打开日志:${e?.message ?? e}`, "error"))}
                  className="platform-pill inline-flex items-center gap-1 px-2.5 py-1 text-[11px] ring-1 ring-red-500/30 transition-colors hover:bg-red-500/10"
                  title={errorRawPath}
                >
                  <FileText className="h-3 w-3" /> 查看日志
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="platform-card android-pad-overview p-4">
        <div className="android-pad-overview-row">
          <div className="android-pad-hero-copy">
            <div className="android-phone-kicker">{mode === "edit" ? "图生图工作流" : "文生图工作流"}</div>
            <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">
              图像工作区
            </h2>
            <p className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-300">
              {isLandscapePad
                ? "横屏下聚焦参数与提示词，画布从左侧导航进入。"
                : isMediumPad
                ? "中等宽度下保留 rail 导航，把主要操作压在单列主区域里。"
                : "参数在左，画布在中，大屏下保持一眼可扫的多窗格结构。"}
            </p>
          </div>
          <div className="android-pad-mode-switch">
            <AndroidModeSwitch mode={mode} onChange={handleModeChange} variant="pad" />
          </div>
        </div>
        <div className="android-inline-metrics mt-3">
          <span>{mode === "edit" ? "图生图" : "文生图"}</span>
          <span>{activeQualityLabel}</span>
          <span>{activeAspectLabel}</span>
          <span>{batchCount} 张</span>
          {hasUsableUpstream && hasBaseURL ? <span>上游已连接</span> : hasUsableUpstream ? <span>待补全地址</span> : <span>待配置上游</span>}
        </div>
      </section>

      <div className="android-pad-compose-grid">
        <section className="platform-card android-pad-prompt p-5">
        <div className="android-pad-section-head">
          <label className="android-phone-kicker">{mode === "edit" ? "修改要求" : "提示词"}</label>
          <div className="android-prompt-head-actions">
            <div className="android-prompt-quick-actions">
              <button
                type="button"
                className="android-prompt-mini-action"
                disabled={!prompt.trim()}
                onClick={handleCopyPrompt}
                title="复制提示词"
              >
                <ClipboardCopy className="h-3 w-3" />
                <span>复制</span>
              </button>
              <button
                type="button"
                className="android-prompt-mini-action danger"
                disabled={!prompt}
                onClick={handleClearPrompt}
                title="清空提示词"
              >
                <Trash2 className="h-3 w-3" />
                <span>清空</span>
              </button>
            </div>
            <span className="font-mono-token text-[11px] text-zinc-400 dark:text-zinc-500">{promptLen}</span>
            <button
              type="button"
              className="android-prompt-collapse-toggle"
              onClick={() => {
                vibrateForPlatform(6);
                setPromptCollapsed((value) => !value);
              }}
              title={promptCollapseLabel}
              aria-label={promptCollapseLabel}
            >
              {promptCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{promptCollapseLabel}</span>
            </button>
          </div>
        </div>
          <div className="android-prompt-stack">
            <section className="android-prompt-prefix-block" aria-label="补充提示词">
              <button
                type="button"
                className="android-prompt-prefix-toggle"
                onClick={() => {
                  vibrateForPlatform(6);
                  setPromptPrefixCollapsed((value) => !value);
                }}
                title={promptPrefixCollapsed ? "展开补充提示词" : "收起补充提示词"}
                aria-expanded={!promptPrefixCollapsed}
              >
                <span className="android-prompt-prefix-title">
                  {promptPrefixCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  <span>补充提示词</span>
                </span>
                <span className="android-prompt-prefix-meta">
                  <span>{promptPrefixActive ? "已参与生成" : "可选"}</span>
                  <span className="font-mono-token">{promptPrefixLen}</span>
                </span>
              </button>
              {!promptPrefixCollapsed ? (
                <div className="android-prompt-prefix-body">
                  <div className="android-prompt-field-note">生成时自动放在主提示词前面</div>
                  <textarea
                    value={promptPrefix}
                    placeholder="可选：输入固定前置提示词，例如画风、角色设定、固定关键词..."
                    onChange={(e) => setField("promptPrefix", e.target.value)}
                    className="android-prompt-prefix-input focus-ring"
                  />
                  <div className="android-prompt-prefix-actions">
                    <button
                      type="button"
                      onClick={() => setField("promptPrefix", "")}
                      disabled={!promptPrefix.trim()}
                      title="清空补充提示词"
                    >
                      清空
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="android-prompt-main-block" aria-label="主提示词">
              <div className="android-prompt-section-label">
                <span>主提示词</span>
                <small>主要描述画面内容，会和补充提示词一起生成</small>
              </div>
              {promptCollapsed ? (
                <button
                  type="button"
                  className="android-prompt-collapsed-preview"
                  onClick={() => {
                    vibrateForPlatform(6);
                    setPromptCollapsed(false);
                  }}
                >
                  {promptCollapsedPreview}
                </button>
              ) : (
                <div className="android-pad-prompt-input-shell mt-3">
                  <textarea
                    ref={promptInputRef}
                    value={prompt}
                    placeholder={mode === "edit"
                      ? "描述如何修改源图，例如：把背景换成夜景、保留主体姿态"
                      : "描述你想生成的画面内容、光线、构图、风格、镜头感"}
                    onChange={(e) => setField("prompt", e.target.value)}
                    onTouchStart={(event) => handlePromptTextareaTouchStart(event, promptTouchRef)}
                    onTouchMove={(event) => handlePromptTextareaTouchMove(event, promptTouchRef)}
                    onTouchEnd={() => handlePromptTextareaTouchEnd(promptTouchRef)}
                    onTouchCancel={() => handlePromptTextareaTouchEnd(promptTouchRef)}
                    className="focus-ring android-pad-prompt-textarea min-h-[170px] w-full resize-none border border-black/[0.08] bg-[var(--surface)] px-4 py-3 text-[15px] leading-7 text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </div>
              )}
              <div className="android-pad-action-row mt-3">
                <div className="relative android-pad-action-slot">
                  <button
                    type="button"
                    onClick={() => { vibrateForPlatform(8); setTemplateOpen(true); }}
                    className={`platform-pill inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[12px] ${
                      templateOpen
                        ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[color:var(--accent)]/20"
                        : "text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                    }`}
                    title="prompt 模板与历史"
                  >
                    <ListPlus className="h-3.5 w-3.5" /> 模板 / 历史
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleOptimize}
                  disabled={!optimizeReady || isOptimizingPrompt}
                  className={`platform-pill inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[12px] ${
                    isOptimizingPrompt
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Sparkles className={`h-3.5 w-3.5 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
                  {isOptimizingPrompt ? "优化中..." : "AI 优化"}
                </button>
                <button
                  type="button"
                  onClick={handleOpenReverse}
                  disabled={isOptimizingPrompt || isReversingPrompt}
                  className={`platform-pill inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[12px] ${
                    isReversingPrompt
                      ? "android-reverse-working-action"
                      : "text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                  title={reversePromptImage ? "打开反推提示词" : "选择图片并反推中文提示词"}
                >
                  <ImageUp className={`h-3.5 w-3.5 ${isReversingPrompt ? "animate-pulse" : ""}`} />
                  {isReversingPrompt ? "反推中..." : "反推"}
                </button>
              </div>
              <section className="android-prompt-guidance-block" aria-label="指令改写提示词">
                <div className="android-prompt-guidance-head">
                  <label>指令改写提示词</label>
                  <button
                    type="button"
                    onClick={() => setField("optimizationGuidance", "")}
                    disabled={!optimizationGuidance.trim() || isOptimizingPrompt || isReversingPrompt}
                    title="清空精准修改指令"
                  >
                    清除
                  </button>
                </div>
                <textarea
                  value={optimizationGuidance}
                  placeholder="输入精准修改指令：去掉帽子 / 天上加一只老鹰..."
                  rows={2}
                  onChange={(event) => setField("optimizationGuidance", event.target.value)}
                  className="android-prompt-guidance-input focus-ring"
                  title="输入要强制执行的提示词修改指令"
                />
                <div className="android-prompt-guidance-actions">
                  <button
                    type="button"
                    onClick={handleRewritePrompt}
                    disabled={!rewriteReady || isOptimizingPrompt || isReversingPrompt}
                    className={`platform-pill android-prompt-guidance-button inline-flex min-h-[40px] items-center justify-center gap-1.5 px-3 text-[12px] ${
                      isOptimizingPrompt
                        ? "bg-[var(--surface)] text-[var(--accent)]"
                        : "bg-[var(--surface)] text-[var(--accent)] hover:brightness-95"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    title={rewriteReady ? "按照指令改写当前提示词" : "先输入主提示词和精准修改指令"}
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
                    {isOptimizingPrompt ? "优化中..." : "精准修改"}
                  </button>
                </div>
              </section>
            </section>
          </div>
        </section>

        <div className="android-pad-side-stack">
          <AndroidPadParameterSection
            activeAspect={activeAspect}
            activeAspectLabel={activeAspectLabel}
            activeResolution={activeResolution}
            activeResolutionLabel={activeResolutionLabel}
            activeQualityLabel={activeQualityLabel}
            activeStyleLabel={activeStyleLabel}
            availableResolutions={availableResolutions}
            apiMode={apiMode}
            batchCount={batchCount}
            concurrencyLimit={activeConcurrencyLimit}
            continuousGenerateTest={continuousGenerateTest}
            fhlImagesPoolActive={fhlImagesPoolActive}
            handleAspectSelect={handleAspectSelect}
            handleResolutionSelect={handleResolutionSelect}
            imageModelID={imageModelID}
            isMediumPad={isMediumPad}
            needsUpstreamSetup={needsUpstreamSetup}
            onConcurrencyLimitChange={handleConcurrencyLimitChange}
            onOpenUpstream={() => { vibrateForPlatform(8); openUpstreamConfig("app"); }}
            quality={quality}
            requestPolicy={requestPolicy}
            setField={setField as any}
            styleTag={styleTag}
          />

          <div className="android-pad-right-stack">
            {mode === "edit" ? (
              <AndroidPadSourceSection
                clearSources={clearSources}
                currentImage={currentImage}
                onSelectSource={handleSelectSource}
                removeSource={removeSource}
                sources={sources}
              />
            ) : null}

            <AndroidAdvancedSection
              advancedOpen={advancedOpen}
              negativePrompt={negativePrompt}
              outputFormat={outputFormat}
              seed={seed}
              setAdvancedOpen={setAdvancedOpen}
              setField={setField as any}
              surface="pad"
            />

            <div className="android-pad-side-cta">
              {submitButton}
            </div>
          </div>
        </div>
      </div>

      <div className="android-pad-cta" style={{ paddingLeft: "calc(var(--android-safe-left-value, 0px) + 16px)", paddingRight: "calc(var(--android-safe-right-value, 0px) + 16px)" }}>
        {submitButton}
      </div>
      <AndroidPromptTemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onPick={(text) => {
          const current = useStudioStore.getState().prompt;
          setField("prompt", current ? `${current}\n${text}` : text);
        }}
      />
      <AndroidQuickProfileSheet open={quickProfileOpen} onClose={() => setQuickProfileOpen(false)} />
      <AndroidReversePromptSheet
        open={reverseOpen}
        onClose={handleCloseReverse}
        reversePromptImage={reversePromptImage}
        fallbackImage={reverseFallbackImage || null}
        isReversingPrompt={isReversingPrompt}
        onSelectImage={() => { void selectReversePromptImage(); }}
        onClearImage={clearReversePromptImage}
        onReversePrompt={() => { void reversePromptFromImage(reversePromptImage); }}
      />
    </div>
  );
}
