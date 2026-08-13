import { X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";

export function SettingsPresetsRow() {
  const { presets, savePreset, applyPreset, deletePreset } = useStudioStore();
  const { usesFluentUI } = usePlatform();

  function onSave() {
    const name = prompt("预设名:");
    if (name) savePreset(name);
  }

  return (
    <div className="settings-presets-row flex flex-col gap-1.5">
      {presets.map((preset) => (
        <div key={preset.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => applyPreset(preset.id)}
            title={`${preset.size} · ${preset.quality}`}
            className={`flex-1 border border-black/[0.08] px-3 py-2 text-left text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            {preset.name}
          </button>
          <button
            type="button"
            onClick={() => deletePreset(preset.id)}
            title="删除"
            className={`p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onSave}
        className={`border border-dashed border-black/[0.12] px-3 py-2 text-xs text-zinc-500 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.1] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
      >
        + 保存当前参数
      </button>
    </div>
  );
}
