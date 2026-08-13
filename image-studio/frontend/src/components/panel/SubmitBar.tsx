import { Settings } from "lucide-react";
import { usePlatform } from "../../platform/context";

export function SubmitBar({
  apiKey,
  baseURL,
  prompt,
  mode,
  isRunning,
  onOpenUpstreamConfig,
  onCancel,
  onSubmit,
}: {
  apiKey: string;
  baseURL: string;
  prompt: string;
  mode: "generate" | "edit";
  isRunning: boolean;
  onOpenUpstreamConfig: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  return (
    <div className={`sticky bottom-0 mt-auto bg-gradient-to-t from-[var(--sidebar)] via-[color:var(--sidebar)]/96 to-transparent ${isMac ? "-mx-6 px-6 pb-5 pt-3" : "-mx-4 px-4 pb-4 pt-2"}`}>
      {(!apiKey || !baseURL) && (
        <div className={`mb-2 border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] px-3 py-2.5 text-center text-[11px] leading-relaxed text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
          <div className="font-medium">还没有可用上游配置</div>
          <div className="mt-1 opacity-90">
            先配置 BASE_URL 和 API Key，才能测试连接或开始生成。
          </div>
          <button
            type="button"
            data-audit-id="open-upstream-config"
            onClick={onOpenUpstreamConfig}
            className={`mt-2 inline-flex items-center gap-1.5 border border-[color:var(--accent)]/22 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-white/90 dark:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <Settings className="h-3.5 w-3.5" /> 配置上游
          </button>
        </div>
      )}
      {!apiKey || !baseURL ? (
        <button
          type="button"
          data-audit-id="open-upstream-config"
          onClick={onOpenUpstreamConfig}
          className={`liquid-primary-button w-full bg-[var(--accent)] py-3 font-semibold text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
        >
          配置上游
        </button>
      ) : isRunning ? (
        <button
          type="button"
          data-audit-id="cancel"
          onClick={onCancel}
          className={`cancel-generation-button w-full border py-3 font-semibold transition-colors ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
        >
          取消生成
        </button>
      ) : (
        <button
          data-audit-id="generate"
          onClick={onSubmit}
          disabled={!apiKey || !prompt}
          className={`liquid-primary-button w-full bg-[var(--accent)] py-3 font-semibold text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}
        >
          生成
        </button>
      )}
    </div>
  );
}
