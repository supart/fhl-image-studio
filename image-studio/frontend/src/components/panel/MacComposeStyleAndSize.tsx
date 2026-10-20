import type { APIMode, BatchProcessConfig, Mode, QualityValue, RequestPolicy } from "../../types/domain";
import { DEFAULT_AUTO_ASPECT_RESOLUTION } from "../../lib/generationDefaults.ts";
import { QUALITY_TIERS, STYLE_CHIPS } from "./panelOptions";
import { AspectRatioPicker } from "./AspectRatioPicker";
import {
  type AspectPresetOption,
  type AspectPreset,
  RESOLUTION_PRESETS,
  type ResolutionPreset,
  sizeCapabilityHint,
} from "./sizeCapabilities";

export function MacComposeStyleAndSize({
  activeAspect,
  aspectPresets,
  activeResolution,
  apiMode,
  availableResolutions,
  batchProcess,
  batchCount,
  handleAspectSelect,
  handleResolutionSelect,
  imageModelID,
  mode,
  quality,
  requestPolicy,
  setBatchProcess,
  setField,
  styleTag,
  Seg,
  SegItem,
}: {
  activeAspect: AspectPreset;
  aspectPresets: AspectPresetOption[];
  activeResolution: ResolutionPreset;
  apiMode: APIMode;
  availableResolutions: ResolutionPreset[];
  batchProcess: BatchProcessConfig;
  batchCount: number;
  handleAspectSelect: (aspect: AspectPreset) => void;
  handleResolutionSelect: (resolution: ResolutionPreset) => void;
  imageModelID: string;
  mode: Mode;
  quality: QualityValue;
  requestPolicy: RequestPolicy;
  setBatchProcess: (next: BatchProcessConfig) => void;
  setField: (key: string, value: any) => void;
  styleTag: string;
  Seg: (props: { children: React.ReactNode }) => React.ReactNode;
  SegItem: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  void batchCount;
  const showTopLevelAspectPicker = mode !== "edit";
  const showEditManualAspectPicker = mode === "edit" && batchProcess.autoAspectResolution === "";
  const resolutionOptions = RESOLUTION_PRESETS.filter((item) => (
    availableResolutions.includes(item.value)
    && (batchProcess.autoAspectResolution === "" || item.value !== "auto")
  ));

  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] text-zinc-500">风格</span>
          {styleTag ? (
            <button
              onClick={() => setField("styleTag", "")}
              className="text-[12px] text-[var(--accent)] hover:opacity-80"
            >
              清除
            </button>
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

      {showTopLevelAspectPicker ? (
        <div>
          <div className="mb-2 text-[12px] text-zinc-500">比例</div>
          <AspectRatioPicker
            ariaLabel="比例"
            value={activeAspect}
            onChange={handleAspectSelect}
            presets={aspectPresets}
          />
        </div>
      ) : null}

      {mode === "edit" ? (
        <div>
          <div className="mb-2 text-[12px] text-zinc-500">{"\u6bd4\u4f8b"}</div>
          <div className="rounded-[16px] border border-black/[0.06] bg-[var(--surface)] px-3 py-3 dark:border-white/[0.04]">
            <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
              {"\u6e90\u56fe\u6bd4\u4f8b\u5904\u7406"}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              {"图生图自动适配统一按第 1 格参考图比例；批量图生图也按参考图栏第 1 格，不再逐张改变比例。需要自己指定比例时，切到手动比例。"}
            </div>
            <div className="mt-3">
              <Seg>
                <SegItem
                  active={batchProcess.autoAspectResolution !== ""}
                  onClick={() =>
                    setBatchProcess({
                      ...batchProcess,
                      autoAspectResolution: batchProcess.autoAspectResolution || DEFAULT_AUTO_ASPECT_RESOLUTION,
                    })
                  }
                >
                  {"\u81ea\u52a8\u9002\u914d"}
                </SegItem>
                <SegItem
                  active={batchProcess.autoAspectResolution === ""}
                  onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: "" })}
                >
                  {"\u624b\u52a8\u6bd4\u4f8b"}
                </SegItem>
              </Seg>
            </div>
            {showEditManualAspectPicker ? (
              <div className="mt-3 rounded-[16px] border border-black/[0.06] bg-black/[0.02] px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
                  {"\u624b\u52a8\u6bd4\u4f8b"}
                </div>
                <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  {"\u5f53\u524d\u4e0d\u81ea\u52a8\u8ddf\u968f\u6e90\u56fe\u6bd4\u4f8b\uff0c\u624b\u52a8\u9009\u62e9\u56fe\u751f\u56fe\u4f7f\u7528\u7684\u6bd4\u4f8b\u3002"}
                </div>
                <div className="mt-3">
                  <AspectRatioPicker
                    ariaLabel={"\u6bd4\u4f8b"}
                    value={activeAspect}
                    onChange={handleAspectSelect}
                    presets={aspectPresets}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-[12px] text-zinc-500">分辨率</div>
        <Seg>
          {resolutionOptions.map((item) => (
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

      {false && mode === "edit" ? (
        <div>
          <div className="mb-2 text-[12px] text-zinc-500">尺寸策略</div>
          <div className="rounded-[16px] border border-black/[0.06] bg-[var(--surface)] px-3 py-3 dark:border-white/[0.04]">
            <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
              按源图比例自动适配
            </div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              图生图自动适配统一按第 1 格参考图比例；批量图生图也按参考图栏第 1 格。用户手动改过比例或分辨率后，不再自动覆盖。
            </div>
            <div className="mt-3">
              <Seg>
                <SegItem
                  active={batchProcess.autoAspectResolution === ""}
                  onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: "" })}
                >
                  沿用当前尺寸
                </SegItem>
                <SegItem
                  active={batchProcess.autoAspectResolution !== ""}
                  onClick={() =>
                    setBatchProcess({
                      ...batchProcess,
                      autoAspectResolution: batchProcess.autoAspectResolution || DEFAULT_AUTO_ASPECT_RESOLUTION,
                    })
                  }
                >
                  按源图比例自动适配
                </SegItem>
              </Seg>
            </div>
            {showEditManualAspectPicker ? (
              <div className="mt-3 rounded-[16px] border border-black/[0.06] bg-black/[0.02] px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
                  手动比例
                </div>
                <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  只有在沿用当前尺寸时，才需要手动选择图生图使用的比例。
                </div>
                <div className="mt-3">
                  <AspectRatioPicker
                    ariaLabel="比例"
                    value={activeAspect}
                    onChange={handleAspectSelect}
                    presets={aspectPresets}
                  />
                </div>
              </div>
            ) : null}
            {false ? (
              <div className="mt-3 rounded-[16px] border border-[color:var(--accent)]/18 bg-[var(--accent-soft)]/55 px-3 py-3 dark:border-[color:var(--accent)]/20">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
                      统一分辨率档位
                    </div>
                    <div className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                      选择 1K / 2K / 4K 作为自动适配时的目标分辨率档位。
                    </div>
                  </div>
                  <span className="rounded-full border border-[color:var(--accent)]/25 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] dark:bg-white/10">
                    当前 {batchProcess.autoAspectResolution.toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["1k", "2k", "4k"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBatchProcess({ ...batchProcess, autoAspectResolution: value })}
                      className={`rounded-[14px] border px-2 py-3 text-[12px] font-semibold transition-colors ${
                        batchProcess.autoAspectResolution === value
                          ? "border-[color:var(--accent)]/35 bg-white text-[var(--accent)] shadow-sm dark:bg-zinc-900"
                          : "border-black/[0.08] bg-white/70 text-zinc-600 hover:border-[color:var(--accent)]/30 hover:text-zinc-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300"
                      }`}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
    </>
  );
}
