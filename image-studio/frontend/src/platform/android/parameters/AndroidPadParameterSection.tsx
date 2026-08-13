import { useState } from "react";
import { Settings } from "lucide-react";
import {
  type AspectPreset,
  type ResolutionPreset,
} from "../../../components/panel/sizeCapabilities";
import type { APIMode, RequestPolicy } from "../../../types/domain";
import { Modal } from "../../../components/common/Modal";
import { vibrateForPlatform } from "../bridge";
import {
  AndroidParameterSummary,
  buildAndroidParameterSummaryItems,
} from "./AndroidParameterPrimitives";
import { AndroidParameterEditor } from "./AndroidParameterEditor";

export function AndroidPadParameterSection({
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
  isMediumPad,
  needsUpstreamSetup,
  onConcurrencyLimitChange,
  onOpenUpstream,
  quality,
  requestPolicy,
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
  isMediumPad: boolean;
  needsUpstreamSetup: boolean;
  onConcurrencyLimitChange: (value: number) => void;
  onOpenUpstream: () => void;
  quality: string;
  requestPolicy: RequestPolicy;
  setField: (key: "quality" | "batchCount" | "styleTag" | "continuousGenerateTest", value: any) => void;
  styleTag: string;
}) {
  const [parametersOpen, setParametersOpen] = useState(false);

  const openParameters = () => {
    vibrateForPlatform(8);
    setParametersOpen(true);
  };
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
    <section className={`platform-card android-parameter-card android-pad-parameter-card ${isMediumPad ? "medium" : "expanded"}`}>
      <div className="android-pad-parameter-head">
        <AndroidParameterSummary
          batchCount={batchCount}
          items={summaryItems}
          title={activeStyleLabel}
        />
        <div className="android-pad-parameter-actions">
          <button
            type="button"
            onClick={openParameters}
            className="android-parameter-upstream-button"
          >
            编辑参数
          </button>
          {needsUpstreamSetup ? (
          <button
            type="button"
            onClick={onOpenUpstream}
            className="android-parameter-upstream-button"
          >
            <Settings className="h-4 w-4" />
            打开设置
          </button>
          ) : null}
        </div>
      </div>

      <Modal
        open={parametersOpen}
        onClose={() => setParametersOpen(false)}
        title="创作参数"
        width={780}
        backdropClassName="android-parameter-modal-backdrop"
        cardClassName="android-parameter-modal-card"
        headerClassName="android-parameter-modal-header"
        bodyClassName="android-parameter-modal-body"
      >
        <AndroidParameterEditor
          activeAspect={activeAspect}
          activeAspectLabel={activeAspectLabel}
          activeResolution={activeResolution}
          activeResolutionLabel={activeResolutionLabel}
          activeQualityLabel={activeQualityLabel}
          activeStyleLabel={activeStyleLabel}
          availableResolutions={availableResolutions}
          apiMode={apiMode}
          batchCount={batchCount}
          concurrencyLimit={concurrencyLimit}
          continuousGenerateTest={continuousGenerateTest}
          fhlImagesPoolActive={fhlImagesPoolActive}
          handleAspectSelect={handleAspectSelect}
          handleResolutionSelect={handleResolutionSelect}
          imageModelID={imageModelID}
          onConcurrencyLimitChange={onConcurrencyLimitChange}
          quality={quality}
          requestPolicy={requestPolicy}
          onSave={() => setParametersOpen(false)}
          setField={setField}
          styleTag={styleTag}
        />
      </Modal>
    </section>
  );
}
