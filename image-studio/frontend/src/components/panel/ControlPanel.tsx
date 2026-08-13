import { useState } from "react";
import { useStudioStore } from "../../state/studioStore";
import { SizeValue, QualityValue, Mode } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { AndroidPhoneComposePanel } from "../../platform/android/AndroidPhoneComposePanel";
import { AndroidPadComposePanel } from "../../platform/android/AndroidPadComposePanel";
import { DesktopAdvancedPanel } from "./DesktopAdvancedPanel";
import { ErrorNotice } from "./ErrorNotice";
import { DesktopComposeSections } from "./DesktopComposeSections";
import { MacAdvancedPanel } from "./MacAdvancedPanel";
import { MacComposePanel } from "./MacComposePanel";
import { QUALITY_TIERS, STYLE_CHIPS } from "./panelOptions";
import { PromptEditorSection } from "./PromptEditorSection";
import { Section, Seg, SegItem } from "./panelChrome";
import { SubmitBar } from "./SubmitBar";
import { WindowsComposePanel } from "./WindowsComposePanel";
import {
  ASPECT_PRESETS,
  RESOLUTION_PRESETS,
  availableResolutionPresets,
  buildAspectSizeSelection,
  buildResolutionSizeSelection,
  deriveAspectPreset,
  deriveResolutionPreset,
} from "./sizeCapabilities";

