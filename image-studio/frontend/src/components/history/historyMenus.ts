import type { HistoryItem } from "../../types/domain";
import { hasPanoramaRoundtripRef } from "../../panorama/core";
import type { MenuItem } from "../common/ContextMenu";

type SharedHistoryMenuActions = {
  currentImageId?: string | null;
  onOpenDetail: () => void;
  onCopyPrompt: () => void;
  onCopyImage: () => void;
  onCopySavedPath: () => void;
  onSaveOriginal: () => void;
  onShare: () => void;
  onOpenRaw: () => void;
  onApplyParams: () => void;
  onRegenerate: () => void;
  onReuseAsSource: () => void;
  onRepastePanorama: () => void;
  onRepasteLocalEdit: () => void;
  onStartLocalEdit: () => void;
  onOpenPanorama: () => void;
  onToggleCompare: () => void;
  onDelete: () => void;
  canCopyImage?: boolean;
  isCompare?: boolean;
};

export function buildSharedHistoryMenu(
  item: HistoryItem,
  actions: SharedHistoryMenuActions,
): MenuItem[] {
  const items: MenuItem[] = [
    { label: "详情", onClick: actions.onOpenDetail },
    {
      label: "复制 prompt",
      separatorBefore: true,
      onClick: actions.onCopyPrompt,
    },
    {
      label: "复制图像",
      disabled: actions.canCopyImage === false,
      onClick: actions.onCopyImage,
    },
    {
      label: "复制本地路径",
      disabled: !item.savedPath,
      onClick: actions.onCopySavedPath,
    },
    {
      label: "保存原图",
      disabled: !(item.savedPath || item.imageB64 || item.fullUrl || item.imageId),
      onClick: actions.onSaveOriginal,
    },
    {
      label: "分享图片",
      disabled: !(item.savedPath || item.imageB64 || item.fullUrl || item.imageId),
      onClick: actions.onShare,
    },
    {
      label: "查看 raw 响应",
      disabled: !item.rawPath,
      onClick: actions.onOpenRaw,
    },
    {
      separatorBefore: true,
      label: "应用参数（不生成）",
      onClick: actions.onApplyParams,
    },
    {
      label: "以此参数重新生成",
      onClick: actions.onRegenerate,
    },
    {
      separatorBefore: true,
      label: "设为源图",
      disabled: !(item.savedPath || item.imageB64 || item.fullUrl || item.imageId),
      onClick: actions.onReuseAsSource,
    },
  ];
  items.push({
    label: "进入360查看",
    onClick: actions.onOpenPanorama,
  });
  items.push({
    label: "局部裁切编辑",
    onClick: actions.onStartLocalEdit,
  });
  if (hasPanoramaRoundtripRef(item)) {
    items.push({
      label: "手动对齐贴回全景图",
      onClick: actions.onRepastePanorama,
    });
  } else if (item.localEditRoundtrip?.kind === "planar") {
    items.push({
      label: "手动对齐贴回原图",
      onClick: actions.onRepasteLocalEdit,
    });
  }
  items.push(
    {
      label: actions.isCompare ? "取消对比" : "用作对比图（B）",
      disabled: actions.currentImageId === item.id,
      onClick: actions.onToggleCompare,
    },
    {
      label: "删除",
      danger: true,
      disabled: !!item.previewOnly,
      separatorBefore: true,
      onClick: actions.onDelete,
    },
  );
  return items;
}
