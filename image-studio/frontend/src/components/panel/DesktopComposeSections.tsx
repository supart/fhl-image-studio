import { type DragEvent, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import type {
  APIMode,
  BatchProcessConfig,
  EditSourceMode,
  Mode,
  QualityValue,
  RequestPolicy,
  SizeValue,
} from "../../types/domain";
import { QUALITY_TIERS } from "./panelOptions";
import { Section, Seg, SegItem } from "./panelChrome";
import { AspectRatioPicker } from "./AspectRatioPicker";
import { BatchProcessSection } from "./BatchProcessSection";
import {
  RESOLUTION_PRESETS,
  type AspectPreset,
  type AspectPresetOption,
  type ResolutionPreset,
  sizeCapabilityHint,
} from "./sizeCapabilities";

export function DesktopComposeSections({
  activeAspect,
  aspectPresets,
  activeResolution,
  apiMode,
  availableResolutions,
  batchCount,
  batchProcess,
  clearSources,
  chooseBatchOutputDir,
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
  setEditSourceMode,
  setField,
  size,
  sources,
  usesFluentUI,
}: {
  activeAspect: AspectPreset;
  aspectPresets: AspectPresetOption[];
  activeResolution: ResolutionPreset;
  apiMode: APIMode;
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  batchProcess: BatchProcessConfig;
  clearSources: () => void;
  chooseBatchOutputDir: () => void;
  currentImageSavedPath?: string | null;
  editSourceMode: EditSourceMode;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  importSourceImageFile: (file: File) => Promise<void>;
  usesFluentUI: boolean;
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
  setEditSourceMode: (mode: EditSourceMode) => void;
  setField: (key: "styleTag" | "quality" | "batchCount" | "size", value: any) => void;
  size: SizeValue;
  sources: Array<{ path: string; name: string }>;
}) {
  void batchCount;
  void size;

  const [sourceFileDragActive, setSourceFileDragActive] = useState(false);
  const showTopLevelAspectPicker = mode !== "edit";
  const showEditManualAspectPicker = mode === "edit" && batchProcess.autoAspectResolution === "";
  const resolutionOptions = RESOLUTION_PRESETS.filter((item) => (
    availableResolutions.includes(item.value)
    && (batchProcess.autoAspectResolution === "" || item.value !== "auto")
  ));

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes("Files");
  const importDroppedSourceImage = (files: FileList | null) => {
    const file = Array.from(files ?? []).find((item) => item.type.startsWith("image/"));
    if (!file) {
      pushToast("请拖入 PNG/JPG/WebP 图片", "warn", 2800);
      return;
    }
    void importSourceImageFile(file);
  };

  const sourceDropHandlers = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setSourceFileDragActive(true);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setSourceFileDragActive(true);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setSourceFileDragActive(false);
      }
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setSourceFileDragActive(false);
      importDroppedSourceImage(event.dataTransfer.files);
    },
  };

  return (
    <>
      {showTopLevelAspectPicker ? (
        <Section label="比例">
          <AspectRatioPicker
            ariaLabel="比例"
            value={activeAspect}
            onChange={handleAspectSelect}
            presets={aspectPresets}
            className={usesFluentUI ? "aspect-picker-fluent" : ""}
          />
        </Section>
      ) : null}

      {mode === "edit" ? (
        <Section label={"\u6bd4\u4f8b"}>
          <div className={`border border-black/[0.06] bg-[var(--surface)] px-3 py-3 dark:border-white/[0.04] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">{"\u6e90\u56fe\u6bd4\u4f8b\u5904\u7406"}</div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              {"图生图自动适配统一按第 1 格参考图比例；批量图生图也按参考图栏第 1 格，不再逐张改变比例。需要自己指定比例时，切到手动比例。"}
            </div>
            <div className="mt-3">
              <Seg>
                <SegItem
                  active={batchProcess.autoAspectResolution !== ""}
                  onClick={() => setBatchProcess({
                    ...batchProcess,
                    autoAspectResolution: batchProcess.autoAspectResolution || "1k",
                  })}
                >
                  {"\u81ea\u52a8\u9002\u914d"}
                </SegItem>
                <SegItem
                  active={batchProcess.autoAspectResolution === ""}
                  onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: "" })}
                >
                  {"\u624b\u52a8\u6bd4\u4f8b"}
                </SegItem>
              </Seg>
            </div>
            {showEditManualAspectPicker ? (
              <div className={`mt-3 border border-black/[0.06] bg-black/[0.02] px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">{"\u624b\u52a8\u6bd4\u4f8b"}</div>
                <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  {"\u5f53\u524d\u4e0d\u81ea\u52a8\u8ddf\u968f\u6e90\u56fe\u6bd4\u4f8b\uff0c\u624b\u52a8\u9009\u62e9\u56fe\u751f\u56fe\u4f7f\u7528\u7684\u6bd4\u4f8b\u3002"}
                </div>
                <div className="mt-3">
                  <AspectRatioPicker
                    ariaLabel={"\u6bd4\u4f8b"}
                    value={activeAspect}
                    onChange={handleAspectSelect}
                    presets={aspectPresets}
                    className={usesFluentUI ? "aspect-picker-fluent" : ""}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section label="分辨率">
        <Seg>
          {resolutionOptions.map((item) => (
            <SegItem
              key={item.value}
              active={activeResolution === item.value}
              onClick={() => handleResolutionSelect(item.value)}
            >
              {item.label}
            </SegItem>
          ))}
        </Seg>
        {sizeCapabilityHint({ apiMode, requestPolicy, imageModelID }) ? (
          <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {sizeCapabilityHint({ apiMode, requestPolicy, imageModelID })}
          </p>
        ) : null}
      </Section>

      <Section label="质量">
        <Seg>
          {QUALITY_TIERS.map((item) => (
            <SegItem
              key={item.value}
              active={quality === item.value}
              onClick={() => setField("quality", item.value as QualityValue)}
            >
              {item.label}
            </SegItem>
          ))}
        </Seg>
      </Section>

      {mode === "edit" ? (
        <>
          {false ? (
          <Section label="尺寸策略">
            <div className={`border border-black/[0.06] bg-[var(--surface)] px-3 py-3 dark:border-white/[0.04] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
              <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">按源图比例自动适配</div>
              <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                图生图自动适配统一按第 1 格参考图比例；批量图生图也按参考图栏第 1 格。用户手动改过比例或分辨率后，不再自动覆盖。
              </div>
              <div className="mt-3 space-y-1.5">
                <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">源图比例处理</span>
                <Seg>
                  <SegItem
                    active={batchProcess.autoAspectResolution === ""}
                    onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: "" })}
                  >
                    沿用当前尺寸
                  </SegItem>
                  <SegItem
                    active={batchProcess.autoAspectResolution !== ""}
                    onClick={() => setBatchProcess({
                      ...batchProcess,
                      autoAspectResolution: batchProcess.autoAspectResolution || "1k",
                    })}
                  >
                    按源图比例自动适配
                  </SegItem>
                </Seg>
              </div>
              {showEditManualAspectPicker ? (
                <div className={`mt-3 border border-black/[0.06] bg-black/[0.02] px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                  <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">手动比例</div>
                  <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                    只有在沿用当前尺寸时，才需要手动选择图生图使用的比例。
                  </div>
                  <div className="mt-3">
                    <AspectRatioPicker
                      ariaLabel="比例"
                      value={activeAspect}
                      onChange={handleAspectSelect}
                      presets={aspectPresets}
                      className={usesFluentUI ? "aspect-picker-fluent" : ""}
                    />
                  </div>
                </div>
              ) : null}
              {false ? (
                <div className={`mt-3 border border-[color:var(--accent)]/18 bg-[var(--accent-soft)]/55 px-3 py-3 dark:border-[color:var(--accent)]/20 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">统一分辨率档位</div>
                      <div className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                        选择 1K / 2K / 4K 作为自动适配时的目标分辨率档位。
                      </div>
                    </div>
                    <span className={`shrink-0 border border-[color:var(--accent)]/25 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] dark:bg-white/10 ${usesFluentUI ? "rounded-[9px]" : "rounded-full"}`}>
                      当前 {batchProcess.autoAspectResolution.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(["1k", "2k", "4k"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: value })}
                        className={`border px-2 py-3 text-[12px] font-semibold transition-colors ${
                          batchProcess.autoAspectResolution === value
                            ? "border-[color:var(--accent)]/35 bg-white text-[var(--accent)] shadow-sm dark:bg-zinc-900"
                            : "border-black/[0.08] bg-white/70 text-zinc-600 hover:border-[color:var(--accent)]/30 hover:text-zinc-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300"
                        } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
                      >
                        {value.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Section>

          ) : null}

          <BatchProcessSection
            currentImageSavedPath={currentImageSavedPath}
            editSourceMode={editSourceMode}
            batchProcess={batchProcess}
            perAPIConcurrencyLimit={perAPIConcurrencyLimit}
            enabledAPICount={enabledAPICount}
            totalConcurrencyLimit={totalConcurrencyLimit}
            setEditSourceMode={setEditSourceMode}
            setBatchProcess={setBatchProcess}
            onChooseInputDir={selectBatchInputDir}
            onChooseInputFiles={selectBatchInputFiles}
            onChooseOutputDir={chooseBatchOutputDir}
            usesFluentUI={usesFluentUI}
          />

          {editSourceMode === "manual" ? (
            <Section label={`源图 / 参考图${sources.length > 0 ? ` 路 ${sources.length} 张` : ""}`}>
              <div
                {...sourceDropHandlers}
                title="点击添加图片，或把图片拖入此区域"
                className={`flex flex-col gap-1.5 border border-dashed p-2 transition-colors ${
                  sourceFileDragActive
                    ? "border-[color:var(--accent)] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]"
                    : "border-black/[0.08] bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.02]"
                } ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
              >
                {sources.length === 0 && currentImageSavedPath ? (
                  <div className={`border border-black/[0.06] bg-[var(--surface)] px-3 py-2 text-xs italic text-zinc-500 dark:border-white/[0.04] dark:text-zinc-500 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                    (画布当前图 路 隐式源图)
                  </div>
                ) : null}
                <div className={`border border-black/[0.06] bg-[var(--surface)] px-3 py-2 text-xs text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                  {sourceFileDragActive
                    ? "松开导入图像作为参考图"
                    : sources.length > 0
                      ? "已添加显式参考图，可继续追加或把图片拖入这里。"
                      : currentImageSavedPath
                        ? "当前画布图会作为隐式源图，也可以拖入图片改用显式参考图。"
                        : "点击添加图片，或把图片拖入这里作为参考图。"}
                </div>
                {sources.map((source, index) => (
                  <div key={source.path} className={`flex items-center gap-1 border border-black/[0.06] bg-[var(--surface)] px-2.5 py-2 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                    <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300" title={source.path}>
                      {index + 1}. {source.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveSource(index)}
                      title="移除"
                      className={`-m-1 p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <button
                    onClick={selectSourceImage}
                    className={`platform-action-btn flex-1 inline-flex items-center justify-center gap-1 border border-black/[0.08] px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                  >
                    <ImagePlus className="w-3.5 h-3.5" /> 添加图片
                  </button>
                  {sources.length > 0 ? (
                    <button
                      onClick={clearSources}
                      className={`platform-action-btn inline-flex items-center gap-1 border border-black/[0.08] px-3 py-2 text-xs text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
