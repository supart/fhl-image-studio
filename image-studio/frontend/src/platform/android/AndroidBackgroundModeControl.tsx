import { ImageIcon, Layers3 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import {
  loadImageModelCatalog,
} from "../../lib/fhlImageModels.ts";
import type {
  APIMode,
  ImageBackgroundMode,
  UpstreamProfile,
} from "../../types/domain.ts";
import { resolveAndroidTransparentEligibility } from "./androidBackgroundMode.ts";
import { vibrateForPlatform } from "./bridge";
function imageCatalogForProfile(
  activeProfile: UpstreamProfile | null | undefined,
  baseURL: string,
) {
  if (!activeProfile) return null;
  const provider = activeProfile.provider?.trim()
    || activeProfile.imageModelCatalogProvider?.trim()
    || "fhl";
  return loadImageModelCatalog(baseURL, provider);
}

export function AndroidBackgroundModeControl({
  activeProfile,
  apiMode,
  baseURL,
  imageBackgroundMode,
  imageModelID,
  onChange,
  onInvalidTransparent,
  surface,
}: {
  activeProfile: UpstreamProfile | null | undefined;
  apiMode: APIMode;
  baseURL: string;
  imageBackgroundMode: ImageBackgroundMode;
  imageModelID: string;
  onChange: (mode: ImageBackgroundMode) => void;
  onInvalidTransparent: (reason: string) => void;
  surface: "phone" | "pad";
}) {
  const eligibility = useMemo(() => {
    const catalog = imageCatalogForProfile(activeProfile, baseURL);
    return resolveAndroidTransparentEligibility({
      activeProfile,
      apiMode,
      baseURL,
      catalog,
      imageModelID,
    });
  }, [activeProfile, apiMode, baseURL, imageModelID]);
  const invalidReasonRef = useRef("");

  useEffect(() => {
    if (imageBackgroundMode !== "transparent" || eligibility.enabled) {
      invalidReasonRef.current = "";
      return;
    }
    if (invalidReasonRef.current === eligibility.reason) return;
    invalidReasonRef.current = eligibility.reason;
    onChange("standard");
    onInvalidTransparent(eligibility.reason);
  }, [
    eligibility.enabled,
    eligibility.reason,
    imageBackgroundMode,
    onChange,
    onInvalidTransparent,
  ]);

  const choose = (next: ImageBackgroundMode) => {
    if (next === "transparent" && !eligibility.enabled) return;
    vibrateForPlatform(7);
    onChange(next);
  };

  return (
    <section
      className={`android-background-mode android-background-mode-${surface}`}
      aria-label="输出背景"
    >
      <div className="android-background-mode-heading">
        <span>输出背景</span>
        <small>{imageBackgroundMode === "transparent" ? "PNG 已锁定" : "普通输出"}</small>
      </div>
      <div className="android-background-mode-options" role="group" aria-label="选择输出背景">
        <button
          type="button"
          className={`android-background-mode-button ${imageBackgroundMode === "standard" ? "active" : ""}`}
          aria-pressed={imageBackgroundMode === "standard"}
          onClick={() => choose("standard")}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span>普通图像</span>
        </button>
        <button
          type="button"
          className={`android-background-mode-button ${imageBackgroundMode === "transparent" ? "active" : ""}`}
          aria-pressed={imageBackgroundMode === "transparent"}
          aria-describedby={`android-transparent-reason-${surface}`}
          disabled={!eligibility.enabled}
          title={eligibility.reason}
          onClick={() => choose("transparent")}
        >
          <Layers3 className="h-3.5 w-3.5" />
          <span>透明 PNG</span>
        </button>
      </div>
      <p
        id={`android-transparent-reason-${surface}`}
        className={`android-background-mode-reason ${eligibility.enabled ? "available" : ""}`}
      >
        {eligibility.reason}
      </p>
    </section>
  );
}
