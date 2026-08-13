import { ImagePlus, Trash2, Wand2, X } from "lucide-react";
import type { HistoryItem, SourceImage } from "../../types/domain";
import { vibrateForPlatform } from "./bridge";

export function AndroidPhoneSourceSection({
  clearSources,
  currentImage,
  onSelectSource,
  removeSource,
  sources,
}: {
  clearSources: () => void;
  currentImage: HistoryItem | null;
  onSelectSource: () => void;
  removeSource: (index: number) => void;
  sources: SourceImage[];
}) {
  return (
    <section className="platform-card android-phone-source-card android-source-summary-card">
      <div className="android-source-summary-head">
        <div className="android-source-summary-copy">
          <div className="android-source-summary-title">源图片 / 参考图{sources.length > 0 ? ` · ${sources.length} 张` : ""}</div>
        </div>
        <Wand2 className="android-source-summary-icon" />
      </div>
      {sources.length === 0 && currentImage?.savedPath ? (
        <div className="android-source-implicit-note">(画板当前图 · 隐式源图)</div>
      ) : null}
      {sources.length > 0 ? (
        <div className="android-source-list">
          {sources.map((source, index) => (
            <div key={source.path} className="android-source-list-item">
              <span title={source.path}>
                {index + 1}. {source.name}
              </span>
              <button
                type="button"
                onClick={() => { vibrateForPlatform(5); removeSource(index); }}
                title="移除"
                className="android-source-remove-button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="android-source-actions">
        <button
          type="button"
          onClick={onSelectSource}
          className="platform-action-btn android-source-primary-action"
        >
          <ImagePlus className="h-3.5 w-3.5" /> 添加图片
        </button>
        {sources.length > 0 ? (
          <button
            type="button"
            onClick={() => { vibrateForPlatform(5); clearSources(); }}
            className="platform-action-btn android-source-clear-action"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
