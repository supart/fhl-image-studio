import { ExternalLink, KeyRound } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { copyText } from "../../lib/fhlAPI";
import { RUNNINGHUB_BASE_URL } from "../../lib/profiles";
import { RUNNINGHUB_REGISTER_URL } from "../../lib/runninghubAPI";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { OpenExternalURL } from "../../platform/runtime/host";

export function RunningHubAPIChoiceModal({
  open,
  onClose,
  onUseExistingAPI,
}: {
  open: boolean;
  onClose: () => void;
  onUseExistingAPI: () => void | Promise<void>;
}) {
  const { usesFluentUI } = usePlatform();
  const pushToast = useStudioStore((state) => state.pushToast);

  async function handleGetAPI() {
    let opened = false;
    try {
      await openExternalURLForPlatform(RUNNINGHUB_REGISTER_URL, OpenExternalURL);
      opened = true;
    } catch {
      opened = false;
    }
    try {
      await copyText(RUNNINGHUB_REGISTER_URL);
      pushToast(
        opened
          ? "RunningHub API 链接已复制，已尝试打开 API 页面。"
          : "RunningHub API 链接已复制；如果没有自动打开，请粘贴到浏览器地址栏。",
        opened ? "success" : "warn",
        5200,
      );
    } catch {
      pushToast(
        opened
          ? "已尝试打开 RunningHub API 页面，但当前环境拒绝复制链接。"
          : "浏览器未自动打开，当前环境也拒绝复制链接。",
        opened ? "warn" : "error",
        6000,
      );
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="配置 RunningHub API" width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-violet-300/70 bg-violet-50 px-3 py-2 text-violet-950 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <div className="text-[13px] font-semibold tracking-[0]">请选择你的 API 状态</div>
          <div className="mt-1 text-[12px] leading-5">
            已有 Key 的用户会使用安卓模拟器桥接地址 `{RUNNINGHUB_BASE_URL}`，再写入或复用 8117 桥接模块里的 RunningHub API Key，并创建 `RH-1 全能图像2` / `RH-1 全能图像G2` 两套配置。
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void onUseExistingAPI()}
            style={{
              border: "2px solid #2563eb",
              backgroundColor: "#ffffff",
              color: "#1d4ed8",
              boxShadow: "0 0 0 1px rgb(37 99 235 / 0.22), 0 4px 14px rgb(37 99 235 / 0.22)",
            }}
            data-runninghub-api-choice="existing"
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-blue-600 bg-white p-3 text-left text-blue-700 shadow-[0_3px_10px_rgb(37_99_235_/_0.18)] ring-1 ring-blue-200 transition-all hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-50 hover:shadow-[0_5px_14px_rgb(37_99_235_/_0.28)] dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-200 dark:ring-blue-500/35 dark:hover:bg-blue-950/70 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">已有 API</span>
            <span className="text-[11px] leading-5 opacity-85">自动填好桥接 IP，再写入或复用 Key 并验证双模型。</span>
          </button>

          <button
            type="button"
            onClick={() => void handleGetAPI()}
            style={{
              border: "2px solid #6d28d9",
              backgroundColor: "#c4b5fd",
              color: "#111827",
              boxShadow: "0 0 0 1px rgb(109 40 217 / 0.24), 0 4px 14px rgb(109 40 217 / 0.26)",
            }}
            data-runninghub-api-choice="get"
            title={`复制完整 API 链接并打开 ${RUNNINGHUB_REGISTER_URL}`}
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-violet-700 bg-violet-300 p-3 text-left text-zinc-950 shadow-[0_3px_10px_rgb(109_40_217_/_0.22)] ring-1 ring-violet-200 transition-all hover:-translate-y-0.5 hover:border-violet-800 hover:bg-violet-200 hover:shadow-[0_5px_14px_rgb(109_40_217_/_0.32)] dark:border-violet-400 dark:bg-violet-500 dark:ring-violet-300/45 dark:hover:bg-violet-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <ExternalLink className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">获取 API</span>
            <span className="text-[11px] leading-5">复制完整 RunningHub 链接，并打开 API 页面。</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
