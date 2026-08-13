import { lazy, Suspense, useRef } from "react";
import { ListPlus, Sparkles } from "lucide-react";
import { submitShortcutLabel } from "../../platform";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import { STYLE_CHIPS } from "./panelOptions";

const PromptPopover = lazy(() => import("./PromptPopover").then((m) => ({ default: m.PromptPopover })));

export function PromptEditorSection({
  mode,
  prompt,
  promptLen,
  promptPopover,
  setPromptPopover,
  optimizeReady,
  isOptimizingPrompt,
  styleTag,
  onSetPrompt,
  onOptimizePrompt,
  onSetStyleTag,
}: {
  mode: "generate" | "edit";
  prompt: string;
  promptLen: number;
  promptPopover: boolean;
  setPromptPopover: (open: boolean | ((v: boolean) => boolean)) => void;
  optimizeReady: boolean;
  isOptimizingPrompt: boolean;
  styleTag: string;
  onSetPrompt: (value: string) => void;
  onOptimizePrompt: () => void;
  onSetStyleTag: (value: string) => void;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  const promptPopoverAnchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <section className={`platform-card relative overflow-visible ${promptPopover ? "z-30" : "z-0"} ${isMac ? "p-5" : "p-4"}`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label className="text-[10px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
          {mode === "edit" ? "修改要求" : "提示词"}
        </label>
        <span className={`font-mono-token tabular-nums ${isMac ? "rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] dark:bg-white/[0.06]" : ""} text-zinc-400 dark:text-zinc-500`}>{promptLen}</span>
      </div>
      {isMac && (
        <p className="mb-3 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
          建议把主体、场景、镜头、材质和光照拆成短句，模板会追加到当前内容末尾。
        </p>
      )}
      <textarea
        value={prompt}
        placeholder={mode === "edit"
          ? "主体保持不变\n把背景换成夜空，补一圈冷色边缘光，保留原有构图"
          : "主体 / 场景 / 光照 / 镜头 / 风格\n例如：一只橘猫坐在雨夜窗边，电影级侧逆光，50mm，浅景深，写实摄影"}
        onChange={(e) => onSetPrompt(e.target.value)}
        className={`focus-ring w-full resize-y border border-black/[0.08] bg-[var(--surface)] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 ${usesFluentUI ? "min-h-[124px] rounded-[10px] px-3.5 py-3 text-[14px] leading-[1.65]" : isMac ? "min-h-[176px] rounded-[18px] px-4 py-3.5 text-[15px] leading-[1.72]" : "min-h-[124px] rounded-[14px] px-3.5 py-3 text-[14px] leading-[1.65]"}`}
      />
      <div className={`mt-3 ${isMac ? "flex flex-col gap-3" : "flex gap-2.5 items-center justify-between"}`}>
        <div className={`${isMac ? "grid grid-cols-2 gap-2.5" : "flex gap-2.5 items-center"}`}>
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
          <button
            type="button"
            onClick={onOptimizePrompt}
            disabled={!optimizeReady || isOptimizingPrompt}
            className={`platform-pill inline-flex items-center justify-center gap-1.5 ${isMac ? "min-h-[38px] w-full px-3 py-2 text-[11px] font-medium" : "px-3 py-1.5 text-[10px]"} transition-colors ${
              isOptimizingPrompt
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            } disabled:cursor-not-allowed disabled:opacity-50 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            title="调用 Responses API 优化当前提示词"
          >
            <Sparkles className={`w-3 h-3 ${isOptimizingPrompt ? "animate-pulse" : ""}`} />
            {isOptimizingPrompt ? "优化中..." : "AI 优化"}
          </button>
        </div>
        <div className={`flex ${isMac ? "items-center justify-between gap-2.5" : "ml-auto items-center gap-2.5"}`}>
          <span className={`${isMac ? "ml-auto rounded-full bg-black/[0.03] px-2.5 py-1.5 text-[11px] dark:bg-white/[0.04]" : "text-[10px]"} text-zinc-400 dark:text-zinc-500`}>{submitShortcutLabel}</span>
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
    </section>
  );
}
