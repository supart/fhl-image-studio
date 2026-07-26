import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCheck, FolderOpen, Images, Trash2, X } from "lucide-react";
import type { BatchProcessConfig, BatchProcessSourceImage, EditSourceMode } from "../../types/domain";
import { Section, Seg, SegItem } from "./panelChrome";

function selectedSourceCount(config: BatchProcessConfig): number {
  return config.discoveredSources.filter((source) => source.selected !== false).length;
}

function batchSummary(config: BatchProcessConfig): string {
  const outputLabel = config.outputMode === "custom_dir" ? "独立输出目录" : "回源目录";
  const sizeLabel = config.autoAspectResolution
    ? `第 1 格比例 ${config.autoAspectResolution.toUpperCase()}`
    : "沿用当前尺寸";
  const retryLabel = config.retryOnFailure ? "失败自动重试" : "失败跳过";
  const selectedCount = selectedSourceCount(config);
  const totalCount = config.discoveredSources.length;
  const sourceLabel = totalCount > 0 ? `已选 ${selectedCount}/${totalCount} 张` : "0 张";
  return `${sourceLabel} 路 ${outputLabel} 路 ${sizeLabel} 路 ${retryLabel}`;
}

function formatSourceMeta(source: BatchProcessSourceImage): string {
  const sizeLabel = source.size > 1024 * 1024
    ? `${(source.size / (1024 * 1024)).toFixed(1)} MB`
    : source.size > 0
      ? `${Math.max(1, Math.round(source.size / 1024))} KB`
      : "";
  const dimensionLabel = source.width && source.height
    ? `${source.width} x ${source.height}`
    : "";
  return [dimensionLabel, sizeLabel].filter(Boolean).join(" 路 ") || "等待读取图片信息";
}