export function ControlPanel() {
  const {
    apiKey, mode, prompt, negativePrompt, size, quality, seed, styleTag,
    outputFormat, batchCount,
    sources, currentImage,
    errorMessage, errorRawPath, isRunning, lastPayload, isTestingKey, isOptimizingPrompt,
    apiMode, requestPolicy, baseURL, profiles, imageModelID,
    setField, clearError, pushToast,
    selectSourceImage, removeSource, clearSources,
    openUpstreamConfig,
    submit, cancel, retryLast, optimizePrompt,
  } = useStudioStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptPopover, setPromptPopover] = useState(false);
  const [macComposeOpen, setMacComposeOpen] = useState(true);
  const [windowsComposeOpen, setWindowsComposeOpen] = useState(true);
  const { isAndroid, isAndroidPhone, isAndroidPad, isMac, isWindows, usesAndroidUI, usesAppleUI, usesFluentUI } = usePlatform();

  if (isAndroidPhone) {
    return <AndroidPhoneComposePanel />;
  }

  if (isAndroidPad) {
    return <AndroidPadComposePanel />;
  }

  const promptLen = prompt.length;
  // 优化按钮只要有任一可用的 Responses profile 或当前 active 已配置就启用。
  // (实际 prompt 优化在 store.optimizePrompt 里会找到 Responses 那条 profile 跑;
  // 这里只判断 UI 是否能点。)
  const hasUsableResponsesProfile = profiles.some(
    (p) => p.apiMode === "responses" && p.baseURL.trim(),
  );
  const activeStyleLabel = STYLE_CHIPS.find((item) => item.id === styleTag)?.label ?? styleTag;
  const activeAspect = deriveAspectPreset(size);
  const activeResolution = deriveResolutionPreset(size);
  const activeAspectLabel = ASPECT_PRESETS.find((item) => item.value === activeAspect)?.label ?? activeAspect;
  const activeResolutionLabel = RESOLUTION_PRESETS.find((item) => item.value === activeResolution)?.label ?? activeResolution;
  const activeQualityLabel = QUALITY_TIERS.find((item) => item.value === quality)?.label ?? quality;
  const availableResolutions = availableResolutionPresets({ apiMode, requestPolicy, imageModelID });
  const optimizeReady = !!(
    prompt.trim() && (hasUsableResponsesProfile || (apiKey.trim() && baseURL.trim()))
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
      { apiMode, requestPolicy, imageModelID },
    ));
  }

  function handleResolutionSelect(resolution: typeof activeResolution) {
    setField("size", buildResolutionSizeSelection(
      activeAspect,
      resolution,
      { apiMode, requestPolicy, imageModelID },
    ));
  }

  return (
    <div data-audit-area="control-panel" className={`control-panel box-border flex shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] backdrop-blur-2xl ${usesAppleUI ? "liquid-sidebar" : ""} ${usesAndroidUI ? "android-surface-pane" : ""} ${isMac ? "w-[408px] gap-5 px-6 py-5" : "w-[372px] gap-4 px-5 py-4"} ${usesFluentUI ? "pt-3" : ""}`}>
      <section className={`platform-card ${isMac ? "px-5 py-5" : "px-4 py-4"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              className={`text-zinc-900 dark:text-zinc-100 ${usesFluentUI ? "text-[18px] font-semibold tracking-[0]" : "text-[20px] font-semibold tracking-[-0.02em]"}`}
              style={{ fontFamily: "var(--title-font)" }}
            >
              图像工作台
            </h2>
            {!isAndroid && (
              <p className={`${isMac ? "mt-1 text-[12px] leading-6" : "mt-0.5 text-[11px] leading-relaxed"} text-zinc-500 dark:text-zinc-400`}>
                保持界面简洁，把注意力留给 prompt、参考图和结果。
              </p>
            )}
            {isMac && (
              <div className="mt-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">模式</div>
                <Seg>
                  {(["generate", "edit"] as Mode[]).map((m) => (
                    <SegItem
                      key={m}
                      active={mode === m}
                      onClick={() => setField("mode", m)}
                    >
                      {m === "generate" ? "📝 文生图" : "🖼 图生图"}
                    </SegItem>
                  ))}
                </Seg>
              </div>
            )}
          </div>
          {!isMac && (
            <div className={`platform-pill bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-2xl"}`}>
              {mode === "edit" ? "图生图" : "文生图"}
            </div>
          )}
        </div>
      </section>

      {errorMessage ? (
        <ErrorNotice
          errorMessage={errorMessage}
          errorRawPath={errorRawPath}
          showRetry={!!(lastPayload && !isRunning)}
          onRetry={retryLast}
          onClear={clearError}
          onPushToast={pushToast}
        />
      ) : null}

      {!isMac && (
        <Section label="模式">
          <Seg>
            {(["generate", "edit"] as Mode[]).map((m) => (
              <SegItem
                key={m}
                active={mode === m}
                onClick={() => setField("mode", m)}
              >
                {m === "generate" ? "📝 文生图" : "🖼 图生图"}
              </SegItem>
            ))}
          </Seg>
        </Section>
      )}

      <PromptEditorSection
        mode={mode}
        prompt={prompt}
        promptLen={promptLen}
        promptPopover={promptPopover}
        setPromptPopover={setPromptPopover}
        optimizeReady={optimizeReady}
        isOptimizingPrompt={isOptimizingPrompt}
        styleTag={styleTag}
        onSetPrompt={(value) => setField("prompt", value)}
        onOptimizePrompt={optimizePrompt}
        onSetStyleTag={(value) => setField("styleTag", value)}
      />

      {!compactMacCompose && !compactWindowsCompose ? (
        <DesktopComposeSections
          activeAspect={activeAspect}
          activeResolution={activeResolution}
          apiMode={apiMode}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          clearSources={clearSources}
          currentImageSavedPath={currentImage?.savedPath ?? null}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          usesFluentUI={usesFluentUI}
          mode={mode}
          onRemoveSource={removeSource}
          quality={quality}
          requestPolicy={requestPolicy}
          selectSourceImage={selectSourceImage}
          setField={setField as any}
          size={size}
          sources={sources}
        />
      ) : null}

      {compactWindowsCompose ? (
        <WindowsComposePanel
          composeOpen={windowsComposeOpen}
          setComposeOpen={setWindowsComposeOpen}
          styleTag={styleTag}
          activeStyleLabel={activeStyleLabel}
          activeAspect={activeAspect}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          clearSources={clearSources}
          currentImageSavedPath={currentImage?.savedPath ?? null}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          mode={mode}
          onRemoveSource={removeSource}
          quality={quality}
          requestPolicy={requestPolicy}
          selectSourceImage={selectSourceImage}
          setField={setField as any}
          size={size}
          sources={sources}
          apiMode={apiMode}
        />
      ) : null}

      {compactMacCompose && (
        <MacComposePanel
          macComposeOpen={macComposeOpen}
          setMacComposeOpen={setMacComposeOpen}
          styleTag={styleTag}
          activeStyleLabel={activeStyleLabel}
          activeAspect={activeAspect}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          availableResolutions={availableResolutions}
          batchCount={batchCount}
          mode={mode}
          sources={sources}
          currentImage={currentImage}
          apiMode={apiMode}
          requestPolicy={requestPolicy}
          imageModelID={imageModelID}
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
        baseURL={baseURL}
        prompt={prompt}
        mode={mode}
        isRunning={isRunning}
        onOpenUpstreamConfig={() => openUpstreamConfig("app")}
        onCancel={cancel}
        onSubmit={submit}
      />
    </div>
  );
}
