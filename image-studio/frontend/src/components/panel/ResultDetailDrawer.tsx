import { ClipboardCopy, Folder, RotateCw, Save, Share2, Sparkles } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { OpenOutputDir } from "../../platform/runtime/host";
import { submitShortcutLabel } from "../../platform";
import { copyImageB64ToClipboard, copyImageURLToClipboard } from "../canvas/canvasImage";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import { androidSaveHint, androidTarget, openOutputLocationForPlatform } from "../../platform/android/bridge";
import { Modal } from "../common/Modal";
import { usePlatform } from "../../platform/context";
import { pixelSizeLabel, qualityLabel, sizeLabel } from "../history/historyLabels";

export function ResultDetailDrawer() {
  const item = useStudioStore((s) => s.resultDetail);
  const close = useStudioStore((s) => s.closeResultDetail);
  const setField = useStudioStore((s) => s.setField);
  const pushToast = useStudioStore((s) => s.pushToast);
  const materializeCurrentImage = useStudioStore((s) => s.materializeCurrentImage);
  const saveHistoryItemAs = useStudioStore((s) => s.saveHistoryItemAs);
  const shareHistoryItem = useStudioStore((s) => s.shareHistoryItem);
  const { usesFluentUI } = usePlatform();

  if (!item) return null;
  const detail = item;

  const created = new Date(detail.createdAt).toLocaleString();
  const previewURL = useBlobURL(detail.previewBlob ?? detail.imageBlob ?? null, detail.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(detail, previewURL);
  const pixelLabel = pixelSizeLabel(detail);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => pushToast(`已复制${label}`, "success"),
      () => pushToast("复制失败", "error"),
    );
  }

  function useAsNextPrompt(text: string) {
    setField("prompt", text);
    pushToast(`已应用为下次提示词,${submitShortcutLabel} 可直接提交`, "success");
    close();
  }

  function openOutputLocation() {
    openOutputLocationForPlatform(OpenOutputDir).catch((e) => pushToast(e?.message ?? "无法打开保存位置", "warn"));
  }

  async function copyImage() {
    try {
      const full = await materializeCurrentImage(detail);
      const ok = full.fullUrl
        ? await copyImageURLToClipboard(full.fullUrl)
        : await copyImageB64ToClipboard(full.imageB64 ?? "");
      if (ok) {
        pushToast("已复制图片到剪贴板", "success");
      } else {
        pushToast("当前环境不支持复制图片，可改用分享或保存", "warn", 4200);
      }
    } catch (error: any) {
      pushToast(`复制失败:${error?.message ?? error}`, "error", 4200);
    }
  }

  return (
    <Modal open onClose={close} title="生成详情" width={720}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <section className={`platform-card border border-black/[0.05] bg-white/72 p-3 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
          <div className={`flex items-center justify-center border border-black/[0.08] bg-[var(--surface)] p-2 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
            <img
              src={imageSrc}
              alt="生成结果"
              decoding="async"
              className={`max-h-[300px] max-w-full object-contain ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Btn onClick={() => void copyImage()}><ClipboardCopy className="w-3 h-3" /> 复制图片</Btn>
            <Btn onClick={() => void saveHistoryItemAs(detail)}><Save className="w-3 h-3" /> 保存原图</Btn>
            <Btn onClick={() => void shareHistoryItem(detail)}><Share2 className="w-3 h-3" /> 分享</Btn>
            <Btn onClick={openOutputLocation}><Folder className="w-3 h-3" /> 打开文件夹</Btn>
          </div>
          {androidTarget.isAndroid && (
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{androidSaveHint()}</p>
          )}
        </section>

        <div className="space-y-4">
          <Section title="参数">
            <Kv label="模式" value={detail.mode === "edit" ? "图生图" : "文生图"} />
            <Kv label="尺寸" value={sizeLabel(detail.size)} />
            {pixelLabel ? <Kv label="真实像素" value={pixelLabel} mono /> : null}
            <Kv label="质量" value={qualityLabel(detail.quality)} />
            {detail.seed ? <Kv label="种子" value={String(detail.seed)} mono /> : null}
            {detail.styleTag ? <Kv label="风格" value={`#${detail.styleTag}`} /> : null}
            {typeof detail.elapsedSec === "number" ? <Kv label="耗时" value={`${detail.elapsedSec.toFixed(1)}s`} /> : null}
            <Kv label="创建时间" value={created} />
          </Section>

          <Section title="原始提示词">
            <PromptBlock>{detail.prompt || <em className="opacity-60">(空)</em>}</PromptBlock>
            {detail.prompt && (
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.prompt, "原始提示词")}><ClipboardCopy className="w-3 h-3" /> 复制</Btn>
                <Btn onClick={() => useAsNextPrompt(detail.prompt)}><RotateCw className="w-3 h-3" /> 用作下次提示词</Btn>
              </div>
            )}
          </Section>

          {detail.revisedPrompt && (
            <Section
              title={<span className="inline-flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-[var(--accent)]" /> 优化后提示词</span>}
              hint="Responses API 模式下文本模型可能会重写你的提示词。"
            >
              <PromptBlock highlight>{detail.revisedPrompt}</PromptBlock>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.revisedPrompt!, "优化后提示词")}><ClipboardCopy className="w-3 h-3" /> 复制</Btn>
                <Btn primary onClick={() => useAsNextPrompt(detail.revisedPrompt!)}><RotateCw className="w-3 h-3" /> 用作下次提示词</Btn>
              </div>
            </Section>
          )}

          {detail.negativePrompt && (
            <Section title="负向提示词">
              <PromptBlock muted>{detail.negativePrompt}</PromptBlock>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.negativePrompt!, "负向提示词")}><ClipboardCopy className="w-3 h-3" /> 复制</Btn>
              </div>
            </Section>
          )}

          <Section title="文件">
            {detail.savedPath ? (
              <p className={`font-mono-token break-all border border-black/[0.06] bg-[var(--surface)] px-2.5 py-2 text-[11px] text-zinc-600 dark:border-white/[0.04] dark:text-zinc-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
                {detail.savedPath}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-500">(本次未落盘 / 路径丢失)</p>
            )}
            {detail.savedPath && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Btn onClick={() => copy(detail.savedPath!, "文件路径")}><ClipboardCopy className="w-3 h-3" /> 复制路径</Btn>
              </div>
            )}
          </Section>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, hint, children }: {
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <section className={`platform-card border border-black/[0.05] bg-white/72 p-4 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{title}</h3>
      {hint && <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">{hint}</p>}
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

function PromptBlock({ children, muted, highlight }: {
  children: React.ReactNode;
  muted?: boolean;
  highlight?: boolean;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <p className={`mb-2 whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed ${
      highlight
        ? "border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]"
        : muted
          ? "border border-black/[0.06] bg-[var(--surface)] text-zinc-500 dark:border-white/[0.04]"
          : "border border-black/[0.06] bg-[var(--surface)] text-zinc-700 dark:border-white/[0.04] dark:text-zinc-300"
    } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
      {children}
    </p>
  );
}

function Btn({ children, onClick, primary }: {
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
