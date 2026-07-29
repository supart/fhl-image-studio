import { Ellipsis, X } from "lucide-react";
import type React from "react";
import {
  buildHistoryItemDragExport,
  writeImageFileDragData,
  writeInternalHistoryItemDragData,
} from "../../lib/dragExport.ts";
import { historyFullSrc, historyPreviewSrc, useBlobURL, useImageLoadState } from "../../lib/images";
import { ImagePixelSizeBadge } from "../common/ImagePixelSizeBadge";
import { usePlatform } from "../../platform/context";
import { BeginNativeFileDrag } from "../../platform/runtime/host";
import type { HistoryItem } from "../../types/domain";
import { HistoryApiSourceBadge } from "./HistoryApiSourceBadge";
import { HistoryMetaBadges } from "./HistoryMetaBadges";
import { HistoryModeBadge } from "./HistoryModeBadge";
import { apiSourceDisplayName } from "./historyApiSource";
import { qualityLabel, sizeLabel } from "./historyLabels";

const EMPTY_PROMPT_LABEL = "(无 prompt)";
const MORE_LABEL = "更多";
const DELETE_LABEL = "删除";

export function HistoryTile({
  item,
  isCurrent,
  isCompare,
  onSelect,
  onToggleCompare,
  onReuse,
  onDelete,
  onOpenMenu,
  variant = "default",
}: {
  item: HistoryItem;
  isCurrent: boolean;
  isCompare: boolean;
  onSelect: (h: HistoryItem) => void;
  onToggleCompare: (h: HistoryItem | null) => void;
  onReuse: (h: HistoryItem) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onOpenMenu: (x: number, y: number) => void;
  variant?: "default" | "phone" | "phoneFeature" | "windowsFeature" | "windowsList";
}) {
  const { isMac, usesFluentUI } = usePlatform();
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const fullImageSrc = historyFullSrc(item, previewURL);
  const imageLoadState = useImageLoadState(imageSrc || null);
  const dragSpec = buildHistoryItemDragExport(item, imageSrc);
  const promptLabel = item.prompt || EMPTY_PROMPT_LABEL;
  const apiSourceName = apiSourceDisplayName(item);
  const metaBadges = [apiSourceName, sizeLabel(item.size), qualityLabel(item.quality)].filter(Boolean);

  function renderPixelSizeBadge(className = "history-image-pixel-size") {
    return <ImagePixelSizeBadge width={item.width} height={item.height} src={fullImageSrc || imageSrc} className={className} />;
  }

  function renderImage(props: React.ImgHTMLAttributes<HTMLImageElement> = {}) {
    if (!imageSrc || imageLoadState !== "ready") {
      return <div className={`history-thumb-fallback ${props.className ?? ""}`} aria-hidden="true" />;
    }
    return (
      <img
        {...props}
        src={imageSrc}
        alt={props.alt ?? item.prompt}
        draggable={!!dragSpec}
        onDragStart={handleImageDragStart}
      />
    );
  }

  function openMenuFromEvent(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onOpenMenu(e.clientX, e.clientY);
  }

  function handleSelect(e: React.MouseEvent) {
    if (e.button === 2 || e.ctrlKey) return;
    if (e.shiftKey) {
      if (isCompare) onToggleCompare(null);
      else if (item.id !== undefined) onToggleCompare(item);
      return;
    }
    void onSelect(item);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 2 || e.ctrlKey) {
      openMenuFromEvent(e);
    }
  }

  function handleImageDragStart(e: React.DragEvent<HTMLImageElement>) {
    if (!dragSpec) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    if (isMac && item.savedPath) {
      e.preventDefault();
      void BeginNativeFileDrag(item.savedPath).catch((error) => {
        console.error("[drag-export] native-file-drag failed", error);
      });
      return;
    }
    e.dataTransfer.effectAllowed = "copy";
    writeInternalHistoryItemDragData(e.dataTransfer, item);
    writeImageFileDragData(e.dataTransfer, dragSpec);
  }

  if (variant === "phoneFeature") {
    return (
      <div
        data-audit-id="history-item"
        title={item.prompt}
        onClick={handleSelect}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onReuse(item)}
        onContextMenu={openMenuFromEvent}
        className={`android-history-feature-tile ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      >
        {renderImage({
          alt: item.prompt,
          loading: "eager",
          decoding: "async",
        })}
        <HistoryModeBadge mode={item.mode} className="android-history-tile-mode" />
        <HistoryApiSourceBadge source={item} className="absolute left-2 bottom-2 rounded-[6px]" />
        {renderPixelSizeBadge("android-history-pixel-size")}
        <button
          type="button"
          data-audit-id="history-item-menu"
          className="android-history-tile-menu"
          onClick={openMenuFromEvent}
          onContextMenu={openMenuFromEvent}
          title={MORE_LABEL}
        >
          <Ellipsis className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (variant === "phone") {
    return (
      <div
        data-audit-id="history-item"
        title={item.prompt}
        onClick={handleSelect}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onReuse(item)}
        onContextMenu={openMenuFromEvent}
        className={`android-history-tile ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      >
        <div className="android-history-tile-image">
          {renderImage({
            alt: item.prompt,
            loading: "eager",
            decoding: "async",
          })}
          <HistoryModeBadge mode={item.mode} className="android-history-tile-mode" />
          <HistoryApiSourceBadge source={item} className="absolute left-2 bottom-2 rounded-[6px]" />
          {renderPixelSizeBadge()}
          {isCompare ? <span className="android-history-compare-badge">B</span> : null}
        </div>
        <div className="android-history-tile-body">
          <p>{promptLabel}</p>
          <HistoryMetaBadges items={metaBadges} compact />
        </div>
        <div className="android-history-tile-actions">
          <button
            type="button"
            data-audit-id="history-item-menu"
            onClick={openMenuFromEvent}
            onContextMenu={openMenuFromEvent}
            title={MORE_LABEL}
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-audit-id="history-item-delete"
            onClick={(e) => {
              e.stopPropagation();
              void onDelete(item.id);
            }}
            onContextMenu={openMenuFromEvent}
            title={DELETE_LABEL}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (variant === "windowsFeature") {
    return (
      <div
        data-audit-id="history-item"
        title={item.prompt}
        onClick={handleSelect}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onReuse(item)}
        onContextMenu={openMenuFromEvent}
        className={`windows-history-feature-tile ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      >
        <div className="windows-history-feature-image">
          {renderImage({
            alt: item.prompt,
            loading: "eager",
            decoding: "async",
          })}
          <HistoryModeBadge mode={item.mode} className="windows-history-mode" />
          <HistoryApiSourceBadge source={item} className="absolute bottom-2 left-2 rounded-[6px]" />
          {renderPixelSizeBadge("windows-history-image-pixel-size")}
          {isCompare ? <span className="windows-history-compare-badge">B</span> : null}
        </div>
        <div className="windows-history-feature-body">
          <p>{promptLabel}</p>
          <HistoryMetaBadges items={metaBadges} compact />
          <div className="windows-history-tile-actions">
            <button
              type="button"
              data-audit-id="history-item-menu"
              onClick={openMenuFromEvent}
              onContextMenu={openMenuFromEvent}
            >
              <Ellipsis className="h-3.5 w-3.5" /> {MORE_LABEL}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "windowsList") {
    return (
      <div
        data-audit-id="history-item"
        title={item.prompt}
        onClick={handleSelect}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onReuse(item)}
        onContextMenu={openMenuFromEvent}
        className={`windows-history-row ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      >
        <div className="windows-history-row-thumb">
          {renderImage({
            alt: item.prompt,
            loading: "eager",
            decoding: "async",
          })}
          {renderPixelSizeBadge("windows-history-image-pixel-size")}
        </div>
        <div className="windows-history-row-main">
          <p>{promptLabel}</p>
          <div className="windows-history-row-meta">
            <HistoryModeBadge mode={item.mode} />
            <HistoryMetaBadges items={metaBadges} compact />
            {isCompare ? <span className="windows-history-compare-inline">B</span> : null}
          </div>
        </div>
        <div className="windows-history-row-actions">
          <button
            type="button"
            data-audit-id="history-item-menu"
            onClick={openMenuFromEvent}
            onContextMenu={openMenuFromEvent}
            title={MORE_LABEL}
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-audit-id="history-item-delete"
            onClick={(event) => {
              event.stopPropagation();
              void onDelete(item.id);
            }}
            onContextMenu={openMenuFromEvent}
            title={DELETE_LABEL}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (isMac) {
    return (
      <div
        data-audit-id="history-item"
        title={item.prompt}
        onClick={handleSelect}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onReuse(item)}
        onContextMenu={openMenuFromEvent}
        className={`group relative overflow-hidden border bg-white/70 shadow-[var(--shadow-card)] transition-all dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[20px]"} ${
          isCurrent
            ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
            : isCompare
              ? "border-blue-400 shadow-[0_0_0_1px_rgb(96_165_250)]"
              : "border-black/[0.06] hover:border-[color:var(--accent)]/30 dark:border-white/[0.06]"
        }`}
      >
        <div className="relative aspect-[5/4] overflow-hidden">
          {renderImage({
            alt: item.prompt,
            loading: "eager",
            decoding: "async",
            className: "h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
          })}
          <HistoryModeBadge mode={item.mode} className="absolute left-2 top-2" />
          <HistoryApiSourceBadge source={item} className={`absolute bottom-2 left-2 ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`} />
          {renderPixelSizeBadge()}
          {isCompare ? (
            <span className={`absolute right-2 top-2 bg-blue-500/90 px-1.5 py-0.5 text-[10px] text-white ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}>B</span>
          ) : null}
          <button
            type="button"
            data-audit-id="history-item-delete"
            onClick={(e) => {
              e.stopPropagation();
              void onDelete(item.id);
            }}
            onContextMenu={openMenuFromEvent}
            title={DELETE_LABEL}
            className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center bg-black/52 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-red-500 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <div className="px-3 py-3">
          <div className="line-clamp-2 text-[12px] font-medium leading-5 text-zinc-800 dark:text-zinc-100">
            {promptLabel}
          </div>
          <div className="mt-1.5">
            <HistoryMetaBadges items={metaBadges} compact />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              data-audit-id="history-item-menu"
              onClick={openMenuFromEvent}
              onContextMenu={openMenuFromEvent}
              className={`inline-flex min-h-[28px] items-center gap-1 rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-[color:var(--accent)]/25 hover:text-[var(--accent)] dark:border-white/[0.06] dark:bg-white/[0.04] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Ellipsis className="h-3.5 w-3.5" />
              {MORE_LABEL}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-audit-id="history-item"
      title={item.prompt}
      onClick={handleSelect}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => onReuse(item)}
      onContextMenu={openMenuFromEvent}
      className={`group relative aspect-square cursor-pointer overflow-hidden border bg-white/70 shadow-[var(--shadow-card)] transition-all dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[20px]"} ${
        isCurrent
          ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : isCompare
            ? "border-blue-400 shadow-[0_0_0_1px_rgb(96_165_250)]"
            : "border-black/[0.06] hover:border-[color:var(--accent)]/30 dark:border-white/[0.06]"
      }`}
    >
      {renderImage({
        alt: item.prompt,
        loading: "eager",
        decoding: "async",
        className: "h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
      })}
      <HistoryModeBadge mode={item.mode} className="absolute left-1.5 top-1.5 bg-black/55" />
      <HistoryApiSourceBadge source={item} className={`absolute left-1.5 top-7 ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`} />
      {renderPixelSizeBadge()}
      {isCompare ? (
        <span className={`absolute right-1.5 top-1.5 bg-blue-500 px-1.5 py-0.5 text-[10px] text-white ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}>B</span>
      ) : null}
      <button
        type="button"
        data-audit-id="history-item-menu"
        onClick={openMenuFromEvent}
        onContextMenu={openMenuFromEvent}
        title={MORE_LABEL}
        className={`absolute bottom-1.5 left-1.5 inline-flex h-6 min-w-[28px] items-center justify-center bg-black/55 px-1.5 text-white backdrop-blur-sm transition-all hover:bg-black/70 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        data-audit-id="history-item-delete"
        onClick={(e) => {
          e.stopPropagation();
          void onDelete(item.id);
        }}
        onContextMenu={openMenuFromEvent}
        title={DELETE_LABEL}
        className={`absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-red-500 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
