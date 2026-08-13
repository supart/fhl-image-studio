import { usePlatform } from "../../platform/context";

export function SettingsRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <div className={`platform-card border border-black/[0.05] bg-white/72 px-4 py-3.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-[rgb(29_32_40_/_0.88)] ${usesFluentUI ? "rounded-[12px]" : "rounded-[20px]"}`}>
      <label className="mb-2.5 block text-[11px] font-semibold tracking-[0.04em] text-zinc-700 dark:text-zinc-200">{label}</label>
      {children}
    </div>
  );
}

export function SettingsSegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`platform-chip inline-flex min-h-[32px] min-w-0 flex-1 items-center justify-center gap-1 px-3 py-2 text-center text-[12px] font-medium leading-tight break-words [overflow-wrap:anywhere] transition-colors ${
        active
          ? "active bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      } ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
    >
      {children}
    </button>
  );
}

export function SettingsFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[14px] border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-left dark:border-white/[0.08]">
      <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="mt-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-100">{value}</div>
    </div>
  );
}
