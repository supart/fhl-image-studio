import { type MouseEvent, useLayoutEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clipboard, Github, KeyRound, Monitor, Moon, Plus, Settings, Star, Sun } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { OpenExternalURL } from "../../platform/runtime/host";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { copyText } from "../../lib/fhlAPI";
import { isFHLBaseURL, isRunningHubBaseURL, isSelectableGenerationProfile } from "../../lib/profiles";
import { AppHeaderBrand } from "./AppHeaderBrand";
import { HeaderIconBtn, HeaderToggleBtn } from "./headerPrimitives";
import {
  ANDROID_FHL_REPO_URL,
  ANDROID_ORIGINAL_REPO_URL,
  AndroidBrandAboutSheet,
} from "../../platform/android/AndroidBrandAboutSheet";
import { AndroidQuickProfileSheet } from "../../platform/android/AndroidQuickProfileSheet";
import { AndroidFHLTransportModeSwitch } from "../../platform/android/AndroidFHLTransportModeSwitch";
import { fhlTransportLabel, isOfficialFHLGenerationProfile } from "../../lib/providerPolicy";
import { storageKey } from "../../lib/storageNamespace";

const REPO_URL = "https://github.com/RoseKhlifa/Image-Studio";
const FHL_QQ_GROUP_TEXT = "FHL官方QQ交流群：207550870";
const ANDROID_QUICK_SETTINGS_COLLAPSED_KEY = storageKey("gptcodex.androidQuickSettingsCollapsed.v1");

function readAndroidQuickSettingsCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppHeader({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [androidProfileOpen, setAndroidProfileOpen] = useState(false);
  const [androidBrandAboutOpen, setAndroidBrandAboutOpen] = useState(false);
  const [androidQuickSettingsCollapsed, setAndroidQuickSettingsCollapsed] = useState(
    readAndroidQuickSettingsCollapsed,
  );
  const {
    fullscreen, theme, setTheme, pushToast, workspaces, newWorkspace, openStarPrompt,
    apiKey, profiles, activeProfileId, fhlTransportMode, setFHLTransportMode,
  } = useStudioStore();
  const { isAndroid, isMac, usesFluentUI, usesAndroidUI, usesAppleUI } = usePlatform();
  const showAndroidConfigRow = usesAndroidUI;
  const generationProfiles = profiles.filter(isSelectableGenerationProfile);
  const hasMultipleProfiles = generationProfiles.length > 1;
  const activeProfile = generationProfiles.find((profile) => profile.id === activeProfileId)
    ?? generationProfiles[0]
    ?? null;
  const activeProfileUsesBridgeKey = activeProfile?.apiMode === "runninghub"
    || (activeProfile ? isRunningHubBaseURL(activeProfile.baseURL) : false);
  const hasConfiguredAPIKey = apiKey.trim().length > 0 || activeProfileUsesBridgeKey;
  const activeProfileModeLabel = activeProfile?.apiMode === "apimart"
    ? "APIMart"
    : activeProfile?.apiMode === "runninghub"
      ? "RH"
    : activeProfile && isOfficialFHLGenerationProfile(activeProfile)
      ? fhlTransportLabel(fhlTransportMode)
      : activeProfile && isFHLBaseURL(activeProfile.baseURL) && activeProfile.apiMode === "responses"
        ? "Responses API"
      : activeProfile?.apiMode === "responses"
        ? "Responses API"
      : activeProfile?.apiMode === "images"
        ? "Images API"
        : "API";
  const androidQuickSettingsToggleLabel = androidQuickSettingsCollapsed
    ? "展开快速设置"
    : "折叠快速设置";

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!usesAndroidUI || fullscreen) {
      delete root.dataset.androidQuickSettings;
      return;
    }
    root.dataset.androidQuickSettings = androidQuickSettingsCollapsed ? "collapsed" : "expanded";
    return () => {
      delete root.dataset.androidQuickSettings;
    };
  }, [androidQuickSettingsCollapsed, fullscreen, usesAndroidUI]);

  const handleFHLTransportModeChange = (mode: "images" | "responses") => {
    if (mode === fhlTransportMode) return;
    setFHLTransportMode(mode);
  };

  const toggleAndroidQuickSettings = () => {
    const next = !androidQuickSettingsCollapsed;
    setAndroidQuickSettingsCollapsed(next);
    try {
      if (next) localStorage.setItem(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY, "1");
      else localStorage.removeItem(ANDROID_QUICK_SETTINGS_COLLAPSED_KEY);
    } catch {
      // Keep the in-memory preference when WebView storage is unavailable.
    }
  };

  const openFHLAPIConfig = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useStudioStore.getState().openUpstreamConfig("app");
  };

  const openAndroidProfilePicker = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (hasMultipleProfiles) {
      setAndroidProfileOpen(true);
      return;
    }
    useStudioStore.getState().openUpstreamConfig("app");
  };

  const openAndroidBrandAbout = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAndroidBrandAboutOpen(true);
  };

  const openAndroidExternal = (url: string) => {
    openExternalURLForPlatform(url, OpenExternalURL).catch(() => {
      pushToast("无法打开浏览器，请稍后重试", "error", 4200);
    });
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

  if (fullscreen) return null;

  if (usesAndroidUI) {
    return (
      <>
        <header
          data-audit-area="header"
          className="drag-region app-header sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--toolbar)] android-app-header"
        >
          <button
            type="button"
            className="no-drag min-w-0 flex-1 android-header-copy android-header-brand-button"
            title="关于 FHL Image Studio"
            aria-label="关于 FHL Image Studio"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={openAndroidBrandAbout}
          >
            <AppHeaderBrand />
          </button>

          <div className="no-drag android-header-top-actions">
            <button
              type="button"
              data-audit-id="toggle-android-quick-settings"
              className="android-header-quick-settings-toggle platform-icon-btn no-drag relative flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-[var(--surface)] text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-zinc-400"
              title={androidQuickSettingsToggleLabel}
              aria-label={androidQuickSettingsToggleLabel}
              aria-expanded={!androidQuickSettingsCollapsed}
              aria-controls="android-header-quick-settings"
              onClick={toggleAndroidQuickSettings}
            >
              {androidQuickSettingsCollapsed
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronUp className="h-4 w-4" />}
            </button>
            <HeaderIconBtn
              onClick={onOpenSettings}
              title="设置"
              auditId="open-settings"
            >
              <Settings className="h-4 w-4" />
            </HeaderIconBtn>
          </div>

          {showAndroidConfigRow && !androidQuickSettingsCollapsed && (
            <div id="android-header-quick-settings" className="no-drag android-header-actions">
              <AndroidFHLTransportModeSwitch
                mode={fhlTransportMode}
                onChange={handleFHLTransportModeChange}
              />
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
                className={`android-header-fhl-config-btn ${hasConfiguredAPIKey ? "is-configured" : "needs-config"}`}
                title={hasConfiguredAPIKey ? "API 已配置，点击可修改" : "一键配置 API"}
                aria-label={hasConfiguredAPIKey ? "API 已配置，点击可修改" : "一键配置 API"}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={openFHLAPIConfig}
              >
                {hasConfiguredAPIKey ? <Check className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                <span>{hasConfiguredAPIKey ? "已配置" : "一键配置"}</span>
              </button>
              <button
                type="button"
                data-audit-id="android-quick-profile"
                className={`android-header-api-chip ${hasMultipleProfiles ? "has-menu" : ""}`}
                title={activeProfile ? `当前 API：${activeProfile.name || activeProfileModeLabel}${hasMultipleProfiles ? "，点击切换" : ""}` : "选择当前 API"}
                aria-label={hasMultipleProfiles ? "选择当前 API" : "当前 API"}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={openAndroidProfilePicker}
              >
                <span>{activeProfileModeLabel}</span>
                {hasMultipleProfiles ? <ChevronDown className="h-3 w-3" /> : null}
              </button>
              <button
                type="button"
                data-audit-id="open-upstream-config"
                className="android-header-config-toggle"
                title="管理上游配置"
                aria-label="管理上游配置"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={openFHLAPIConfig}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        </header>
        <AndroidQuickProfileSheet open={androidProfileOpen} onClose={() => setAndroidProfileOpen(false)} />
        <AndroidBrandAboutSheet
          open={androidBrandAboutOpen}
          onClose={() => setAndroidBrandAboutOpen(false)}
          onOpenRepo={() => openAndroidExternal(ANDROID_FHL_REPO_URL)}
          onOpenOriginalRepo={() => openAndroidExternal(ANDROID_ORIGINAL_REPO_URL)}
        />
      </>
    );
  }

  return (
    <header
      data-audit-area="header"
      className={`drag-region app-header sticky top-0 z-40 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl ${
        usesAppleUI ? "liquid-glass-bar" : ""
      } ${
        usesAndroidUI
          ? "android-app-header"
          :
        usesAppleUI
          ? `${isMac ? "mac-app-header" : ""} min-h-[64px] px-5 pb-2 pt-3`
          : usesFluentUI
            ? "min-h-[48px] px-3"
            : "min-h-12 px-4"
      }`}
    >
      <div className={`min-w-0 flex-1 ${usesAndroidUI ? "android-header-copy" : ""} ${isMac ? "mac-header-copy" : ""}`}>
        <AppHeaderBrand />
      </div>

      <div className={`no-drag ml-auto flex items-center shrink-0 ${usesAndroidUI ? "android-header-actions" : ""} ${isMac ? "mac-header-actions" : ""} ${usesFluentUI ? "gap-1" : isMac ? "gap-2" : "gap-1.5"}`}>
        {usesAndroidUI && (
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
        )}
        {usesAndroidUI && (
          <button
            type="button"
            data-audit-id="fhl-config"
            className={`android-header-fhl-config-btn ${hasConfiguredAPIKey ? "is-configured" : "needs-config"}`}
            title={hasConfiguredAPIKey ? "API 已配置，点击可修改" : "一键配置 API"}
            aria-label={hasConfiguredAPIKey ? "API 已配置，点击可修改" : "一键配置 API"}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={openFHLAPIConfig}
          >
            {hasConfiguredAPIKey ? <Check className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
            <span>{hasConfiguredAPIKey ? "已配置" : "一键配置"}</span>
          </button>
        )}
        {!isAndroid && <HeaderIconBtn
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
        </HeaderIconBtn>}
        {!isAndroid && <div className={`platform-seg flex items-center p-0.5 ring-1 ${
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
        </div>}
        {!isAndroid && !isMac && <HeaderIconBtn
          onClick={() => openExternalURLForPlatform(REPO_URL, OpenExternalURL).catch(() => pushToast("无法打开浏览器", "error"))}
          title="GitHub"
        >
          <Github className="h-4 w-4" />
        </HeaderIconBtn>}
        {!isAndroid && !isMac && <HeaderIconBtn
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
    </header>
  );
}
