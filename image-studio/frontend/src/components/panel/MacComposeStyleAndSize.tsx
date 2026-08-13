import type { APIMode, QualityValue, RequestPolicy } from "../../types/domain";
import { Check } from "lucide-react";
import { QUALITY_TIERS, STYLE_CHIPS } from "./panelOptions";
import { AspectRatioPicker } from "./AspectRatioPicker";
import {
  type AspectPreset,
  RESOLUTION_PRESETS,
  type ResolutionPreset,
  sizeCapabilityHint,
} from "./sizeCapabilities";

export function MacComposeStyleAndSize({
  activeAspect,
  activeResolution,
  apiMode,
  availableResolutions,
  batchCount,
  handleAspectSelect,
  handleResolutionSelect,
  imageModelID,
  quality,
  requestPolicy,
  setField,
  styleTag,
  Seg,
  SegItem,
}: {
  activeAspect: AspectPreset;
  activeResolution: ResolutionPreset;
  apiMode: APIMode;
  availableResolutions: ResolutionPreset[];
  batchCount: number;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  quality: QualityValue;
  requestPolicy: RequestPolicy;
  setField: (key: string, value: any) => void;
  styleTag: string;
  Seg: (props: { children: React.ReactNode }) => React.ReactNode;
  SegItem: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] text-zinc-500">风格</span>
          {styleTag ? (
            <button onClick={() => setField("styleTag", "")} className="text-[12px] text-[var(--accent)] hover:opacity-80">清除</button>
          ) : null}
        </div>
        <div className="mac-style-chips">
          {STYLE_CHIPS.map((style) => {
            const active = styleTag === style.id;
            return (
              <button
                key={style.id}
                type="button"
                aria-pressed={active}
                onClick={() => setField("styleTag", active ? "" : style.id)}
                className={`mac-style-pill ${active ? "active" : ""}`}
              >
                <span>{style.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[12px] text-zinc-500">比例</div>
        <AspectRatioPicker
          ariaLabel="比例"
          value={activeAspect}
          onChange={handleAspectSelect}
        />
      </div>

      <div>
        <div className="mb-2 text-[12px] text-zinc-500">分辨率</div>
        <Seg>
          {RESOLUTION_PRESETS.filter((item) => availableResolutions.includes(item.value)).map((item) => (
            <SegItem
              key={item.value}
              active={activeResolution === item.value}
              onClick={() => handleResolutionSelect(item.value)}
            >
              {item.label}
            </SegItem>
          ))}
        </Seg>
        {sizeCapabilityHint({ apiMode, requestPolicy, imageModelID }) ? (
          <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {sizeCapabilityHint({ apiMode, requestPolicy, imageModelID })}
          </p>
        ) : null}
      </div>

      <div>
        <div className="mb-2 text-[12px] text-zinc-500">质量</div>
        <Seg>
          {QUALITY_TIERS.map((tier) => (
            <SegItem
              key={tier.value}
              active={quality === tier.value}
              onClick={() => setField("quality", tier.value as QualityValue)}
            >
              {tier.label}
            </SegItem>
          ))}
        </Seg>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] text-zinc-500">出图张数</span>
          <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-300">
            当前 {batchCount} 张
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[1, 2, 4, 6, 8, 9].map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={batchCount === count}
              onClick={() => setField("batchCount", count)}
              title={`同一提示词发起 ${count} 次请求`}
              className={`relative flex min-h-[48px] min-w-0 items-center justify-center rounded-[16px] border px-2 text-center transition-all ${
                batchCount === count
                  ? "border-[color:var(--accent)] bg-[var(--accent)] text-white ring-2 ring-[color:var(--accent)]/35 shadow-[0_10px_24px_rgb(0_122_255_/_0.24)]"
                  : "border-black/[0.08] bg-white/45 text-zinc-600 hover:border-[color:var(--accent)]/35 hover:text-zinc-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:text-zinc-100"
              }`}
            >
              <span className="flex min-w-0 flex-col items-center leading-none">
                <span className="text-[15px] font-semibold tabular-nums">{count}</span>
                <span className={`mt-1 text-[10px] font-medium ${batchCount === count ? "text-white/80" : "text-zinc-400 dark:text-zinc-500"}`}>
                  张
                </span>
              </span>
              {batchCount === count ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/18">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
