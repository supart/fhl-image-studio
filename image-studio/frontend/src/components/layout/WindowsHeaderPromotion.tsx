import { type MouseEvent, useState } from "react";
import { Check, Clipboard, ExternalLink } from "lucide-react";
import type { HeaderPromotionConfig } from "../../lib/headerPromotion";
import { OpenExternalURL } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy path below in restricted browser shells.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    input.remove();
  }

  if (!copied) throw new Error("Copy command was blocked");
}

export function WindowsHeaderPromotion({ config }: { config: HeaderPromotionConfig }) {
  const [copiedGroup, setCopiedGroup] = useState(false);
  const [copiedRegisterURL, setCopiedRegisterURL] = useState(false);
  const showRegistration = Boolean(config.registrationText && config.registrationURL);

  if (!config.announcement && !config.groupNumber && !showRegistration) return null;

  const copyQQGroup = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCopiedGroup(true);
    window.setTimeout(() => setCopiedGroup(false), 1400);
    try {
      await copyText(config.groupNumber);
    } catch {
      // Some embedded browsers block clipboard access.
    }
  };

  const copyAndOpenRegister = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    let opened = false;
    try {
      await OpenExternalURL(config.registrationURL);
      opened = true;
    } catch {
      opened = false;
    }
    setCopiedRegisterURL(true);
    window.setTimeout(() => setCopiedRegisterURL(false), 1400);
    try {
      await copyText(config.registrationURL);
      useStudioStore.getState().pushToast(
        opened
          ? "注册链接已复制，已尝试打开注册页"
          : "注册链接已复制；如果没有自动打开，请粘贴到浏览器地址栏",
        opened ? "success" : "warn",
        5200,
      );
    } catch {
      useStudioStore.getState().pushToast(
        opened
          ? "已尝试打开注册页，但当前环境拒绝复制链接"
          : "浏览器未自动打开，当前环境也拒绝复制链接",
        opened ? "warn" : "error",
        6000,
      );
    }
  };

  return (
    <>
      {config.announcement ? (
        <div
          className="windows-header-promo min-w-0 truncate text-[11px] font-[500] tracking-[0] text-[var(--accent)]"
          title={config.announcement}
        >
          {config.announcement}
        </div>
      ) : null}
      {config.groupNumber ? (
        <button
          type="button"
          data-audit-id="copy-qq"
          className="no-drag inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-red-500/45 bg-red-500/10 px-1.5 text-[11px] font-semibold tracking-[0] text-red-500 transition-colors hover:border-red-500 hover:bg-red-500/15 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-400 dark:hover:bg-red-400/15"
          title={copiedGroup ? "已复制群号" : `复制QQ群号 ${config.groupNumber}`}
          aria-label={copiedGroup ? "已复制QQ群号" : `复制QQ群号 ${config.groupNumber}`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={copyQQGroup}
        >
          {copiedGroup ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
          <span className="whitespace-nowrap">{copiedGroup ? "已复制" : "复制群号"}</span>
        </button>
      ) : null}
      {showRegistration ? (
        <button
          type="button"
          data-audit-id="register-fhl"
          className="no-drag inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-sky-500/45 bg-sky-500/10 px-1.5 text-[11px] font-semibold tracking-[0] text-sky-600 transition-colors hover:border-sky-500 hover:bg-sky-500/15 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:bg-sky-400/15"
          title={copiedRegisterURL ? "已复制完整注册链接，可粘贴到浏览器打开" : `复制完整注册链接并打开 ${config.registrationURL}`}
          aria-label={copiedRegisterURL ? "已复制注册链接，可粘贴到浏览器打开" : "复制注册链接并打开注册页"}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={copyAndOpenRegister}
        >
          {copiedRegisterURL ? <Check className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
          <span className="whitespace-nowrap">{copiedRegisterURL ? "已复制，可粘贴" : config.registrationText}</span>
        </button>
      ) : null}
    </>
  );
}
