import { useEffect, useState } from "react";
import {
  Download, Folder, FolderEdit, Github, Info, KeyRound,
  MessageSquare, Monitor, Moon, Network, RotateCw, Sparkles, Sun, Trash2, Upload,
} from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import {
  GetOutputDir, OpenOutputDir, OpenExternalURL, ChooseOutputDir, SetOutputDir,
} from "../../platform/runtime/host";
import type { KernelRuntimeMode, ProxyMode } from "../../types/domain";
import { Modal } from "../common/Modal";
import { platformOutputRootLabel } from "../../platform";
import { androidSaveHint, androidTarget, openExternalURLForPlatform, openOutputLocationForPlatform } from "../../platform/android/bridge";
import { AndroidSettingsPanel } from "../../platform/android/settings/AndroidSettingsPanel";
import { usePlatform } from "../../platform/context";
import { AboutImageStudioModal } from "./AboutImageStudioModal";
import { FHLAPIChoiceModal } from "./FHLAPIChoiceModal";
import { APIMartAPIChoiceModal } from "./APIMartAPIChoiceModal";
import { RunningHubAPIChoiceModal } from "./RunningHubAPIChoiceModal";
import { FHLQuickConfigModal } from "./FHLQuickConfigModal";
import { RunningHubQuickConfigModal } from "./RunningHubQuickConfigModal";
import { SettingsPresetsRow } from "./SettingsPresetsRow";
import { SettingsRow, SettingsSegButton } from "./settingsPrimitives";
import { ensureFHLProfiles, focusFHLAPIKeyInput } from "../../lib/fhlAPI";
import { ensureAPIMartProfile, focusAPIMartAPIKeyInput } from "../../lib/apimartAPI";
import { apiModeRequiresDirectAPIKey } from "../../lib/profiles";

