import { Dices, X } from "lucide-react";
import type { OutputFormatValue } from "../../types/domain";
import { OUTPUT_FORMAT_OPTIONS } from "../../types/domain";
import { Modal } from "../../components/common/Modal";
import { vibrateForPlatform } from "./bridge";

export function AndroidAdvancedSection({
  advancedOpen,
  negativePrompt,
  outputFormat,
  seed,
  setAdvancedOpen,
  setField,
  surface = "phone",
}: {
  advancedOpen: boolean;
  negativePrompt: string;
  outputFormat: OutputFormatValue;
  seed: number;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setField: (key: string, value: any) => void;
  surface?: "phone" | "pad";
}) {
  const openAdvanced = () => {
    vibrateForPlatform(8);
    setAdvancedOpen(true);
  };
  const negativeState = negativePrompt.trim() ? "已填写" : "未填写";
  const outputFormatLabel = OUTPUT_FORMAT_OPTIONS.find((item) => item.value === outputFormat)?.label ?? outputFormat;
  const title = surface === "pad" ? "3 项高级设置" : "负向提示词、Seed 与输出格式";
  const negativeLabel = surface === "pad" ? "负向" : "负向提示词";

  return (
    <section className={`android-advanced-block ${surface === "pad" ? "android-pad-advanced-block" : ""}`}>
      <button
        type="button"
        onClick={openAdvanced}
        className="platform-card android-advanced-toggle"
      >
        <span>
          <span className="android-phone-kicker !mb-0">高级参数</span>
          <strong>{title}</strong>
          <span className="android-advanced-summary-grid">
            <span>
              <span>{negativeLabel}</span>
              <strong>{negativeState}</strong>
            </span>
            <span>
              <span>输出格式</span>
              <strong>{outputFormatLabel}</strong>
            </span>
            <span>
              <span>Seed</span>
              <strong>{seed > 0 ? seed : "随机"}</strong>
            </span>
          </span>
        </span>
        <span className="android-advanced-toggle-state">编辑</span>
      </button>

      <Modal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="高级参数"
        width={680}
        backdropClassName="android-advanced-modal-backdrop"
        cardClassName="android-advanced-modal-card"
        headerClassName="android-advanced-modal-header"
        bodyClassName="android-advanced-modal-body"
      >
        <AndroidAdvancedEditor
          negativePrompt={negativePrompt}
          outputFormat={outputFormat}
          seed={seed}
          setField={setField}
        />
      </Modal>
    </section>
  );
}

function AndroidAdvancedEditor({
  negativePrompt,
  outputFormat,
  seed,
  setField,
}: {
  negativePrompt: string;
  outputFormat: OutputFormatValue;
  seed: number;
  setField: (key: string, value: any) => void;
}) {
  return (
    <div className="android-advanced-modal-panel">
      <div className="android-phone-advanced-section">
        <div className="android-phone-advanced-label">负向提示词</div>
        <textarea
          value={negativePrompt}
          placeholder="不希望出现的元素"
          onChange={(event) => setField("negativePrompt", event.target.value)}
          className="focus-ring android-phone-advanced-textarea"
        />
      </div>

      <div className="android-phone-advanced-section">
        <div className="android-phone-advanced-label">输出格式</div>
        <div className="android-phone-format-row">
          {OUTPUT_FORMAT_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                vibrateForPlatform(5);
                setField("outputFormat", item.value as OutputFormatValue);
              }}
              className={`android-choice-chip ${outputFormat === item.value ? "active" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="android-phone-advanced-section">
        <div className="android-phone-advanced-label">Seed</div>
        <div className="android-phone-seed-row">
          <input
            type="number"
            value={seed || ""}
            placeholder="留空为随机"
            min={0}
            onChange={(event) => setField("seed", Number(event.target.value) || 0)}
            className="focus-ring android-phone-seed-input font-mono-token"
          />
          <button
            type="button"
            onClick={() => {
              vibrateForPlatform(5);
              setField("seed", Math.floor(Math.random() * 2_000_000_000));
            }}
            title="随机 seed"
            className="platform-action-btn android-phone-seed-icon-button"
          >
            <Dices className="h-3.5 w-3.5" />
          </button>
          {seed > 0 ? (
            <button
              type="button"
              onClick={() => {
                vibrateForPlatform(5);
                setField("seed", 0);
              }}
              title="清除"
              className="platform-action-btn android-phone-seed-icon-button danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
