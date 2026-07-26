import { ExternalLink, KeyRound } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { copyText, FHL_REGISTER_URL } from "../../lib/fhlAPI";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { OpenExternalURL } from "../../platform/runtime/host";

export function FHLAPIChoiceModal({
  open,
  onClose,
  onUseExistingAPI,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  onUseExistingAPI: () => void | Promise<void>;
  mode?: "desktopPool" | "legacy";
}) {
  const { isAndroid, usesFluentUI } = usePlatform();
  const pushToast = useStudioStore((state) => state.pushToast);
  const useDesktopPool = (mode ?? (isAndroid ? "legacy" : "desktopPool")) === "desktopPool";

  async function handleGetAPI() {
    let opened = false;
    try {
      await openExternalURLForPlatform(FHL_REGISTER_URL, OpenExternalURL);
      opened = true;
    } catch {
      opened = false;
    }
    try {
      await copyText(FHL_REGISTER_URL);
      pushToast(
        opened
          ? "FHL 注册链接已复制，已尝试打开注册页。"
          : "FHL 注册链接已复制；如果没有自动打开，请粘贴到浏览器地址栏。",
        opened ? "success" : "warn",
        5200,
      );
    } catch {
      pushToast(
        opened
          ? "已尝试打开 FHL 注册页，但当前环境拒绝复制链接。"
          : "浏览器未自动打开，当前环境也拒绝复制链接。",
        opened ? "warn" : "error",
        6000,
      );
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={useDesktopPool ? "配置 FHL Images API" : "配置 FHL API"} width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <div className="text-[13px] font-semibold tracking-[0]">请选择你的 API 状态</div>
          <div className="mt-1 text-[12px] leading-5">
            {useDesktopPool
              ? "已有 Key 的用户可填写最多 10 个 FHL Images API。每个非空槽都是独立的连续生成 API，不会创建 Responses 配置或自动发起连接测试。"
              : "已有 Key 的用户会先粘贴 1 个 API Key，再自动完成 `FHL-... Responses` 和 `FHL-... Images` 两套配置与连接验证；没有 Key 的用户先注册获取。"}
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
            data-fhl-api-choice="existing"
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-blue-600 bg-white p-3 text-left text-blue-700 shadow-[0_3px_10px_rgb(37_99_235_/_0.18)] ring-1 ring-blue-200 transition-all hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-50 hover:shadow-[0_5px_14px_rgb(37_99_235_/_0.28)] dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-200 dark:ring-blue-500/35 dark:hover:bg-blue-950/70 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">已有 API</span>
            <span className="text-[11px] leading-5 opacity-85">
              {useDesktopPool
                ? "配置最多 10 个 Images API，由连续生成自动分配空闲 API。"
                : "先输入 1 个 Key，再自动配置 Responses / Images 并连接验证。"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleGetAPI()}
            style={{
              border: "2px solid #b45309",
              backgroundColor: "#fcd34d",
              color: "#1f2937",
              boxShadow: "0 0 0 1px rgb(180 83 9 / 0.24), 0 4px 14px rgb(180 83 9 / 0.26)",
            }}
            data-fhl-api-choice="get"
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-amber-700 bg-amber-300 p-3 text-left text-zinc-950 shadow-[0_3px_10px_rgb(180_83_9_/_0.22)] ring-1 ring-amber-200 transition-all hover:-translate-y-0.5 hover:border-amber-800 hover:bg-amber-200 hover:shadow-[0_5px_14px_rgb(180_83_9_/_0.32)] dark:border-amber-400 dark:bg-amber-500 dark:ring-amber-300/45 dark:hover:bg-amber-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <ExternalLink className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">获取 API</span>
            <span className="text-[11px] leading-5">复制完整注册链接，并打开 FHL 注册页。</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