const REPO_URL = "https://github.com/supart/fhl-image-studio";
const ISSUES_URL = "https://github.com/supart/fhl-image-studio/issues";
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    kernelRuntimeMode,
    proxyMode, proxyURL,
    theme, fontScale,
    setField, setAPIKey, setProxyConfig,
    history,
    exportHistory, importHistory,
    pruneHistoryOlderThanDays,
    setTheme, setFontScale,
    pushToast,
    apiKey, baseURL, apiMode,
    profiles, activeProfileId, setActiveProfile,
    openUpstreamConfig, testAPIKey, isTestingKey,
  } = useStudioStore();

  const [outputDir, setOutputDir] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [fhlChoiceOpen, setFHLChoiceOpen] = useState(false);
  const [fhlQuickConfigOpen, setFHLQuickConfigOpen] = useState(false);
  const [apimartChoiceOpen, setAPIMartChoiceOpen] = useState(false);
  const [runningHubChoiceOpen, setRunningHubChoiceOpen] = useState(false);
  const [runningHubQuickConfigOpen, setRunningHubQuickConfigOpen] = useState(false);
  const { usesMacDesktopUI, usesFluentUI, isAndroid, isAndroidPad } = usePlatform();

  useEffect(() => {
    if (!open) return;
    GetOutputDir().then(setOutputDir).catch(() => undefined);
  }, [open]);

  async function configureFHLFromSettings() {
    setFHLChoiceOpen(false);
    setFHLQuickConfigOpen(true);
    return;
    const store = useStudioStore.getState();
    await ensureFHLProfiles(store);
    useStudioStore.getState().pushToast("已切到 FHL 推荐配置，请粘贴自己的 API Key。", "success", 4200);
    useStudioStore.getState().openUpstreamConfig("settings");
    focusFHLAPIKeyInput();
  }

  async function configureAPIMartFromSettings() {
    setAPIMartChoiceOpen(false);
    const store = useStudioStore.getState();
    await ensureAPIMartProfile(store);
    useStudioStore.getState().pushToast("已切到 APIMart 异步配置，请粘贴自己的 API Key。", "success", 4200);
    useStudioStore.getState().openUpstreamConfig("settings");
    focusAPIMartAPIKeyInput();
  }

  function configureRunningHubFromSettings() {
    setRunningHubChoiceOpen(true);
  }

  function useExistingRunningHubFromSettings() {
    setRunningHubChoiceOpen(false);
    setRunningHubQuickConfigOpen(true);
  }

  async function clearAPIKey() {
    if (!confirm("确定清除已保存的 API Key 吗?")) return;
    try {
      await setAPIKey("");
      pushToast("已清除安全存储中的 API Key", "success");
    } catch (e: any) {
      pushToast(`清除失败:${e?.message ?? e}`, "error", 5000);
    }
  }

  async function clearHistory() {
    if (!confirm(`确定清除 ${history.length} 条历史记录吗?(本地数据库也会删除)`)) return;
    for (const h of history) {
      await useStudioStore.getState().deleteHistoryItem(h.id);
    }
  }

  async function pruneHistory(days: number) {
    const removed = await pruneHistoryOlderThanDays(days);
    if (removed > 0) pushToast(`已清理 ${removed} 条 ${days} 天前的历史`, "success");
    else pushToast(`没有 ${days} 天前的历史需要清理`, "info");
  }

  function openOutputLocation() {
    openOutputLocationForPlatform(OpenOutputDir).catch((e) => pushToast(e?.message ?? "无法打开保存位置", "warn"));
  }

  function openExternal(url: string) {
    openExternalURLForPlatform(url, OpenExternalURL).catch(() => undefined);
  }

  function closeSettings() {
    setAboutOpen(false);
    onClose();
  }

  const outputLabel = androidTarget.isAndroid ? platformOutputRootLabel() : (outputDir || "...");
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const upstreamReady = (!apiModeRequiresDirectAPIKey(apiMode) || !!apiKey.trim()) && !!baseURL.trim();

  const androidSettings = isAndroid ? (
    <AndroidSettingsPanel
      activeProfile={activeProfile}
      activeProfileId={activeProfileId}
      apiMode={apiMode}
      clearAPIKey={() => void clearAPIKey()}
      clearHistory={() => void clearHistory()}
      exportHistory={() => void exportHistory()}
      fontScale={fontScale}
      historyCount={history.length}
      importHistory={() => void importHistory()}
      isTestingKey={isTestingKey}
      kernelRuntimeMode={kernelRuntimeMode}
      onOpenAbout={() => setAboutOpen(true)}
      onOpenFeedback={() => openExternal(ISSUES_URL)}
      onOpenRepo={() => openExternal(REPO_URL)}
      onOpenUpstream={() => openUpstreamConfig("settings")}
      onSetActiveProfile={(id) => {
        if (id) void setActiveProfile(id);
      }}
      onSetFontScale={setFontScale}
      onSetKernelRuntimeMode={(value) => setField("kernelRuntimeMode", value)}
      onSetProxyConfig={setProxyConfig}
      onSetTheme={setTheme}
      openOutputLocation={openOutputLocation}
      outputLabel={outputLabel}
      profiles={profiles}
      proxyMode={proxyMode}
      proxyURL={proxyURL}
      pruneHistory={(days) => void pruneHistory(days)}
      surface={isAndroidPad ? "pad" : "phone"}
      testAPIKey={() => void testAPIKey()}
      theme={theme}
      upstreamReady={upstreamReady}
    />
  ) : null;

  return (
    <>
      <Modal
        open={open}
        onClose={closeSettings}
        title="设置"
        width={isAndroidPad ? 1040 : 540}
        backdropClassName={isAndroid ? "android-settings-modal-backdrop" : ""}
        cardClassName={isAndroid ? "android-settings-modal-card" : ""}
        headerClassName={isAndroid ? "android-settings-modal-header" : ""}
        bodyClassName={isAndroid ? "android-settings-modal-body" : ""}
      >
        {androidSettings ?? (
        <div className={`flex flex-col ${androidTarget.isAndroid ? "gap-3" : usesMacDesktopUI ? "gap-4" : "gap-3.5"}`}>
          <div className={`border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 shadow-sm dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-[0]">FHL 推荐配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">Images API standard generations / edits - gpt-image-2</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold text-red-600 dark:text-red-300">不包含 API Key，用户需要粘贴自己的 FHL API Key。</div>
              </div>
              <button
                type="button"
                onClick={() => setFHLChoiceOpen(true)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-amber-500/60 bg-amber-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-amber-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 FHL
              </button>
            </div>
          </div>
          <div className={`border border-violet-300/70 bg-violet-50 px-3 py-2 text-violet-950 shadow-sm dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold tracking-[0]">RH 桥接配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">本地桥接 · 默认 `http://127.0.0.1:8117` · banana2 / image_g2</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold">一次写入桥接 Key，并自动创建两套桌面版 profile。</div>
              </div>
              <button
                type="button"
                onClick={configureRunningHubFromSettings}
                className={`ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 border border-violet-500/60 bg-violet-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-violet-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 RH
              </button>
            </div>
          </div>
          <div className={`border border-sky-300/70 bg-sky-50 px-3 py-2 text-sky-950 shadow-sm dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-[0]">APIMart 异步配置</div>
                <div className="mt-0.5 text-[11px] leading-5 opacity-85">Async API · gpt-image-2 · api.apimart.ai</div>
                <div className="mt-0.5 text-[11px] leading-5 font-semibold text-red-600 dark:text-red-300">不包含 API Key，请粘贴自己的 APIMart API Key。</div>
              </div>
              <button
                type="button"
                onClick={() => setAPIMartChoiceOpen(true)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 border border-sky-500/60 bg-sky-400 px-3 text-[13px] font-bold tracking-[0] text-zinc-950 shadow-sm transition-colors hover:bg-sky-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Sparkles className="h-4 w-4" />
                一键配置 APIMart
              </button>
            </div>
          </div>
          <SettingsRow label="内核执行">
            <select
              value={kernelRuntimeMode}
              onChange={(e) => setField("kernelRuntimeMode", e.target.value as KernelRuntimeMode)}
              className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] px-3 ${usesMacDesktopUI ? "min-h-[44px] py-3 text-[14px]" : "py-2.5 text-[12px]"} text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
            >
              <option value="auto">auto(按宿主自动选择)</option>
              <option value="local">local(桌面 Go/Wails)</option>
              <option value="remote">remote(共享远程内核)</option>
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              桌面可切到 remote 验证与 Android / Worker 是否走同一套共享请求内核
            </p>
          </SettingsRow>

          <SettingsRow label="代理服务器">
            <div className={`platform-seg flex flex-wrap gap-1 bg-black/[0.04] p-0.5 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}>
              {([
                ["none", "不使用"],
                ["system", "系统配置"],
                ["custom", "自定义"],
              ] as Array<[ProxyMode, string]>).map(([value, label]) => (
                <SettingsSegButton key={value} active={proxyMode === value} onClick={() => setProxyConfig(value)}>
                  {value === "custom" ? <Network className="w-3 h-3" /> : null}{label}
                </SettingsSegButton>
              ))}
            </div>
            {proxyMode === "custom" ? (
              <input
                value={proxyURL}
                onChange={(e) => setProxyConfig("custom", e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className={`focus-ring mt-2 w-full border border-black/[0.08] bg-[var(--surface)] px-3 ${usesMacDesktopUI ? "min-h-[42px] py-2.5 text-[13px]" : "py-2.5 text-[12px]"} font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}
              />
            ) : null}
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              默认使用系统配置；自定义地址支持 http:// 和 https://。
            </p>
          </SettingsRow>

          <SettingsRow label={androidTarget.isAndroid ? "保存位置" : "输出目录"}>
            <div className={`flex items-center gap-1 border border-black/[0.08] bg-[var(--surface)] px-3 ${usesMacDesktopUI ? "py-3" : "py-2.5"} dark:border-white/[0.08] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
              <span title={outputDir} className={`flex-1 truncate font-mono-token text-zinc-700 dark:text-zinc-200 ${usesMacDesktopUI ? "text-[13px]" : "text-[12px]"}`}>
                {androidTarget.isAndroid ? platformOutputRootLabel() : (outputDir || "...")}
              </span>
              <button
                onClick={openOutputLocation}
                title={androidTarget.isAndroid ? "打开 Android 保存位置" : "在系统文件管理器中打开"}
                className={`p-1 text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
              >
                <Folder className="w-3.5 h-3.5" />
              </button>
            </div>
            {androidTarget.isAndroid ? (
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">{androidSaveHint()}</p>
            ) : (
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={async () => {
                    try {
                      const chosen = await ChooseOutputDir();
                      if (chosen) {
                        setOutputDir(chosen);
                        pushToast(`输出目录已切换:${chosen}`, "success");
                      }
                    } catch (e: any) {
                      pushToast(`切换失败:${e?.message ?? e}`, "error", 5000);
                    }
                  }}
                  className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 ${usesMacDesktopUI ? "py-2.5 text-[13px]" : "py-2 text-[12px]"} font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <FolderEdit className="w-3 h-3" /> 修改
                </button>
                <button
                  onClick={async () => {
                    try {
                      await SetOutputDir("");
                      const def = await GetOutputDir();
                      setOutputDir(def);
                      pushToast("已恢复默认输出目录", "success");
                    } catch (e: any) {
                      pushToast(`重置失败:${e?.message ?? e}`, "error", 5000);
                    }
                  }}
                  title={`清除自定义路径,回到 ${platformOutputRootLabel()}/images`}
                  className={`inline-flex min-h-[34px] items-center gap-1 border border-black/[0.08] px-3 ${usesMacDesktopUI ? "py-2.5 text-[13px]" : "py-2 text-[12px]"} font-medium text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  <RotateCw className="w-3 h-3" /> 默认
                </button>
              </div>
            )}
          </SettingsRow>

          <SettingsRow label="主题">
            <div className={`platform-seg flex flex-wrap gap-1 bg-black/[0.04] p-0.5 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}>
              <SettingsSegButton active={theme === "system"} onClick={() => setTheme("system")}>
                <Monitor className="w-3 h-3" /> 系统
              </SettingsSegButton>
              <SettingsSegButton active={theme === "dark"} onClick={() => setTheme("dark")}>
                <Moon className="w-3 h-3" /> 深色
              </SettingsSegButton>
              <SettingsSegButton active={theme === "light"} onClick={() => setTheme("light")}>
                <Sun className="w-3 h-3" /> 浅色
              </SettingsSegButton>
            </div>
          </SettingsRow>

          <SettingsRow label={`字号 ${Math.round(fontScale * 100)}%`}>
            <div className={`platform-seg flex flex-wrap gap-1 bg-black/[0.04] p-0.5 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}>
              {[0.85, 1, 1.15].map((v) => (
                <SettingsSegButton key={v} active={Math.abs(fontScale - v) < 0.01} onClick={() => setFontScale(v)}>
                  {v === 0.85 ? "小" : v === 1 ? "中" : "大"}
                </SettingsSegButton>
              ))}
            </div>
          </SettingsRow>

          <SettingsRow label="参数预设">
            <SettingsPresetsRow />
          </SettingsRow>

          {/* 历史 import / export */}
          <div className="flex gap-1.5">
            <button
              onClick={exportHistory}
              title="导出全部历史为 JSON"
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 ${usesMacDesktopUI ? "py-2.5 text-[13px]" : "py-2 text-[12px]"} font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Upload className="w-3 h-3" /> 导出历史
            </button>
            <button
              onClick={importHistory}
              title="从 JSON 文件导入"
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 ${usesMacDesktopUI ? "py-2.5 text-[13px]" : "py-2 text-[12px]"} font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Download className="w-3 h-3" /> 导入历史
            </button>
          </div>

          {/* 危险动作 */}
          <div className="flex gap-1.5">
            <button
              onClick={() => openUpstreamConfig("settings")}
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <KeyRound className="w-3 h-3" /> 管理 API 凭据
            </button>
            <button
              onClick={clearHistory}
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Trash2 className="w-3 h-3" /> 清空历史
            </button>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() => pruneHistory(3)}
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              清理 3 天前
            </button>
            <button
              onClick={() => pruneHistory(7)}
              className={`flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              清理 7 天前
            </button>
          </div>


          <button
            onClick={() => setAboutOpen(true)}
            className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <Info className="w-3 h-3" /> 关于 FHL Studio
          </button>

          <SettingsRow label="支持与反馈">
            <div className="flex gap-1.5">
              <button
                onClick={() => openExternal(REPO_URL)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Github className="w-3 h-3" /> GitHub
              </button>
              <button
                onClick={() => openExternal(ISSUES_URL)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <MessageSquare className="w-3 h-3" /> 反馈
              </button>
            </div>
          </SettingsRow>

        </div>
        )}
      </Modal>

      <AboutImageStudioModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onOpenFeedback={() => openExternal(REPO_URL + "/issues")}
        onOpenLicense={() => openExternal(LICENSE_URL)}
        onOpenRepo={() => openExternal(REPO_URL)}
        licenseURL={LICENSE_URL}
      />
      <FHLAPIChoiceModal
        open={fhlChoiceOpen}
        onClose={() => setFHLChoiceOpen(false)}
        onUseExistingAPI={configureFHLFromSettings}
      />
      <FHLQuickConfigModal
        open={fhlQuickConfigOpen}
        onClose={() => setFHLQuickConfigOpen(false)}
        onOpenUpstream={() => {
          setFHLQuickConfigOpen(false);
          useStudioStore.getState().openUpstreamConfig("settings");
        }}
      />
      <APIMartAPIChoiceModal
        open={apimartChoiceOpen}
        onClose={() => setAPIMartChoiceOpen(false)}
        onUseExistingAPI={configureAPIMartFromSettings}
      />
      <RunningHubAPIChoiceModal
        open={runningHubChoiceOpen}
        onClose={() => setRunningHubChoiceOpen(false)}
        onUseExistingAPI={useExistingRunningHubFromSettings}
      />
      <RunningHubQuickConfigModal
        open={runningHubQuickConfigOpen}
        onClose={() => setRunningHubQuickConfigOpen(false)}
        onOpenUpstream={() => {
          setRunningHubQuickConfigOpen(false);
          useStudioStore.getState().openUpstreamConfig("settings");
        }}
      />
    </>
  );
}
