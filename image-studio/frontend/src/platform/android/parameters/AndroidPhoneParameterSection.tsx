import type { Dispatch, SetStateAction } from "react";
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

export function AndroidPhoneParameterSection({
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
  onConcurrencyLimitChange,
  parametersOpen,
  quality,
  requestPolicy,
  setField,
  setParametersOpen,
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
  onConcurrencyLimitChange: (value: number) => void;
  parametersOpen: boolean;
  quality: string;
  requestPolicy: RequestPolicy;
  setField: (key: "quality" | "styleTag" | "batchCount" | "continuousGenerateTest", value: any) => void;
  setParametersOpen: Dispatch<SetStateAction<boolean>>;
  styleTag: string;
}) {
  const toggleParameters = () => {
    vibrateForPlatform(8);
    setParametersOpen((current) => !current);
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
    <section className="platform-card android-parameter-card android-phone-parameter-card">
      <AndroidParameterSummary
        batchCount={batchCount}
        items={summaryItems}
        onClick={toggleParameters}
        open={parametersOpen}
        title={styleTag ? activeStyleLabel : "默认风格"}
      />

      <Modal
        open={parametersOpen}
        onClose={() => setParametersOpen(false)}
        title="创作参数"
        width={720}
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
