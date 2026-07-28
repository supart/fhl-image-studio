import { type MouseEvent, useState } from "react";
import { Check, Clipboard, ExternalLink, KeyRound } from "lucide-react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import { hasUsableFHLConfiguration } from "../../lib/profiles";
import { FHLQuickConfigModal } from "../panel/FHLQuickConfigModal";
import { FHLAPIChoiceModal } from "../panel/FHLAPIChoiceModal";
import { HitokotoStrip } from "./HitokotoStrip";
import { FHLTransportToggle } from "./FHLTransportToggle";
import { FHL_INVITE_CODE, FHL_REGISTER_URL } from "../../lib/fhlAPI";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { OpenExternalURL } from "../../platform/runtime/host";

const BRAND_TITLE = "FHL Image Studio 方汤圆版";
const BRAND_VERSION = "V2.0.3.1";
const HEADER_LOGO_SRC = "favicon.png";
const FHL_QQ_GROUP = "207550870";
const FHL_QQ_PROMO = `FHL官方QQ交流群:${FHL_QQ_GROUP} 进群免费获取GPT image2生图福利！`;
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

  if (!copied) {
    throw new Error("Copy command was blocked");
  }
}

export function AppHeaderBrand() {
  const { isAndroidPhone, isAndroidPad, usesFluentUI, usesMacDesktopUI, usesWindowsDesktopUI, usesAndroidUI } = usePlatform();
  const profiles = useStudioStore((state) => state.profiles);
  const apiKey = useStudioStore((state) => state.apiKey);
  const apiMode = useStudioStore((state) => state.apiMode);
  const baseURL = useStudioStore((state) => state.baseURL);
  const fhlTransportMode = useStudioStore((state) => state.fhlTransportMode);
  const setFHLTransportMode = useStudioStore((state) => state.setFHLTransportMode);
  const [copiedGroup, setCopiedGroup] = useState(false);
  const [copiedRegisterURL, setCopiedRegisterURL] = useState(false);
  const [fhlChoiceOpen, setFHLChoiceOpen] = useState(false);
  const [fhlQuickConfigOpen, setFHLQuickConfigOpen] = useState(false);
  const hasFHLConfiguration = hasUsableFHLConfiguration({
    apiKey,
    apiMode,
    baseURL,
    profiles,
  });
  const shouldPulseConfigButton = !hasFHLConfiguration;

  const copyQQGroup = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCopiedGroup(true);
    window.setTimeout(() => setCopiedGroup(false), 1400);
    try {
      await copyText(FHL_QQ_GROUP);
    } catch {
      // Some embedded browsers block clipboard access.
    }
  };

  const copyAndOpenRegister = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    let opened = false;
    try {
      await openExternalURLForPlatform(FHL_REGISTER_URL, OpenExternalURL);
      opened = true;
    } catch {
      opened = false;
    }
    setCopiedRegisterURL(true);
    window.setTimeout(() => setCopiedRegisterURL(false), 1400);
    try {
      await copyText(FHL_REGISTER_URL);
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

  const openFHLAPIConfig = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (hasFHLConfiguration) {
      useStudioStore.getState().openUpstreamConfig("app");
      return;
    }
    setFHLChoiceOpen(true);
  };

  const useExistingFHLAPI = async () => {
    setFHLChoiceOpen(false);
    setFHLQuickConfigOpen(true);
  };

  if (usesAndroidUI) {
    return (
      <>
        <div
          className={`android-header-title text-zinc-900 dark:text-zinc-100 ${
            isAndroidPhone
              ? "text-[15px] font-bold tracking-[0]"
              : isAndroidPad
                ? "text-[18px] font-bold tracking-[0]"
                : usesFluentUI
                  ? "text-[16px] font-bold tracking-[0]"
                  : "text-[16px] font-bold tracking-[0]"
          }`}
          style={{ fontFamily: "var(--title-font)" }}
        >
          <img className="android-header-logo" src={HEADER_LOGO_SRC} alt="" aria-hidden="true" />
          <span className="android-header-title-main">{BRAND_TITLE}</span>
          <span className="android-header-version">{BRAND_VERSION}</span>
        </div>
        {!isAndroidPhone ? (
          <div className="android-header-subtitle mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            <span className="truncate">{isAndroidPad ? "自适应大屏工作区" : "移动创作工作区"}</span>
          </div>
        ) : null}
      </>
    );
  }

  if (usesWindowsDesktopUI) {
    return (
      <>
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            className="h-11 w-11 shrink-0 rounded-[10px] object-cover shadow-[0_4px_12px_rgb(15_23_42_/_0.16)]"
            src={HEADER_LOGO_SRC}
            alt=""
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="shrink-0 truncate text-[14px] font-[600] tracking-[0] text-zinc-900 dark:text-zinc-100"
                style={{ fontFamily: "var(--title-font)" }}
                title={BRAND_TITLE}
              >
                {BRAND_TITLE}
              </div>
              <span
                className="shrink-0 text-[10px] font-[600] leading-none tracking-[0] text-zinc-400 dark:text-zinc-500"
                title={BRAND_VERSION}
                aria-label={`版本 ${BRAND_VERSION}`}
              >
                {BRAND_VERSION}
              </span>
              <div
                className="min-w-0 truncate text-[11px] font-[500] tracking-[0] text-[var(--accent)]"
                title={FHL_QQ_PROMO}
              >
                {FHL_QQ_PROMO}
              </div>
              <button
                type="button"
                data-audit-id="copy-qq"
                className="no-drag inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-red-500/45 bg-red-500/10 px-1.5 text-[11px] font-semibold tracking-[0] text-red-500 transition-colors hover:border-red-500 hover:bg-red-500/15 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-400 dark:hover:bg-red-400/15"
                title={copiedGroup ? "已复制群号" : `复制QQ群号 ${FHL_QQ_GROUP}`}
                aria-label={copiedGroup ? "已复制QQ群号" : `复制QQ群号 ${FHL_QQ_GROUP}`}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={copyQQGroup}
              >
                {copiedGroup ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
                <span className="whitespace-nowrap">{copiedGroup ? "已复制" : "复制群号"}</span>
              </button>
              <button
                type="button"
                data-audit-id="register-fhl"
                className="no-drag inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[6px] border border-sky-500/45 bg-sky-500/10 px-1.5 text-[11px] font-semibold tracking-[0] text-sky-600 transition-colors hover:border-sky-500 hover:bg-sky-500/15 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:bg-sky-400/15"
                title={copiedRegisterURL ? "已复制完整注册链接，可粘贴到浏览器打开" : `复制完整注册链接并打开 ${FHL_REGISTER_URL}`}
                aria-label={copiedRegisterURL ? "已复制注册链接，可粘贴到浏览器打开" : "复制注册链接并打开注册页"}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={copyAndOpenRegister}
              >
                {copiedRegisterURL ? <Check className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                <span className="whitespace-nowrap">
                  {copiedRegisterURL ? "已复制，可粘贴" : `注册FHL 方汤圆邀请码:${FHL_INVITE_CODE}`}
                </span>
              </button>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              <button
                type="button"
                data-audit-id="fhl-config"
                className={`fhl-api-config-btn ${shouldPulseConfigButton ? "needs-config" : "is-configured"} no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border px-2.5 text-[14px] font-bold tracking-[0] transition-colors`}
                title={hasFHLConfiguration ? "修改统一 FHL 配置" : "一键配置 FHL API"}
                aria-label={hasFHLConfiguration ? "修改统一 FHL 配置" : "一键配置 FHL API"}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={openFHLAPIConfig}
              >
                {hasFHLConfiguration ? <Check className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                <span className="whitespace-nowrap">{hasFHLConfiguration ? "FHL API 配置" : "一键配置 FHL API"}</span>
              </button>
              <FHLTransportToggle mode={fhlTransportMode} onChange={setFHLTransportMode} />
              <div className="min-w-0 flex-1">
                <HitokotoStrip />
              </div>
            </div>
          </div>
        </div>
        <FHLAPIChoiceModal
          open={fhlChoiceOpen}
          onClose={() => setFHLChoiceOpen(false)}
          onUseExistingAPI={useExistingFHLAPI}
        />
        <FHLQuickConfigModal
          open={fhlQuickConfigOpen}
          onClose={() => setFHLQuickConfigOpen(false)}
          onOpenUpstream={() => {
            setFHLQuickConfigOpen(false);
            useStudioStore.getState().openUpstreamConfig("app");
          }}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className={`inline-flex shrink-0 items-center justify-center border border-white/44 bg-white/70 text-[var(--accent)] shadow-[0_12px_32px_rgb(15_23_42_/_0.12)] dark:border-white/10 dark:bg-white/[0.06] ${usesFluentUI ? "h-8 w-8 rounded-[10px]" : usesMacDesktopUI ? "h-10 w-10 rounded-[14px]" : "h-10 w-10 rounded-[13px]"}`}>
        <img
          className={`object-cover ${usesFluentUI ? "h-7 w-7 rounded-[9px]" : "h-9 w-9 rounded-[12px]"}`}
          src={HEADER_LOGO_SRC}
          alt=""
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <div
            className={`android-header-title truncate text-zinc-900 dark:text-zinc-100 ${
              usesFluentUI
                ? "font-[600] text-[14px] tracking-[0]"
                : usesMacDesktopUI
                  ? "text-[16px] font-semibold tracking-[0]"
                  : "text-[16px] font-semibold tracking-[0]"
            }`}
            style={{ fontFamily: "var(--title-font)" }}
            title={BRAND_TITLE}
          >
            {BRAND_TITLE}
          </div>
          <span
            className="shrink-0 text-[10px] font-[600] leading-none tracking-[0] text-zinc-400 dark:text-zinc-500"
            title={BRAND_VERSION}
            aria-label={`版本 ${BRAND_VERSION}`}
          >
            {BRAND_VERSION}
          </span>
        </div>
        {usesMacDesktopUI ? (
          <div className="mt-1 truncate text-[12px] leading-none text-zinc-500 dark:text-zinc-400">
            图像工作区
          </div>
        ) : (
          <div className={`flex min-w-0 items-center text-zinc-500 dark:text-zinc-400 ${usesFluentUI ? "mt-0 text-[10px]" : "mt-0.5 text-[11px]"}`}>
            <HitokotoStrip />
          </div>
        )}
      </div>
    </div>
  );
}
