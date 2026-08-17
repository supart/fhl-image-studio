import { type MouseEvent, useEffect, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import { hasUsableFHLConfiguration } from "../../lib/profiles";
import { FHLQuickConfigModal } from "../panel/FHLQuickConfigModal";
import { FHLAPIChoiceModal } from "../panel/FHLAPIChoiceModal";
import { HitokotoStrip } from "./HitokotoStrip";
import { FHLTransportToggle } from "./FHLTransportToggle";
import { appVersion } from "../../lib/version";
import {
  EMPTY_HEADER_PROMOTION_CONFIG,
  loadHeaderPromotionConfig,
  type HeaderPromotionConfig,
} from "../../lib/headerPromotion";
import { WindowsHeaderPromotion } from "./WindowsHeaderPromotion";

const BRAND_TITLE = "FHL Image Studio 方汤圆版";
const BRAND_VERSION = `V${appVersion}`;
const HEADER_LOGO_SRC = "favicon.png";

export function AppHeaderBrand() {
  const { isAndroidPhone, isAndroidPad, usesFluentUI, isMac, isWindows, usesAndroidUI } = usePlatform();
  const profiles = useStudioStore((state) => state.profiles);
  const apiKey = useStudioStore((state) => state.apiKey);
  const apiMode = useStudioStore((state) => state.apiMode);
  const baseURL = useStudioStore((state) => state.baseURL);
  const fhlTransportMode = useStudioStore((state) => state.fhlTransportMode);
  const setFHLTransportMode = useStudioStore((state) => state.setFHLTransportMode);
  const [headerPromotion, setHeaderPromotion] = useState<HeaderPromotionConfig>(EMPTY_HEADER_PROMOTION_CONFIG);
  const [fhlChoiceOpen, setFHLChoiceOpen] = useState(false);
  const [fhlQuickConfigOpen, setFHLQuickConfigOpen] = useState(false);
  const hasFHLConfiguration = hasUsableFHLConfiguration({
    apiKey,
    apiMode,
    baseURL,
    profiles,
  });
  const shouldPulseConfigButton = !hasFHLConfiguration;

  useEffect(() => {
    let active = true;
    if (!isWindows) {
      setHeaderPromotion(EMPTY_HEADER_PROMOTION_CONFIG);
      return () => { active = false; };
    }
    void loadHeaderPromotionConfig().then((config) => {
      if (active) setHeaderPromotion(config);
    });
    return () => { active = false; };
  }, [isWindows]);

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

  if (isWindows) {
    return (
      <>
        <div className="windows-header-brand flex min-w-0 items-center gap-2.5">
          <img
            className="windows-header-logo h-11 w-11 shrink-0 rounded-[10px] object-cover shadow-[0_4px_12px_rgb(15_23_42_/_0.16)]"
            src={HEADER_LOGO_SRC}
            alt=""
            aria-hidden="true"
          />
          <div className="windows-header-content flex min-w-0 flex-1 flex-col gap-1">
            <div className="windows-header-primary-row flex min-w-0 items-center gap-2">
              <div
                className="windows-header-title shrink-0 truncate text-[14px] font-[600] tracking-[0] text-zinc-900 dark:text-zinc-100"
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
              <WindowsHeaderPromotion config={headerPromotion} />
            </div>
            <div className="windows-header-secondary-row flex min-w-0 items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
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
              <div className="windows-header-transport">
                <FHLTransportToggle mode={fhlTransportMode} onChange={setFHLTransportMode} />
              </div>
              <div className="windows-header-hitokoto min-w-0 flex-1">
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
      <span className={`inline-flex shrink-0 items-center justify-center border border-white/44 bg-white/70 text-[var(--accent)] shadow-[0_12px_32px_rgb(15_23_42_/_0.12)] dark:border-white/10 dark:bg-white/[0.06] ${usesFluentUI ? "h-8 w-8 rounded-[10px]" : isMac ? "h-10 w-10 rounded-[14px]" : "h-10 w-10 rounded-[13px]"}`}>
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
                : isMac
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
        {isMac ? (
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