export function BatchProcessSection({
  currentImageSavedPath,
  editSourceMode,
  batchProcess,
  perAPIConcurrencyLimit,
  enabledAPICount,
  totalConcurrencyLimit,
  setEditSourceMode,
  setBatchProcess,
  onChooseInputDir,
  onChooseInputFiles,
  onChooseOutputDir,
  usesFluentUI = false,
}: {
  currentImageSavedPath?: string | null;
  editSourceMode: EditSourceMode;
  batchProcess: BatchProcessConfig;
  perAPIConcurrencyLimit: number;
  enabledAPICount: number;
  totalConcurrencyLimit: number;
  setEditSourceMode: (mode: EditSourceMode) => void;
  setBatchProcess: (next: BatchProcessConfig) => void;
  onChooseInputDir: () => void;
  onChooseInputFiles: () => void;
  onChooseOutputDir: () => void;
  usesFluentUI?: boolean;
}) {
  void currentImageSavedPath;

  const batchMode = editSourceMode === "batch";
  const roundedClass = usesFluentUI ? "rounded-[10px]" : "rounded-[14px]";
  const surfaceClass = `border border-black/[0.06] bg-[var(--surface)] dark:border-white/[0.04] ${roundedClass}`;
  const selectedCount = selectedSourceCount(batchProcess);
  const totalCount = batchProcess.discoveredSources.length;
  const sourceListRef = useRef<HTMLDivElement | null>(null);
  const sourceVirtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => sourceListRef.current,
    estimateSize: () => 60,
    getItemKey: (index) => batchProcess.discoveredSources[index]?.path ?? index,
    overscan: 4,
  });

  function updateBatchSources(
    updater: (source: BatchProcessSourceImage, index: number) => BatchProcessSourceImage,
    nextInputDir?: string,
  ) {
    setBatchProcess({
      ...batchProcess,
      inputDir: nextInputDir ?? batchProcess.inputDir,
      discoveredSources: batchProcess.discoveredSources.map(updater),
    });
  }

  function handleToggleSource(path: string) {
    updateBatchSources((source) => (
      source.path === path
        ? { ...source, selected: source.selected === false }
        : source
    ));
  }

  function handleSelectAllSources() {
    updateBatchSources((source) => ({ ...source, selected: true }));
  }

  function handleClearSourceSelection() {
    updateBatchSources((source) => ({ ...source, selected: false }));
  }

  function handleClearBatchQueue() {
    setBatchProcess({
      ...batchProcess,
      inputDir: "",
      discoveredSources: [],
    });
  }

  return (
    <Section
      label="批处理图生图"
      trailing={batchMode ? (
        <span className="text-[10px] font-medium text-[var(--accent)]">
          {batchSummary(batchProcess)}
        </span>
      ) : (
        <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
          已关闭
        </span>
      )}
    >
      <div className="space-y-3">
        <button
          type="button"
          role="switch"
          aria-checked={batchMode}
          onClick={() => setEditSourceMode(batchMode ? "manual" : "batch")}
          className={`flex w-full items-center justify-between gap-3 border px-3 py-3 text-left transition-colors ${
            batchMode
              ? "border-[color:var(--accent)]/28 bg-[var(--accent-soft)]/50"
              : "border-black/[0.06] bg-black/[0.02] hover:border-[color:var(--accent)]/22 dark:border-white/[0.06] dark:bg-white/[0.02]"
          } ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
        >
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
              批量图生图开关
            </div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              需要时再打开，关闭后折叠全部批处理设置，不影响普通图生图。
            </div>
          </div>
          <span
            aria-hidden="true"
            className={`continuous-test-switch pointer-events-none ${
              batchMode ? "continuous-test-switch-on" : "continuous-test-switch-off"
            }`}
          >
            <span className="continuous-test-switch-thumb" />
          </span>
        </button>

        {batchMode ? (
          <div className="space-y-3">
            <div className={`${surfaceClass} px-3 py-3 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400`}>
              批处理会把加入队列的每一张图都当作独立源图，复用同一套提示词和参数逐张执行图生图，并跟随上方每 API 并发推进。
            </div>

            <div className={`${surfaceClass} px-3 py-3`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">输入队列</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    先选文件夹或直接加入多张图片；扫出来后可全选，也可点单张挑选。
                  </div>
                </div>
                <span className={`shrink-0 border border-[color:var(--accent)]/18 bg-[var(--accent-soft)]/60 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] ${usesFluentUI ? "rounded-[9px]" : "rounded-full"}`}>
                  {totalCount > 0 ? `已选 ${selectedCount}/${totalCount}` : "0 张"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onChooseInputDir}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> {batchProcess.inputDir ? "更换文件夹" : "选择文件夹"}
                </button>
                <button
                  type="button"
                  onClick={onChooseInputFiles}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <Images className="h-3.5 w-3.5" /> 直接加入多张图片
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllSources}
                  disabled={totalCount === 0}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <CheckCheck className="h-3.5 w-3.5" /> 全选
                </button>
                <button
                  type="button"
                  onClick={handleClearSourceSelection}
                  disabled={totalCount === 0}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <X className="h-3.5 w-3.5" /> 清空选择
                </button>
                <button
                  type="button"
                  onClick={handleClearBatchQueue}
                  disabled={totalCount === 0}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 清空队列
                </button>
              </div>

              <div className={`mt-3 border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-zinc-400 ${roundedClass}`}>
                {batchProcess.inputDir
                  ? (
                    <>
                      <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                        已选文件夹
                      </div>
                      <div className="mt-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={batchProcess.inputDir}>
                        {batchProcess.inputDir}
                      </div>
                    </>
                  )
                  : (
                    <div>
                      选择文件夹后会自动扫出图片，也可以直接加入多张图片再逐张挑选。
                    </div>
                  )}
              </div>

              {totalCount > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>已选 {selectedCount} / {totalCount} 张</span>
                  </div>
                  <div ref={sourceListRef} className={`h-[240px] overflow-y-auto pr-1 ${usesFluentUI ? "pb-1" : ""}`}>
                    <div className="relative w-full" style={{ height: sourceVirtualizer.getTotalSize() }}>
                    {sourceVirtualizer.getVirtualItems().map((virtualRow) => {
                      const index = virtualRow.index;
                      const source = batchProcess.discoveredSources[index];
                      if (!source) return null;
                      const active = source.selected !== false;
                      return (
                        <button
                          key={source.path}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleToggleSource(source.path)}
                          className={`absolute left-0 top-0 flex h-[52px] w-full items-center justify-between gap-3 border px-3 py-2 text-left transition-colors ${
                            active
                              ? "border-[color:var(--accent)]/28 bg-[var(--accent-soft)]/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                              : "border-black/[0.06] bg-white/72 hover:border-[color:var(--accent)]/24 hover:bg-[var(--accent-soft)]/20 dark:border-white/[0.06] dark:bg-white/[0.03]"
                          } ${roundedClass}`}
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                          title={active ? "点击取消选择" : "点击选择这张"}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[12px] font-medium ${active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}>
                              第 {index + 1} 张
                            </span>
                            <span className="mt-0.5 block text-[10px] text-zinc-500 dark:text-zinc-400">
                              {formatSourceMeta(source)}
                            </span>
                          </span>
                          <span className={`shrink-0 border px-2 py-1 text-[10px] font-semibold ${active ? "border-[color:var(--accent)]/20 bg-white/80 text-[var(--accent)] dark:bg-white/[0.08]" : "border-black/[0.08] bg-black/[0.02] text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400"} ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>
                            {active ? "已选" : "未选"}
                          </span>
                        </button>
                      );
                    })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`mt-3 border border-dashed border-black/[0.08] bg-black/[0.02] px-3 py-3 text-[11px] text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-zinc-400 ${roundedClass}`}>
                  还没有加入批处理图片
                </div>
              )}
            </div>

            <div className={`${surfaceClass} px-3 py-3`}>
              <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">输出位置</div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                成功结果会按你的输出策略写回源目录或独立目录，同时正常进入当前批次视图和历史。
              </div>

              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">输出策略</span>
                  <Seg>
                    <SegItem
                      active={batchProcess.outputMode === "source_dir"}
                      onClick={() => setBatchProcess({ ...batchProcess, outputMode: "source_dir" })}
                    >
                      回源目录
                    </SegItem>
                    <SegItem
                      active={batchProcess.outputMode === "custom_dir"}
                      onClick={() => setBatchProcess({ ...batchProcess, outputMode: "custom_dir" })}
                    >
                      独立输出目录
                    </SegItem>
                  </Seg>
                </div>

                {batchProcess.outputMode === "custom_dir" ? (
                  <div className="space-y-1.5">
                    <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">独立输出目录</span>
                    <button
                      type="button"
                      onClick={onChooseOutputDir}
                      className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> {batchProcess.outputDir ? "更换输出目录" : "选择输出目录"}
                    </button>
                    <div className={`border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-zinc-400 ${roundedClass}`}>
                      {batchProcess.outputDir ? (
                        <>
                          <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                            已选输出目录
                          </div>
                          <div className="mt-1 truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={batchProcess.outputDir}>
                            {batchProcess.outputDir}
                          </div>
                        </>
                      ) : (
                        <div>点击选择输出目录后，批处理成功结果会复制到这里。</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className={`border border-[color:var(--accent)]/18 bg-[var(--accent-soft)]/55 px-3 py-3 dark:border-[color:var(--accent)]/20 ${roundedClass}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">当前跟随每 API 并发：</div>
                      <div className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                        每个已启用 API 最多 {perAPIConcurrencyLimit} 张；已启用 {enabledAPICount} 个 API，总上限 {totalConcurrencyLimit}。
                      </div>
                    </div>
                    <span className={`shrink-0 border border-[color:var(--accent)]/25 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] dark:bg-white/10 ${usesFluentUI ? "rounded-[9px]" : "rounded-full"}`}>
                      {perAPIConcurrencyLimit}/API · 总 {totalConcurrencyLimit}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">失败处理</span>
                  <Seg>
                    <SegItem
                      active={!batchProcess.retryOnFailure}
                      onClick={() => setBatchProcess({ ...batchProcess, retryOnFailure: false })}
                    >
                      失败跳过
                    </SegItem>
                    <SegItem
                      active={batchProcess.retryOnFailure}
                      onClick={() => setBatchProcess({ ...batchProcess, retryOnFailure: true })}
                    >
                      失败自动重试
                    </SegItem>
                  </Seg>
                </div>
              </div>
            </div>

            <div className={`${surfaceClass} px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400`}>
              批量输出会默认使用 <code>processed-</code> 作为文件名前缀；如果重名，会自动追加编号避免覆盖原图。
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
