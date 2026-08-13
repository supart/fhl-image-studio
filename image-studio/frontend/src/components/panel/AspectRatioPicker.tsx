import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ASPECT_PRESETS, type AspectPreset, type AspectPresetOption } from "./sizeCapabilities";

type AspectRatioPickerProps = {
  value: AspectPreset;
  onChange: (value: AspectPreset) => void;
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  options?: AspectPresetOption[];
};

const PREVIEW_MAX_W = 58;
const PREVIEW_MAX_H = 34;

export function AspectRatioPicker({
  value,
  onChange,
  ariaLabel = "Aspect ratio",
  className = "",
  compact = false,
  options = ASPECT_PRESETS,
}: AspectRatioPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = options.find((item) => item.value === value) ?? options[0] ?? ASPECT_PRESETS[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`aspect-picker ${compact ? "aspect-picker-compact" : ""} ${open ? "open" : ""} ${className}`}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        className="aspect-picker-trigger focus-ring"
        onClick={() => setOpen((next) => !next)}
      >
        <span className="aspect-picker-label">{selected.label}</span>
        <span className="aspect-picker-trigger-right">
          <AspectPreview aspect={selected} />
          <ChevronDown className="aspect-picker-chevron" aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div id={listId} role="listbox" className="aspect-picker-menu">
          {options.map((aspect) => {
            const active = aspect.value === value;
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
                  <span className="aspect-picker-option-label">{aspect.label}</span>
                  {aspect.auto ? <span className="aspect-picker-hint">auto</span> : null}
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
      ) : null}
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
