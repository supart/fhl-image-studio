import type { OutputFormatValue } from "../../types/domain";
import {
  AdvancedCard,
  AdvancedNegativePromptField,
  AdvancedOutputFormatField,
  AdvancedSeedField,
} from "./AdvancedParameterBlocks";

export function MacAdvancedPanel({
  advancedOpen,
  advancedSummary,
  negativePrompt,
  outputFormat,
  seed,
  setAdvancedOpen,
  setField,
  Seg,
  SegItem,
}: {
  advancedOpen: boolean;
  advancedSummary: string;
  negativePrompt: string;
  outputFormat: OutputFormatValue;
  seed: number;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setField: (key: string, value: any) => void;
  Seg: (props: { children: React.ReactNode }) => React.ReactNode;
  SegItem: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <section className="platform-card rounded-[22px] border border-black/[0.05] bg-white/70 p-4.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03]">
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        type="button"
        className="flex w-full min-w-0 items-center justify-between text-left"
      >
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">高级参数</div>
          <div className="mt-1.5 min-w-0 truncate text-[13px] font-normal leading-6 text-zinc-600 dark:text-zinc-300">
            {advancedSummary}
          </div>
        </div>
        <span className="shrink-0 pl-3 text-[12px] text-zinc-500 dark:text-zinc-400">{advancedOpen ? "收起 ▾" : "展开 ▸"}</span>
      </button>
      {advancedOpen && (
        <div className="mt-4 grid min-w-0 gap-[18px]">
          <div className="grid min-w-0 gap-3">
            <AdvancedCard
              title="负向提示词"
              hint="描述不希望出现的物体、色彩或构图倾向。留空时不做额外限制。"
              variant="mac"
            >
              <AdvancedNegativePromptField
                negativePrompt={negativePrompt}
                onChange={(value) => setField("negativePrompt", value)}
                variant="mac"
              />
            </AdvancedCard>

            <AdvancedCard
              title="输出格式"
              hint="PNG 保留细节最多；JPEG / WebP 更省空间。"
              variant="mac"
            >
              <AdvancedOutputFormatField
                outputFormat={outputFormat}
                onChange={(value) => setField("outputFormat", value)}
                Seg={Seg}
                SegItem={SegItem}
                noteClassName="text-[11px] leading-6 text-zinc-500 dark:text-zinc-400"
              />
            </AdvancedCard>

            <AdvancedCard
              title="随机种子"
              hint={seed > 0 ? `当前固定为 ${seed}` : "留空即随机，每次生成都会变化。"}
              variant="mac"
            >
              <AdvancedSeedField
                seed={seed}
                onChange={(value) => setField("seed", value)}
                onRandomize={() => setField("seed", Math.floor(Math.random() * 2_000_000_000))}
                onClear={() => setField("seed", 0)}
                variant="mac"
              />
            </AdvancedCard>
          </div>

          <div className="rounded-[18px] border border-black/[0.05] bg-black/[0.025] px-3.5 py-3 text-[11px] leading-[1.65] text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-zinc-400">
            高级参数只在上游兼容时生效；标准 OpenAI 请求策略会自动避开不支持的扩展字段。
          </div>
        </div>
      )}
    </section>
  );
}
