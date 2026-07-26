import { useMemo, useState } from "react";
import {
  AlertCircle,
  Database,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  buildAPICredentialInventory,
  hasActiveAPIWork,
} from "../../lib/apiCredentialLibrary.ts";
import { clearAllRuntimeAPIConfigurations } from "../../lib/apiCredentialClearRuntime.ts";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import { Modal } from "../common/Modal";

export function APICredentialLibrary() {
  const { usesFluentUI } = usePlatform();
  const profiles = useStudioStore((state) => state.profiles);
  const fhlTextAPIConfigured = useStudioStore((state) => state.fhlTextAPIConfigured);
  const batchTasksById = useStudioStore((state) => state.batchTasksById);
  const isRunning = useStudioStore((state) => state.isRunning);
  const runningJobs = useStudioStore((state) => state.runningJobs);
  const isTestingKey = useStudioStore((state) => state.isTestingKey);
  const fhlTextAPITestStatus = useStudioStore((state) => state.fhlTextAPITestStatus);
  const isOptimizingPrompt = useStudioStore((state) => state.isOptimizingPrompt);
  const isReversingPrompt = useStudioStore((state) => state.isReversingPrompt);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [lastResult, setLastResult] = useState("");

  const inventory = useMemo(
    () => buildAPICredentialInventory(profiles, fhlTextAPIConfigured),
    [profiles, fhlTextAPIConfigured],
  );
  const activeWork = hasActiveAPIWork({
    isRunning,
    runningJobs,
    batchTasksById,
    isTestingKey,
    fhlTextAPITestStatus,
    isOptimizingPrompt,
    isReversingPrompt,
  });
  const configuredImages = inventory.fhlImagesProfiles.filter((profile) => (
    !!profile.fhlImagesPoolKeyHint
  )).length;
  const profileNames = profiles.map((profile) => profile.name.trim()).filter(Boolean);

  async function handleClearAll() {
    if (activeWork || isClearing) return;
    setIsClearing(true);
    setOperationError("");
    setLastResult("");
    try {
      const result = await clearAllRuntimeAPIConfigurations(
        useStudioStore.getState(),
        (patch) => useStudioStore.setState(patch),
      );
      useStudioStore.getState().pushToast("本机 API 凭据库已彻底清空。", "success", 4200);
      setLastResult(
        `已清空 ${result.credentialsCleared} 个本地凭据目标、${result.profilesCleared} 条配置记录`
        + (result.runningHubBridgesCleared > 0 ? `、${result.runningHubBridgesCleared} 个 RunningHub 桥接` : ""),
      );
      setConfirmOpen(false);
    } catch (error: any) {
      setOperationError(error?.message ?? "清空 API 凭据库失败，请重试。");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      <section
        className={`api-credential-library flex min-w-0 flex-col gap-3 border border-black/[0.08] bg-[var(--surface)]/75 p-3 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}
        data-audit-id="api-credential-library"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-300" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">本机 API 凭据库</h3>
              <p className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                统一管理本软件保存的凭据；仅显示配置状态，不显示完整 API Key。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOperationError("");
              setConfirmOpen(true);
            }}
            disabled={activeWork || isClearing}
            title={activeWork ? "仍有排队或运行中的任务，暂时不能清空 API" : "永久清空本机全部 API 凭据"}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-red-300 bg-red-50 px-3 text-[12px] font-semibold text-red-700 transition-colors hover:border-red-400 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200 dark:hover:bg-red-400/15 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            一键清空全部 API
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
          <CredentialStat label="FHL 文本" value={inventory.fhlTextConfigured ? "已配置" : "未配置"} />
          <CredentialStat label="FHL Images" value={`${configuredImages}/10`} />
          <CredentialStat label="其他本地 API" value={`${inventory.directProfiles.length} 条`} />
          <CredentialStat label="RunningHub" value={`${inventory.runningHubProfiles.length} 条`} />
        </div>

        {profileNames.length > 0 ? (
          <div className="min-w-0 border-t border-black/[0.06] pt-2 text-[11px] leading-5 text-zinc-500 dark:border-white/[0.06] dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">配置记录：</span>
            <span className="break-words">{profileNames.join("、")}</span>
          </div>
        ) : null}

        {activeWork ? (
          <div className="flex items-start gap-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>当前仍有排队或运行中的任务。任务结束后才能清空，避免中途移除正在使用的凭据。</span>
          </div>
        ) : null}

        {lastResult ? (
          <div className="flex items-start gap-2 text-[11px] leading-5 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{lastResult}</span>
          </div>
        ) : null}
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => { if (!isClearing) setConfirmOpen(false); }}
        title="清空全部 API"
        width={520}
      >
        <div className="flex flex-col gap-4">
          <div className={`flex items-start gap-3 border border-red-300/80 bg-red-50 p-3 text-red-950 dark:border-red-400/35 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-300" />
            <div className="min-w-0 text-[12px] leading-6">
              <p className="font-semibold">此操作不可撤销。</p>
              <p>将删除系统凭据库、FHL 文本、Images 池、其他 profile、旧兼容项、本地 CLI 凭据文件，以及当前可访问的 RunningHub 桥接 Key。</p>
            </div>
          </div>

          <p className="text-[12px] leading-6 text-zinc-600 dark:text-zinc-300">
            历史记录、生成图片、工作区、预设和普通设置不会被删除。
          </p>

          {operationError ? (
            <div className={`flex items-start gap-2 border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{operationError}</span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={isClearing}
              className={`inline-flex h-9 items-center px-3 text-[12px] font-medium text-zinc-600 hover:bg-black/[0.04] disabled:opacity-45 dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleClearAll()}
              disabled={isClearing || activeWork}
              className={`inline-flex h-9 items-center gap-1.5 bg-red-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            >
              {isClearing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {isClearing ? "正在清空并验证" : "确认永久清空"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function CredentialStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l-2 border-black/[0.08] pl-2 dark:border-white/[0.10]">
      <div className="text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 truncate font-semibold text-zinc-900 dark:text-zinc-100" title={`${label}：${value}`}>{value}</div>
    </div>
  );
}
