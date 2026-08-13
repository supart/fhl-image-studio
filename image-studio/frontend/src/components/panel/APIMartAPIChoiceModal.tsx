import { ExternalLink, KeyRound } from "lucide-react";
import { APIMART_REGISTER_URL } from "../../lib/apimartAPI";
import { copyText } from "../../lib/fhlAPI";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { usePlatform } from "../../platform/context";
import { OpenExternalURL } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";
import { Modal } from "../common/Modal";

export function APIMartAPIChoiceModal({
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
      await openExternalURLForPlatform(APIMART_REGISTER_URL, OpenExternalURL);
      opened = true;
    } catch {
      opened = false;
    }
    try {
      await copyText(APIMART_REGISTER_URL);
      pushToast(
        opened
          ? "APIMart 注册链接已复制，已尝试打开注册页。"
          : "APIMart 注册链接已复制；如果没有自动打开，请粘贴到浏览器地址栏。",
        opened ? "success" : "warn",
        5200,
      );
    } catch {
      pushToast(
        opened
          ? "已尝试打开 APIMart 注册页，但当前环境拒绝复制链接。"
          : "浏览器未自动打开，当前环境也拒绝复制链接。",
        opened ? "warn" : "error",
        6000,
      );
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="配置 APIMart API" width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <div className="text-[13px] font-semibold tracking-[0]">请选择你的 API 状态</div>
          <div className="mt-1 text-[12px] leading-5">
            一键配置只设置 APIMart 异步接口参数，不包含 API Key。已有 Key 的用户直接去输入框粘贴；没有 Key 的用户先注册获取。
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
            data-apimart-api-choice="existing"
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-blue-600 bg-white p-3 text-left text-blue-700 shadow-[0_3px_10px_rgb(37_99_235_/_0.18)] ring-1 ring-blue-200 transition-all hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-50 hover:shadow-[0_5px_14px_rgb(37_99_235_/_0.28)] dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-200 dark:ring-blue-500/35 dark:hover:bg-blue-950/70 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">已有 API</span>
            <span className="text-[11px] leading-5 opacity-85">自动切到 APIMart 推荐配置，并移动到 API Key 输入框。</span>
          </button>

          <button
            type="button"
            onClick={() => void handleGetAPI()}
            style={{
              border: "2px solid #0369a1",
              backgroundColor: "#7dd3fc",
              color: "#0f172a",
              boxShadow: "0 0 0 1px rgb(3 105 161 / 0.24), 0 4px 14px rgb(3 105 161 / 0.26)",
            }}
            data-apimart-api-choice="get"
            className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-sky-700 bg-sky-300 p-3 text-left text-zinc-950 shadow-[0_3px_10px_rgb(3_105_161_/_0.22)] ring-1 ring-sky-200 transition-all hover:-translate-y-0.5 hover:border-sky-800 hover:bg-sky-200 hover:shadow-[0_5px_14px_rgb(3_105_161_/_0.32)] dark:border-sky-400 dark:bg-sky-500 dark:ring-sky-300/45 dark:hover:bg-sky-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          >
            <ExternalLink className="h-5 w-5" />
            <span className="text-[16px] font-bold tracking-[0]">获取 API</span>
            <span className="text-[11px] leading-5">复制完整注册链接，并打开 APIMart 注册页。</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
