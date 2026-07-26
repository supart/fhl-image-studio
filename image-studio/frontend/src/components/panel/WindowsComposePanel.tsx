import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  APIMode,
  BatchProcessConfig,
  EditSourceMode,
  Mode,
  QualityValue,
  RequestPolicy,
  SizeValue,
} from "../../types/domain";
import { DesktopComposeSections } from "./DesktopComposeSections";
import type { AspectPreset, AspectPresetOption, ResolutionPreset } from "./sizeCapabilities";

export function WindowsComposePanel({
  apiMode,
  aspectPresets,
  availableResolutions,
  batchCount,
  batchProcess,
  chooseBatchOutputDir,
  clearSources,
  composeOpen,
  continuousGenerateTest,
  currentImageSavedPath,
  editSourceMode,
  handleAspectSelect,
  handleResolutionSelect,
  imageModelID,
  importSourceImageFile,
  mode,
  onRemoveSource,
  pushToast,
  quality,
  requestPolicy,
  perAPIConcurrencyLimit,
  enabledAPICount,
  totalConcurrencyLimit,
  selectBatchInputDir,
  selectBatchInputFiles,
  selectSourceImage,
  setBatchProcess,
  setComposeOpen,
  setEditSourceMode,
  setField,
  size,
  sources,
  styleTag,
  activeStyleLabel,
  activeAspect,
  activeAspectLabel,
  activeResolution,
  activeResolutionLabel,
  activeQualityLabel,
}: {
  apiMode: APIMode;
  aspectPresets: AspectPresetOption[];
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  batchProcess: BatchProcessConfig;
  chooseBatchOutputDir: () => void;
  clearSources: () => void;
  composeOpen: boolean;
  continuousGenerateTest: boolean;
  currentImageSavedPath?: string | null;
  editSourceMode: EditSourceMode;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  importSourceImageFile: (file: File) => Promise<void>;
  mode: Mode;
  onRemoveSource: (index: number) => void;
  pushToast: (text: string, kind?: "info" | "success" | "error" | "warn", ttl?: number) => void;
  quality: QualityValue;
  requestPolicy: RequestPolicy;
  perAPIConcurrencyLimit: number;
  enabledAPICount: number;
  totalConcurrencyLimit: number;
  selectBatchInputDir: () => void;
  selectBatchInputFiles: () => void;
  selectSourceImage: () => void;
  setBatchProcess: (next: BatchProcessConfig) => void;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditSourceMode: (mode: EditSourceMode) => void;
  setField: (key: "styleTag" | "quality" | "batchCount" | "size", value: any) => void;
  size: SizeValue;
  sources: Array<{ path: string; name: string }>;
  styleTag: string;
  activeStyleLabel: string;
  activeAspect: AspectPreset;
  activeAspectLabel: string;
  activeResolution: ResolutionPreset;
  activeResolutionLabel: string;
  activeQualityLabel: string;
}) {
  const selectedBatchSourceCount = batchProcess.discoveredSources.filter((source) => source.selected !== false).length;
  const batchSourceSummary = batchProcess.discoveredSources.length > 0
    ? `${selectedBatchSourceCount}/${batchProcess.discoveredSources.length} 张`
    : "0 张";
  const sourceLabel = editSourceMode === "batch"
    ? `批处理 ${batchSourceSummary}`
    : mode === "edit"
      ? sources.length > 0
        ? `${sources.length} 张源图`
        : currentImageSavedPath
          ? "画布图作源图"
          : "未添加源图"
      : "文生图";

  const summary = [
    styleTag ? activeStyleLabel : "默认风格",
    activeAspectLabel,
    activeResolutionLabel,
    activeQualityLabel,
    editSourceMode === "batch" ? "批处理" : (continuousGenerateTest ? "连续生成" : `${batchCount} 张`),
    sourceLabel,
  ].join(" · ");

  return (
    <section className="platform-card windows-compose-panel">
      <button
        type="button"
        onClick={() => setComposeOpen((value) => !value)}
        className="windows-compose-toggle"
      >
        <span className="min-w-0">
          <span className="windows-compose-title">创作参数</span>
          <span className="windows-compose-summary">{summary}</span>
        </span>
        <span className="windows-compose-state">
          {composeOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {composeOpen ? "收起" : "展开"}
        </span>
      </button>

      {composeOpen ? (
        <div className="windows-compose-body">
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
            currentImageSavedPath={currentImageSavedPath}
            editSourceMode={editSourceMode}
            handleAspectSelect={handleAspectSelect}
            handleResolutionSelect={handleResolutionSelect}
            imageModelID={imageModelID}
            importSourceImageFile={importSourceImageFile}
            usesFluentUI
            mode={mode}
            onRemoveSource={onRemoveSource}
            pushToast={pushToast}
            quality={quality}
            requestPolicy={requestPolicy}
            perAPIConcurrencyLimit={perAPIConcurrencyLimit}
            enabledAPICount={enabledAPICount}
            totalConcurrencyLimit={totalConcurrencyLimit}
            selectBatchInputDir={selectBatchInputDir}
            selectBatchInputFiles={selectBatchInputFiles}
            selectSourceImage={selectSourceImage}
            setBatchProcess={setBatchProcess}
            setEditSourceMode={setEditSourceMode}
            setField={setField}
            size={size}
            sources={sources}
          />
        </div>
      ) : null}
    </section>
  );
}
