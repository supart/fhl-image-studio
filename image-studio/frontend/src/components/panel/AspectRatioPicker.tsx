import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ASPECT_PRESETS, type AspectPreset, type AspectPresetOption } from "./sizeCapabilities";

type AspectRatioPickerProps = {
  value: AspectPreset;
  onChange: (value: AspectPreset) => void;
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  presets?: AspectPresetOption[];
  /** Override the visible label for the provider's automatic aspect option. */
  autoLabel?: string;
  /** Hide the small provider-specific hint shown beside automatic aspect options. */
  showAutoHint?: boolean;
  /** Render the menu against the document to avoid clipping inside scroll containers. */
  portalMenu?: boolean;
};

const PREVIEW_MAX_W = 58;
const PREVIEW_MAX_H = 34;

export function AspectRatioPicker({
  value,
  onChange,
  ariaLabel = "Aspect ratio",
  className = "",
  compact = false,
  presets = ASPECT_PRESETS,
  autoLabel,
  showAutoHint = true,
  portalMenu = false,
}: AspectRatioPickerProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = presets.find((item) => item.value === value) ?? presets[0] ?? ASPECT_PRESETS[0];

  const updateMenuPosition = useCallback(() => {
    if (!portalMenu || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(180, Math.round(rect.width));
    const maxHeight = Math.max(160, Math.min(360, window.innerHeight - 24));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const belowTop = rect.bottom + 6;
    const top = belowTop + maxHeight <= window.innerHeight - 8
      ? belowTop
      : Math.max(8, rect.top - maxHeight - 6);
    setMenuStyle({
      position: "fixed",
      top,
      left,
      right: "auto",
      width,
      maxHeight,
      zIndex: 100100,
    });
  }, [portalMenu]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    if (portalMenu) {
      updateMenuPosition();
      window.addEventListener("resize", updateMenuPosition);
      window.addEventListener("scroll", updateMenuPosition, true);
    }
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (portalMenu) {
        window.removeEventListener("resize", updateMenuPosition);
        window.removeEventListener("scroll", updateMenuPosition, true);
      }
    };
  }, [open, portalMenu, updateMenuPosition]);

  useEffect(() => {
    if (!portalMenu || !open) {
      setMenuStyle(null);
    }
  }, [open, portalMenu]);

  const menu = open ? (
    <div
      ref={menuRef}
      id={listId}
      role="listbox"
      className={`aspect-picker-menu ${className}`}
      style={portalMenu ? menuStyle ?? undefined : undefined}
    >
      {presets.map((aspect) => {
        const active = aspect.value === value;
        const label = aspect.auto ? (autoLabel ?? aspect.label) : aspect.label;
        return (
          <button
            key={aspect.value}
            type="button"
            role="option"
            aria-selected={active}
            className={`aspect-picker-option ${active ? "active" : ""}`}
            onClick={() => {
              if (!active) onChange(aspect.value);
              setOpen(false);
            }}
          >
            <span className="aspect-picker-option-main">
              <span className="aspect-picker-option-label">{label}</span>
              {aspect.auto && showAutoHint ? <span className="aspect-picker-hint">auto</span> : null}
            </span>
            <span className="aspect-picker-option-side">
              <AspectPreview aspect={aspect} />
              <span className="aspect-picker-check" aria-hidden="true">
                {active ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`aspect-picker ${compact ? "aspect-picker-compact" : ""} ${open ? "open" : ""} ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        className="aspect-picker-trigger focus-ring"
        onClick={() => setOpen((next) => !next)}
      >
        <span className="aspect-picker-label">{selected.auto ? (autoLabel ?? selected.label) : selected.label}</span>
        <span className="aspect-picker-trigger-right">
          <AspectPreview aspect={selected} />
          <ChevronDown className="aspect-picker-chevron" aria-hidden="true" />
        </span>
      </button>
      {portalMenu ? (menu ? createPortal(menu, document.body) : null) : menu}
    </div>
  );
}

function AspectPreview({
  aspect,
}: {
  aspect: AspectPresetOption;
}) {
  const { width, height } = previewSize(aspect);
  return (
    <span className="aspect-picker-preview-box" aria-hidden="true">
      <span
        className={`aspect-picker-preview ${aspect.auto ? "auto" : ""}`}
        style={{
          "--aspect-preview-w": `${width}px`,
          "--aspect-preview-h": `${height}px`,
        } as CSSProperties}
      />
    </span>
  );
}

function previewSize(aspect: AspectPresetOption) {
  if (aspect.auto) return { width: 24, height: 24 };
  const scale = Math.min(PREVIEW_MAX_W / aspect.w, PREVIEW_MAX_H / aspect.h);
  return {
    width: Math.max(8, Math.round(aspect.w * scale)),
    height: Math.max(8, Math.round(aspect.h * scale)),
  };
}
