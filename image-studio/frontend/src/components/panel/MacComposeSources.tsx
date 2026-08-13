import { ImagePlus, Trash2 } from "lucide-react";

export function MacComposeSources({
  clearSources,
  currentImageSavedPath,
  selectSourceImage,
  sources,
}: {
  clearSources: () => void;
  currentImageSavedPath?: string | null;
  selectSourceImage: () => void;
  sources: Array<{ path: string }>;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-zinc-500">源图片 / 参考图</span>
        <span className="text-[10px] text-zinc-400">
          {sources.length > 0 ? `${sources.length} 张` : currentImageSavedPath ? "已就绪" : "未添加"}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="rounded-[14px] border border-black/[0.06] bg-[var(--surface)] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
          {sources.length > 0
            ? "已添加显式参考图，可继续追加、替换或拖入更多图片。"
            : currentImageSavedPath
              ? "当前画板图会作为隐式源图参与本次编辑。"
              : "先添加一张参考图，或从历史里挑一张结果继续编辑。"}
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
    </div>
  );
}
