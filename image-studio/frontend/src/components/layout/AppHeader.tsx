import { type MouseEvent, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clipboard, ExternalLink, Github, KeyRound, Monitor, Moon, Plus, Settings, Star, Sun } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { OpenExternalURL } from "../../platform/runtime/host";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { APIMART_IMAGE_MODEL_ID, apiModeRequiresDirectAPIKey, isAPIMartOfficialBaseURL } from "../../lib/profiles";
import { copyText } from "../../lib/fhlAPI";
import { FHLAPIChoiceModal } from "../panel/FHLAPIChoiceModal";
import { FHLQuickConfigModal } from "../panel/FHLQuickConfigModal";
import { AppHeaderBrand } from "./AppHeaderBrand";
import { HeaderIconBtn, HeaderToggleBtn } from "./headerPrimitives";

const REPO_URL = "https://github.com/RoseKhlifa/Image-Studio";
const FHL_REPO_URL = "https://github.com/supart/fhl-image-studio";
const FHL_QQ_GROUP_TEXT = "FHL官方QQ交流群：207550870";

export function AppHeader({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    fullscreen, theme, setTheme, pushToast, workspaces, newWorkspace, openStarPrompt,
    apiKey, apiMode, baseURL, imageModelID,
  } = useStudioStore();
  const { isAndroid, isMac, usesFluentUI, usesAndroidUI, usesAppleUI } = usePlatform();
  const [fhlChoiceOpen, setFHLChoiceOpen] = useState(false);
  const [fhlQuickConfigOpen, setFHLQuickConfigOpen] = useState(false);
  const [androidConfigRowOpen, setAndroidConfigRowOpen] = useState(false);
  const hasDirectKey = !apiModeRequiresDirectAPIKey(apiMode) || apiKey.trim().length > 0;
  const isFHLAPIConfigured = hasDirectKey && apiMode !== "apimart" && apiMode !== "runninghub";
  const isAPIMartConfigured = apiKey.trim().length > 0
    && apiMode === "apimart"
    && isAPIMartOfficialBaseURL(baseURL)
    && (imageModelID.trim() || APIMART_IMAGE_MODEL_ID) === APIMART_IMAGE_MODEL_ID;
  const isRunningHubConfigured = apiMode === "runninghub" && !!baseURL.trim();
  const isCurrentAPIConfigured = isFHLAPIConfigured || isAPIMartConfigured || isRunningHubConfigured;
  const configuredAPILabel = isAPIMartConfigured
    ? "APIMart 已配置"
    : isRunningHubConfigured
      ? "RunningHub 已配置"
    : apiMode === "images"
      ? "Images API 已配置"
      : "FHL API 已配置";
  const showAndroidConfigRow = usesAndroidUI && (!isCurrentAPIConfigured || androidConfigRowOpen);

  const openFHLAPIConfig = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isCurrentAPIConfigured) {
      useStudioStore.getState().openUpstreamConfig("app");
      return;
    }
    setFHLChoiceOpen(true);
  };

  const useExistingFHLAPI = async () => {
    setFHLChoiceOpen(false);
    setFHLQuickConfigOpen(true);
  };

  const copyFHLQQGroup = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyText(FHL_QQ_GROUP_TEXT);
      pushToast(`已复制：${FHL_QQ_GROUP_TEXT}`, "success", 2800);
    } catch {
      pushToast(`复制失败，请手动复制：${FHL_QQ_GROUP_TEXT}`, "error", 4600);
    }
  };

  const openAttributionURL = (event: MouseEvent<HTMLButtonElement>, url: string) => {
    event.preventDefault();
    event.stopPropagation();
    openExternalURLForPlatform(url, OpenExternalURL).catch(() => pushToast("无法打开浏览器", "error"));
  };

  if (fullscreen) return null;

  if (usesAndroidUI) {
    return (
      <header
        data-audit-area="header"
        className="drag-region app-header sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl android-app-header"
      >
        <div className="min-w-0 flex-1 android-header-copy">
          <AppHeaderBrand />
        </div>

        <div className="no-drag android-header-top-actions">
          {isCurrentAPIConfigured && (
            <button
              type="button"
              data-audit-id="toggle-fhl-config-row"
              className="android-header-config-toggle"
              title={androidConfigRowOpen ? "收起配置按钮" : "展开配置按钮"}
              aria-label={androidConfigRowOpen ? "收起配置按钮" : "展开配置按钮"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setAndroidConfigRowOpen((value) => !value);
              }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {androidConfigRowOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <HeaderIconBtn
            onClick={onOpenSettings}
            title="设置"
            auditId="open-settings"
          >
            <Settings className="h-4 w-4" />
          </HeaderIconBtn>
        </div>

        {showAndroidConfigRow && (
          <div className="no-drag android-header-actions">
            <button
              type="button"
              data-audit-id="copy-qq"
              className="android-header-qq-btn"
              title={FHL_QQ_GROUP_TEXT}
              aria-label={`复制${FHL_QQ_GROUP_TEXT}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={copyFHLQQGroup}
            >
              <Clipboard className="h-3.5 w-3.5" />
              <span>QQ群</span>
            </button>
            <button
              type="button"
              data-audit-id="fhl-config"
              className={`android-header-fhl-config-btn ${isCurrentAPIConfigured ? "is-configured" : "needs-config"}`}
              title={isCurrentAPIConfigured ? `${configuredAPILabel}，点击可修改` : "一键配置 FHL API"}
              aria-label={isCurrentAPIConfigured ? `${configuredAPILabel}，点击可修改` : "一键配置 FHL API"}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={openFHLAPIConfig}
            >
              {isCurrentAPIConfigured ? <Check className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
              <span>{isCurrentAPIConfigured ? (isAPIMartConfigured ? "APIMart" : "已配置") : "一键配置"}</span>
            </button>
          </div>
        )}

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
      </header>
    );
  }

  return (
    <div className="desktop-header-stack sticky top-0 z-40">
      <div
        className={`drag-region flex min-h-[30px] items-center gap-2 border-b border-sky-500/20 bg-sky-50/95 px-4 text-[12px] font-medium text-slate-700 shadow-[0_1px_0_rgb(255_255_255_/_0.72)_inset] backdrop-blur-2xl dark:border-sky-400/20 dark:bg-sky-950/60 dark:text-slate-200 ${
          usesAppleUI ? "liquid-glass-bar" : ""
        }`}
        aria-label="开源项目来源"
      >
        <span className="shrink-0 font-semibold text-sky-700 dark:text-sky-300">开源致谢</span>
        <span className="hidden shrink-0 text-slate-400 dark:text-slate-500 sm:inline">/</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            data-audit-id="open-original-repo"
            className="no-drag inline-flex min-w-0 items-center gap-1 text-sky-700 underline-offset-2 transition-colors hover:text-sky-900 hover:underline dark:text-sky-300 dark:hover:text-sky-100"
            title={`Image-Studio 原作者 RoseKhlifa 项目地址：${REPO_URL}`}
            aria-label="打开 Image-Studio 原作者 RoseKhlifa 项目地址"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => openAttributionURL(event, REPO_URL)}
          >
            <Github className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Image-Studio 原作者 RoseKhlifa</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </button>
          <button
            type="button"
            data-audit-id="open-fhl-repo"
            className="no-drag inline-flex min-w-0 items-center gap-1 text-sky-700 underline-offset-2 transition-colors hover:text-sky-900 hover:underline dark:text-sky-300 dark:hover:text-sky-100"
            title={`方汤圆修改版项目地址：${FHL_REPO_URL}`}
            aria-label="打开方汤圆修改版项目地址"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => openAttributionURL(event, FHL_REPO_URL)}
          >
            <Github className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">方汤圆修改版</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </button>
        </div>
      </div>
      <header
        data-audit-area="header"
        className={`drag-region app-header flex items-center gap-3 border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl ${
          usesAppleUI ? "liquid-glass-bar" : ""
        } ${
          usesAppleUI
            ? `${isMac ? "mac-app-header" : ""} min-h-[64px] px-5 pb-2 pt-3`
            : usesFluentUI
              ? "min-h-[48px] px-3"
              : "min-h-12 px-4"
        }`}
      >
        <div className={`min-w-0 flex-1 ${isMac ? "mac-header-copy" : ""}`}>
          <AppHeaderBrand />
        </div>

        <div className={`no-drag ml-auto flex shrink-0 items-center ${isMac ? "mac-header-actions" : ""} ${usesFluentUI ? "gap-1" : isMac ? "gap-2" : "gap-1.5"}`}>
          <HeaderIconBtn
            onClick={() => newWorkspace()}
            title={workspaces.length > 1 ? `${workspaces.length} 个标签 · 新建` : "新建标签"}
            auditId="new-workspace"
          >
            <Plus className="h-4 w-4" />
            {workspaces.length > 1 && (
              <span className="absolute right-0 top-0 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--accent)] px-[3px] text-[8px] font-semibold leading-none text-white shadow-sm">
                {workspaces.length}
              </span>
            )}
          </HeaderIconBtn>
          <div className={`platform-seg flex items-center p-0.5 ring-1 ${
            usesFluentUI
              ? "bg-white/66 ring-black/[0.08] dark:bg-white/[0.04] dark:ring-white/[0.08]"
              : "rounded-full bg-black/[0.04] ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06]"
          }`}>
            <HeaderToggleBtn
              active={theme === "system"}
              onClick={() => setTheme("system")}
              title="跟随系统"
            >
              <Monitor className="h-3.5 w-3.5" />
            </HeaderToggleBtn>
            <HeaderToggleBtn
              active={theme === "light"}
              onClick={() => setTheme("light")}
              title="浅色外观"
            >
              <Sun className="h-3.5 w-3.5" />
            </HeaderToggleBtn>
            <HeaderToggleBtn
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              title="深色外观"
            >
              <Moon className="h-3.5 w-3.5" />
            </HeaderToggleBtn>
          </div>
          {!isMac && <HeaderIconBtn
            onClick={() => openExternalURLForPlatform(REPO_URL, OpenExternalURL).catch(() => pushToast("无法打开浏览器", "error"))}
            title="GitHub"
          >
            <Github className="h-4 w-4" />
          </HeaderIconBtn>}
          {!isMac && <HeaderIconBtn
            onClick={openStarPrompt}
            title="给项目点个 Star"
          >
            <Star className="h-4 w-4 text-amber-500 dark:text-amber-400" fill="currentColor" strokeWidth={1.5} />
          </HeaderIconBtn>}
          <HeaderIconBtn
            onClick={onOpenSettings}
            title="设置"
            auditId="open-settings"
          >
            <Settings className="h-4 w-4" />
          </HeaderIconBtn>
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
      </header>
    </div>
  );
}
