import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { useBlobURL } from "../../lib/images";
import { sourceToDataURL } from "../../lib/virtualHostStore";
import { usePlatform } from "../../platform/context";
import type { HistoryItem } from "../../types/domain";

export function SourceStrip() {
  const sources = useStudioStore((s) => s.sources);
  const removeSource = useStudioStore((s) => s.removeSource);
  const reorderSources = useStudioStore((s) => s.reorderSources);
  const mode = useStudioStore((s) => s.mode);
  const selectSourceImage = useStudioStore((s) => s.selectSourceImage);
  const { isMac, usesFluentUI, usesAppleUI } = usePlatform();

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  if (mode !== "edit") return null;

  return (
    <div data-audit-area="canvas" className={`source-strip border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""} ${isMac ? "px-3 py-2.5" : "px-3 py-2"}`}>
      <div className={`flex ${isMac ? "items-start justify-between gap-3" : "items-center gap-2"} overflow-x-auto`}>
        <div className="min-w-0 shrink-0">
          <div className="source-strip-label text-[11px] text-zinc-500 shrink-0">参考图 {sources.length} 张</div>
          {isMac && (
            <div className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              图生图时常驻显示，支持拖拽排序和继续追加参考图。
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
      {sources.map((s, i) => (
        <SourceTile
          key={s.path}
          source={s}
          index={i}
          dragFrom={dragFrom}
          overIdx={overIdx}
          setDragFrom={setDragFrom}
          setOverIdx={setOverIdx}
          reorderSources={reorderSources}
          removeSource={removeSource}
        />
      ))}
      <button
        data-audit-id="select-source-image"
        onClick={selectSourceImage}
        title="添加参考图"
        className={`source-thumb add flex h-12 w-12 shrink-0 items-center justify-center border border-dashed border-zinc-300 text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-zinc-700 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
      >
        <Plus className="w-4 h-4" />
      </button>
        </div>
      </div>
    </div>
  );
}

function SourceTile({
  source,
  index,
  dragFrom,
  overIdx,
  setDragFrom,
  setOverIdx,
  reorderSources,
  removeSource,
}: {
  source: { path: string; name: string; previewUrl?: string | null; imageBlob?: Blob | null; imageB64?: string };
  index: number;
  dragFrom: number | null;
  overIdx: number | null;
  setDragFrom: (v: number | null) => void;
  setOverIdx: (v: number | null) => void;
  reorderSources: (from: number, to: number) => void;
  removeSource: (index: number) => void;
}) {
  const objectURL = useBlobURL(source.imageBlob ?? null, source.imageB64 ?? null);
  const immediatePreviewURL = source.previewUrl || objectURL;
  const [pathPreviewURL, setPathPreviewURL] = useState("");
  const previewURL = immediatePreviewURL || pathPreviewURL;
  const { usesFluentUI } = usePlatform();

  async function openSourceOnCanvas() {
    const state = useStudioStore.getState();
    const dataURL = await sourceToDataURL(source).catch(() => "");
    const imageB64 = dataURLBase64(dataURL) || source.imageB64 || undefined;
    const item: HistoryItem = {
      id: `source-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: source.previewUrl || undefined,
      imageB64,
      imageBlob: source.imageBlob ?? null,
      previewBlob: source.imageBlob ?? null,
      previewOnly: !imageB64 && !source.imageBlob,
      prompt: `(参考图) ${source.name}`,
      mode: "edit",
      size: state.size,
      quality: state.quality,
      outputFormat: state.outputFormat,
      createdAt: Date.now(),
      savedPath: source.path,
    };
    state.setField("currentImage", item);
    state.pushToast("已在画布打开参考图大图", "success");
  }

  useEffect(() => {
    let cancelled = false;
    if (immediatePreviewURL || !source.path) {
      setPathPreviewURL("");
      return () => { cancelled = true; };
    }
    sourceToDataURL(source)
      .then((dataURL) => {
        if (!cancelled) setPathPreviewURL(dataURL);
      })
      .catch(() => {
        if (!cancelled) setPathPreviewURL("");
      });
    return () => { cancelled = true; };
  }, [immediatePreviewURL, source]);

  return (
    <div
      data-audit-id="source-image"
      draggable
      onDragStart={() => setDragFrom(index)}
      onDragOver={(e) => { e.preventDefault(); setOverIdx(index); }}
      onDragLeave={() => setOverIdx(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragFrom != null && dragFrom !== index) reorderSources(dragFrom, index);
        setDragFrom(null);
        setOverIdx(null);
      }}
      onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
      onDoubleClick={() => void openSourceOnCanvas()}
      title={`${index + 1}. ${source.name}\n${source.path}\n双击查看大图`}
      className={`source-thumb relative group h-12 w-12 shrink-0 cursor-grab overflow-hidden border transition-all ${
        overIdx === index
          ? "scale-105 border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-black/[0.06] hover:border-[color:var(--accent)]/30 dark:border-white/[0.06]"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
    >
      <span className="absolute top-0 left-0 z-10 px-1 text-[9px] bg-zinc-950/70 text-white rounded-br">
        {index + 1}
      </span>
      {previewURL ? (
        <img
          src={previewURL}
          alt={source.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800">
          {source.name.split(".").slice(-1)[0].toUpperCase()}
        </div>
      )}
      <button
        type="button"
        data-audit-id="remove-source-image"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); removeSource(index); }}
        title="移除"
        className={`source-thumb-remove absolute right-0.5 top-0.5 z-20 hidden h-6 w-6 items-center justify-center border border-white bg-red-600 text-white shadow-[0_3px_10px_rgb(185_28_28)] group-hover:flex hover:bg-red-700 dark:border-zinc-950 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function dataURLBase64(dataURL: string): string {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !dataURL.slice(0, comma).includes(";base64")) return "";
  return dataURL.slice(comma + 1);
}
