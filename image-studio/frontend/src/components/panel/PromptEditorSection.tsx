import { lazy, Suspense, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Clipboard, Copy, Expand, ImageUp, ListPlus, Minimize2, Plus, Sparkles, Trash2 } from "lucide-react";
import { submitShortcutLabel } from "../../platform";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import type { ReversePromptImage } from "../../state/studioStore.types";
import { copyText } from "../../lib/fhlAPI";
import { ContextMenu } from "../common/ContextMenu";
import { STYLE_CHIPS } from "./panelOptions";

const PromptPopover = lazy(() => import("./PromptPopover").then((m) => ({ default: m.PromptPopover })));

export function PromptEditorSection({
  mode,
  promptPrefix,
  prompt,
  optimizationGuidance,
  promptPrefixLen,
  promptLen,
  promptPopover,
  setPromptPopover,
  optimizeReady,
  promptTextProviderLabel = "",
  promptTextUnavailableReason = "",
  isOptimizingPrompt,
  isReversingPrompt,
  reverseReady,
  reversePromptImage,
  styleTag,
  onSetPromptPrefix,
  onSetPrompt,
  onSetOptimizationGuidance,
  onSelectReversePromptImage,
  onImportReversePromptImageFile,
  onClearReversePromptImage,
  onOptimizePromptBase,
  onReversePrompt,
  onRewritePrompt,
  onSetStyleTag,
}: {
  mode: "generate" | "edit";
  promptPrefix: string;
  prompt: string;
  optimizationGuidance: string;
  promptPrefixLen: number;
  promptLen: number;
  promptPopover: boolean;
  setPromptPopover: (open: boolean | ((v: boolean) => boolean)) => void;
  optimizeReady: boolean;
  promptTextProviderLabel?: string;
  promptTextUnavailableReason?: string;
  isOptimizingPrompt: boolean;
  isReversingPrompt: boolean;
  reverseReady: boolean;
  reversePromptImage: ReversePromptImage | null;
  styleTag: string;
  onSetPromptPrefix: (value: string) => void;
  onSetPrompt: (value: string) => void;
  onSetOptimizationGuidance: (value: string) => void;
  onSelectReversePromptImage: () => void;
  onImportReversePromptImageFile: (file: File) => Promise<void>;
  onClearReversePromptImage: () => void;
  onOptimizePromptBase: () => void;
  onReversePrompt: () => void;
  onRewritePrompt: () => void;
  onSetStyleTag: (value: string) => void;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  const promptPopoverAnchorRef = useRef<HTMLButtonElement | null>(null);
  const promptPrefixRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const optimizationGuidanceRef = useRef<HTMLTextAreaElement | null>(null);
  const mergePreviewTimerRef = useRef<number | null>(null);
  const [reverseDragActive, setReverseDragActive] = useState(false);
  const [reverseImageMenu, setReverseImageMenu] = useState<{ x: number; y: number } | null>(null);
  const [promptPrefixOpen, setPromptPrefixOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [mergePreviewOpen, setMergePreviewOpen] = useState(false);
  const pushToast = useStudioStore((state) => state.pushToast);
  const promptBusy = isOptimizingPrompt || isReversingPrompt;
  const prefixActive = promptPrefix.trim().length > 0;
  const rewriteReady = optimizeReady && optimizationGuidance.trim().length > 0;
  const optimizeWithImageContext = mode === "edit";
  const optimizeButtonTitle = optimizeWithImageContext
    ? "根据图生图输入的参考图优化当前提示词；无参考图时会参考当前结果图"
    : "使用基础系统提示词优化当前提示词";
  const reversePreviewSrc = reversePromptImage?.previewUrl
    || (reversePromptImage?.imageB64 ? `data:image/png;base64,${reversePromptImage.imageB64}` : "");
  const promptTextStatus = promptTextProviderLabel
    ? `文本配置：${promptTextProviderLabel}`
    : promptTextUnavailableReason || "未配置可用文本模型";
  const optimizeActionTitle = optimizeReady
    ? `${optimizeButtonTitle}\n${promptTextStatus}`
    : !prompt.trim()
      ? "主提示词未输入"
      : promptTextStatus;
  const reverseActionTitle = reverseReady
    ? `把图片反推成中文文生图提示词\n${promptTextStatus}`
    : promptTextProviderLabel
      ? "先上传、生成或导入一张图片"
      : promptTextStatus;
  const promptPrefixMinHeight = usesFluentUI ? 72 : isMac ? 88 : 72;
  const promptCollapsedHeight = usesFluentUI ? 116 : isMac ? 132 : 116;
  const promptExpandedMinHeight = usesFluentUI ? 124 : isMac ? 176 : 124;
  const optimizationGuidanceMinHeight = 62;

  const resizePromptPrefix = () => {
    const el = promptPrefixRef.current;
    if (!el) return;
    const borderHeight = el.offsetHeight - el.clientHeight;
    el.style.height = "0px";
    el.style.height = `${Math.max(promptPrefixMinHeight, el.scrollHeight + borderHeight)}px`;
  };

  const resizePrompt = () => {
    const el = promptRef.current;
    if (!el) return;
    if (!promptExpanded) {
      el.style.height = `${promptCollapsedHeight}px`;
      return;
    }
    const borderHeight = el.offsetHeight - el.clientHeight;
    el.style.height = "0px";
    el.style.height = `${Math.max(promptExpandedMinHeight, el.scrollHeight + borderHeight)}px`;
  };

  const resizeOptimizationGuidance = () => {
    const el = optimizationGuidanceRef.current;
    if (!el) return;
    if (!el.value) {
      el.style.height = `${optimizationGuidanceMinHeight}px`;
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.max(optimizationGuidanceMinHeight, el.scrollHeight)}px`;
  };

  useLayoutEffect(() => {
    if (promptPrefixOpen) {
      resizePromptPrefix();
    }
  }, [promptPrefix, promptPrefixMinHeight, promptPrefixOpen]);

  useLayoutEffect(() => {
    resizePrompt();
  }, [prompt, promptExpanded, promptCollapsedHeight, promptExpandedMinHeight]);

  useLayoutEffect(() => {
    resizeOptimizationGuidance();
  }, [optimizationGuidance]);

  useEffect(() => {
    return () => {
      if (mergePreviewTimerRef.current !== null) {
        window.clearTimeout(mergePreviewTimerRef.current);
      }
    };
  }, []);

  const showPromptMergePreview = () => {
    setMergePreviewOpen(true);
    if (mergePreviewTimerRef.current !== null) {
      window.clearTimeout(mergePreviewTimerRef.current);
    }
    mergePreviewTimerRef.current = window.setTimeout(() => {
      setMergePreviewOpen(false);
      mergePreviewTimerRef.current = null;
    }, 5000);
  };

  const togglePromptPrefixOpen = () => {
    const nextOpen = !promptPrefixOpen;
    setPromptPrefixOpen(nextOpen);
    if (nextOpen) {
      requestAnimationFrame(resizePromptPrefix);
      return;
    }
    setMergePreviewOpen(false);
  };

  const copyPrompt = async () => {
    const text = prompt.trim();
    if (!text) return;
    try {
      await copyText(text);
      pushToast("提示词已复制", "success", 2400);
    } catch {
      pushToast("复制失败，请手动复制提示词", "error", 4200);
    }
  };

  const clearPrompt = () => {
    onSetPrompt("");
    requestAnimationFrame(resizePrompt);
  };

  const togglePromptExpanded = () => {
    setPromptExpanded((prev) => !prev);
  };

  const importDroppedReverseImage = (files: FileList | null) => {
    const file = Array.from(files ?? []).find((item) => item.type.startsWith("image/"));
    if (!file) {
      pushToast("请拖入 PNG/JPG/WebP 图片", "warn", 2800);
      return;
    }
    void onImportReversePromptImageFile(file);
  };

  const openReverseImageMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setReverseImageMenu({ x: event.clientX, y: event.clientY });
  };

  const clipboardImageExtension = (type: string) => {
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("webp")) return "webp";
    return "png";
  };

  const pasteReversePromptImageFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      pushToast("无法读取剪贴板图片，请使用 Ctrl+V 或拖入图片", "warn", 3600);
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const file = new File([blob], `clipboard-image.${clipboardImageExtension(imageType)}`, { type: imageType });
        await onImportReversePromptImageFile(file);
        return;
      }
      pushToast("剪贴板里没有可用图片", "warn", 3000);
    } catch {
      pushToast("无法读取剪贴板图片，请使用 Ctrl+V 或拖入图片", "warn", 3600);
    }
  };

  return (
    <section className={`relative overflow-visible ${promptPopover ? "z-30" : "z-0"}`}>
      <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
        <h2
          className={`text-zinc-950 dark:text-zinc-50 ${usesFluentUI ? "text-[18px] font-semibold" : "text-[21px] font-bold"}`}
          style={{ fontFamily: "var(--title-font)" }}
        >
          提示词
        </h2>
        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          {mode === "edit" ? "修改要求" : "文生图 prompt"}
        </span>
      </div>
      <div className={`platform-card relative overflow-visible ${isMac ? "p-5" : "p-4"}`}>
        <div className={`border border-black/[0.06] bg-[var(--surface)]/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-white/[0.06] dark:bg-white/[0.025] ${usesFluentUI ? "rounded-[10px]" : isMac ? "rounded-[16px]" : "rounded-[12px]"}`}>
        <div
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            setReverseDragActive(true);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
            setReverseDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setReverseDragActive(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setReverseDragActive(false);
            importDroppedReverseImage(event.dataTransfer.files);
          }}
          className={`mb-2.5 border border-dashed p-2.5 transition-colors ${
            reverseDragActive
              ? "border-amber-400 bg-amber-50/85 ring-2 ring-amber-400/30 dark:border-yellow-300/70 dark:bg-yellow-400/15 dark:ring-yellow-300/25"
              : "border-amber-300/80 bg-amber-50/70 dark:border-yellow-300/40 dark:bg-yellow-400/10"
          } ${usesFluentUI ? "rounded-[10px]" : "rounded-[12px]"}`}
        >
          {reversePromptImage ? (
            <div className="space-y-2.5">
              <div
                onContextMenu={openReverseImageMenu}
                className={`relative flex h-32 w-full items-center justify-center overflow-hidden bg-amber-50/45 ring-1 ring-amber-300/70 dark:bg-yellow-400/5 dark:ring-yellow-300/30 ${usesFluentUI ? "rounded-[8px]" : "rounded-[10px]"}`}
              >
                  {reversePreviewSrc ? (
                    <img src={reversePreviewSrc} alt="反推参考图预览" className="h-full w-full object-contain object-center" />
                  ) : (
                    <ImageUp className="h-5 w-5 text-amber-600 dark:text-yellow-200" />
                  )}
                <button
                  type="button"
                  onClick={onClearReversePromptImage}
                  disabled={promptBusy}
                  className={`absolute right-2 top-2 bg-[var(--panel)]/90 px-2.5 py-1 text-[11px] font-medium text-amber-700 shadow-sm backdrop-blur transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:text-yellow-200 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                  title="清除反推图片"
                >
                  清除
                </button>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onReversePrompt}
                  disabled={!reverseReady || promptBusy}
                  className={`platform-pill inline-flex min-h-[34px] min-w-[132px] items-center justify-center gap-1.5 px-4 text-[11px] font-medium transition-colors ${
                    isReversingPrompt
                      ? "bg-amber-100 text-amber-700 dark:bg-yellow-400/15 dark:text-yellow-200"
                      : "bg-amber-500 text-white shadow-sm hover:bg-amber-400 dark:bg-yellow-500 dark:text-zinc-950 dark:hover:bg-yellow-400"
                  } disabled:cursor-not-allowed disabled:opacity-45 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                  title={reverseActionTitle}
                >
                  <ImageUp className={`w-3 h-3 ${isReversingPrompt ? "animate-pulse" : ""}`} />
                  {isReversingPrompt ? "反推中..." : "反推提示词"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSelectReversePromptImage}
              onContextMenu={openReverseImageMenu}
              disabled={promptBusy}
              className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 text-center transition-colors hover:bg-amber-100/70 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-yellow-400/10 ${usesFluentUI ? "rounded-[8px]" : "rounded-[10px]"}`}
              title="可选功能：点击上传或拖入图片，用来反推中文提示词；不上传也可以直接输入提示词生成"
            >
              <span className="inline-flex items-center justify-center gap-2 text-[12px] font-medium text-amber-700 dark:text-yellow-200">
                <ImageUp className="h-4 w-4" />
                {reverseDragActive ? "松开导入反推图像" : "可选：导入反推图像"}
              </span>
              <span className="text-[10px] font-normal leading-4 text-amber-700/75 dark:text-yellow-100/70">
                {reverseDragActive ? "释放后从图片反推中文提示词" : "不上传也可以直接输入提示词生成"}
              </span>
            </button>
          )}
        </div>
        {reverseImageMenu ? (
          <ContextMenu
            x={reverseImageMenu.x}
            y={reverseImageMenu.y}
            onClose={() => setReverseImageMenu(null)}
            items={[
              {
                label: "粘贴图像",
                icon: <Clipboard className="h-3.5 w-3.5" />,
                onClick: () => {
                  setReverseImageMenu(null);
                  void pasteReversePromptImageFromClipboard();
                },
              },
              ...(reversePromptImage
                ? [{
                  label: "清除",
                  danger: true,
                  separatorBefore: true,
                  onClick: () => {
                    setReverseImageMenu(null);
                    onClearReversePromptImage();
                  },
                }]
                : []),
            ]}
          />
        ) : null}
        <div className={`mb-2.5 border border-[color:var(--accent)]/16 bg-[var(--accent-soft)]/35 ${promptPrefixOpen ? "p-2.5" : "px-2.5 py-2"} ${usesFluentUI ? "rounded-[10px]" : "rounded-[12px]"}`}>
          <button
            type="button"
            onClick={togglePromptPrefixOpen}
            aria-expanded={promptPrefixOpen}
            aria-controls="prompt-prefix-panel"
            className="flex w-full items-center justify-between gap-2 text-left"
            title={promptPrefixOpen ? "收起补充提示词" : "展开补充提示词"}
          >
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
                补充提示词
              </span>
              {promptPrefixOpen ? (
                <span className="mt-0.5 block text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                生成时自动放在主提示词前面
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {promptPrefixOpen || prefixActive ? (
                <span className="font-mono-token text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{promptPrefixLen}</span>
              ) : null}
              <span className={`prompt-prefix-toggle-action inline-flex min-h-[26px] items-center gap-1 border border-[color:var(--accent)]/20 bg-white/70 px-2 text-[11px] font-medium text-[var(--accent)] shadow-sm transition-colors dark:bg-zinc-950/45 ${usesFluentUI ? "rounded-[7px]" : "rounded-full"}`}>
                {promptPrefixOpen ? "收起" : "展开"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${promptPrefixOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </span>
            </span>
          </button>
          {promptPrefixOpen ? (
            <div id="prompt-prefix-panel" className="mt-1.5">
              <div className="mb-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  onSetPromptPrefix("");
                  requestAnimationFrame(resizePromptPrefix);
                }}
                disabled={!promptPrefix.trim() || promptBusy}
                className="text-[11px] font-medium text-[var(--accent)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                title="清空补充提示词"
              >
                清空
              </button>
              </div>
              <textarea
                ref={promptPrefixRef}
                value={promptPrefix}
                placeholder="可选：输入固定前置提示词，例如画风、角色设定、固定关键词..."
                style={{ minHeight: promptPrefixMinHeight }}
                onChange={(e) => {
                  onSetPromptPrefix(e.target.value);
                  requestAnimationFrame(resizePromptPrefix);
                }}
                onInput={() => requestAnimationFrame(resizePromptPrefix)}
                onBlur={resizePromptPrefix}
                className={`focus-ring w-full resize-none overflow-hidden border border-[color:var(--accent)]/18 bg-[var(--surface)] text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${usesFluentUI ? "min-h-[72px] rounded-[10px] px-3.5 py-2.5 text-[13px] leading-[1.6]" : isMac ? "min-h-[88px] rounded-[14px] px-4 py-3 text-[13px] leading-[1.65]" : "min-h-[72px] rounded-[12px] px-3.5 py-2.5 text-[12px] leading-[1.6]"}`}
              />
            </div>
          ) : null}
        </div>
        {promptPrefixOpen ? (
        <div className="relative my-1.5 flex items-center justify-center">
          <button
            type="button"
            onClick={showPromptMergePreview}
            aria-label={prefixActive ? "补充提示词已参与生成" : "补充提示词为空"}
            title="补充提示词合并状态预览"
            className={`inline-flex h-6 min-w-[82px] items-center justify-center gap-1 border px-2.5 text-[10px] font-medium leading-none transition-colors ${
              prefixActive
                ? "border-emerald-500/55 bg-emerald-50 text-emerald-700 shadow-[0_1px_2px_rgb(0_0_0_/_0.06)] hover:border-emerald-500/75 hover:bg-emerald-100 dark:border-emerald-400/45 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15"
                : "border-black/[0.08] bg-zinc-50 text-zinc-300 hover:border-black/[0.12] hover:bg-zinc-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-600 dark:hover:bg-white/[0.06]"
            } ${usesFluentUI ? "rounded-[8px]" : "rounded-[10px]"}`}
          >
            <Plus className="h-3 w-3" />
            <span>合并</span>
          </button>
          {mergePreviewOpen ? (
            <div
              role="status"
              className={`absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap border border-[color:var(--accent)]/18 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-zinc-700 shadow-[0_8px_24px_rgb(15_23_42_/_0.16)] backdrop-blur-xl dark:bg-zinc-900/95 dark:text-zinc-100 ${usesFluentUI ? "rounded-[7px]" : "rounded-full"}`}
            >
              补充提示词合并状态预览
            </div>
          ) : null}
        </div>
        ) : null}
        <div className={`mb-2.5 border border-[color:var(--accent)]/16 bg-[var(--accent-soft)]/35 p-2.5 ${usesFluentUI ? "rounded-[10px]" : "rounded-[12px]"}`}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
                主提示词
              </label>
              <div className="mt-0.5 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                主要描述画面内容，会和补充提示词一起生成
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={copyPrompt}
                disabled={!prompt.trim() || promptBusy}
                className={`platform-pill inline-flex min-h-[28px] items-center gap-1 border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-[color:var(--accent)]/35 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                title="复制当前提示词"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
              <button
                type="button"
                onClick={clearPrompt}
                disabled={!prompt.trim() || promptBusy}
                className={`platform-pill inline-flex min-h-[28px] items-center gap-1 border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                title="清空当前提示词"
              >
                <Trash2 className="h-3 w-3" />
                清空
              </button>
              <span className={`font-mono-token tabular-nums ${isMac ? "rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] dark:bg-white/[0.06]" : ""} text-zinc-400 dark:text-zinc-500`}>{promptLen}</span>
            </div>
          </div>
          {isMac && (
            <p className="mb-3 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
              建议把主体、场景、镜头、材质和光照拆成短句，模板会追加到当前内容末尾。
            </p>
          )}
          <div
            className={`relative overflow-hidden border border-[color:var(--accent)]/18 bg-[var(--surface)] transition-[border-color,box-shadow] focus-within:border-[color:var(--accent)]/40 focus-within:shadow-[0_0_0_3px_rgb(0_122_255_/_0.14)] ${usesFluentUI ? "rounded-[10px]" : isMac ? "rounded-[18px]" : "rounded-[14px]"}`}
          >
            <button
              type="button"
              onClick={togglePromptExpanded}
              className={`absolute right-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center border border-black/[0.08] bg-[var(--panel)]/92 text-zinc-600 shadow-sm backdrop-blur transition-colors hover:border-[color:var(--accent)]/35 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[7px]" : "rounded-full"}`}
              title={promptExpanded ? "收起输入框，回到 4 行预览" : "展开输入框，用 Enter 键换行"}
              aria-label={promptExpanded ? "收起输入框，回到 4 行预览" : "展开输入框，用 Enter 键换行"}
              aria-pressed={promptExpanded}
            >
              {promptExpanded ? <Minimize2 className="h-2.5 w-2.5" /> : <Expand className="h-2.5 w-2.5" />}
            </button>
            <textarea
            ref={promptRef}
            value={prompt}
            placeholder={mode === "edit"
              ? "输入图生图修改要求，例如：换背景、补光、保留构图"
              : "输入主体、场景、光照、镜头、风格..."}
            rows={4}
            style={{ minHeight: promptExpanded ? promptExpandedMinHeight : promptCollapsedHeight }}
            onChange={(e) => {
              onSetPrompt(e.target.value);
              requestAnimationFrame(resizePrompt);
            }}
            onInput={() => requestAnimationFrame(resizePrompt)}
            onBlur={resizePrompt}
              className={`block w-full resize-none overflow-x-hidden border-0 bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none ${promptExpanded ? "overflow-y-hidden" : "overflow-y-auto"} dark:text-zinc-100 dark:placeholder:text-zinc-500 ${usesFluentUI ? "px-3.5 py-3 text-[14px] leading-[1.65]" : isMac ? "px-4 py-3.5 text-[15px] leading-[1.72]" : "px-3.5 py-3 text-[14px] leading-[1.65]"}`}
          />
          </div>
          {optimizeWithImageContext ? (
            <button
              type="button"
              onClick={onOptimizePromptBase}
              disabled={!optimizeReady || promptBusy}
              className={`platform-pill prompt-reference-optimize-button mt-2 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 border px-3 py-2 text-[12px] font-semibold transition-colors ${
                isOptimizingPrompt
                  ? "border-amber-400/80 bg-amber-100 text-amber-800 shadow-[inset_0_0_0_1px_rgb(251_191_36_/_0.35)] dark:border-amber-400/60 dark:bg-amber-400/15 dark:text-amber-200"
                  : "border-amber-400/80 bg-amber-50 text-amber-700 shadow-[inset_0_0_0_1px_rgb(251_191_36_/_0.35),0_1px_2px_rgb(120_53_15_/_0.08)] hover:border-amber-500 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/15"
              } disabled:cursor-not-allowed disabled:opacity-50 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
              title={optimizeActionTitle}
            >
              <Sparkles className={`w-3.5 h-3.5 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
              {isOptimizingPrompt ? "优化中..." : "根据参考图AI优化提示词"}
            </button>
          ) : null}
          {optimizeWithImageContext ? (
            <p className="mt-1.5 text-[10px] leading-4 text-zinc-400 dark:text-zinc-500">
              <span className="block">{promptTextStatus}</span>
              <span className="block">多图会自动压缩上传副本，不影响原图</span>
            </p>
          ) : null}
        </div>
        <div className={`mt-3 ${isMac ? "flex flex-col gap-3" : "flex gap-2.5 items-center justify-between"}`}>
          <div className={`${isMac ? "grid grid-cols-1 gap-2.5" : "flex gap-2.5 items-center"}`}>
            <div className={`relative ${isMac ? "min-w-0" : "shrink-0"}`}>
              <button
                ref={promptPopoverAnchorRef}
                type="button"
                onClick={() => setPromptPopover((v) => !v)}
                title="prompt 模板与历史"
                className={`platform-pill inline-flex items-center justify-center gap-1.5 ${isMac ? "min-h-[38px] w-full px-3 py-2 text-[11px] font-medium" : "px-3 py-1.5 text-[10px]"} transition-colors ${
                  promptPopover
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[color:var(--accent)]/20"
                    : "text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                } ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <ListPlus className="w-3 h-3" /> 模板 / 历史
              </button>
              {promptPopover && (
                <Suspense fallback={null}>
                  <PromptPopover
                    anchorRef={promptPopoverAnchorRef}
                    onClose={() => setPromptPopover(false)}
                    onPick={(text) => {
                      const current = useStudioStore.getState().prompt;
                      onSetPrompt(current ? `${current}\n${text}` : text);
                    }}
                  />
                </Suspense>
              )}
            </div>
          </div>
          <div className={`flex flex-wrap ${isMac ? "items-center justify-between gap-2.5" : "ml-auto items-center justify-end gap-2"}`}>
            <span className={`${isMac ? "ml-auto rounded-full bg-black/[0.03] px-2.5 py-1.5 text-[11px] dark:bg-white/[0.04]" : "text-[10px]"} text-zinc-400 dark:text-zinc-500`}>{submitShortcutLabel}</span>
            {!optimizeWithImageContext ? (
              <button
                type="button"
                onClick={onOptimizePromptBase}
                disabled={!optimizeReady || promptBusy}
                className={`platform-pill prompt-ai-optimize-button inline-flex min-h-[38px] min-w-[92px] items-center justify-center gap-1.5 border border-yellow-500 bg-yellow-300 text-yellow-950 shadow-sm ${isMac ? "px-3 py-2 text-[11px] font-semibold" : "px-3 py-1.5 text-[10px] font-semibold"} transition-colors ${
                  isOptimizingPrompt
                    ? "bg-yellow-200 text-yellow-950"
                    : "hover:border-yellow-400 hover:bg-yellow-200 hover:text-yellow-950"
                } disabled:cursor-not-allowed disabled:opacity-55 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                title={optimizeActionTitle}
              >
                <Sparkles className={`w-3 h-3 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
                {isOptimizingPrompt ? "优化中..." : "AI 优化"}
              </button>
            ) : null}
          </div>
        </div>
        </div>
        <div className={`mt-3 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] p-3 ${usesFluentUI ? "rounded-[10px]" : isMac ? "rounded-[16px]" : "rounded-[12px]"}`}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
              指令改写提示词
            </label>
            <button
              type="button"
              onClick={() => {
                onSetOptimizationGuidance("");
                requestAnimationFrame(resizeOptimizationGuidance);
              }}
              disabled={!optimizationGuidance.trim() || promptBusy}
              className="text-[11px] font-medium text-[var(--accent)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              title="清空精准修改指令"
            >
              清除
            </button>
          </div>
          <div className="grid gap-2.5">
            <textarea
              ref={optimizationGuidanceRef}
              value={optimizationGuidance}
              placeholder="输入精准修改指令：去掉帽子 / 天上加一只老鹰..."
              rows={2}
              style={{ minHeight: optimizationGuidanceMinHeight }}
              onChange={(e) => {
                onSetOptimizationGuidance(e.target.value);
                requestAnimationFrame(resizeOptimizationGuidance);
              }}
              onInput={() => requestAnimationFrame(resizeOptimizationGuidance)}
              onBlur={resizeOptimizationGuidance}
              className={`focus-ring min-h-[62px] w-full min-w-0 resize-none overflow-hidden border border-[color:var(--accent)]/20 bg-[var(--surface)] py-2 leading-[1.55] text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${usesFluentUI ? "rounded-[10px] px-3.5 text-[13px]" : isMac ? "rounded-[14px] px-4 text-[13px]" : "rounded-[12px] px-3.5 text-[12px]"}`}
              title="输入要强制执行的提示词修改指令"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onRewritePrompt}
                disabled={!rewriteReady || promptBusy}
                className={`platform-pill inline-flex min-h-[38px] min-w-[92px] items-center justify-center gap-1.5 ${isMac ? "px-3 py-2 text-[11px] font-medium" : "px-3 py-1.5 text-[10px]"} transition-colors ${
                  isOptimizingPrompt
                    ? "bg-[var(--surface)] text-[var(--accent)]"
                    : "bg-[var(--surface)] text-[var(--accent)] hover:brightness-95"
                } disabled:cursor-not-allowed disabled:opacity-50 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                title={rewriteReady ? `按照指令改写当前提示词\n${promptTextStatus}` : optimizeActionTitle}
              >
                <Sparkles className={`w-3 h-3 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
                {isOptimizingPrompt ? "优化中..." : "精准修改"}
              </button>
            </div>
          </div>
        </div>
        <div className={`mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.06] ${isMac ? "space-y-2.5" : "space-y-2"}`}>
          <div className="flex items-center justify-between gap-3">
            <label className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
              风格模板
            </label>
            {styleTag ? (
              <button
                type="button"
                onClick={() => onSetStyleTag("")}
                className="text-[11px] text-[var(--accent)] hover:opacity-80"
              >
                清除
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STYLE_CHIPS.map((style) => {
              const active = styleTag === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => onSetStyleTag(active ? "" : style.id)}
                  title={style.hint}
                  className={`platform-chip px-2.5 py-1.5 text-xs ring-1 transition-colors ${
                    active
                      ? "active bg-[var(--accent-soft)] text-[var(--accent)] ring-[color:var(--accent)]/20"
                      : "text-zinc-600 dark:text-zinc-400 ring-black/[0.08] dark:ring-white/[0.08] hover:text-zinc-900 dark:hover:text-zinc-200 hover:ring-[color:var(--accent)]/30"
                  } ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
