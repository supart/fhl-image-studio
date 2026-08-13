import type { FHLTransportMode } from "../../lib/providerPolicy";

const OPTIONS: ReadonlyArray<{
  mode: FHLTransportMode;
  label: string;
}> = [
  { mode: "images", label: "Images API" },
  { mode: "responses", label: "Responses API" },
];

/**
 * The transport switch is intentionally presentation-only. The store owns
 * persistence and runtime mapping; this control only reports the user's
 * explicit choice and exposes stable selectors for Android audits.
 */
export function AndroidFHLTransportModeSwitch({
  mode,
  onChange,
}: {
  mode: FHLTransportMode;
  onChange: (mode: FHLTransportMode) => void;
}) {
  return (
    <div
      className="android-fhl-transport-switch"
      data-testid="android-fhl-transport-mode"
      data-audit-id="fhl-transport-mode"
      role="group"
      aria-label="FHL 生图 API 形态"
    >
      <span className="android-fhl-transport-switch-label">API 形态</span>
      <div className="android-fhl-transport-options">
        {OPTIONS.map((option) => {
          const selected = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              className={`android-fhl-transport-option ${selected ? "active" : ""}`}
              data-testid={`android-fhl-transport-${option.mode}`}
              data-audit-id={`fhl-transport-${option.mode}`}
              aria-pressed={selected}
              title={`切换 FHL 新任务到 ${option.label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onChange(option.mode)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
