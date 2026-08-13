import { ExternalLink, ImageIcon, KeyRound, RadioTower } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { copyText, FHL_REGISTER_URL } from "../../lib/fhlAPI";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { OpenExternalURL } from "../../platform/runtime/host";

type FHLAPIShape = "responses" | "images";

export function FHLAPIChoiceModal({
  open,
  onClose,
  onUseExistingAPI,
  onUseImagesAPI,
}: {
  open: boolean;
  onClose: () => void;
  onUseExistingAPI: (shape?: FHLAPIShape) => void | Promise<void>;
  onUseImagesAPI?: () => void | Promise<void>;
}) {
  const { usesFluentUI } = usePlatform();
  const pushToast = useStudioStore((state) => state.pushToast);
  const showShapeChoices = !!onUseImagesAPI;

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

  const roundedClass = usesFluentUI ? "rounded-[10px]" : "rounded-[14px]";

  return (
    <Modal open={open} onClose={onClose} title="配置 FHL API" width={520}>
      <div className="flex flex-col gap-3">
        <div className={`border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${roundedClass}`}>
          <div className="text-[13px] font-semibold tracking-[0]">请选择你的 API 状态</div>
          <div className="mt-1 text-[12px] leading-5">
            一键配置只设置 FHL 接口参数，不包含 API Key。已有 Key 的用户选择接口形态后粘贴自己的 Key；没有 Key 的用户先注册获取。
          </div>
        </div>

        {showShapeChoices ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void onUseExistingAPI("responses")}
                style={{
                  border: "2px solid #2563eb",
                  backgroundColor: "#ffffff",
                  color: "#1d4ed8",
                  boxShadow: "0 0 0 1px rgb(37 99 235 / 0.22), 0 4px 14px rgb(37 99 235 / 0.22)",
                }}
                data-fhl-api-choice="responses"
                className={`flex min-h-[126px] flex-col items-start justify-between border-2 border-blue-600 bg-white p-3 text-left text-blue-700 shadow-[0_3px_10px_rgb(37_99_235_/_0.18)] ring-1 ring-blue-200 transition-all hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-50 hover:shadow-[0_5px_14px_rgb(37_99_235_/_0.28)] dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-200 dark:ring-blue-500/35 dark:hover:bg-blue-950/70 ${roundedClass}`}
              >
                <RadioTower className="h-5 w-5" />
                <span className="text-[16px] font-bold tracking-[0]">Responses API</span>
                <span className="text-[11px] leading-5 opacity-85">推荐长任务，SSE 保活，适合 FHL 默认生图与提示词流程。</span>
              </button>

              <button
                type="button"
                onClick={() => void onUseImagesAPI?.()}
                style={{
                  border: "2px solid #0f766e",
                  backgroundColor: "#ffffff",
                  color: "#0f766e",
                  boxShadow: "0 0 0 1px rgb(15 118 110 / 0.22), 0 4px 14px rgb(15 118 110 / 0.22)",
                }}
                data-fhl-api-choice="images"
                className={`flex min-h-[126px] flex-col items-start justify-between border-2 border-teal-700 bg-white p-3 text-left text-teal-700 shadow-[0_3px_10px_rgb(15_118_110_/_0.18)] ring-1 ring-teal-200 transition-all hover:-translate-y-0.5 hover:border-teal-800 hover:bg-teal-50 hover:shadow-[0_5px_14px_rgb(15_118_110_/_0.28)] dark:border-teal-400 dark:bg-teal-950/45 dark:text-teal-200 dark:ring-teal-500/35 dark:hover:bg-teal-950/70 ${roundedClass}`}
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-[16px] font-bold tracking-[0]">Images API</span>
                <span className="text-[11px] leading-5 opacity-85">兼容标准 generations / edits，适合需要传统 Images 接口的场景。</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleGetAPI()}
              data-fhl-api-choice="get"
              className={`flex min-h-[64px] items-center gap-3 border border-amber-400 bg-amber-100 px-3 text-left text-amber-950 transition-colors hover:bg-amber-200 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30 ${roundedClass}`}
            >
              <ExternalLink className="h-5 w-5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[14px] font-bold tracking-[0]">还没有 API Key</span>
                <span className="block text-[11px] leading-5 opacity-85">复制完整注册链接，并打开 FHL 注册页。</span>
              </span>
            </button>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void onUseExistingAPI("responses")}
              style={{
                border: "2px solid #2563eb",
                backgroundColor: "#ffffff",
                color: "#1d4ed8",
                boxShadow: "0 0 0 1px rgb(37 99 235 / 0.22), 0 4px 14px rgb(37 99 235 / 0.22)",
              }}
              data-fhl-api-choice="existing"
              className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-blue-600 bg-white p-3 text-left text-blue-700 shadow-[0_3px_10px_rgb(37_99_235_/_0.18)] ring-1 ring-blue-200 transition-all hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-50 hover:shadow-[0_5px_14px_rgb(37_99_235_/_0.28)] dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-200 dark:ring-blue-500/35 dark:hover:bg-blue-950/70 ${roundedClass}`}
            >
              <KeyRound className="h-5 w-5" />
              <span className="text-[16px] font-bold tracking-[0]">已有 API</span>
              <span className="text-[11px] leading-5 opacity-85">自动切到 FHL 推荐配置，并移动到 API Key 输入框。</span>
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
              className={`flex min-h-[112px] flex-col items-start justify-between border-2 border-amber-700 bg-amber-300 p-3 text-left text-zinc-950 shadow-[0_3px_10px_rgb(180_83_9_/_0.22)] ring-1 ring-amber-200 transition-all hover:-translate-y-0.5 hover:border-amber-800 hover:bg-amber-200 hover:shadow-[0_5px_14px_rgb(180_83_9_/_0.32)] dark:border-amber-400 dark:bg-amber-500 dark:ring-amber-300/45 dark:hover:bg-amber-400 ${roundedClass}`}
            >
              <ExternalLink className="h-5 w-5" />
              <span className="text-[16px] font-bold tracking-[0]">获取 API</span>
              <span className="text-[11px] leading-5">复制完整注册链接，并打开 FHL 注册页。</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
