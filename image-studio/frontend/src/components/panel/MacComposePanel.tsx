import type { APIMode, QualityValue, RequestPolicy } from "../../types/domain";
import {
  type AspectPreset,
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
  activeAspectLabel,
  activeResolution,
  activeResolutionLabel,
  activeQualityLabel,
  availableResolutions,
  batchCount,
  mode,
  sources,
  currentImage,
  apiMode,
  requestPolicy,
  imageModelID,
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
  activeAspectLabel: string;
  activeResolution: ResolutionPreset;
  activeResolutionLabel: string;
  activeQualityLabel: string;
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  mode: string;
  sources: Array<{ path: string }>;
  currentImage: { savedPath?: string } | null;
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID: string;
  setField: (key: string, value: any) => void;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  selectSourceImage: () => void;
  clearSources: () => void;
  quality: QualityValue;
  Seg: (props: { children: React.ReactNode }) => React.ReactNode;
  SegItem: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <section className="platform-card rounded-[22px] border border-black/[0.05] bg-white/70 p-4.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setMacComposeOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">创作参数</div>
          <div className="mt-1.5 text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
            {styleTag ? `风格 ${activeStyleLabel}` : "默认风格"} · {activeAspectLabel} · {activeResolutionLabel} · {activeQualityLabel} · {batchCount} 张
          </div>
        </div>
        <span className="shrink-0 pl-3 text-[12px] text-zinc-500 dark:text-zinc-400">{macComposeOpen ? "收起 ▾" : "展开 ▸"}</span>
      </button>
      {macComposeOpen && (
        <div className="mt-4 flex flex-col gap-[18px]">
          <MacComposeStyleAndSize
            activeAspect={activeAspect}
            activeResolution={activeResolution}
            apiMode={apiMode}
            availableResolutions={availableResolutions}
            batchCount={batchCount}
            handleAspectSelect={handleAspectSelect}
            handleResolutionSelect={handleResolutionSelect}
            imageModelID={imageModelID}
            quality={quality}
            requestPolicy={requestPolicy}
            setField={setField}
            styleTag={styleTag}
            Seg={Seg}
            SegItem={SegItem}
          />

          {mode === "edit" && (
            <MacComposeSources
              clearSources={clearSources}
              currentImageSavedPath={currentImage?.savedPath ?? null}
              selectSourceImage={selectSourceImage}
              sources={sources}
            />
          )}
        </div>
      )}
    </section>
  );
}
