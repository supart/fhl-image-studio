import { useState } from "react";
import { Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useStudioStore } from "../../../state/studioStore";
import type { Preset } from "../../../types/domain";

function presetSummary(preset: Preset) {
  return [
    preset.size,
    preset.quality,
    preset.outputFormat?.toUpperCase(),
    preset.batchCount > 1 ? `${preset.batchCount} 张` : "单张",
  ].filter(Boolean).join(" · ");
}

export function AndroidSettingsPresetsRow() {
  const { presets, savePreset, applyPreset, deletePreset, pushToast } = useStudioStore();
  const [name, setName] = useState("");
  const trimmedName = name.trim();

  const handleSave = () => {
    if (!trimmedName) {
      pushToast("先输入预设名称", "warn", 2200);
      return;
    }
    savePreset(trimmedName);
    setName("");
  };

  return (
    <div className="android-settings-presets-row">
      <div className="android-settings-preset-save">
        <input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSave();
          }}
          aria-label="预设名称"
          placeholder="给当前参数起个名字"
          className="focus-ring"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!trimmedName}
          title="保存当前参数为预设"
        >
          <Save className="h-4 w-4" />
          <span>保存</span>
        </button>
      </div>

      {presets.length > 0 ? (
        <div className="android-settings-preset-list">
          {presets.map((preset) => (
            <div key={preset.id} className="android-settings-preset-item">
              <button
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="android-settings-preset-apply"
                title="应用这组参数"
              >
                <span className="android-settings-preset-icon">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="android-settings-preset-name">{preset.name}</span>
                  <span className="android-settings-preset-meta">{presetSummary(preset)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => deletePreset(preset.id)}
                className="android-settings-preset-delete"
                title="删除预设"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="android-settings-preset-empty">保存常用尺寸、质量、负向提示词和批量数量，之后可以一键套用。</p>
      )}
    </div>
  );
}
