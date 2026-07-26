import { ImagePlus, Trash2 } from "lucide-react";
import type { BatchProcessConfig, EditSourceMode } from "../../types/domain";
import { BatchProcessSection } from "./BatchProcessSection";

export function MacComposeSources({
  batchProcess,
  chooseBatchOutputDir,
  clearSources,
  currentImageSavedPath,
  editSourceMode,
  perAPIConcurrencyLimit,
  enabledAPICount,
  totalConcurrencyLimit,
  selectBatchInputDir,
  selectBatchInputFiles,
  selectSourceImage,
  setBatchProcess,
  setEditSourceMode,
  sources,
}: {
  batchProcess: BatchProcessConfig;
  chooseBatchOutputDir: () => void;
  clearSources: () => void;
  currentImageSavedPath?: string | null;
  editSourceMode: EditSourceMode;
  perAPIConcurrencyLimit: number;
  enabledAPICount: number;
  totalConcurrencyLimit: number;
  selectBatchInputDir: () => void;
  selectBatchInputFiles: () => void;
  selectSourceImage: () => void;
  setBatchProcess: (next: BatchProcessConfig) => void;
  setEditSourceMode: (mode: EditSourceMode) => void;
  sources: Array<{ path: string }>;
}) {
  return (
    <div>
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
      />

      {editSourceMode === "manual" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="rounded-[14px] border border-black/[0.06] bg-[var(--surface)] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
            {sources.length > 0
              ? "已添加显式参考图，可以继续追加或更换。"
              : currentImageSavedPath
                ? "当前画布图会作为隐式源图参与本次编辑。"
                : "先添加一张参考图，或从历史里挑一张图继续编辑。"}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={selectSourceImage}
              className="platform-action-btn flex-1 inline-flex items-center justify-center gap-1 rounded-full border border-black/[0.08] px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300"
            >
              <ImagePlus className="w-3.5 h-3.5" /> 添加图片
            </button>
            {sources.length > 0 ? (
              <button
                onClick={clearSources}
                className="platform-action-btn inline-flex items-center gap-1 rounded-full border border-black/[0.08] px-3 py-2 text-xs text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 dark:border-white/[0.08]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
