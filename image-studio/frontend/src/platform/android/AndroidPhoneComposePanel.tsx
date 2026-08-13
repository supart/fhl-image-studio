import { useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, ClipboardCopy, FileText, ImageUp, ListPlus, RotateCw, Search, Settings, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { copyText } from "../../lib/fhlAPI";
import { FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, isOfficialFHLPoolProfile } from "../../lib/profiles";
import { dataURLFromBase64 } from "../../lib/images";
import { OpenFile } from "../runtime/host";
import { Mode } from "../../types/domain";
import { QUALITY_TIERS, STYLE_CHIPS } from "../../components/panel/panelOptions";
import {
  availableResolutionPresets,
  deriveAspectPreset,
  deriveResolutionPreset,
} from "../../components/panel/sizeCapabilities";
import { AndroidModeSwitch } from "./AndroidModeSwitch";
import { AndroidPhoneAdvancedSection } from "./AndroidPhoneAdvancedSection";
import { AndroidPhoneParameterSection } from "./AndroidPhoneParameterSection";
import { AndroidPhoneSourceSection } from "./AndroidPhoneSourceSection";
import { AndroidPromptTemplateModal } from "./AndroidPromptTemplateModal";
import { AndroidQuickProfileSheet } from "./AndroidQuickProfileSheet";
import { AndroidReversePromptSheet } from "./AndroidReversePromptSheet";
import {
  handlePromptTextareaTouchEnd,
  handlePromptTextareaTouchMove,
  handlePromptTextareaTouchStart,
} from "./AndroidPromptTouchScroll";
import { AndroidCanvasProgressOverlay } from "./canvas/AndroidCanvasWorkspace";
import {
  buildAndroidAspectSizeSelection,
  buildAndroidResolutionSizeSelection,
} from "./parameters/androidSizeSelection";
import { vibrateForPlatform } from "./bridge";

function resizePromptTextarea(input: HTMLTextAreaElement | null) {
  if (!input) return;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
  const maxHeight = Math.max(360, Math.min(900, Math.round(viewportHeight * 0.88)));
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

export function AndroidPhoneComposePanel() {
  const {
    apiKey, mode, promptPrefix, prompt, optimizationGuidance, negativePrompt, size, quality, seed, styleTag,
    outputFormat, batchCount, continuousGenerateTest, sources, currentImage, errorMessage, errorRawPath,
    apimartRecoveryTask,
    isRunning, lastPayload, isOptimizingPrompt, isReversingPrompt, reversePromptImage, apiMode, requestPolicy, baseURL, profiles, activeProfileId, imageModelID,
    progress, streamPreview, runningJobs, jobsCompleted, jobsTotal,
    setField, clearError, pushToast, selectSourceImage,
    removeSource, clearSources, openUpstreamConfig, submit, cancel, retryLast, optimizePrompt, updateProfile,
    selectReversePromptImage, clearReversePromptImage, reversePromptFromImage, queryAPIMartRecoveryTask,
  } = useStudioStore();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [quickProfileOpen, setQuickProfileOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [promptPrefixCollapsed, setPromptPrefixCollapsed] = useState(true);
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
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
  const settingsExpanded = parametersOpen || advancedOpen;

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
    setParametersOpen(false);
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

  return (
    <div
      className={`control-panel android-phone-compose ${settingsExpanded ? "android-phone-compose-expanded" : ""} flex w-full flex-col gap-3 overflow-y-auto border-r-0 bg-[var(--bg)] px-3 py-3`}
      style={{ paddingLeft: "calc(var(--android-safe-left-value, 0px) + 12px)", paddingRight: "calc(var(--android-safe-right-value, 0px) + 12px)" }}
    >
      {errorMessage ? (
        <section className="platform-card border border-red-500/18 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
          <div className="flex items-start gap-2">
            <div className="flex-1 whitespace-pre-wrap leading-relaxed">{errorMessage}</div>
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

      {needsUpstreamSetup ? (
        <section className="platform-card android-phone-hero border border-[color:var(--accent)]/14 bg-[var(--accent-soft)] p-4">
          <div className="flex items-start gap-3">
            <div className="android-phone-hero-icon">
              <Settings className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="android-phone-kicker">启动前准备</div>
              <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">
                先接入可用上游
              </h2>
              <p className="mt-2 text-[12px] leading-6 text-zinc-600 dark:text-zinc-300">
                保存中转站地址和 API Key 后，这里会切换成完整的移动端创作页。
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openUpstreamConfig("app")}
                  className="liquid-primary-button inline-flex min-h-[42px] items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-white"
                >
                  <Settings className="h-3.5 w-3.5" /> 配置上游
                </button>
                <button
                  type="button"
                  onClick={() => openUpstreamConfig("app")}
                  className="platform-action-btn inline-flex min-h-[42px] items-center gap-1.5 border border-[color:var(--accent)]/20 bg-white/70 px-3 py-2 text-[12px] text-[var(--accent)] dark:bg-white/[0.05]"
                >
                  <Sparkles className="h-3.5 w-3.5" /> 去配置
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={`platform-card android-phone-prompt ${needsUpstreamSetup ? "" : "android-phone-compose-sheet"} p-4`}>
        {!needsUpstreamSetup ? (
          <div className="android-phone-sheet-header">
            <div className="android-phone-hero-top">
              <div className="min-w-0">
                <div className="android-phone-kicker">{mode === "edit" ? "图生图工作流" : "文生图工作流"}</div>
                <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">
                  {mode === "edit" ? "说明修改目标" : "描述画面"}
                </h2>
              </div>
              <div className="android-phone-mode-switch android-phone-mode-switch-compact">
                <AndroidModeSwitch mode={mode} onChange={handleModeChange} variant="phone" />
              </div>
            </div>
            <p className="android-phone-hero-copy mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-300">
              {mode === "edit"
                ? "先写改动重点，再补参考图和参数。"
                : "先写主体和镜头，参数在下面补。"}
            </p>
          </div>
        ) : null}
        <div className="android-phone-prompt-head">
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
                <textarea
                  ref={promptInputRef}
                  value={prompt}
                  placeholder={mode === "edit"
                    ? "描述要修改的内容，例如换背景、改光线"
                    : "描述主体、场景、光线、风格和镜头"}
                  onChange={(e) => setField("prompt", e.target.value)}
                  onTouchStart={(event) => handlePromptTextareaTouchStart(event, promptTouchRef)}
                  onTouchMove={(event) => handlePromptTextareaTouchMove(event, promptTouchRef)}
                  onTouchEnd={() => handlePromptTextareaTouchEnd(promptTouchRef)}
                  onTouchCancel={() => handlePromptTextareaTouchEnd(promptTouchRef)}
                  className="android-phone-prompt-input focus-ring"
                />
              )}
              <div className="android-phone-action-row">
                <div className="android-phone-action-item relative">
                  <button
                    type="button"
                    onClick={() => { vibrateForPlatform(8); setTemplateOpen(true); }}
                    className={`platform-pill android-phone-action-pill inline-flex min-h-[38px] items-center gap-1.5 px-3 text-[11px] ${
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
                  className={`platform-pill android-phone-action-pill inline-flex min-h-[38px] items-center gap-1.5 px-3 text-[11px] ${
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
                  className={`platform-pill android-phone-action-pill inline-flex min-h-[38px] items-center gap-1.5 px-3 text-[11px] ${
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
                    className={`platform-pill android-prompt-guidance-button inline-flex min-h-[38px] items-center justify-center gap-1.5 px-3 text-[11px] ${
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

      {mode === "edit" ? (
        <AndroidPhoneSourceSection
          clearSources={clearSources}
          currentImage={currentImage}
          onSelectSource={handleSelectSource}
          removeSource={removeSource}
          sources={sources}
        />
      ) : null}

      {!needsUpstreamSetup ? (
        <AndroidPhoneParameterSection
          activeAspect={activeAspect}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          activeStyleLabel={activeStyleLabel}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          concurrencyLimit={activeConcurrencyLimit}
          continuousGenerateTest={continuousGenerateTest}
          fhlImagesPoolActive={fhlImagesPoolActive}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          onConcurrencyLimitChange={handleConcurrencyLimitChange}
          apiMode={apiMode}
          parametersOpen={parametersOpen}
          quality={quality}
          requestPolicy={requestPolicy}
          setField={setField as any}
          setParametersOpen={setParametersOpen}
          styleTag={styleTag}
        />
      ) : null}

      {!needsUpstreamSetup ? (
        <AndroidPhoneAdvancedSection
          advancedOpen={advancedOpen}
          negativePrompt={negativePrompt}
          outputFormat={outputFormat}
          seed={seed}
          setAdvancedOpen={setAdvancedOpen}
          setField={setField as any}
        />
      ) : null}

      <div className="android-phone-sticky-cta" style={{ paddingLeft: "calc(var(--android-safe-left-value, 0px) + 12px)", paddingRight: "calc(var(--android-safe-right-value, 0px) + 12px)" }}>
        {isRunning ? (
          <AndroidCanvasProgressOverlay
            stage={progress?.stage}
            elapsed={progress?.elapsed}
            bytes={progress?.bytes}
            runningJobs={runningJobs.length}
            jobsCompleted={jobsCompleted}
            jobsTotal={jobsTotal}
            streamPreviewActive={!!streamPreview}
            placement="compose"
          />
        ) : null}
        {needsUpstreamSetup ? (
          <button
            type="button"
            onClick={() => { vibrateForPlatform(10); openUpstreamConfig("app"); }}
            className="liquid-primary-button h-[54px] w-full text-[15px] font-semibold text-white"
          >
            配置上游
          </button>
        ) : needsBaseURLSetup ? (
          <button
            type="button"
            onClick={() => { vibrateForPlatform(10); openUpstreamConfig("app"); }}
            className="liquid-primary-button h-[54px] w-full text-[15px] font-semibold text-white"
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
                className="liquid-primary-button android-running-append-button h-[54px] min-w-0 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
              >
                追加生成
              </button>
              <button
                type="button"
                onClick={() => { vibrateForPlatform(10); cancel(); }}
                className="android-running-cancel-button h-[54px]"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { vibrateForPlatform(10); cancel(); }}
              className="android-running-cancel-button h-[54px] w-full"
            >
              取消生成
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasUsableUpstream || !hasBaseURL || !effectivePromptReady}
            className="liquid-primary-button h-[54px] w-full text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
          >
            {mode === "edit" ? "开始编辑" : "开始生成"}
          </button>
        )}
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
