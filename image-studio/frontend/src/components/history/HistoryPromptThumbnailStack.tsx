import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import type { HistoryItem } from "../../types/domain";
import { HistoryModeBadge } from "./HistoryModeBadge";

export function HistoryPromptThumbnailStack({
  className = "",
  count,
  items,
}: {
  className?: string;
  count?: number;
  items: HistoryItem[];
}) {
  return (
    <span className={`timeline-prompt-card-pile ${className}`} aria-hidden="true">
      {items.slice(0, 3).map((item, index) => (
        <HistoryPromptThumbnailStackLayer key={item.id} item={item} index={index} />
      ))}
      <span className="timeline-prompt-card-count">{count ?? items.length}</span>
    </span>
  );
}

function HistoryPromptThumbnailStackLayer({ item, index }: { item: HistoryItem; index: number }) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);

  return (
    <span className={`timeline-prompt-card-layer layer-${index}`}>
      <img src={imageSrc} alt="" loading="eager" decoding="async" />
      {index === 0 ? <HistoryModeBadge mode={item.mode} className="timeline-prompt-card-mode" /> : null}
    </span>
  );
}
