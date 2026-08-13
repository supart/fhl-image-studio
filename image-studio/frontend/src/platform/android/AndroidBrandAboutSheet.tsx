import { ExternalLink, Github } from "lucide-react";
import { Modal } from "../../components/common/Modal";

export const ANDROID_FHL_REPO_URL = "https://github.com/supart/fhl-image-studio";
export const ANDROID_ORIGINAL_REPO_URL = "https://github.com/RoseKhlifa/Image-Studio";
const ANDROID_BRAND_VERSION = "V2.0.3";

export function AndroidBrandAboutSheet({
  open,
  onClose,
  onOpenOriginalRepo,
  onOpenRepo,
}: {
  open: boolean;
  onClose: () => void;
  onOpenOriginalRepo: () => void;
  onOpenRepo: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="关于 FHL Image Studio"
      width={430}
      backdropClassName="android-settings-modal-backdrop"
      cardClassName="android-settings-modal-card"
      headerClassName="android-settings-modal-header"
      bodyClassName="android-settings-modal-body"
    >
      <div className="text-center">
        <img
          src="favicon.png"
          alt=""
          aria-hidden="true"
          className="mx-auto h-14 w-14 rounded-[14px] ring-1 ring-black/10"
        />
        <div className="mt-2 text-[18px] font-bold tracking-[0] text-zinc-900 dark:text-zinc-100">
          FHL Image Studio 方汤圆版
        </div>
        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{ANDROID_BRAND_VERSION}</div>
      </div>

      <div className="mt-4 space-y-2 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>
          这是基于 RoseKhlifa/Image-Studio 的独立修改发行版，保留原作者项目来源，并按 AGPLv3 继续公开源码。
        </p>
        <div className="rounded-[12px] border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
          <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">方汤圆版 GitHub</div>
          <div className="mt-0.5 break-all font-mono-token text-[11px] text-zinc-800 dark:text-zinc-200">
            {ANDROID_FHL_REPO_URL}
          </div>
        </div>
        <div className="rounded-[12px] border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
          <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">原作者 GitHub</div>
          <div className="mt-0.5 break-all font-mono-token text-[11px] text-zinc-800 dark:text-zinc-200">
            {ANDROID_ORIGINAL_REPO_URL}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenRepo}
          className="liquid-primary-button inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[10px] bg-[var(--accent)] px-3 text-[12px] font-semibold text-white"
        >
          <Github className="h-3.5 w-3.5" /> 方汤圆版
        </button>
        <button
          type="button"
          onClick={onOpenOriginalRepo}
          className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-black/[0.08] px-3 text-[12px] font-semibold text-zinc-700 dark:border-white/[0.08] dark:text-zinc-200"
        >
          <ExternalLink className="h-3.5 w-3.5" /> 原作者
        </button>
      </div>
    </Modal>
  );
}
