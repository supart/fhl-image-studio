import { CheckCircle2, Settings, Zap } from "lucide-react";
import { Modal } from "../../components/common/Modal";
import { isAPIMartAsyncProfile } from "../../lib/apimartAPI";
import {
  isFHLBaseURL,
  isOfficialFHLPoolProfile,
  isSelectableGenerationProfile,
  normalizeFHLImagesPoolSlot,
} from "../../lib/profiles";
import { fhlTransportLabel, isOfficialFHLGenerationProfile } from "../../lib/providerPolicy";
import { useStudioStore } from "../../state/studioStore";
import type { UpstreamProfile } from "../../types/domain";
import { vibrateForPlatform } from "./bridge";

function profileModeLabel(profile: UpstreamProfile, fhlTransportMode: "images" | "responses"): string {
  if (isAPIMartAsyncProfile(profile)) return "APIMart";
  if (isOfficialFHLGenerationProfile(profile)) return fhlTransportLabel(fhlTransportMode);
  if (isFHLBaseURL(profile.baseURL) && profile.apiMode === "responses") return "Responses API";
  if (profile.apiMode === "responses") return "Responses API";
  return "Images API";
}

function profileDetailLabel(profile: UpstreamProfile, fhlTransportMode: "images" | "responses"): string {
  const base = profile.baseURL.trim() || "未填写上游地址";
  const poolSlot = isOfficialFHLPoolProfile(profile)
    ? normalizeFHLImagesPoolSlot(profile.fhlImagesPoolSlot)
    : undefined;
  const limit = poolSlot !== undefined
    ? `FHL${poolSlot} · ${fhlTransportLabel(fhlTransportMode)} · 每槽 4 / 总 40`
    : `${Math.min(2, Math.max(1, Math.floor(Number(profile.concurrencyLimit) || 1)))} 并发`;
  return poolSlot !== undefined
    ? `${limit} · ${base}`
    : `${profileModeLabel(profile, fhlTransportMode)} · ${limit} · ${base}`;
}

export function AndroidQuickProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    activeProfileId,
    openUpstreamConfig,
    profiles,
    pushToast,
    setActiveProfile,
  } = useStudioStore();
  const fhlTransportMode = useStudioStore((state) => state.fhlTransportMode);
  const generationProfiles = profiles.filter(isSelectableGenerationProfile);

  const handlePick = async (profile: UpstreamProfile) => {
    vibrateForPlatform(8);
    await setActiveProfile(profile.id);
    pushToast(`已切换到 ${profile.name || profileModeLabel(profile, fhlTransportMode)}`, "success", 2600);
    onClose();
  };

  const handleManage = () => {
    vibrateForPlatform(8);
    onClose();
    openUpstreamConfig("app");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="选择当前 API"
      width={520}
      cardClassName="android-quick-profile-card"
      bodyClassName="android-quick-profile-body"
    >
      <div className="android-quick-profile-sheet">
        <div className="android-quick-profile-summary">
          点选后立即作为当前生图 API。FHL / APIMart 不需要进设置页反复确认。
        </div>
        <div className="android-quick-profile-list">
          {generationProfiles.map((profile) => {
            const active = profile.id === activeProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                className={`android-quick-profile-item ${active ? "active" : ""}`}
                onClick={() => { void handlePick(profile); }}
                aria-current={active ? "true" : undefined}
              >
                <span className="android-quick-profile-icon">
                  {active ? <CheckCircle2 className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                </span>
                <span className="android-quick-profile-copy">
                  <strong>{profile.name || profileModeLabel(profile, fhlTransportMode)}</strong>
                  <small>{profileDetailLabel(profile, fhlTransportMode)}</small>
                </span>
                <span className="android-quick-profile-mode">{profileModeLabel(profile, fhlTransportMode)}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="android-quick-profile-manage" onClick={handleManage}>
          <Settings className="h-4 w-4" />
          管理上游配置
        </button>
      </div>
    </Modal>
  );
}
