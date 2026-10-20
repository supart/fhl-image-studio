import { targetPlatform } from "../index.ts";
import { canUseWebGLImageTransforms } from "../../lib/virtualHostStore.ts";
import {
  clearLocalEvents,
  getForcedKernelRuntimeMode,
  onLocalEvent,
  setForcedKernelRuntimeMode,
} from "./hostEvents.ts";
import {
  canInvokeAndroidMethod,
  getRuntime,
  hasServiceMethod,
  invokeService,
} from "./hostBindings.ts";
import type {
  AutomationStatusLike,
  HostCapabilities,
  HostKind,
  KernelRuntimeMode,
} from "./hostTypes.ts";

export function detectHostKind(): HostKind {
  if (targetPlatform === "android" || targetPlatform === "android-pad") {
    return canInvokeAndroidMethod("GetOutputDir") || hasServiceMethod("GetOutputDir") ? "android-shell" : "browser";
  }
  if (hasServiceMethod("Generate") && getRuntime()) return "wails-desktop";
  return "browser";
}

export function unsupportedMessage(method: string): string {
  const kind = detectHostKind();
  if (kind === "android-shell") {
    return `当前 Android shell 未提供 ${method} 对应的本地内核能力`;
  }
  if (kind === "browser") {
    return `当前浏览器预览环境未注入 ${method} 宿主能力`;
  }
  return `宿主未暴露 ${method} 能力`;
}

export function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function bootstrapAutomationStatus(): AutomationStatusLike | undefined {
  return typeof window !== "undefined"
    ? (window as Window & { __IMAGE_STUDIO_E2E_BOOTSTRAP?: AutomationStatusLike }).__IMAGE_STUDIO_E2E_BOOTSTRAP
    : undefined;
}

export function shouldFallbackFromEmptyNativeDialog(): boolean {
  return bootstrapAutomationStatus()?.e2eOnly === true;
}

export function shouldAvoidVolatileBrowserImages(): boolean {
  return bootstrapAutomationStatus()?.e2eOnly === true;
}

export function supportsDesktopNativeGPUTransforms(): boolean {
  return detectHostKind() === "wails-desktop" && targetPlatform === "macos";
}

export function setKernelRuntimeMode(mode: KernelRuntimeMode) {
  setForcedKernelRuntimeMode(mode);
}

export function getKernelRuntimeMode(): KernelRuntimeMode {
  return getForcedKernelRuntimeMode();
}

export function getHostCapabilities(): HostCapabilities {
  const kind = detectHostKind();
  const localGenerationCapable = kind === "wails-desktop" && hasServiceMethod("Generate") && hasServiceMethod("Edit");
  const localPromptOptimizeCapable = kind === "wails-desktop" && hasServiceMethod("OptimizePrompt");
  const localModeEnabled = getForcedKernelRuntimeMode() !== "remote";
  const hasDesktopNativeTransforms = kind === "wails-desktop"
    && hasServiceMethod("RotateImage")
    && hasServiceMethod("FlipImage")
    && hasServiceMethod("CropImage");
  const webGLTransforms = canUseWebGLImageTransforms();
  const imageTransformAcceleration = supportsDesktopNativeGPUTransforms()
    ? "gpu-metal"
    : webGLTransforms
      ? "gpu-webgl"
      : hasDesktopNativeTransforms
        ? "native"
        : kind === "android-shell" || kind === "browser"
          ? "cpu-canvas"
          : "none";
  return {
    localGeneration: localGenerationCapable && localModeEnabled,
    promptOptimization: localPromptOptimizeCapable && localModeEnabled,
    nativeFileDialogs: kind === "wails-desktop" || canInvokeAndroidMethod("OpenImageDialog"),
    nativeImageTransforms:
      hasDesktopNativeTransforms
      || kind === "android-shell"
      || kind === "browser",
    imageTransformAcceleration,
    nativeHistoryFileIO: kind === "wails-desktop" || canInvokeAndroidMethod("ImportHistoryFromFile"),
    nativeOutputDirectoryPicker: hasServiceMethod("ChooseOutputDir") && kind !== "android-shell",
    secureCredentialStore: kind === "wails-desktop",
  };
}

export function EventsOn(eventName: string, callback: (...args: any[]) => void) {
  const offLocal = onLocalEvent(eventName, callback);
  const runtime = getRuntime();
  const offRuntime = runtime?.EventsOnMultiple
    ? runtime.EventsOnMultiple(eventName, callback, -1)
    : () => undefined;
  return () => {
    offLocal();
    try {
      offRuntime();
    } catch {
      // Wails IPC may already be closed during WebView teardown.
    }
  };
}

export function EventsOff(eventName: string, ...additionalEventNames: string[]) {
  clearLocalEvents(eventName, ...additionalEventNames);
  getRuntime()?.EventsOff?.(eventName, ...additionalEventNames);
}

export function WindowSetSystemDefaultTheme() {
  getRuntime()?.WindowSetSystemDefaultTheme?.();
}

export function WindowSetLightTheme() {
  getRuntime()?.WindowSetLightTheme?.();
}

export function WindowSetDarkTheme() {
  getRuntime()?.WindowSetDarkTheme?.();
}

export function GetAutomationStatus(): Promise<AutomationStatusLike> {
  const bootstrapStatus = bootstrapAutomationStatus();
  if (hasServiceMethod("GetAutomationStatus")) {
    return invokeService<AutomationStatusLike>(unsupportedMessage, "GetAutomationStatus")
      .catch(() => bootstrapStatus ?? { enabled: false });
  }
  return Promise.resolve(bootstrapStatus ?? { enabled: false });
}
