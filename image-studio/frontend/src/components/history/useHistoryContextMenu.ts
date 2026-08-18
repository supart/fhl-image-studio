import { useState } from "react";
import type { HistoryItem, Toast } from "../../types/domain";
import { useStudioStore } from "../../state/studioStore";
import type { MenuItem } from "../common/ContextMenu";
import { canCopyHistoryItemImage, copyHistoryItemImageToClipboard } from "../canvas/canvasImage";
import { buildSharedHistoryMenu } from "./historyMenus";

type HistoryContextMenuArgs = {
  compareItemId?: string | null;
  currentImageId?: string | null;
  onApplyParams: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onOpenDetail: (item: HistoryItem) => void;
  onOpenPanorama: (item: HistoryItem) => void;
  onRepastePanorama: (item: HistoryItem) => void;
  onRepasteLocalEdit?: (item: HistoryItem) => void;
  onStartLocalEdit?: (item: HistoryItem) => void;
  onRegenerate: (item: HistoryItem) => void;
  onReuseAsSource: (item: HistoryItem) => void;
  onSaveOriginal: (item: HistoryItem) => void;
  onShare: (item: HistoryItem) => void;
  onToggleCompare: (item: HistoryItem) => void;
  pushToast: (message: string, kind?: Toast["kind"]) => void;
};

type HistoryMenuState = {
  item: HistoryItem;
  x: number;
  y: number;
};

export function useHistoryContextMenu({
  compareItemId,
  currentImageId,
  onApplyParams,
  onDelete,
  onOpenDetail,
  onOpenPanorama,
  onRepastePanorama,
  onRepasteLocalEdit,
  onStartLocalEdit,
  onRegenerate,
  onReuseAsSource,
  onSaveOriginal,
  onShare,
  onToggleCompare,
  pushToast,
}: HistoryContextMenuArgs) {
  const [menu, setMenu] = useState<HistoryMenuState | null>(null);
  const [rawPath, setRawPath] = useState<string | null>(null);

  async function copyImage(item: HistoryItem) {
    const result = await copyHistoryItemImageToClipboard(
      item,
      (target) => useStudioStore.getState().materializeCurrentImage(target),
    );
    if (result === "success") {
      pushToast("已复制图像，可直接粘贴到微信", "success");
      return;
    }
    if (result === "missing_original") {
      pushToast("当前图片没有可复制的原图", "warn");
      return;
    }
    pushToast("复制图像失败", "error");
  }

  function buildMenu(item: HistoryItem): MenuItem[] {
    return buildSharedHistoryMenu(item, {
      currentImageId: currentImageId ?? null,
      canCopyImage: canCopyHistoryItemImage(item),
      isCompare: compareItemId === item.id,
      onOpenDetail: () => onOpenDetail(item),
      onCopyPrompt: () => navigator.clipboard.writeText(item.prompt ?? "").then(
        () => pushToast("已复制 prompt", "success"),
        () => pushToast("复制失败", "error"),
      ),
      onCopyImage: () => void copyImage(item),
      onCopySavedPath: () => navigator.clipboard.writeText(item.savedPath ?? "").then(
        () => pushToast("已复制路径", "success"),
        () => pushToast("复制失败", "error"),
      ),
      onSaveOriginal: () => onSaveOriginal(item),
      onShare: () => onShare(item),
      onOpenRaw: () => setRawPath(item.rawPath ?? null),
      onApplyParams: () => onApplyParams(item),
      onRegenerate: () => onRegenerate(item),
      onReuseAsSource: () => onReuseAsSource(item),
      onRepastePanorama: () => onRepastePanorama(item),
      onRepasteLocalEdit: () => onRepasteLocalEdit?.(item),
      onStartLocalEdit: () => onStartLocalEdit?.(item),
      onOpenPanorama: () => onOpenPanorama(item),
      onToggleCompare: () => onToggleCompare(item),
      onDelete: () => onDelete(item),
    });
  }

  return {
    buildMenu,
    closeMenu: () => setMenu(null),
    closeRaw: () => setRawPath(null),
    menu,
    openMenu: (item: HistoryItem, x: number, y: number) => setMenu({ item, x, y }),
    rawPath,
  };
}
