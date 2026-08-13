import { readRuntimePlatformState } from "..";
import { invokeAndroidNative } from "./nativeInvoke";

export type AndroidBridge = {
  getDeviceDiagnosticsJson?: () => string;
  invoke?: (requestId: string, method: string, payloadJson: string) => void;
  saveImage?: (imageB64: string, suggestedName: string) => string | Promise<string>;
  saveImagePathAs?: (path: string, suggestedName: string) => string | Promise<string>;
  shareImage?: (imageB64: string, suggestedName: string) => string | Promise<string>;
  shareImagePathAs?: (path: string, suggestedName: string) => string | Promise<string>;
  openOutputDir?: () => string | Promise<string | void>;
  pickImage?: () => string | Promise<string | AndroidPickedImage | null>;
  exportHistory?: (jsonContent: string, suggestedName: string) => string | Promise<string>;
  importHistory?: () => string | Promise<string | null>;
  vibrate?: (ms: number) => void | Promise<void>;
};

type AndroidPickedImage = {
  path?: string;
  name?: string;
  size?: number;
  imageB64?: string;
  mimeType?: string;
};

declare global {
  interface Window {
    AndroidImageStudio?: AndroidBridge;
    Android?: AndroidBridge;
  }
}

function bridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  return window.AndroidImageStudio ?? window.Android ?? null;
}

