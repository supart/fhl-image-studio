import { useState } from "react";
import { Clock3, ListPlus } from "lucide-react";
import { Modal } from "../../components/common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { vibrateForPlatform } from "./bridge";

const ANDROID_PROMPT_TEMPLATES: { label: string; text: string }[] = [
  { label: "写实摄影", text: "photorealistic, professional photography, 35mm, natural lighting, sharp focus, high detail" },
  { label: "电影感", text: "cinematic, dramatic lighting, shallow depth of field, film grain, anamorphic, 2.39:1" },
  { label: "二次元", text: "anime style, vibrant colors, cel shading, detailed illustration" },
  { label: "油画", text: "oil painting, thick brush strokes, classical art style, warm tones" },
  { label: "水彩", text: "watercolor painting, soft edges, pastel colors, paper texture" },
  { label: "扁平插画", text: "flat illustration, minimalist, geometric shapes, vector style" },
  { label: "3D 渲染", text: "3D render, octane render, ray tracing, glossy, studio lighting" },
  { label: "像素风", text: "pixel art, 16-bit, retro game style, limited palette" },
];

export function AndroidPromptTemplateModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (text: string) => void;
}) {
  const history = useStudioStore((s) => s.promptHistory);
  const [tab, setTab] = useState<"templates" | "history">("templates");
  const items = tab === "templates"
    ? ANDROID_PROMPT_TEMPLATES
    : history.map((text, index) => ({ label: `历史 ${index + 1}`, text }));

  const pick = (text: string) => {
    vibrateForPlatform(8);
    onPick(text);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="模板与历史"
      width={720}
      backdropClassName="android-template-modal-backdrop"
      cardClassName="android-template-modal-card"
      headerClassName="android-template-modal-header"
      bodyClassName="android-template-modal-body"
    >
      <div className="android-template-modal-panel">
        <p className="android-template-helper">
          选择模板或历史 prompt 后会追加到主提示词末尾，适合把主体、场景、镜头、材质和光照分段组合。
        </p>
        <div className="android-template-tabs" role="tablist" aria-label="提示词来源">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "templates"}
            className={tab === "templates" ? "active" : ""}
            onClick={() => { vibrateForPlatform(5); setTab("templates"); }}
          >
            <ListPlus className="h-4 w-4" />
            <span>模板</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={tab === "history" ? "active" : ""}
            onClick={() => { vibrateForPlatform(5); setTab("history"); }}
          >
            <Clock3 className="h-4 w-4" />
            <span>历史 {history.length}</span>
          </button>
        </div>

        {items.length > 0 ? (
          <div className="android-template-list">
            {items.map((item, index) => (
              <button
                key={`${tab}-${index}-${item.label}`}
                type="button"
                className="android-template-item"
                onClick={() => pick(item.text)}
              >
                <strong>{item.label}</strong>
                <span>{item.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="android-template-empty">还没有提交过 prompt</div>
        )}
      </div>
    </Modal>
  );
}
