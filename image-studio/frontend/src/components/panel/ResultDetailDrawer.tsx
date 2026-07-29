import { ClipboardCopy, Compass, Folder, RotateCw, Save, Share2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type React from "react";
import {
  buildHistoryItemDragExport,
  writeImageFileDragData,
  writeInternalHistoryItemDragData,
} from "../../lib/dragExport.ts";
import { dataURLFromBase64, historyPreviewSrc, useBlobURL } from "../../lib/images";
import { apiSourceDetailLabel } from "../history/historyApiSource";
import { qualityLabel, sizeLabel } from "../history/historyLabels";
import { useHistoryContextMenu } from "../history/useHistoryContextMenu";
import { usePlatform } from "../../platform/context";
import { submitShortcutLabel } from "../../platform";
import { androidSaveHint, androidTarget, openOutputLocationForPlatform } from "../../platform/android/bridge";
import { BeginNativeFileDrag, OpenOutputDir, ReadImageAsBase64 } from "../../platform/runtime/host";
import { resolvePanoramaRoundtripRef } from "../../panorama/core";
import { useStudioStore } from "../../state/studioStore";
import { ContextMenu } from "../common/ContextMenu";
import { Modal } from "../common/Modal";
import { RawResponseModal } from "../history/RawResponseModal";

export function ResultDetailDrawer() {
  const item = useStudioStore((s) => s.resultDetail);
  const close = useStudioStore((s) => s.closeResultDetail);
  const setField = useStudioStore((s) => s.setField);
  const pushToast = useStudioStore((s) => s.pushToast);
  const currentImage = useStudioStore((s) => s.currentImage);
  const compareB = useStudioStore((s) => s.compareB);
  const setCompareB = useStudioStore((s) => s.setCompareB);
  const openResultDetail = useStudioStore((s) => s.openResultDetail);
  const openPanoramaViewer = useStudioStore((s) => s.openPanoramaViewer);
  const applyHistoryParams = useStudioStore((s) => s.applyHistoryParams);
  const regenerateFromHistory = useStudioStore((s) => s.regenerateFromHistory);
  const reuseAsSource = useStudioStore((s) => s.reuseAsSource);
  const openPanoramaPastebackAligner = useStudioStore((s) => s.openPanoramaPastebackAligner);
  const deleteHistoryItem = useStudioStore((s) => s.deleteHistoryItem);
  const saveHistoryItemAs = useStudioStore((s) => s.saveHistoryItemAs);
  const shareHistoryItem = useStudioStore((s) => s.shareHistoryItem);
  const { isMac, usesFluentUI } = usePlatform();

  const detail = item;
  const [failedPreviewKey, setFailedPreviewKey] = useState("");
  const [savedPathFallback, setSavedPathFallback] = useState({ key: "", src: "" });
  const canRepastePanorama = !!detail && !!resolvePanoramaRoundtripRef(detail);
  const canOpenPanorama = true;

  const created = detail ? new Date(detail.createdAt).toLocaleString() : "";
  const previewURL = useBlobURL(detail?.previewBlob ?? detail?.imageBlob ?? null, detail?.imageB64 ?? null);
  const previewKey = `${detail?.id ?? ""}|${detail?.previewUrl ?? ""}`;
  const savedPathKey = `${detail?.id ?? ""}|${detail?.savedPath ?? ""}`;
  const previewUrlFailed = !!detail?.previewUrl && failedPreviewKey === previewKey;
  const savedPathFallbackURL = savedPathFallback.key === savedPathKey ? savedPathFallback.src : "";
  const fallbackImageSrc = previewURL
    || (detail?.imageB64 ? dataURLFromBase64(detail.imageB64) : "")
    || savedPathFallbackURL;
  const imageSrc = detail && previewUrlFailed
    ? fallbackImageSrc
    : detail ? historyPreviewSrc(detail, previewURL) : "";

  useEffect(() => {
    if (!detail || !previewUrlFailed || fallbackImageSrc || !detail.savedPath) return;
    let active = true;
    void ReadImageAsBase64(detail.savedPath)
      .then((imageB64) => {
        if (active && imageB64) {
          setSavedPathFallback({ key: savedPathKey, src: dataURLFromBase64(imageB64) });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detail, fallbackImageSrc, previewUrlFailed, savedPathKey]);

  const dragSpec = detail ? buildHistoryItemDragExport(detail, imageSrc) : null;
  const {
    buildMenu,
    closeMenu,
    closeRaw,
    menu,
    openMenu,
    rawPath,
  } = useHistoryContextMenu({
    currentImageId: currentImage?.id ?? null,
    compareItemId: compareB?.id ?? null,
    onOpenDetail: openResultDetail,
    onOpenPanorama: (target) => void openPanoramaViewer(target),
    onApplyParams: applyHistoryParams,
    onRegenerate: (target) => void regenerateFromHistory(target),
    onReuseAsSource: (target) => void reuseAsSource(target),
    onRepastePanorama: (target) => openPanoramaPastebackAligner(target),
    onSaveOriginal: (target) => void saveHistoryItemAs(target),
    onShare: (target) => void shareHistoryItem(target),
    onToggleCompare: (target) => setCompareB(compareB?.id === target.id ? null : target),
    onDelete: (target) => {
      if (target.previewOnly) return;
      if (window.confirm(`确定删除这条历史记录？\n\n${target.prompt?.slice(0, 60) || "(无 prompt)"}`)) {
        void deleteHistoryItem(target.id).finally(close);
      }
    },
    pushToast,
  });

  if (!detail) return null;
  const resolvedDetail = detail;

  function handlePreviewLoadError() {
    if (imageSrc === resolvedDetail.previewUrl) setFailedPreviewKey(previewKey);
  }

  function handlePreviewDragStart(event: React.DragEvent<HTMLDivElement>) {
    if (!dragSpec) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    if (isMac && resolvedDetail.savedPath) {
      event.preventDefault();
      void BeginNativeFileDrag(resolvedDetail.savedPath).catch((error) => {
        console.error("[drag-export] native-file-drag failed", error);
      });
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    writeInternalHistoryItemDragData(event.dataTransfer, resolvedDetail);
    writeImageFileDragData(event.dataTransfer, dragSpec);
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => pushToast(`已复制${label}`, "success"),
      () => pushToast("复制失败", "error"),
    );
  }

  function applyAsNextPrompt(text: string) {
    setField("prompt", text);
    pushToast(`已应用为下次提示词，${submitShortcutLabel} 可直接提交`, "success");
    close();
  }

  function openOutputLocation() {
    openOutputLocationForPlatform(OpenOutputDir).catch((error) => {
      pushToast(error?.message ?? "无法打开保存位置", "warn");
    });
  }

  return (
    <Modal open onClose={close} title="生成详情" width={720}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <section className={`platform-card border border-black/[0.05] bg-white/72 p-3 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
          <div
            draggable={!!dragSpec}
            onDragStart={handlePreviewDragStart}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(detail, event.clientX, event.clientY);
            }}
            title={dragSpec ? "拖到文件夹导出结果图" : undefined}
            className={`flex items-center justify-center border border-black/[0.08] bg-[var(--surface)] p-2 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
          >
            <img
              data-testid="image-studio-result-detail-preview"
              data-preview-fallback={previewUrlFailed ? (imageSrc ? "ready" : "loading") : "none"}
              src={imageSrc}
              alt="生成结果"
              decoding="async"
              draggable={false}
              onError={handlePreviewLoadError}
              className={`max-h-[300px] max-w-full object-contain ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {canOpenPanorama ? (
              <Btn primary onClick={() => void openPanoramaViewer(detail)}>
                <Compass className="h-3 w-3" />
                进入全景查看
              </Btn>
            ) : null}
            {canRepastePanorama ? (
              <Btn onClick={() => openPanoramaPastebackAligner(detail)}>
                <RotateCw className="h-3 w-3" />
                手动贴回360
              </Btn>
            ) : null}
            <Btn onClick={() => void saveHistoryItemAs(detail)}>
              <Save className="h-3 w-3" />
              保存原图
            </Btn>
            <Btn onClick={() => void shareHistoryItem(detail)}>
              <Share2 className="h-3 w-3" />
              分享
            </Btn>
            <Btn onClick={openOutputLocation}>
              <Folder className="h-3 w-3" />
              打开文件夹
            </Btn>
          </div>
          {androidTarget.isAndroid ? (
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{androidSaveHint()}</p>
          ) : null}
        </section>

        <div className="space-y-4">
          <Section title="参数">
            <Kv label="模式" value={detail.mode === "edit" ? "图生图" : "文生图"} />
            {detail.apiMode ? <Kv label="生成 API" value={apiSourceDetailLabel(detail)} /> : null}
            <Kv label="尺寸" value={sizeLabel(detail.size)} />
            <Kv label="质量" value={qualityLabel(detail.quality)} />
            {detail.seed ? <Kv label="种子" value={String(detail.seed)} mono /> : null}
            {detail.styleTag ? <Kv label="风格" value={`#${detail.styleTag}`} /> : null}
            {typeof detail.elapsedSec === "number" ? <Kv label="耗时" value={`${detail.elapsedSec.toFixed(1)}s`} /> : null}
            <Kv label="创建时间" value={created} />
          </Section>

          <Section title="原始提示词">
            <PromptBlock>{detail.prompt || <em className="opacity-60">(空)</em>}</PromptBlock>
            {detail.prompt ? (
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.prompt, "原始提示词")}>
                  <ClipboardCopy className="h-3 w-3" />
                  复制
                </Btn>
                <Btn onClick={() => applyAsNextPrompt(detail.prompt)}>
                  <RotateCw className="h-3 w-3" />
                  用作下次提示词
                </Btn>
              </div>
            ) : null}
          </Section>

          {detail.revisedPrompt ? (
            <Section
              title={(
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-[var(--accent)]" />
                  优化后提示词
                </span>
              )}
              hint="Responses API 模式下文本模型可能会重写你的提示词。"
            >
              <PromptBlock highlight>{detail.revisedPrompt}</PromptBlock>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.revisedPrompt!, "优化后提示词")}>
                  <ClipboardCopy className="h-3 w-3" />
                  复制
                </Btn>
                <Btn primary onClick={() => applyAsNextPrompt(detail.revisedPrompt!)}>
                  <RotateCw className="h-3 w-3" />
                  用作下次提示词
                </Btn>
              </div>
            </Section>
          ) : null}

          {detail.negativePrompt ? (
            <Section title="负向提示词">
              <PromptBlock muted>{detail.negativePrompt}</PromptBlock>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.negativePrompt!, "负向提示词")}>
                  <ClipboardCopy className="h-3 w-3" />
                  复制
                </Btn>
              </div>
            </Section>
          ) : null}

          <Section title="文件">
            {detail.savedPath ? (
              <p className={`font-mono-token break-all border border-black/[0.06] bg-[var(--surface)] px-2.5 py-2 text-[11px] text-zinc-600 dark:border-white/[0.04] dark:text-zinc-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                {detail.savedPath}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-500">(本次未落地 / 路径丢失)</p>
            )}
            {detail.savedPath ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.savedPath!, "文件路径")}>
                  <ClipboardCopy className="h-3 w-3" />
                  复制路径
                </Btn>
              </div>
            ) : null}
          </Section>
        </div>
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.item)}
          onClose={closeMenu}
        />
      ) : null}
      {rawPath ? <RawResponseModal path={rawPath} onClose={closeRaw} /> : null}
    </Modal>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <section className={`platform-card border border-black/[0.05] bg-white/72 p-4 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{title}</h3>
      {hint ? <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">{hint}</p> : null}
      {children}
    </section>
  );
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-dashed border-black/[0.05] py-1 text-xs last:border-b-0 dark:border-white/[0.04]">
      <span className="w-16 shrink-0 text-zinc-500">{label}</span>
      <span className={`flex-1 break-words text-zinc-700 dark:text-zinc-300 ${mono ? "font-mono-token" : ""}`}>{value}</span>
    </div>
  );
}

function PromptBlock({
  children,
  muted,
  highlight,
}: {
  children: React.ReactNode;
  muted?: boolean;
  highlight?: boolean;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <p
      className={`mb-2 whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed ${
        highlight
          ? "border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]"
          : muted
            ? "border border-black/[0.06] bg-[var(--surface)] text-zinc-500 dark:border-white/[0.04]"
            : "border border-black/[0.06] bg-[var(--surface)] text-zinc-700 dark:border-white/[0.04] dark:text-zinc-300"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
    >
      {children}
    </p>
  );
}

function Btn({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition-colors ${
        primary
          ? "border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90"
          : "border border-black/[0.08] text-zinc-700 hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.06] dark:text-zinc-300"
      } ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
    >
      {children}
    </button>
  );
}
