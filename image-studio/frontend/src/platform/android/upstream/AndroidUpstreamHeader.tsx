import { Boxes, CheckCircle2, PlugZap, ShieldCheck, Sparkles } from "lucide-react";
import { isAPIMartAsyncProfile } from "../../../lib/apimartAPI";
import { isFHLBaseURL, isRunningHubBaseURL } from "../../../lib/profiles";
import { fhlTransportLabel, isOfficialFHLGenerationProfile } from "../../../lib/providerPolicy";
import { useStudioStore } from "../../../state/studioStore";
import type { UpstreamProfile } from "../../../types/domain";
import { ANDROID_UPSTREAM_MODE_OPTIONS } from "./useAndroidUpstreamConfig";

export function AndroidUpstreamHeader({
  activeProfile,
  profileCount,
  onConfigureAPIMart,
  onConfigureFHLImages,
  onConfigureFHLResponses,
  onConfigureRunningHub,
}: {
  activeProfile: UpstreamProfile | null;
  profileCount: number;
  onConfigureAPIMart: () => void;
  onConfigureFHLImages: () => void;
  onConfigureFHLResponses: () => void;
  onConfigureRunningHub: () => void;
}) {
  const fhlTransportMode = useStudioStore((state) => state.fhlTransportMode);
  const activeMode = activeProfile
    ? `${profileModeLabel(activeProfile, fhlTransportMode)} · ${activeProfile.baseURL || "未填写地址"}`
    : "先添加一个可用配置。";

  return (
    <section className="android-upstream-header">
      <div className="android-upstream-header-icon">
        <PlugZap className="h-5 w-5" />
      </div>
      <div className="android-upstream-header-copy">
        <div className="android-upstream-kicker">Android 上游</div>
        <h2>{activeProfile ? activeProfile.name : "未配置"}</h2>
        <p>{activeMode}</p>
      </div>
      <div className="android-upstream-header-metrics" aria-label="上游状态">
        <span className={activeProfile?.baseURL ? "ready" : "missing"}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {activeProfile?.baseURL ? "可用" : "待配置"}
        </span>
        <span>
          <ShieldCheck className="h-3.5 w-3.5" />
          {profileCount} 组
        </span>
      </div>
      <div className="android-upstream-create-grid" aria-label="上游模式入口" style={{ gridColumn: "1 / -1" }}>
        {ANDROID_UPSTREAM_MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === "fhl-images" ? "android-upstream-onekey-button" : ""}
            onClick={() => {
              if (option.id === "apimart") {
                onConfigureAPIMart();
              } else if (option.id === "runninghub") {
                onConfigureRunningHub();
              } else if (option.id === "fhl-responses") {
                onConfigureFHLResponses();
              } else {
                onConfigureFHLImages();
              }
            }}
          >
            <span className="android-upstream-create-icon">
              {option.id === "fhl-images" ? <Boxes className="h-4 w-4" /> : option.id === "runninghub" ? <PlugZap className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </span>
            <span>
              <strong>{option.title}</strong>
              <small>{option.meta}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function profileModeLabel(profile: UpstreamProfile, fhlTransportMode: "images" | "responses"): string {
  if (profile.apiMode === "runninghub" || isRunningHubBaseURL(profile.baseURL)) return "RunningHub";
  if (isAPIMartAsyncProfile(profile)) return "APIMart 异步参数";
  if (isOfficialFHLGenerationProfile(profile)) return fhlTransportLabel(fhlTransportMode);
  if (isFHLBaseURL(profile.baseURL) && profile.apiMode === "responses") return "Responses API";
  return profile.apiMode === "responses" ? "Responses API" : "Images API";
}
