import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Compass, ImagePlus, Images, Sparkles } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import type { HistoryItem } from "../../types/domain";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import { Modal } from "../common/Modal";
import { deriveResolutionPreset } from "../panel/sizeCapabilities";
import {
  buildPanoramaGenerateSize,
  isPanoramaStudioItem,
  preservePanoramaManualAspect,
  recentPanoramaHistoryItems,
} from "./panoramaStudioEntry";

function PanoramaHistoryCard({
  item,
  onOpen,
}: {
  item: HistoryItem;
  onOpen: (item: HistoryItem) => void;
}) {
  const objectURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64);
  const src = historyPreviewSrc(item, objectURL);
  const title = item.prompt?.trim() || "360 全景图";
  const sizeLabel = item.width && item.height
    ? `${item.width}x${item.height}`
    : item.size || "2:1";

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group overflow-hidden rounded-[8px] border border-black/[0.08] bg-white/80 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-[1px] hover:border-[color:var(--accent)]/45 hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]"
      title="进入 360 查看"
    >
      <div className="aspect-[2/1] bg-zinc-100 dark:bg-zinc-900">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <Compass className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="space-y-1 px-2.5 py-2">
        <div className="truncate text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{title}</div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{sizeLabel}</div>
      </div>
    </button>
  );
}

export function PanoramaStudioEntryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const {
    apiMode,
    requestPolicy,
    imageModelID,
    size,
    batchProcess,
    currentImage,
    history,
    setField,
    importImageFile,
    openPanoramaViewer,
    pushToast,
  } = useStudioStore();

  const currentPanorama = isPanoramaStudioItem(currentImage) ? currentImage : null;
  const recentPanoramas = useMemo(
    () => recentPanoramaHistoryItems(history, 6),
    [history],
  );

  function handleGeneratePanorama() {
    const nextSize = buildPanoramaGenerateSize({
      apiMode,
      requestPolicy,
      imageModelID,
      currentResolution: deriveResolutionPreset(size),
    });
    if (!nextSize) {
      pushToast("当前 API 配置不支持 2:1 全景比例，请切换到 FHL、APIMart 或 RunningHub。", "warn", 3600);
      return;
    }
    const manualBatchProcess = preservePanoramaManualAspect(batchProcess);
    if (manualBatchProcess !== batchProcess) {
      setField("batchProcess", manualBatchProcess);
    }
    setField("mode", "generate");
    setField("size", nextSize);
    onClose();
    pushToast("已切到 2:1 全景生成，输入提示词后点击生成。", "success", 2600);
  }

  async function handleOpenPanorama(item: HistoryItem) {
    onClose();
    await openPanoramaViewer(item);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    const previousCurrentId = useStudioStore.getState().currentImage?.id;
    setImporting(true);
    try {
      await importImageFile(file, { forcePanorama: true });
      const imported = useStudioStore.getState().currentImage;
      if (imported && imported.id !== previousCurrentId) {
        onClose();
        await openPanoramaViewer(imported);
        pushToast("已导入并打开 360 查看器。", "success", 2600);
        return;
      }
      pushToast("没有检测到新的导入图像，请重新选择图片。", "warn", 3200);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="360 工作台" width={560}>
      <div className="space-y-4">
        <div className="rounded-[10px] border border-[color:var(--accent)]/20 bg-[var(--accent-soft)]/55 px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            <Compass className="h-4 w-4 text-[var(--accent)]" />
            生成全景 / 编辑全景 / 镜头输出 / 贴回管理
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300">
            这里会复用现有 360 查看器和输出管理。生成时自动设为 2:1；导入 2:1 图片后会进入全景查看。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleGeneratePanorama}
            className="rounded-[10px] border border-black/[0.08] bg-white/88 p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-[1px] hover:border-[color:var(--accent)]/45 hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]"
          >
            <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              生成 360 全景图
            </div>
            <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
              切到文生图并设置 2:1，全景提示词仍由你自己输入。
            </p>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-[10px] border border-black/[0.08] bg-white/88 p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-[1px] hover:border-[color:var(--accent)]/45 hover:shadow-sm disabled:cursor-wait disabled:opacity-60 dark:border-white/[0.08] dark:bg-white/[0.05]"
          >
            <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
              <ImagePlus className="h-4 w-4 text-[var(--accent)]" />
              导入 / 编辑 360 全景图
            </div>
            <p className="mt-2 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
              选择本地 2:1 图片，导入后直接进入 360 查看器。
            </p>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />

        {currentPanorama ? (
          <div className="rounded-[10px] border border-black/[0.08] bg-white/72 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">当前预览是 2:1 全景图</div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{currentPanorama.prompt || "当前全景图"}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleOpenPanorama(currentPanorama)}
                className="shrink-0 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--accent-2)]"
              >
                编辑当前全景
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
            <Images className="h-3.5 w-3.5 text-[var(--accent)]" />
            最近 360 全景图
          </div>
          {recentPanoramas.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recentPanoramas.map((item) => (
                <PanoramaHistoryCard
                  key={item.id}
                  item={item}
                  onOpen={(target) => void handleOpenPanorama(target)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-black/[0.12] px-3 py-4 text-center text-[12px] text-zinc-500 dark:border-white/[0.12] dark:text-zinc-400">
              还没有可管理的 2:1 全景历史图。
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
