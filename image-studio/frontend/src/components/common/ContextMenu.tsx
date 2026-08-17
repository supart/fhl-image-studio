import {
  Clipboard,
  Compass,
  FileText,
  FolderOpen,
  ImagePlus,
  Info,
  RotateCcw,
  Save,
  Share2,
  SlidersHorizontal,
  Split,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlatform } from "../../platform/context";

export interface MenuItem {
  label: string;
  icon?: string | ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

function matchesAny(label: string, patterns: string[]) {
  return patterns.some((pattern) => label.includes(pattern));
}

function FluentMenuIcon({ item }: { item: MenuItem }) {
  const iconClass = "h-3.5 w-3.5";
  const label = item.label.toLowerCase();

  if (item.danger || matchesAny(label, ["删除", "清空"])) return <Trash2 className={iconClass} />;
  if (matchesAny(label, ["详情"])) return <Info className={iconClass} />;
  if (matchesAny(label, ["复制 prompt", "复制图像", "粘贴图像", "粘贴", "复制"])) {
    return <Clipboard className={iconClass} />;
  }
  if (matchesAny(label, ["路径", "复制本地路径"])) return <FolderOpen className={iconClass} />;
  if (label.includes("raw")) return <FileText className={iconClass} />;
  if (matchesAny(label, ["应用参数", "参数"])) return <SlidersHorizontal className={iconClass} />;
  if (matchesAny(label, ["重新生成", "以此参数重新生成"])) return <RotateCcw className={iconClass} />;
  if (matchesAny(label, ["设为源图", "源图"])) return <ImagePlus className={iconClass} />;
  if (matchesAny(label, ["360", "全景"])) return <Compass className={iconClass} />;
  if (matchesAny(label, ["对比"])) return <Split className={iconClass} />;
  if (matchesAny(label, ["保存原图", "另存", "保存"])) return <Save className={iconClass} />;
  if (matchesAny(label, ["分享"])) return <Share2 className={iconClass} />;
  if (matchesAny(label, ["关闭", "取消"])) return <X className={iconClass} />;

  if (typeof item.icon !== "string") return <>{item.icon}</>;
  return <Info className={iconClass} />;
}

function LegacyMenuIcon({ icon }: { icon?: MenuItem["icon"] }) {
  if (!icon) return null;
  if (typeof icon !== "string") return <>{icon}</>;
  return <>{icon}</>;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { usesFluentUI, usesAppleUI } = usePlatform();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const w = 236;
  const ah = 36;
  const h = items.length * ah + 8;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));

  const menu = (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: w }}
      onContextMenu={(event) => event.preventDefault()}
      className={`context-menu z-[9200] overflow-hidden border border-black/[0.08] bg-white/95 py-1 shadow-[0_24px_60px_rgb(15_23_42_/_0.16)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-zinc-900/95 ${usesAppleUI ? "liquid-glass-panel" : ""} ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}
    >
      {items.map((it, index) => (
        <div key={index}>
          {it.separatorBefore ? <div className="context-menu-separator h-px my-1 bg-black/5 dark:bg-white/5" /> : null}
          <button
            onClick={() => {
              if (!it.disabled) {
                it.onClick();
                onClose();
              }
            }}
            disabled={it.disabled}
            className={`context-menu-item w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger
                ? "danger text-red-500 hover:bg-red-500/10"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
          >
            <span className="context-menu-icon w-4 text-center">
              {usesFluentUI ? <FluentMenuIcon item={it} /> : <LegacyMenuIcon icon={it.icon} />}
            </span>
            <span className="context-menu-label min-w-0">{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  );

  if (typeof document === "undefined") return menu;
  return createPortal(menu, document.body);
}
