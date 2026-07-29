import { useState } from "react";
import { Compass, RotateCcw } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { isRetryableBatchTask } from "../../state/batchTaskRecords";
import { SizeValue, QualityValue, Mode } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { AndroidPhoneComposePanel } from "../../platform/android/AndroidPhoneComposePanel";
import { AndroidPadComposePanel } from "../../platform/android/AndroidPadComposePanel";
import { Modal } from "../common/Modal";
import { RawResponseModal } from "../history/RawResponseModal";
import { DesktopAdvancedPanel } from "./DesktopAdvancedPanel";
import { ErrorNotice } from "./ErrorNotice";
import { DesktopComposeSections } from "./DesktopComposeSections";
import { MacAdvancedPanel } from "./MacAdvancedPanel";
import { MacComposePanel } from "./MacComposePanel";
import { PanoramaStudioEntryModal } from "../panorama/PanoramaStudioEntryModal";
import { resolvePromptTextCapability } from "../../lib/promptTextProfiles";
import { mapFHLImagesProfilesToPoolSlots } from "../../lib/profiles";
import { QUALITY_TIERS, STYLE_CHIPS } from "./panelOptions";
import { PromptEditorSection } from "./PromptEditorSection";
import { Section, Seg, SegItem } from "./panelChrome";
import { SubmitBar } from "./SubmitBar";
import { WindowsComposePanel } from "./WindowsComposePanel";
import {
  RESOLUTION_PRESETS,
  aspectPresetsForAPIMode,
  availableResolutionPresets,
  buildAspectSizeSelection,
  buildResolutionSizeSelection,
  deriveAspectPreset,
  deriveResolutionPreset,
  normalizeAspectSelection,
} from "./sizeCapabilities";

