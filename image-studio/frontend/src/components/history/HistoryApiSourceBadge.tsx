import type { HistoryApiSource } from "./historyApiSource";
import { apiSourceDetailLabel, apiSourceShortLabel } from "./historyApiSource";
import { FHL_BASE_URL, FHL_IMAGE_MODEL_ID, FHL_PROFILE_ID } from "../../lib/profiles";
import { useStudioStore } from "../../state/studioStore";

function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isFHLProfile(profile: { id?: string; apiMode?: string; baseURL?: string; imageModelID?: string } | null | undefined): boolean {
  if (!profile) return false;
  if (profile.id === FHL_PROFILE_ID) return true;
  const apiMode = String(profile.apiMode || "").trim();
  return (apiMode === "images" || apiMode === "responses")
    && normalizeBaseURL(String(profile.baseURL || "")) === FHL_BASE_URL
    && String(profile.imageModelID || "").trim() === FHL_IMAGE_MODEL_ID;
}

export function HistoryApiSourceBadge({
  className = "",
  source,
}: {
  className?: string;
  source: HistoryApiSource;
}) {
  const profiles = useStudioStore((state) => state.profiles);
  const sourceProfileId = String(source.apiProfileId || "").trim();
  const sourceProfileName = String(source.apiProfileName || "").trim();
  const matchedProfile = profiles.find((profile) => (
    (sourceProfileId && profile.id === sourceProfileId)
    || (sourceProfileName && profile.name === sourceProfileName)
  ));
  const hasExplicitProviderMode = source.apiMode === "apimart" || source.apiMode === "runninghub";
  const matchedProfileMatchesMode = !source.apiMode || !matchedProfile?.apiMode || matchedProfile.apiMode === source.apiMode;
  const sourceLooksLikeFHL = !hasExplicitProviderMode && (sourceProfileId === FHL_PROFILE_ID || isFHLProfile(matchedProfile));
  const resolvedSource: HistoryApiSource = sourceLooksLikeFHL
    ? {
        apiMode: "responses",
        apiProfileId: source.apiProfileId || matchedProfile?.id,
        apiProfileName: source.apiProfileName || matchedProfile?.name,
        fhlImagesPoolSlot: source.fhlImagesPoolSlot ?? matchedProfile?.fhlImagesPoolSlot,
      }
    : matchedProfile && matchedProfileMatchesMode
      ? {
          apiMode: matchedProfile.apiMode,
          apiProfileId: source.apiProfileId || matchedProfile.id,
          apiProfileName: source.apiProfileName || matchedProfile.name,
          fhlImagesPoolSlot: source.fhlImagesPoolSlot ?? matchedProfile.fhlImagesPoolSlot,
        }
      : source;
  const label = apiSourceShortLabel(resolvedSource);
  if (!label) return null;
  const title = apiSourceDetailLabel(resolvedSource) || label;
  return (
    <span
      className={`pointer-events-none inline-flex max-w-[96px] items-center border border-white/15 bg-black/62 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm backdrop-blur-sm ${className}`.trim()}
      title={title}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
