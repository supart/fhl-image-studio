import { Dices, X } from "lucide-react";
import type { OutputFormatValue } from "../../types/domain";
import { OUTPUT_FORMAT_OPTIONS } from "../../types/domain";

type SegRenderer = (props: { children: React.ReactNode }) => React.ReactNode;
type SegItemRenderer = (props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => React.ReactNode;

export function AdvancedCard({
  title,
  hint,
  children,
  variant = "desktop",
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  variant?: "mac" | "desktop";
  className?: string;
}) {
  const isMac = variant === "mac";

  return (
    <section
      className={`min-w-0 ${
        isMac
          ? "rounded-[18px] border border-black/[0.06] bg-white/55 px-3.5 py-3.5 ring-1 ring-black/[0.02] dark:border-white/[0.07] dark:bg-white/[0.035] dark:ring-white/[0.03]"
          : "rounded-[20px] border border-white/12 bg-[var(--surface)]/70 px-4 py-4 ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
      } ${className}`}
    >
      <div className={`${isMac ? "text-[12px]" : "text-[11px]"} font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-300`}>
        {title}
      </div>
      {hint ? (
        <p className={`${isMac ? "mt-1.5 text-[12px] leading-[1.65]" : "mt-1.5 text-[12px] leading-6"} text-zinc-500 dark:text-zinc-400`}>
          {hint}
        </p>
      ) : null}
      <div className={isMac ? "mt-3.5" : "mt-3"}>{children}</div>
    </section>
  );
}

export function AdvancedNegativePromptField({
  negativePrompt,
  onChange,
  variant,
}: {
  negativePrompt: string;
  onChange: (value: string) => void;
  variant: "mac" | "desktop";
}) {
  return (
    <textarea
      value={negativePrompt}
      placeholder={variant === "mac"
        ? "例如：不要文字、不要水印、不要多余肢体、不要过曝"
        : "负向提示词(不希望出现的元素)..."}
      onChange={(e) => onChange(e.target.value)}
      className={`focus-ring w-full resize-y border border-black/[0.08] bg-[var(--surface)] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
        variant === "mac"
          ? "min-h-[150px] rounded-[18px] px-4 py-3.5 text-[14px] leading-[1.72]"
          : "min-h-[84px] rounded-[16px] px-3.5 py-3 text-[13px] leading-relaxed"
      }`}
    />
  );
}

export function AdvancedOutputFormatField({
  outputFormat,
  onChange,
  Seg,
  SegItem,
  noteClassName = "text-[10px] text-zinc-500",
}: {
  outputFormat: OutputFormatValue;
  onChange: (value: OutputFormatValue) => void;
  Seg: SegRenderer;
  SegItem: SegItemRenderer;
  noteClassName?: string;
}) {
  return (
    <>
      <Seg>
        {OUTPUT_FORMAT_OPTIONS.map((item) => (
          <SegItem
            key={item.value}
            active={outputFormat === item.value}
            onClick={() => onChange(item.value as OutputFormatValue)}
          >
            {item.label}
          </SegItem>
        ))}
      </Seg>
      <p className={`mt-1 ${noteClassName}`}>JPEG/WebP 体积更小；落盘扩展名 jpeg → .jpg</p>
    </>
  );
}

export function AdvancedSeedField({
  seed,
  onChange,
  onRandomize,
  onClear,
  variant,
}: {
  seed: number;
  onChange: (value: number) => void;
  onRandomize: () => void;
  onClear: () => void;
  variant: "mac" | "desktop";
}) {
  const inputClassName = variant === "mac"
    ? "min-h-[44px] rounded-[18px] px-4 py-3 text-[14px]"
    : "min-h-[42px] rounded-[10px] px-3 py-2.5 text-[13px]";
  const buttonShape = variant === "mac" ? "rounded-full" : "rounded-[8px]";

  return (
    <div className="flex flex-col gap-2.5">
      <input
        type="number"
        value={seed || ""}
        placeholder={variant === "mac" ? "留空为随机" : "seed (留空=随机)"}
        min={0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 ${inputClassName}`}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onRandomize}
          title="随机 seed"
          type="button"
          className={`platform-action-btn inline-flex min-h-[40px] min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${buttonShape}`}
        >
          <Dices className="h-3.5 w-3.5" /> 随机
        </button>
        <button
          onClick={onClear}
          title="清除"
          disabled={seed <= 0}
          type="button"
          className={`platform-action-btn inline-flex min-h-[40px] min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.08] dark:text-zinc-300 ${buttonShape}`}
        >
          <X className="h-3.5 w-3.5" /> 清空
        </button>
      </div>
    </div>
  );
}
