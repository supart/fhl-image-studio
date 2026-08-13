import type { CSSProperties, ReactNode } from "react";
import { AspectRatioPicker } from "../../../components/panel/AspectRatioPicker";
import { ASPECT_PRESETS, type AspectPreset, type AspectPresetOption } from "../../../components/panel/sizeCapabilities";
import { STYLE_CHIPS } from "../../../components/panel/panelOptions";
import { vibrateForPlatform } from "../bridge";

export type AndroidSliderValue = string | number;
export type AndroidParameterSummaryItem = {
  key: string;
  label: string;
  value: string;
};

export function buildAndroidParameterSummaryItems({
  activeAspectLabel,
  activeResolutionLabel,
  activeQualityLabel,
  batchCount,
  concurrencyLimit,
  continuousGenerateTest,
  fhlImagesPoolActive,
}: {
  activeAspectLabel: string;
  activeResolutionLabel: string;
  activeQualityLabel: string;
  batchCount: number;
  concurrencyLimit?: number;
  continuousGenerateTest?: boolean;
  fhlImagesPoolActive?: boolean;
}): AndroidParameterSummaryItem[] {
  const items = [
    { key: "aspect", label: "比例", value: activeAspectLabel },
    { key: "resolution", label: "尺寸", value: activeResolutionLabel },
    { key: "quality", label: "画面质量", value: activeQualityLabel },
  ];
  if (continuousGenerateTest === true) {
    items.push({ key: "continuous", label: "连续生成", value: "开启" });
  } else {
    items.push({ key: "batch", label: "出图张数", value: `${batchCount} 张` });
    if (continuousGenerateTest !== undefined) {
      items.push({ key: "continuous", label: "连续生成", value: "关闭" });
    }
  }
  if (concurrencyLimit !== undefined) {
    items.push({
      key: "concurrency",
      label: continuousGenerateTest === true ? "连续并发" : "并发上限",
      value: fhlImagesPoolActive
        ? "每槽 4 / 总 40"
        : `${Math.min(2, Math.max(1, Math.floor(Number(concurrencyLimit) || 1)))} 并发`,
    });
  }
  return items;
}

export function AndroidParameterEditorShell({
  children,
  summary,
}: {
  children: ReactNode;
  summary: ReactNode;
}) {
  return (
    <div className="android-parameter-modal-panel">
      <div className="android-parameter-modal-summary">
        {summary}
      </div>
      <div className="android-parameter-stack android-parameter-modal-stack">
        {children}
      </div>
    </div>
  );
}

export function AndroidParameterBlock({
  children,
  className = "",
  title,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <section className={`android-parameter-block ${className}`}>
      <div className="android-parameter-block-head">
        <span>{title}</span>
        {trailing ? <span className="android-parameter-block-trailing">{trailing}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function AndroidParameterSummary({
  batchCount,
  detail,
  items,
  labels,
  onClick,
  open,
  title,
}: {
  batchCount: number;
  detail?: string;
  items?: AndroidParameterSummaryItem[];
  labels?: string[];
  onClick?: () => void;
  open?: boolean;
  title: string;
}) {
  const content = (
    <>
      <div className="android-parameter-summary-copy">
        <div className="android-phone-kicker">创作参数</div>
        <div className="android-parameter-summary-title">{title}</div>
        {items?.length ? (
          <div className="android-parameter-summary-grid">
            {items.map((item) => (
              <span key={item.key} className="android-parameter-summary-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </span>
            ))}
          </div>
        ) : (
          <div className="android-parameter-summary-meta">
            {(labels ?? []).map((label) => <span key={label}>{label}</span>)}
            <span>{batchCount} 张</span>
          </div>
        )}
      </div>
      {(detail || onClick) ? (
        <span className="android-parameter-summary-side">
          {detail ? <span className="android-parameter-summary-detail">{detail}</span> : null}
          {onClick ? <span className="android-parameter-summary-state">{open ? "正在编辑" : "编辑"}</span> : null}
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="android-parameter-summary android-parameter-summary-button">
        {content}
      </button>
    );
  }

  return <div className="android-parameter-summary">{content}</div>;
}

export function AndroidSegmentedChoices<T extends AndroidSliderValue>({
  columns,
  options,
  value,
  onChange,
}: {
  columns?: number;
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="android-parameter-segmented"
      style={{ "--android-parameter-columns": columns ?? options.length } as CSSProperties}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={`${option.value}`}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              vibrateForPlatform(5);
              onChange(option.value);
            }}
            className={active ? "active" : ""}
          >
            <strong>{option.label}</strong>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

export function AndroidStyleChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="android-parameter-chip-grid">
      {STYLE_CHIPS.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              vibrateForPlatform(5);
              onChange(active ? "" : item.id);
            }}
            className={`android-parameter-style-chip ${active ? "active" : ""}`}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        );
      })}
    </div>
  );
}

export function AndroidAspectGrid({
  options = ASPECT_PRESETS,
  value,
  onChange,
}: {
  options?: AspectPresetOption[];
  value: AspectPreset;
  onChange: (value: AspectPreset) => void;
}) {
  return (
    <AspectRatioPicker
      ariaLabel="画幅比例"
      className="android-parameter-aspect-picker"
      compact
      options={options}
      value={value}
      onChange={(next) => {
        if (next === value) return;
        vibrateForPlatform(5);
        onChange(next);
      }}
    />
  );
}

export function AndroidToggleSetting({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`android-parameter-toggle ${checked ? "active" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => {
        vibrateForPlatform(5);
        onChange(!checked);
      }}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <i aria-hidden="true" />
    </button>
  );
}

export function AndroidDiscreteSlider<T extends AndroidSliderValue>({
  label,
  note,
  onChange,
  options,
  value,
  valueSuffix = "",
}: {
  label: string;
  note?: string;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  value: T;
  valueSuffix?: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((item) => item.value === value));
  const denominator = Math.max(1, options.length - 1);
  const progress = `${(activeIndex / denominator) * 100}%`;
  const activeOption = options[activeIndex] ?? options[0];
  const disabled = options.length < 2;

  const commit = (index: number) => {
    const next = options[index];
    if (!next || next.value === value) return;
    vibrateForPlatform(4);
    onChange(next.value);
  };

  return (
    <AndroidParameterBlock title={label}>
      <div className="android-parameter-slider-head">
        <output className="font-mono-token android-parameter-slider-value">
          {activeOption?.label}{valueSuffix}
        </output>
      </div>
      <div
        className="android-parameter-discrete-slider"
        style={{ "--android-parameter-slider-progress": progress } as CSSProperties}
      >
        <input
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={activeIndex}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={`${activeOption?.label ?? ""}${valueSuffix}`}
          onChange={(event) => commit(Number(event.currentTarget.value))}
        />
      </div>
      <div
        className="android-parameter-slider-ticks"
        style={{ "--android-parameter-slider-columns": options.length } as CSSProperties}
      >
        {options.map((item, index) => (
          <button
            key={`${item.value}`}
            type="button"
            aria-pressed={index === activeIndex}
            onClick={() => commit(index)}
            className={index === activeIndex ? "active" : ""}
          >
            {item.label}
          </button>
        ))}
      </div>
      {note ? <p className="android-parameter-note">{note}</p> : null}
    </AndroidParameterBlock>
  );
}
