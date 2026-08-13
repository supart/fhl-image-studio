import { ChevronDown, ChevronRight } from "lucide-react";
import type { APIMode, Mode, QualityValue, RequestPolicy, SizeValue } from "../../types/domain";
import { DesktopComposeSections } from "./DesktopComposeSections";
import type { AspectPreset, ResolutionPreset } from "./sizeCapabilities";

export function WindowsComposePanel({
  composeOpen,
  setComposeOpen,
  styleTag,
  activeStyleLabel,
  activeAspect,
  activeAspectLabel,
  activeResolution,
  activeResolutionLabel,
  activeQualityLabel,
  availableResolutions,
  batchCount,
  clearSources,
  currentImageSavedPath,
  handleAspectSelect,
  handleResolutionSelect,
  imageModelID,
  mode,
  onRemoveSource,
  quality,
  requestPolicy,
  selectSourceImage,
  setField,
  size,
  sources,
  apiMode,
}: {
  composeOpen: boolean;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  styleTag: string;
  activeStyleLabel: string;
  activeAspect: AspectPreset;
  activeAspectLabel: string;
  activeResolution: ResolutionPreset;
  activeResolutionLabel: string;
  activeQualityLabel: string;
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  clearSources: () => void;
  currentImageSavedPath?: string | null;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  mode: Mode;
  onRemoveSource: (index: number) => void;
  quality: QualityValue;
  requestPolicy: RequestPolicy;
  selectSourceImage: () => void;
  setField: (key: "styleTag" | "quality" | "batchCount" | "size", value: any) => void;
  size: SizeValue;
  sources: Array<{ path: string; name: string }>;
  apiMode: APIMode;
}) {
  const sourceLabel = mode === "edit"
    ? sources.length > 0
      ? `${sources.length} 张源图`
      : currentImageSavedPath
        ? "画板图作源图"
        : "未添加源图"
    : "文生图";
  const summary = [
    styleTag ? activeStyleLabel : "默认风格",
    activeAspectLabel,
    activeResolutionLabel,
    activeQualityLabel,
    `${batchCount} 张`,
    sourceLabel,
  ].join(" · ");
  const multiSourceHint = mode === "edit" && sources.length > 1
    ? "多参考图规则:第 1 张为主图,后续图片作为人物/风格/场景参考;失败时会自动尝试兼容模式。"
    : "";

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
          {multiSourceHint ? (
            <div className="mx-4 mt-3 rounded-[10px] border border-blue-400/25 bg-blue-500/[0.08] px-3 py-2 text-[12px] leading-5 text-blue-700 dark:text-blue-200">
              {multiSourceHint}
            </div>
          ) : null}
          <DesktopComposeSections
            activeAspect={activeAspect}
            activeResolution={activeResolution}
            apiMode={apiMode}
            availableResolutions={availableResolutions}
            batchCount={batchCount}
            clearSources={clearSources}
            currentImageSavedPath={currentImageSavedPath}
            handleAspectSelect={handleAspectSelect}
            handleResolutionSelect={handleResolutionSelect}
            imageModelID={imageModelID}
            mode={mode}
            onRemoveSource={onRemoveSource}
            quality={quality}
            requestPolicy={requestPolicy}
            selectSourceImage={selectSourceImage}
            setField={setField}
            size={size}
            sources={sources}
            usesFluentUI
          />
        </div>
      ) : null}
    </section>
  );
}