function byteStringToBlobURL(imageB64: string, type = "image/png"): string {
  const bin = atob(imageB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

function triggerDownload(imageB64: string, suggestedName: string): string {
  const objectURL = byteStringToBlobURL(imageB64);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = suggestedName || "image-studio.png";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  return suggestedName;
}

function ensurePngName(name: string): string {
  const trimmed = name.trim() || "image-studio.png";
  return /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
}

export const androidTarget = {
  get isAndroid() {
    return readRuntimePlatformState().isAndroid;
  },
  get isPad() {
    return readRuntimePlatformState().isAndroidPad;
  },
  get isPhone() {
    return readRuntimePlatformState().isAndroidPhone;
  },
};

export function hasAndroidBridge(): boolean {
  return !!bridge();
}

function readNativeDeviceDiagnostics(): Record<string, unknown> {
  const raw = bridge()?.getDeviceDiagnosticsJson?.();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { nativeDiagnosticsError: "failed to parse native diagnostics" };
  }
}

function readCssPixelNumber(name: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getAndroidDeviceDiagnosticsText(): string {
  const platform = readRuntimePlatformState();
  const nativeDiagnostics = readNativeDeviceDiagnostics();
  const visualViewport = typeof window !== "undefined" ? window.visualViewport : null;
  const safeArea = (window as Window & {
    __imageStudioAndroidSafeArea?: Record<string, number>;
  }).__imageStudioAndroidSafeArea ?? {};
  const data = {
    app: "FHL Image Studio Android",
    url: typeof window !== "undefined" ? window.location.href : "",
    platform,
    native: nativeDiagnostics,
    viewport: {
      innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
      innerHeight: typeof window !== "undefined" ? window.innerHeight : null,
      visualWidth: visualViewport?.width ?? null,
      visualHeight: visualViewport?.height ?? null,
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : null,
    },
    css: {
      safeTop: readCssPixelNumber("--android-safe-top-value"),
      headerSafeTop: readCssPixelNumber("--android-header-safe-top-value"),
      headerHeight: readCssPixelNumber("--android-header-height"),
      bottomNavHeight: readCssPixelNumber("--android-bottom-nav-height"),
      viewportHeight: readCssPixelNumber("--android-viewport-height"),
      contentHeight: readCssPixelNumber("--android-content-height"),
    },
    safeArea,
    currentView: document.querySelector(".studio")?.getAttribute("data-android-view") ?? "",
  };
  return JSON.stringify(data, null, 2);
}

export async function saveImageForPlatform(
  imageB64: string,
  suggestedName: string,
  desktopSave: (imageB64: string, suggestedName: string) => Promise<string>,
): Promise<string> {
  const filename = ensurePngName(suggestedName);
  const platform = readRuntimePlatformState();
  if (!platform.isAndroid) return desktopSave(imageB64, filename);

  const nativeBridge = bridge();
  if (nativeBridge?.saveImage) {
    const saved = await nativeBridge.saveImage(imageB64, filename);
    return String(saved || filename);
  }

  try {
    return await desktopSave(imageB64, filename);
  } catch {
    // Fall back to Web Share / download below.
  }

  if (navigator.share && typeof File !== "undefined") {
    try {
      const blob = await (await fetch(`data:image/png;base64,${imageB64}`)).blob();
      const file = new File([blob], filename, { type: "image/png" });
      const canShare = !navigator.canShare || navigator.canShare({ files: [file] });
      if (canShare) {
        await navigator.share({ files: [file], title: filename });
        return filename;
      }
    } catch {
      // Fall back to direct download below.
    }
  }

  return triggerDownload(imageB64, filename);
}

export async function openOutputLocationForPlatform(desktopOpen: () => Promise<void>): Promise<void> {
  const platform = readRuntimePlatformState();
  if (!platform.isAndroid) {
    await desktopOpen();
    return;
  }

  const nativeBridge = bridge();
  if (nativeBridge?.openOutputDir) {
    await nativeBridge.openOutputDir();
    return;
  }

  throw new Error(platform.isAndroidPad ? "Android Pad 壳层未提供打开图片目录接口" : "手机版请从系统下载或分享记录里查看保存图片");
}

export async function exportHistoryForPlatform(
  jsonContent: string,
  desktopExport: (jsonContent: string) => Promise<string>,
): Promise<string> {
  if (!readRuntimePlatformState().isAndroid) return desktopExport(jsonContent);
  const suggested = `fhl-studio-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const nativeBridge = bridge();
  if (nativeBridge?.exportHistory) {
    const exported = await nativeBridge.exportHistory(jsonContent, suggested);
    return String(exported || suggested);
  }

  const objectURL = URL.createObjectURL(new Blob([jsonContent], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = suggested;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
  return suggested;
}

export async function openExternalURLForPlatform(url: string, desktopOpen: (url: string) => Promise<void>): Promise<void> {
  if (!readRuntimePlatformState().isAndroid) {
    await desktopOpen(url);
    return;
  }

  await desktopOpen(url);
}

export async function shareImageForPlatform(
  imageB64: string,
  suggestedName: string,
  desktopShare: (imageB64: string, suggestedName: string) => Promise<string>,
): Promise<string> {
  const filename = ensurePngName(suggestedName);
  const platform = readRuntimePlatformState();
  if (!platform.isAndroid) return desktopShare(imageB64, filename);

  const nativeBridge = bridge();
  if (nativeBridge?.shareImage) {
    const shared = await nativeBridge.shareImage(imageB64, filename);
    return String(shared || filename);
  }

  return desktopShare(imageB64, filename);
}

export async function shareImagePathForPlatform(
  path: string,
  suggestedName: string,
  desktopShare: (path: string, suggestedName: string) => Promise<string>,
): Promise<string> {
  const filename = ensurePngName(suggestedName);
  const platform = readRuntimePlatformState();
  if (!platform.isAndroid) return desktopShare(path, filename);

  const nativeBridge = bridge();
  if (nativeBridge?.shareImagePathAs) {
    const shared = await nativeBridge.shareImagePathAs(path, filename);
    return String(shared || path);
  }

  return desktopShare(path, filename);
}

export async function importHistoryForPlatform(desktopImport: () => Promise<string>): Promise<string> {
  if (!readRuntimePlatformState().isAndroid) return desktopImport();
  const nativeBridge = bridge();
  if (nativeBridge?.importHistory) return String((await nativeBridge.importHistory()) || "");
  return "";
}

export function vibrateForPlatform(ms = 50) {
  if (!readRuntimePlatformState().isAndroid) return;
  const nativeBridge = bridge();
  if (nativeBridge?.vibrate) {
    try {
      nativeBridge.vibrate(ms);
    } catch {
      invokeAndroidNative("Vibrate", ms).catch(() => {});
    }
  } else {
    invokeAndroidNative("Vibrate", ms).catch(() => {});
  }
}

export function androidSaveHint(): string {
  const platform = readRuntimePlatformState();
  if (platform.isAndroidPad) return "Pad 版默认保存到相册 ImageStudio 目录;无壳层时会下载或调系统分享面板。";
  if (platform.isAndroidPhone) return "手机版保存后会出现在系统相册 ImageStudio 目录、下载或分享记录中。";
  return "";
}
