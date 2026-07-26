import type { MouseEvent } from "react";
import type { FHLTransportMode } from "../../lib/providerPolicy";

type FHLTransportToggleProps = {
  mode: FHLTransportMode;
  onChange: (mode: FHLTransportMode) => void;
};

const activeClassName = "border border-[color:var(--accent)] bg-[var(--accent-soft)] text-zinc-950 shadow-sm ring-1 ring-[color:var(--accent)]/20 dark:text-zinc-50";
const inactiveClassName = "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

export function FHLTransportToggle({ mode, onChange }: FHLTransportToggleProps) {
  const select = (event: MouseEvent<HTMLButtonElement>, nextMode: FHLTransportMode) => {
    event.preventDefault();
    event.stopPropagation();
    onChange(nextMode);
  };

  return (
    <div
      className="no-drag inline-flex h-8 shrink-0 items-center rounded-[7px] border border-black/[0.10] bg-black/[0.04] p-0.5 dark:border-white/[0.10] dark:bg-white/[0.06]"
      role="group"
      aria-label="FHL 接口模式"
    >
      {(["images", "responses"] as const).map((transport) => {
        const selected = mode === transport;
        const label = transport === "images" ? "FHL Images" : "FHL Responses";
        return (
          <button
            key={transport}
            type="button"
            data-audit-id={`fhl-transport-${transport}`}
            className={`fhl-transport-option inline-flex h-6 items-center justify-center rounded-[5px] px-2 text-[11px] font-semibold tracking-[0] transition-colors ${selected ? activeClassName : inactiveClassName}`}
            title={`所有 FHL 槽位的新任务使用 ${transport === "images" ? "Images" : "Responses"} 接口`}
            aria-label={`切换全部 FHL API 为 ${transport === "images" ? "Images" : "Responses"}`}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => select(event, transport)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