function ModeSwitch({
  mode,
  onChange,
  usesFluentUI,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  usesFluentUI: boolean;
}) {
  const items: Array<{ id: Mode; icon: string; title: string; subtitle: string }> = [
    { id: "generate", icon: "📝", title: "文生图", subtitle: "生图模式" },
    { id: "edit", icon: "🖼", title: "图生图", subtitle: "编辑模式" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`mode-switch-button ${usesFluentUI ? "mode-switch-button-fluent" : ""}`}
            aria-pressed={active}
            title={item.id === "generate" ? "文生图 · 生图模式" : "图生图 · 编辑模式"}
          >
            <span className="mode-switch-title">
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.title}</span>
            </span>
            <span className="mode-switch-subtitle">
              {item.subtitle}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PanoramaStudioEntryButton({
  onClick,
  usesFluentUI,
}: {
  onClick: () => void;
  usesFluentUI: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panorama-studio-entry-button group w-full px-3 py-3 text-left ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
      title="打开 360 工作台，生成或编辑 2:1 全景图"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            <Compass className="h-4 w-4 text-[var(--accent)]" />
            360 工作台
          </span>
          <span className="mt-1 block text-[11px] leading-4 text-zinc-600 dark:text-zinc-300">
            生成全景 / 编辑全景 / 镜头输出 / 贴回管理
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-[color:var(--accent)]/25 px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">
          2:1
        </span>
      </span>
    </button>
  );
}

export function ControlPanel() {
  const {
    apiKey, mode, promptPrefix, prompt, optimizationGuidance, negativePrompt, size, quality, seed, styleTag,
    outputFormat, batchCount, continuousGenerateTest, fhlPoolPerAPIConcurrencyLimit, fhlPoolEffectiveConcurrencyByProfileId,
    sources, currentImage, reversePromptImage, editSourceMode, batchProcess,
    errorMessage, errorRawPath, isRunning, runningJobs, lastPayload, isTestingKey, isOptimizingPrompt, isReversingPrompt,
    apiMode, requestPolicy, baseURL, textModelID, profiles, activeProfileId, imageModelID, fhlTextAPIConfigured,
    activeWorkspaceId, workspaces, jobGroupsByWorkspace, batchTasksById, batchResults, history,
    setField, clearError, pushToast,
    selectSourceImage, selectBatchInputDir, selectBatchInputFiles, chooseBatchOutputDir, importSourceImageFile, selectReversePromptImage, importReversePromptImageFile, clearReversePromptImage, removeSource, clearSources,
    openUpstreamConfig,
    submit, cancel, retryLast, retryFailedBatchTasks, cancelQueuedBatchTasks, clearFailedBatchTasks, optimizePrompt, reversePromptFromImage, resetCurrentWorkspaceDraft,
    setFHLPoolPerAPIConcurrencyLimit,
  } = useStudioStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptPopover, setPromptPopover] = useState(false);
  const [macComposeOpen, setMacComposeOpen] = useState(true);
  const [windowsComposeOpen, setWindowsComposeOpen] = useState(true);
  const [rawLogPath, setRawLogPath] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [continuousSubmitHintOpen, setContinuousSubmitHintOpen] = useState(false);
  const [customConcurrency, setCustomConcurrency] = useState("");
  const [panoramaStudioOpen, setPanoramaStudioOpen] = useState(false);
  const { isAndroid, isAndroidPhone, isAndroidPad, isMac, isWindows, usesAndroidUI, usesAppleUI, usesFluentUI } = usePlatform();

  if (isAndroidPhone) {
    return <AndroidPhoneComposePanel />;
  }

  if (isAndroidPad) {
    return <AndroidPadComposePanel />;
  }

  const promptLen = prompt.length;
  const promptPrefixLen = promptPrefix.length;
  const mainPromptReady = prompt.trim();
  // 优化按钮只要有任一可用的 Responses profile 或当前 active 已配置就启用。
  // (实际 prompt 优化在 store.optimizePrompt 里会找到 Responses 那条 profile 跑;
  // 这里只判断 UI 是否能点。)
  const promptTextCapability = resolvePromptTextCapability({
    apiMode,
    apiKey,
    baseURL,
    textModelID,
    profiles,
    fhlTextAPIConfigured,
  });
  const activeStyleLabel = STYLE_CHIPS.find((item) => item.id === styleTag)?.label ?? styleTag;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeBatchTasks = (activeWorkspace?.batchTaskIds ?? [])
    .map((id) => batchTasksById[id])
    .filter((task): task is NonNullable<typeof task> => !!task && task.workspaceId === activeWorkspaceId);
  const retryHistoryById = new Map([...batchResults, ...history].map((item) => [item.id, item]));
  const failedBatchTaskCount = activeBatchTasks.filter((task) => isRetryableBatchTask(task, retryHistoryById)).length;
  const queuedBatchTaskCount = activeBatchTasks.filter((task) => task.status === "queued").length;
  const retryApiLabel = activeProfile?.name?.trim()
    || (apiMode === "apimart" ? "APIMart" : apiMode === "runninghub" ? "RunningHub" : apiMode === "images" ? "Images API" : "FHL");
  const perAPIConcurrencyLimit = fhlPoolPerAPIConcurrencyLimit;
  const enabledFHLPoolSlots = mapFHLImagesProfilesToPoolSlots(profiles)
    .filter((profile): profile is NonNullable<typeof profile> => profile?.continuousPoolEnabled === true);
  const enabledFHLPoolAPICount = enabledFHLPoolSlots.length;
  const fhlPoolTotalConcurrencyLimit = enabledFHLPoolAPICount * perAPIConcurrencyLimit;
  const effectivePoolLimitForProfile = (profileId: string) => {
    const override = fhlPoolEffectiveConcurrencyByProfileId[profileId];
    return Number.isFinite(override) ? Math.max(0, Math.min(perAPIConcurrencyLimit, override)) : perAPIConcurrencyLimit;
  };
  const fhlPoolEffectiveTotalConcurrencyLimit = enabledFHLPoolSlots
    .reduce((sum, profile) => sum + effectivePoolLimitForProfile(profile.id), 0);
  const activePoolTasks = activeBatchTasks.filter((task) => task.continuousPoolTask === true);
  const poolSubmittingCount = activePoolTasks.filter((task) => task.launchState === "submitting").length;
  const poolRunningCount = activePoolTasks.filter((task) => (
    task.launchState !== "submitting"
    && (task.status === "running" || (task.status === "queued" && !!task.jobId))
  )).length;
  const poolQueuedCount = activePoolTasks.filter((task) => (
    task.status === "queued" && task.launchState !== "submitting" && !task.jobId
  )).length;
  const poolSucceededCount = activePoolTasks.filter((task) => task.status === "succeeded").length;
  const poolFailedCount = activePoolTasks.filter((task) => task.status === "failed" || task.status === "interrupted").length;
  const poolOccupancyByProfileId = new Map<string, number>();
  for (const task of Object.values(batchTasksById)) {
    const profileId = String(task.apiProfileId || "").trim();
    if (!profileId || task.continuousPoolTask !== true) continue;
    const occupiesSlot = task.launchState === "submitting"
      || task.status === "running"
      || (task.status === "queued" && !!task.jobId);
    if (occupiesSlot) poolOccupancyByProfileId.set(profileId, (poolOccupancyByProfileId.get(profileId) ?? 0) + 1);
  }
  const batchImageToImageMode = mode === "edit" && editSourceMode === "batch";
  const batchImageToImageCount = batchImageToImageMode
    ? batchProcess.discoveredSources.filter((source) => source.selected !== false).length
    : 0;
  const activeGenerationTaskCount = activeBatchTasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const activeBrowserJobCount = (jobGroupsByWorkspace[activeWorkspaceId] ?? [])
    .flatMap((group) => group.slots)
    .filter((slot) => slot.status === "queued" || slot.status === "running").length;
  const submitBlockedByActiveGeneration = !continuousGenerateTest && !batchImageToImageMode && (
    isRunning
    || runningJobs.length > 0
    || activeGenerationTaskCount > 0
    || activeBrowserJobCount > 0
  );
  const showPerAPIConcurrency = continuousGenerateTest;
  const customConcurrencySelected = ![2, 4, 5].includes(perAPIConcurrencyLimit);
  const aspectPresets = aspectPresetsForAPIMode(apiMode, mode);
  const activeAspect = normalizeAspectSelection(
    deriveAspectPreset(size),
    { apiMode, requestPolicy, imageModelID, mode },
  );
  const activeResolution = mode === "edit" && batchProcess.autoAspectResolution !== ""
    ? batchProcess.autoAspectResolution
    : deriveResolutionPreset(size);
  const activeAspectLabel = aspectPresets.find((item) => item.value === activeAspect)?.label ?? activeAspect;
  const activeResolutionLabel = RESOLUTION_PRESETS.find((item) => item.value === activeResolution)?.label ?? activeResolution;
  const activeQualityLabel = QUALITY_TIERS.find((item) => item.value === quality)?.label ?? quality;
  const availableResolutions = availableResolutionPresets({ apiMode, requestPolicy, imageModelID, mode });
  const batchCountOptions = [1, 2, 4, 6, 8, 9] as const;
  const optimizeReady = !!(prompt.trim() && promptTextCapability.available);
  const reverseReady = !!(
    promptTextCapability.available
    && (
      reversePromptImage?.path
      || reversePromptImage?.imageB64
      || reversePromptImage?.imageBlob
      || reversePromptImage?.previewUrl
      ||
      currentImage?.savedPath
      || currentImage?.imageB64
      || currentImage?.imageBlob
      || sources[0]?.path
      || sources[0]?.imageB64
      || sources[0]?.imageBlob
    )
  );
  const compactMacCompose = isMac;
  const compactWindowsCompose = isWindows;
  const advancedSummary = [
    negativePrompt.trim() ? "已填负向提示词" : "无负向限制",
    outputFormat.toUpperCase(),
    seed > 0 ? `Seed ${seed}` : "随机 Seed",
  ].join(" · ");

  function handleAspectSelect(aspect: typeof activeAspect) {
    setField("size", buildAspectSizeSelection(
      aspect,
      activeResolution,
      { apiMode, requestPolicy, imageModelID, mode },
    ));
  }

  function handleResolutionSelect(resolution: typeof activeResolution) {
    if (mode === "edit" && batchProcess.autoAspectResolution !== "") {
      setField("batchProcess", {
        ...batchProcess,
        autoAspectResolution: resolution === "auto" ? "" : resolution,
      });
      return;
    }
    setField("size", buildResolutionSizeSelection(
      activeAspect,
      resolution,
      { apiMode, requestPolicy, imageModelID, mode },
    ));
  }

  function handleResetWorkspaceDraft() {
    setResetConfirmOpen(true);
  }

  function confirmResetWorkspaceDraft() {
    setResetConfirmOpen(false);
    resetCurrentWorkspaceDraft();
  }

  function handleSubmit() {
    if (submitBlockedByActiveGeneration) {
      setContinuousSubmitHintOpen(true);
      pushToast("当前正在生成。需要连续点击生成请先开启连续生成模式。", "warn", 3200);
      return;
    }
    void submit();
  }

  function enableContinuousGenerateMode() {
    setField("continuousGenerateTest", true as any);
    setContinuousSubmitHintOpen(false);
    pushToast("已开启连续生成模式，每次点击提交 1 个任务并按 API 池轮询", "success", 3200);
  }

  function handleCustomConcurrencyCommit() {
    const raw = customConcurrency.trim();
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
      pushToast("自定义并发请输入 1 到 5；单个 FHL API 最大并发为 5", "warn", 3000);
      return;
    }
    const normalized = Math.max(1, Math.min(5, Math.floor(parsed)));
    void setFHLPoolPerAPIConcurrencyLimit(normalized);
    setCustomConcurrency("");
  }

  function handleCustomConcurrencyFocus() {
    if (!customConcurrency && customConcurrencySelected) {
      setCustomConcurrency(String(perAPIConcurrencyLimit));
    }
  }

  return (
    <div data-audit-area="control-panel" className={`control-panel box-border flex shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] backdrop-blur-2xl ${usesAppleUI ? "liquid-sidebar" : ""} ${usesAndroidUI ? "android-surface-pane" : ""} ${isMac ? "w-[408px] gap-5 px-6 py-5" : "w-[372px] gap-4 px-5 py-4"} ${usesFluentUI ? "pt-3" : ""}`}>
      <section className={`platform-card ${isMac ? "px-5 py-5" : "px-4 py-4"}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2
                className={`min-w-0 text-zinc-900 dark:text-zinc-100 ${usesFluentUI ? "text-[18px] font-semibold tracking-[0]" : "text-[20px] font-semibold tracking-[-0.02em]"}`}
                style={{ fontFamily: "var(--title-font)" }}
              >
                图像工作台
              </h2>
              <button
                type="button"
                onClick={handleResetWorkspaceDraft}
                disabled={isRunning || isOptimizingPrompt || isReversingPrompt}
                title="清空当前工作区的提示词、参考图、尺寸比例等草稿设置"
                className={`workspace-init-button platform-pill no-drag inline-flex shrink-0 items-center gap-1.5 border px-3 py-1.5 text-[11px] font-semibold transition-[transform,background-color,border-color,box-shadow,opacity] active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:opacity-45 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                一键初始化
              </button>
            </div>
            {!isAndroid && (
              <p className={`${isMac ? "mt-1 text-[12px] leading-6" : "mt-0.5 text-[11px] leading-relaxed"} text-zinc-500 dark:text-zinc-400`}>
                保持界面简洁，把注意力留给 prompt、参考图和结果。
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-[10px] border border-black/[0.08] bg-white/72 dark:border-white/[0.08] dark:bg-white/[0.04]">
          <div className="px-3 pb-2 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              生成方式
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[8px] border border-emerald-300/70 bg-emerald-50/70 px-3 py-2 dark:border-emerald-400/30 dark:bg-emerald-500/10">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-100">连续生成模式</div>
                <div className="mt-0.5 text-[11px] leading-snug text-emerald-700/80 dark:text-emerald-100/75">
                  运行中也能继续提交，每次点击生成 1 张
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={continuousGenerateTest}
                onClick={() => setField("continuousGenerateTest", !continuousGenerateTest)}
                className={`continuous-test-switch ${continuousGenerateTest ? "continuous-test-switch-on" : "continuous-test-switch-off"}`}
                title="开启后，生成运行中也可以继续提交新任务"
              >
                <span className="continuous-test-switch-thumb" />
              </button>
            </div>
          </div>
          <div className="border-t border-black/[0.06] px-3 py-3 dark:border-white/[0.06]">
            {showPerAPIConcurrency ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
                    每 API 并发
                  </div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    {enabledFHLPoolAPICount} 个 API × {perAPIConcurrencyLimit} 并发 = 总上限 {fhlPoolTotalConcurrencyLimit} 张
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[2, 4, 5].map((limit) => (
                    <button
                      key={limit}
                      type="button"
                      onClick={() => void setFHLPoolPerAPIConcurrencyLimit(limit)}
                      disabled={false}
                      className={`h-10 w-full border px-2 text-[11px] font-semibold transition-[border-color,background-color,color,box-shadow] disabled:cursor-not-allowed disabled:opacity-45 ${perAPIConcurrencyLimit === limit ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)]" : "border-black/[0.08] bg-white/88 text-zinc-700 hover:border-[color:var(--accent)]/40 hover:text-[var(--accent)] dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-zinc-200"} rounded-[8px]`}
                    >
                      {limit === 5 ? "5/API 满载" : `${limit}/API`}
                    </button>
                  ))}
                </div>
                <label
                  className={`mt-2 flex min-w-0 items-center gap-2.5 border px-3 py-2.5 text-[11px] font-semibold transition-[border-color,background-color,color,box-shadow] ${customConcurrencySelected ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)]" : "border-black/[0.08] bg-white/88 text-zinc-700 hover:border-[color:var(--accent)]/40 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-zinc-200"} focus-within:border-[color:var(--accent)] focus-within:bg-[var(--accent-soft)] focus-within:text-[var(--accent)] focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)] rounded-[8px]`}
                  title="输入每个 API 的并发数量，范围 1 到 5，按 Enter 或离开输入框生效"
                >
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-current/70">
                    自定义
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={customConcurrency}
                    onChange={(event) => setCustomConcurrency(event.target.value)}
                    onFocus={handleCustomConcurrencyFocus}
                    onBlur={handleCustomConcurrencyCommit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    disabled={false}
                    aria-label="自定义并发"
                    placeholder={customConcurrencySelected ? String(perAPIConcurrencyLimit) : "输入 1-5"}
                    className="min-w-[120px] flex-1 bg-transparent text-[12px] font-semibold outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
                  />
                  <span className="shrink-0 text-[11px] text-current/85">/ API</span>
                </label>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  每次点击只新增 1 个任务；连续点击的任务按 {enabledFHLPoolAPICount} 个已启用 API 轮询分配，超过总并发空位后自动排队。单个 API 最大并发为 5。
                </p>
                {activePoolTasks.length > 0 ? (
                  <div data-audit-id="fhl-pool-live-status" className="mt-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
                      <span>运行 {poolRunningCount}/{fhlPoolEffectiveTotalConcurrencyLimit}</span>
                      <span>提交中 {poolSubmittingCount}</span>
                      <span>排队 {poolQueuedCount}</span>
                      <span>成功 {poolSucceededCount}</span>
                      <span>失败 {poolFailedCount}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                      {enabledFHLPoolSlots.map((profile) => (
                        <span
                          key={profile.id}
                          className="min-w-0 truncate rounded-[6px] border border-black/[0.07] bg-white/70 px-1.5 py-1 text-center text-[9px] font-medium text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-zinc-300"
                          title={`${profile.name} 当前占用 ${poolOccupancyByProfileId.get(profile.id) ?? 0}/${effectivePoolLimitForProfile(profile.id)}`}
                        >
                          {profile.name} {poolOccupancyByProfileId.get(profile.id) ?? 0}/{effectivePoolLimitForProfile(profile.id)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
                    单次生成模式
                  </div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    当前 {batchCount} 张
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {batchCountOptions.map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={batchCount === count}
                      onClick={() => setField("batchCount", count)}
                      title={`同一提示词发起 ${count} 次请求`}
                      className={`h-10 border px-2 text-[11px] font-semibold transition-[border-color,background-color,color,box-shadow] ${batchCount === count ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)]" : "border-black/[0.08] bg-white/88 text-zinc-700 hover:border-[color:var(--accent)]/40 hover:text-[var(--accent)] dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-zinc-200"} rounded-[8px]`}
                    >
                      {count} 张
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  这里控制连续生成关闭时的单批张数。开启连续生成后，每次点击固定生成 1 张，可在运行中继续点击提交。
                </p>
              </>
            )}
          </div>
        </div>
        {isMac && (
          <div className="mt-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">模式</div>
            <ModeSwitch
              mode={mode}
              onChange={(nextMode) => setField("mode", nextMode)}
              usesFluentUI={usesFluentUI}
            />
            <div className="mt-3">
              <PanoramaStudioEntryButton
                onClick={() => setPanoramaStudioOpen(true)}
                usesFluentUI={usesFluentUI}
              />
            </div>
          </div>
        )}
      </section>

      {errorMessage ? (
        <ErrorNotice
          errorMessage={errorMessage}
          errorRawPath={errorRawPath}
          showRetry={!!(lastPayload && !isRunning)}
          onRetry={retryLast}
          onClear={clearError}
          onPushToast={pushToast}
          onOpenRawLog={setRawLogPath}
          onOpenUpstreamConfig={() => openUpstreamConfig("app")}
          apiMode={apiMode}
        />
      ) : null}

      {!isMac && (
        <Section label="模式">
          <ModeSwitch
            mode={mode}
            onChange={(nextMode) => setField("mode", nextMode)}
            usesFluentUI={usesFluentUI}
          />
          <div className="mt-3">
            <PanoramaStudioEntryButton
              onClick={() => setPanoramaStudioOpen(true)}
              usesFluentUI={usesFluentUI}
            />
          </div>
        </Section>
      )}

      {!compactMacCompose && !compactWindowsCompose ? (
        <DesktopComposeSections
          activeAspect={activeAspect}
          aspectPresets={aspectPresets}
          activeResolution={activeResolution}
          apiMode={apiMode}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          batchProcess={batchProcess}
          clearSources={clearSources}
          chooseBatchOutputDir={chooseBatchOutputDir}
          currentImageSavedPath={currentImage?.savedPath ?? null}
          editSourceMode={editSourceMode}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          importSourceImageFile={importSourceImageFile}
          usesFluentUI={usesFluentUI}
          mode={mode}
          onRemoveSource={removeSource}
          pushToast={pushToast}
          quality={quality}
          requestPolicy={requestPolicy}
          perAPIConcurrencyLimit={perAPIConcurrencyLimit}
          enabledAPICount={enabledFHLPoolAPICount}
          totalConcurrencyLimit={fhlPoolTotalConcurrencyLimit}
          selectBatchInputDir={selectBatchInputDir}
          selectBatchInputFiles={selectBatchInputFiles}
          selectSourceImage={selectSourceImage}
          setBatchProcess={(value) => setField("batchProcess", value as any)}
          setEditSourceMode={(value) => setField("editSourceMode", value as any)}
          setField={setField as any}
          size={size}
          sources={sources}
        />
      ) : null}

      {compactWindowsCompose ? (
        <WindowsComposePanel
          apiMode={apiMode}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          batchProcess={batchProcess}
          chooseBatchOutputDir={chooseBatchOutputDir}
          clearSources={clearSources}
          composeOpen={windowsComposeOpen}
          activeAspect={activeAspect}
          aspectPresets={aspectPresets}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          continuousGenerateTest={continuousGenerateTest}
          currentImageSavedPath={currentImage?.savedPath ?? null}
          editSourceMode={editSourceMode}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          importSourceImageFile={importSourceImageFile}
          mode={mode}
          onRemoveSource={removeSource}
          pushToast={pushToast}
          quality={quality}
          requestPolicy={requestPolicy}
          perAPIConcurrencyLimit={perAPIConcurrencyLimit}
          enabledAPICount={enabledFHLPoolAPICount}
          totalConcurrencyLimit={fhlPoolTotalConcurrencyLimit}
          selectBatchInputDir={selectBatchInputDir}
          selectBatchInputFiles={selectBatchInputFiles}
          selectSourceImage={selectSourceImage}
          setBatchProcess={(value) => setField("batchProcess", value as any)}
          setComposeOpen={setWindowsComposeOpen}
          setEditSourceMode={(value) => setField("editSourceMode", value as any)}
          setField={setField as any}
          size={size}
          sources={sources}
          styleTag={styleTag}
          activeStyleLabel={activeStyleLabel}
        />
      ) : null}

      {compactMacCompose && (
        <MacComposePanel
          macComposeOpen={macComposeOpen}
          setMacComposeOpen={setMacComposeOpen}
          styleTag={styleTag}
          activeStyleLabel={activeStyleLabel}
          activeAspect={activeAspect}
          aspectPresets={aspectPresets}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          batchProcess={batchProcess}
          chooseBatchOutputDir={chooseBatchOutputDir}
          continuousGenerateTest={continuousGenerateTest}
          editSourceMode={editSourceMode}
          mode={mode}
          sources={sources}
          currentImage={currentImage}
          apiMode={apiMode}
          requestPolicy={requestPolicy}
          perAPIConcurrencyLimit={perAPIConcurrencyLimit}
          enabledAPICount={enabledFHLPoolAPICount}
          totalConcurrencyLimit={fhlPoolTotalConcurrencyLimit}
          imageModelID={imageModelID}
          selectBatchInputDir={selectBatchInputDir}
          selectBatchInputFiles={selectBatchInputFiles}
          setBatchProcess={(value) => setField("batchProcess", value as any)}
          setEditSourceMode={(value) => setField("editSourceMode", value as any)}
          setField={setField as any}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          selectSourceImage={selectSourceImage}
          clearSources={clearSources}
          quality={quality}
          Seg={Seg as any}
          SegItem={SegItem as any}
        />
      )}

      <PromptEditorSection
        mode={mode}
        promptPrefix={promptPrefix}
        prompt={prompt}
        optimizationGuidance={optimizationGuidance}
        promptPrefixLen={promptPrefixLen}
        promptLen={promptLen}
        promptPopover={promptPopover}
        setPromptPopover={setPromptPopover}
        optimizeReady={optimizeReady}
        promptTextProviderLabel={promptTextCapability.available ? promptTextCapability.label : ""}
        promptTextUnavailableReason={promptTextCapability.reason}
        isOptimizingPrompt={isOptimizingPrompt}
        isReversingPrompt={isReversingPrompt}
        reverseReady={reverseReady}
        reversePromptImage={reversePromptImage}
        styleTag={styleTag}
        onSetPromptPrefix={(value) => setField("promptPrefix", value)}
        onSetPrompt={(value) => setField("prompt", value)}
        onSetOptimizationGuidance={(value) => setField("optimizationGuidance", value)}
        onSelectReversePromptImage={selectReversePromptImage}
        onImportReversePromptImageFile={importReversePromptImageFile}
        onClearReversePromptImage={clearReversePromptImage}
        onOptimizePromptBase={() => optimizePrompt({ useGuidance: false })}
        onReversePrompt={reversePromptFromImage}
        onRewritePrompt={() => optimizePrompt({ useGuidance: true })}
        onSetStyleTag={(value) => setField("styleTag", value)}
      />

      {/* 高级参数(可折叠)*/}
      {isMac ? (
        <MacAdvancedPanel
          advancedOpen={advancedOpen}
          advancedSummary={advancedSummary}
          negativePrompt={negativePrompt}
          outputFormat={outputFormat}
          seed={seed}
          setAdvancedOpen={setAdvancedOpen}
          setField={setField as any}
          Seg={Seg as any}
          SegItem={SegItem as any}
        />
      ) : (
        <DesktopAdvancedPanel
          advancedOpen={advancedOpen}
          negativePrompt={negativePrompt}
          outputFormat={outputFormat}
          seed={seed}
          setAdvancedOpen={setAdvancedOpen}
          setField={setField as any}
        />
      )}

      <SubmitBar
        apiKey={apiKey}
        apiMode={apiMode}
        baseURL={baseURL}
        prompt={mainPromptReady}
        mode={mode}
        isRunning={isRunning}
        continuousGenerateTest={continuousGenerateTest}
        failedBatchTaskCount={failedBatchTaskCount}
        queuedBatchTaskCount={queuedBatchTaskCount}
        retryApiLabel={retryApiLabel}
        batchImageToImageCount={batchImageToImageCount}
        onOpenUpstreamConfig={() => openUpstreamConfig("app")}
        onCancel={cancel}
        onSubmit={handleSubmit}
        onRetryFailedBatchTasks={retryFailedBatchTasks}
        onCancelQueuedBatchTasks={cancelQueuedBatchTasks}
        onClearFailedBatchTasks={clearFailedBatchTasks}
      />
      <PanoramaStudioEntryModal
        open={panoramaStudioOpen}
        onClose={() => setPanoramaStudioOpen(false)}
      />
      {rawLogPath ? <RawResponseModal path={rawLogPath} onClose={() => setRawLogPath(null)} /> : null}
      <Modal
        open={continuousSubmitHintOpen}
        onClose={() => setContinuousSubmitHintOpen(false)}
        title="连续生成模式未开启"
        width={420}
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
            当前已经有任务正在排队或生成。连续生成模式关闭时，生成按钮不会并发提交新任务，避免用户误点后重复扣费。
          </p>
          <p className="text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
            需要连续点击生成并按并发设置排队时，请先开启连续生成模式。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setContinuousSubmitHintOpen(false)}
              className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              知道了
            </button>
            <button
              type="button"
              data-audit-id="enable-continuous-generate-from-submit-hint"
              onClick={enableContinuousGenerateMode}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              开启连续生成模式
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title="初始化当前工作区"
        width={420}
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
            将清空提示词、指令改写、反推图像、参考图、画布当前图和生图参数。
            历史记录、API 配置和本地输出文件不会删除。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResetConfirmOpen(false)}
              className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmResetWorkspaceDraft}
              className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              确认初始化
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
