import type { HistoryItem } from "../../../types/domain";

export function historySourceLabel(
  item: Pick<HistoryItem, "apiLabel" | "apiMode" | "fhlImagesPoolSlot">,
) {
  const slot = item.fhlImagesPoolSlot ?? 0;
  if (
    (item.apiMode === "images" || item.apiMode === "responses")
    && Number.isInteger(slot)
    && slot >= 1
    && slot <= 10
  ) {
    return `FHL${slot} · ${item.apiMode === "responses" ? "Responses API" : "Images API"}`;
  }

  const frozenLabel = item.apiLabel?.trim();
  if (frozenLabel) return frozenLabel;
  if (item.apiMode === "images") return "Images API";
  if (item.apiMode === "responses") return "Responses API";
  if (item.apiMode === "apimart") return "APIMart";
  if (item.apiMode === "runninghub") return "RunningHub";
  return "FHL";
}
