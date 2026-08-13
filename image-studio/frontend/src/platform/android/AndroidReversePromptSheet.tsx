import { ImageUp, RefreshCw, Trash2 } from "lucide-react";
import { Modal } from "../../components/common/Modal";
import type { ReversePromptImage } from "../../state/studioStore.types";
import { vibrateForPlatform } from "./bridge";

export type AndroidReversePromptFallbackImage = {
  label: string;
  name?: string;
  previewSrc?: string;
  size?: number;
};

export function AndroidReversePromptSheet({
  open,
  onClose,
  reversePromptImage,
  fallbackImage = null,
  isReversingPrompt,
  onSelectImage,
  onClearImage,
  onReversePrompt,
}: {
  open: boolean;
  onClose: () => void;
  reversePromptImage: ReversePromptImage | null;
  fallbackImage?: AndroidReversePromptFallbackImage | null;
  isReversingPrompt: boolean;
  onSelectImage: () => void;
  onClearImage: () => void;
  onReversePrompt: () => void;
}) {
  const previewSrc = reversePromptImage?.previewUrl
    || (reversePromptImage?.imageB64 ? `data:image/png;base64,${reversePromptImage.imageB64}` : "");
  const hasImage = !!reversePromptImage;
  const fallbackPreviewSrc = fallbackImage?.previewSrc || "";
  const canReverse = hasImage || !!fallbackImage;

  const selectImage = () => {
    vibrateForPlatform(8);
    onSelectImage();
  };

  const clearImage = () => {
    vibrateForPlatform(6);
    onClearImage();
  };

  const reversePrompt = () => {
    if (!canReverse || isReversingPrompt) return;
    vibrateForPlatform(10);
    onReversePrompt();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="反推提示词"
      width={680}
      backdropClassName="android-reverse-modal-backdrop"
      cardClassName="android-reverse-modal-card"
      headerClassName="android-reverse-modal-header"
      bodyClassName="android-reverse-modal-body"
    >
      <div className="android-reverse-modal-panel">
        <div className="android-reverse-image-card rounded-[24px] border border-[color:var(--accent)]/14 bg-white/80 p-3 shadow-sm dark:bg-white/[0.04]">
          {hasImage || fallbackImage ? (
            <div className="space-y-3">
              <div className="android-reverse-preview-frame relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-[20px] bg-zinc-950/[0.04] ring-1 ring-black/[0.06] dark:bg-white/[0.04] dark:ring-white/[0.08]">
                {(previewSrc || fallbackPreviewSrc) ? (
                  <img
                    src={previewSrc || fallbackPreviewSrc}
                    alt="反推参考图预览"
                    className="max-h-[54vh] w-full object-contain"
                    decoding="async"
                  />
                ) : (
                  <ImageUp className="h-8 w-8 text-[var(--accent)]" />
                )}
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="truncate">
                  {hasImage
                    ? (reversePromptImage.name || "反推图片")
                    : `${fallbackImage?.label || "当前图片"} · ${fallbackImage?.name || "直接反推"}`}
                </span>
                <span className="shrink-0">
                  {hasImage
                    ? (reversePromptImage.size ? `${Math.round(reversePromptImage.size / 1024)} KB` : "已选择")
                    : "未单独选择"}
                </span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={selectImage}
              disabled={isReversingPrompt}
              className="android-reverse-upload-drop flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[color:var(--accent)]/30 bg-[var(--accent-soft)]/45 text-center text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageUp className="h-8 w-8" />
              <strong className="text-[15px]">选择一张图片</strong>
              <span className="max-w-[260px] text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                选择后会上传给当前上游的视觉文本模型，并返回中文文生图提示词。
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={selectImage}
            disabled={isReversingPrompt}
            className="android-reverse-secondary-action platform-pill inline-flex min-h-[42px] items-center justify-center gap-1.5 px-3 text-[12px] text-zinc-600 ring-1 ring-black/[0.06] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:ring-white/[0.08]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {hasImage ? "替换图片" : "选择图片"}
          </button>
          <button
            type="button"
            onClick={clearImage}
            disabled={!hasImage || isReversingPrompt}
            className="android-reverse-danger-action platform-pill inline-flex min-h-[42px] items-center justify-center gap-1.5 px-3 text-red-500 ring-1 ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清除
          </button>
        </div>

        <button
          type="button"
          onClick={reversePrompt}
          disabled={!canReverse || isReversingPrompt}
          title={canReverse ? "把图片反推成中文文生图提示词" : "先选择一张图片"}
          className="android-reverse-primary-action liquid-primary-button inline-flex min-h-[50px] w-full items-center justify-center gap-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
        >
          <ImageUp className={`h-4 w-4 ${isReversingPrompt ? "animate-pulse" : ""}`} />
          {isReversingPrompt ? "反推中..." : "反推提示词"}
        </button>
        <p className="android-reverse-helper m-0 text-center text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
          {isReversingPrompt
            ? "可以关闭此窗口，反推会继续进行，完成后自动写入主提示词。"
            : "开始反推后可以关闭此窗口，完成后会自动写入主提示词。"}
        </p>
      </div>
    </Modal>
  );
}
