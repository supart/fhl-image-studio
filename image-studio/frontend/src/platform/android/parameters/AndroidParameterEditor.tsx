import type { APIMode, QualityValue, RequestPolicy } from "../../../types/domain";
import { QUALITY_TIERS } from "../../../components/panel/panelOptions";
import { vibrateForPlatform } from "../bridge";
import {
  RESOLUTION_PRESETS,
  aspectPresetsForAPIMode,
  sizeCapabilityHint,
  type AspectPreset,
  type ResolutionPreset,
} from "../../../components/panel/sizeCapabilities";
import { ANDROID_BATCH_COUNT_OPTIONS, ANDROID_CONTINUOUS_CONCURRENCY_OPTIONS } from "./parameterOptions";
import {
  AndroidAspectGrid,
  AndroidDiscreteSlider,
  AndroidParameterBlock,
  AndroidParameterEditorShell,
  AndroidParameterSummary,
  AndroidSegmentedChoices,
  AndroidStyleChips,
  AndroidToggleSetting,
  buildAndroidParameterSummaryItems,
} from "./AndroidParameterPrimitives";

export function AndroidParameterEditor({
  activeAspect,
  activeAspectLabel,
  activeResolution,
  activeResolutionLabel,
  activeQualityLabel,
  activeStyleLabel,
  availableResolutions,
  apiMode,
  batchCount,
  concurrencyLimit,
  continuousGenerateTest,
  fhlImagesPoolActive,
  handleAspectSelect,
  handleResolutionSelect,
  imageModelID,
  quality,
  requestPolicy,
  onConcurrencyLimitChange,
  onSave,
  setField,
  styleTag,
}: {
  activeAspect: AspectPreset;
  activeAspectLabel: string;
  activeResolution: ResolutionPreset;
  activeResolutionLabel: string;
  activeQualityLabel: string;
  activeStyleLabel: string;
  availableResolutions: ResolutionPreset[];
  apiMode: APIMode;
  batchCount: number;
  concurrencyLimit: number;
  continuousGenerateTest: boolean;
  fhlImagesPoolActive: boolean;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  quality: string;
  requestPolicy: RequestPolicy;
  onConcurrencyLimitChange: (value: number) => void;
  onSave: () => void;
  setField: (key: "quality" | "styleTag" | "batchCount" | "continuousGenerateTest", value: any) => void;
  styleTag: string;
}) {
  const resolutionHint = sizeCapabilityHint({ apiMode, requestPolicy, imageModelID });
  const aspectOptions = aspectPresetsForAPIMode(apiMode);
  const normalizedConcurrencyLimit = Math.min(2, Math.max(1, Math.floor(Number(concurrencyLimit) || 1)));
  const summaryItems = buildAndroidParameterSummaryItems({
    activeAspectLabel,
    activeResolutionLabel,
    activeQualityLabel,
    batchCount,
    concurrencyLimit,
    continuousGenerateTest,
    fhlImagesPoolActive,
  });

  return (
    <AndroidParameterEditorShell
      summary={(
        <AndroidParameterSummary
          batchCount={batchCount}
          items={summaryItems}
          title={styleTag ? activeStyleLabel : "默认风格"}
        />
      )}
    >
      <AndroidParameterBlock
        title="风格"
        trailing={styleTag ? (
          <button type="button" onClick={() => setField("styleTag", "")}>清除</button>
        ) : null}
      >
        <AndroidStyleChips
          value={styleTag}
          onChange={(next) => setField("styleTag", next)}
        />
      </AndroidParameterBlock>

      <AndroidParameterBlock title="画幅比例">
        <AndroidAspectGrid options={aspectOptions} value={activeAspect} onChange={handleAspectSelect} />
      </AndroidParameterBlock>

      <AndroidDiscreteSlider
        label="尺寸"
        value={activeResolution}
        options={RESOLUTION_PRESETS.filter((item) => availableResolutions.includes(item.value))}
        onChange={handleResolutionSelect}
        note={resolutionHint}
      />

      <AndroidParameterBlock title="画面质量">
        <AndroidSegmentedChoices
          columns={2}
          options={QUALITY_TIERS.map((item) => ({ ...item, hint: qualityHint(item.value) }))}
          value={quality as QualityValue}
          onChange={(next) => setField("quality", next)}
        />
      </AndroidParameterBlock>

      {!continuousGenerateTest ? (
        <AndroidDiscreteSlider
          label="出图张数"
          value={batchCount}
          options={ANDROID_BATCH_COUNT_OPTIONS}
          onChange={(next) => setField("batchCount", next)}
          valueSuffix="张"
        />
      ) : null}

      <AndroidParameterBlock title="连续生成">
        <AndroidToggleSetting
          checked={continuousGenerateTest}
          label="连续出图模式"
          description="开启后，每次点击生成只追加 1 张；生成中可继续点击追加。"
          onChange={(next) => setField("continuousGenerateTest", next)}
        />
      </AndroidParameterBlock>

      {continuousGenerateTest && fhlImagesPoolActive ? (
        <AndroidParameterBlock title="连续并发">
          <p className="android-parameter-note">FHL Images 池固定每槽 4 个任务，总容量最高 40。</p>
        </AndroidParameterBlock>
      ) : continuousGenerateTest ? (
        <AndroidDiscreteSlider
          label="连续并发"
          value={normalizedConcurrencyLimit}
          options={ANDROID_CONTINUOUS_CONCURRENCY_OPTIONS}
          onChange={onConcurrencyLimitChange}
          valueSuffix="并发"
          note="控制连续出图同时运行的任务数；不限会交给上游和系统调度。"
        />
      ) : null}

      <div className="android-parameter-save-bar">
        <button
          type="button"
          className="android-parameter-save-button"
          onClick={() => {
            vibrateForPlatform(8);
            onSave();
          }}
        >
          保存设置
        </button>
      </div>
    </AndroidParameterEditorShell>
  );
}

function qualityHint(value: QualityValue) {
  switch (value) {
    case "low":
      return "更快";
    case "medium":
      return "均衡";
    case "high":
      return "细节";
    default:
      return "上游";
  }
}
