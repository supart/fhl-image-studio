import type {
  KernelRuntimeMode,
  OutputFormatValue,
  ProxyMode,
  ThemeMode,
} from "../types/domain.ts";
import { storageKey } from "../lib/storageNamespace.ts";
import type { StudioState } from "./studioStore.types.ts";

export type ApplicationSettings = Pick<
  StudioState,
  "theme" | "fontScale" | "kernelRuntimeMode" | "outputFormat" | "proxyMode" | "proxyURL"
>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState>) => void;
};

export type SettingsRuntime = {
  storage?: StorageLike;
  applyTheme: (theme: ThemeMode) => void;
  applyFontScale: (fontScale: number) => void;
  setKernelRuntimeMode: (mode: KernelRuntimeMode) => void;
};

export const APPLICATION_SETTINGS_DEFAULTS: Readonly<ApplicationSettings> = Object.freeze({
  theme: "system",
  fontScale: 1,
  kernelRuntimeMode: "auto",
  outputFormat: "png",
  proxyMode: "system",
  proxyURL: "",
});

export const APPLICATION_SETTING_STORAGE_KEYS = Object.freeze({
  theme: storageKey("gptcodex.theme"),
  fontScale: storageKey("gptcodex.fontScale"),
  kernelRuntimeMode: storageKey("gptcodex.kernelRuntimeMode"),
  outputFormat: storageKey("gptcodex.outputFormat"),
  proxyMode: storageKey("gptcodex.proxyMode"),
  proxyURL: storageKey("gptcodex.proxyURL"),
});

export const APPLICATION_SETTING_DEFAULT_STORAGE_VALUES = [
  [APPLICATION_SETTING_STORAGE_KEYS.theme, APPLICATION_SETTINGS_DEFAULTS.theme],
  [APPLICATION_SETTING_STORAGE_KEYS.fontScale, String(APPLICATION_SETTINGS_DEFAULTS.fontScale)],
  [APPLICATION_SETTING_STORAGE_KEYS.kernelRuntimeMode, APPLICATION_SETTINGS_DEFAULTS.kernelRuntimeMode],
  [APPLICATION_SETTING_STORAGE_KEYS.outputFormat, APPLICATION_SETTINGS_DEFAULTS.outputFormat],
  [APPLICATION_SETTING_STORAGE_KEYS.proxyMode, APPLICATION_SETTINGS_DEFAULTS.proxyMode],
  [APPLICATION_SETTING_STORAGE_KEYS.proxyURL, APPLICATION_SETTINGS_DEFAULTS.proxyURL],
] as const;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

function readStorageValue(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isKernelRuntimeMode(value: unknown): value is KernelRuntimeMode {
  return value === "auto" || value === "local" || value === "remote";
}

function isOutputFormat(value: unknown): value is OutputFormatValue {
  return value === "png" || value === "jpeg" || value === "webp";
}

export function normalizeProxyMode(value: unknown): ProxyMode {
  return value === "none" || value === "custom" || value === "system" ? value : "system";
}

export function loadApplicationSettings(storage?: StorageLike): ApplicationSettings {
  const source = resolveStorage(storage);
  const themeValue = readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.theme);
  const fontScaleValue = Number(readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.fontScale));
  const kernelRuntimeModeValue = readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.kernelRuntimeMode);
  const outputFormatValue = readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.outputFormat);
  const proxyModeValue = readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.proxyMode);
  const proxyURLValue = readStorageValue(source, APPLICATION_SETTING_STORAGE_KEYS.proxyURL);

  return {
    theme: isThemeMode(themeValue) ? themeValue : APPLICATION_SETTINGS_DEFAULTS.theme,
    fontScale: Number.isFinite(fontScaleValue) && fontScaleValue > 0.5 && fontScaleValue < 2
      ? fontScaleValue
      : APPLICATION_SETTINGS_DEFAULTS.fontScale,
    kernelRuntimeMode: isKernelRuntimeMode(kernelRuntimeModeValue)
      ? kernelRuntimeModeValue
      : APPLICATION_SETTINGS_DEFAULTS.kernelRuntimeMode,
    outputFormat: isOutputFormat(outputFormatValue)
      ? outputFormatValue
      : APPLICATION_SETTINGS_DEFAULTS.outputFormat,
    proxyMode: normalizeProxyMode(proxyModeValue),
    proxyURL: proxyURLValue?.trim() ?? APPLICATION_SETTINGS_DEFAULTS.proxyURL,
  };
}

export function persistApplicationSetting<K extends keyof ApplicationSettings>(
  key: K,
  value: ApplicationSettings[K],
  storage?: StorageLike,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    const persisted = key === "proxyURL" ? String(value).trim() : String(value);
    target.setItem(APPLICATION_SETTING_STORAGE_KEYS[key], persisted);
  } catch {
    // localStorage may be unavailable in tests or embedded previews.
  }
}

export function applyApplicationSettingsRuntime(
  settings: ApplicationSettings,
  runtime: Pick<SettingsRuntime, "applyTheme" | "applyFontScale" | "setKernelRuntimeMode">,
): void {
  runtime.applyTheme(settings.theme);
  runtime.applyFontScale(settings.fontScale);
  runtime.setKernelRuntimeMode(settings.kernelRuntimeMode);
}

export function createSettingsActions(
  store: StateAdapter,
  runtime: SettingsRuntime,
) {
  return {
    setTheme(theme: ThemeMode): void {
      store.setState({ theme });
      persistApplicationSetting("theme", theme, runtime.storage);
      runtime.applyTheme(theme);
    },

    setFontScale(fontScale: number): void {
      store.setState({ fontScale });
      persistApplicationSetting("fontScale", fontScale, runtime.storage);
      runtime.applyFontScale(fontScale);
    },

    setProxyConfig(mode: ProxyMode, url?: string): void {
      const proxyMode = normalizeProxyMode(mode);
      const proxyURL = (url ?? store.getState().proxyURL).trim();
      store.setState({ proxyMode, proxyURL });
      persistApplicationSetting("proxyMode", proxyMode, runtime.storage);
      persistApplicationSetting("proxyURL", proxyURL, runtime.storage);
    },

    persistField(key: keyof StudioState, value: StudioState[keyof StudioState]): boolean {
      if (key === "kernelRuntimeMode") {
        const kernelRuntimeMode = value as KernelRuntimeMode;
        persistApplicationSetting("kernelRuntimeMode", kernelRuntimeMode, runtime.storage);
        runtime.setKernelRuntimeMode(kernelRuntimeMode);
        return true;
      }
      if (key === "outputFormat") {
        persistApplicationSetting("outputFormat", value as OutputFormatValue, runtime.storage);
        return true;
      }
      return false;
    },
  };
}
