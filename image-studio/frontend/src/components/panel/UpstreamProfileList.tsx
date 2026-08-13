import { Copy, Plus, Trash2 } from "lucide-react";
import type { UpstreamProfile } from "../../types/domain";
import { usePlatform } from "../../platform/context";

export function UpstreamProfileList({
  profiles,
  selectedId,
  activeProfileId,
  draftId,
  isAndroidPhone,
  onSelectProfile,
  onHandleNew,
  onHandleDuplicate,
  onHandleDelete,
  onHandleSetActive,
}: {
  profiles: UpstreamProfile[];
  selectedId: string;
  activeProfileId: string;
  draftId?: string;
  isAndroidPhone: boolean;
  onSelectProfile: (id: string) => void;
  onHandleNew: () => void | Promise<void>;
  onHandleDuplicate: () => void | Promise<void>;
  onHandleDelete: () => void | Promise<void>;
  onHandleSetActive: () => void | Promise<void>;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <aside className={`upstream-profile-list flex min-w-0 shrink-0 flex-col gap-2 ${isAndroidPhone ? "w-full" : "w-[240px]"}`}>
      <div className={`flex-1 overflow-y-auto border border-black/[0.08] bg-[var(--surface)] p-1.5 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`} style={{ maxHeight: isAndroidPhone ? 172 : 460 }}>
        {profiles.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-zinc-500">还没有配置,点下方「+ 新建」开始。</p>
        ) : (
          <div className={`flex ${isAndroidPhone ? "gap-2 overflow-x-auto pb-1" : "flex-col"}`}>
            {profiles.map((p) => {
              const isSel = p.id === selectedId;
              const isActive = p.id === activeProfileId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProfile(p.id)}
                  className={`platform-card group flex min-w-0 items-center gap-2 border px-2.5 py-2 text-left transition-colors ${
                    isSel
                      ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-2 ring-[color:var(--accent)]/35"
                      : "border-transparent text-zinc-700 hover:bg-black/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
                  } ${isAndroidPhone ? "min-w-[208px]" : "mb-1 w-full"} ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
                >
                  <span
                    title={isActive ? "当前激活" : "点列表切换 selected;点「设为激活」激活"}
                    className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "bg-[var(--accent)] shadow-[0_0_5px_rgb(0_122_255_/_0.6)]" : "bg-zinc-300 dark:bg-zinc-700"}`}
                  />
                  <span className="min-w-0 flex-1 truncate break-words text-[13px] font-medium [overflow-wrap:anywhere]">{p.name}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wider opacity-70">
                    {p.apiMode === "responses" ? "R" : "I"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void onHandleNew()}
          className={`platform-action-btn inline-flex flex-1 items-center justify-center gap-1 border border-black/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Plus className="h-3 w-3" /> 新建
        </button>
        <button
          type="button"
          onClick={() => void onHandleDuplicate()}
          disabled={!selectedId}
          title="复制当前选中"
          className={`platform-action-btn inline-flex items-center justify-center gap-1 border border-black/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => void onHandleDelete()}
          disabled={!selectedId}
          title="删除当前选中(连同凭据)"
          className={`platform-action-btn inline-flex items-center justify-center gap-1 border border-black/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-500 transition-colors hover:border-red-400/45 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {draftId && draftId !== activeProfileId ? (
        <button
          type="button"
          onClick={() => void onHandleSetActive()}
          className={`platform-action-btn inline-flex items-center justify-center gap-1 border border-[color:var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[color:var(--accent)]/15 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          设为当前激活
        </button>
      ) : null}
    </aside>
  );
}
