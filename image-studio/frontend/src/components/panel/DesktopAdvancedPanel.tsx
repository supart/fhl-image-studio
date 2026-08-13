import type { OutputFormatValue } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import {
  AdvancedCard,
  AdvancedNegativePromptField,
  AdvancedOutputFormatField,
  AdvancedSeedField,
} from "./AdvancedParameterBlocks";
import { Seg, SegItem } from "./panelChrome";

export function DesktopAdvancedPanel({
  advancedOpen,
  negativePrompt,
  outputFormat,
  seed,
  setAdvancedOpen,
  setField,
}: {
  advancedOpen: boolean;
  negativePrompt: string;
  outputFormat: OutputFormatValue;
  seed: number;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setField: (key: string, value: any) => void;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <section>
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        type="button"
        className={`platform-card flex w-full items-center justify-between border border-black/[0.05] bg-white/70 px-4 py-3 text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
      >
        <span className="uppercase tracking-[0.12em]">高级参数</span>
        <span className="text-[11px] opacity-70">{advancedOpen ? "收起 ▾" : "展开 ▸"}</span>
      </button>
      {advancedOpen ? (
        <div className={`platform-card mt-2 flex flex-col border border-black/[0.05] bg-white/70 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px] gap-3 p-4" : "rounded-[20px] gap-3 p-4"}`}>
          <AdvancedCard title="负向提示词">
            <AdvancedNegativePromptField
              negativePrompt={negativePrompt}
              onChange={(value) => setField("negativePrompt", value)}
              variant="desktop"
            />
          </AdvancedCard>

          <AdvancedCard title="输出格式">
            <AdvancedOutputFormatField
              outputFormat={outputFormat}
              onChange={(value) => setField("outputFormat", value)}
              Seg={Seg}
              SegItem={SegItem}
            />
          </AdvancedCard>

          <AdvancedCard title="随机种子">
            <AdvancedSeedField
              seed={seed}
              onChange={(value) => setField("seed", value)}
              onRandomize={() => setField("seed", Math.floor(Math.random() * 2_000_000_000))}
              onClear={() => setField("seed", 0)}
              variant="desktop"
            />
          </AdvancedCard>
        </div>
      ) : null}
    </section>
  );
}
