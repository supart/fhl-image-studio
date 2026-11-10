import type { BackgroundMode } from "../../types/domain";

export function BackgroundModeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: BackgroundMode;
  onChange: (value: BackgroundMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="mb-3"
      data-testid="background-mode-control"
      data-background-supported={disabled ? "false" : "true"}
      aria-disabled={disabled}
    >
      <div className="mb-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">输出背景</div>
      <div className="grid grid-cols-2 gap-1 rounded-[6px] border border-black/[0.08] bg-black/[0.025] p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
        {([
          ["opaque", "普通图像"],
          ["transparent", "透明 PNG"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            disabled={disabled}
            title={disabled ? "当前模型不支持或未确认透明背景" : label}
            className={`mode-switch-button mode-switch-button-fluent background-mode-switch-button focus-ring ${value === id ? "background-mode-switch-button-active" : ""}`}
            data-testid={`background-mode-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={`mt-1.5 min-h-4 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400 ${disabled ? "" : "invisible"}`}
        aria-hidden={!disabled}
      >
        当前模型不支持或未确认透明背景，已固定为普通图像。
      </div>
    </div>
  );
}
