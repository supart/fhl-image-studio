import type { APIMode, BatchProcessConfig, EditSourceMode, Mode, QualityValue, RequestPolicy } from "../../types/domain";
import {
  type AspectPreset,
  type AspectPresetOption,
  type ResolutionPreset,
} from "./sizeCapabilities";
import { MacComposeSources } from "./MacComposeSources";
import { MacComposeStyleAndSize } from "./MacComposeStyleAndSize";

export function MacComposePanel({
  macComposeOpen,
  setMacComposeOpen,
  styleTag,
  activeStyleLabel,
  activeAspect,
  aspectPresets,
  activeAspectLabel,
  activeResolution,
  activeResolutionLabel,
  activeQualityLabel,
  availableResolutions,
  batchCount,
  batchProcess,
  chooseBatchOutputDir,
  continuousGenerateTest,
  editSourceMode,
  mode,
  sources,
  currentImage,
  apiMode,
  requestPolicy,
  perAPIConcurrencyLimit,
  enabledAPICount,
  totalConcurrencyLimit,
  imageModelID,
  selectBatchInputDir,
  selectBatchInputFiles,
  setBatchProcess,
  setEditSourceMode,
  setField,
  handleAspectSelect,
  handleResolutionSelect,
  selectSourceImage,
  clearSources,
  quality,
  Seg,
  SegItem,
}: {
  macComposeOpen: boolean;
  setMacComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  styleTag: string;
  activeStyleLabel: string;
  activeAspect: AspectPreset;
  aspectPresets: AspectPresetOption[];
  activeAspectLabel: string;
  activeResolution: ResolutionPreset;
  activeResolutionLabel: string;
  activeQualityLabel: string;
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  batchProcess: BatchProcessConfig;
  chooseBatchOutputDir: () => void;
  continuousGenerateTest: boolean;
  editSourceMode: EditSourceMode;
  mode: Mode;
  sources: Array<{ path: string }>;
  currentImage: { savedPath?: string } | null;
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  perAPIConcurrencyLimit: number;
  enabledAPICount: number;
  totalConcurrencyLimit: number;
  imageModelID: string;
  selectBatchInputDir: () => void;
  selectBatchInputFiles: () => void;
  setBatchProcess: (next: BatchProcessConfig) => void;
  setEditSourceMode: (mode: EditSourceMode) => void;
  setField: (key: string, value: any) => void;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  selectSourceImage: () => void;
  clearSources: () => void;
  quality: QualityValue;
  Seg: (props: { children: React.ReactNode }) => React.ReactNode;
  SegItem: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  const selectedBatchSourceCount = batchProcess.discoveredSources.filter((source) => source.selected !== false).length;
  const modeSummary = editSourceMode === "batch"
    ? `批处理 ${batchProcess.discoveredSources.length > 0 ? `${selectedBatchSourceCount}/${batchProcess.discoveredSources.length}` : "0"} 张`
    : (continuousGenerateTest ? "连续生成" : `${batchCount} 张`);

  return (
    <section className="platform-card rounded-[22px] border border-black/[0.05] bg-white/70 p-4.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setMacComposeOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">创作参数</div>
          <div className="mt-1.5 text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
            {styleTag ? `风格 ${activeStyleLabel}` : "默认风格"} 路 {activeAspectLabel} 路 {activeResolutionLabel} 路 {activeQualityLabel} 路 {modeSummary}
          </div>
        </div>
        <span className="shrink-0 pl-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {macComposeOpen ? "收起 ▴" : "展开 ▾"}
        </span>
      </button>
      {macComposeOpen && (
        <div className="mt-4 flex flex-col gap-[18px]">
          <MacComposeStyleAndSize
            activeAspect={activeAspect}
            aspectPresets={aspectPresets}
            activeResolution={activeResolution}
            apiMode={apiMode}
            availableResolutions={availableResolutions}
            batchProcess={batchProcess}
            batchCount={batchCount}
            handleAspectSelect={handleAspectSelect}
            handleResolutionSelect={handleResolutionSelect}
            imageModelID={imageModelID}
            mode={mode}
            quality={quality}
            requestPolicy={requestPolicy}
            setBatchProcess={setBatchProcess}
            setField={setField}
            styleTag={styleTag}
            Seg={Seg}
            SegItem={SegItem}
          />

          {mode === "edit" && (
            <MacComposeSources
              batchProcess={batchProcess}
              chooseBatchOutputDir={chooseBatchOutputDir}
              clearSources={clearSources}
              currentImageSavedPath={currentImage?.savedPath ?? null}
              editSourceMode={editSourceMode}
              perAPIConcurrencyLimit={perAPIConcurrencyLimit}
              enabledAPICount={enabledAPICount}
              totalConcurrencyLimit={totalConcurrencyLimit}
              selectBatchInputDir={selectBatchInputDir}
              selectBatchInputFiles={selectBatchInputFiles}
              selectSourceImage={selectSourceImage}
              setBatchProcess={setBatchProcess}
              setEditSourceMode={setEditSourceMode}
              sources={sources}
            />
          )}
        </div>
      )}
    </section>
  );
}
