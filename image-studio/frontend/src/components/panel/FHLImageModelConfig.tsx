import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Image, LoaderCircle, RefreshCw } from "lucide-react";
import { fetchFHLImageAPIModels } from "../../lib/fhlImageAPI.ts";
import {
  FHL_IMAGE_MODEL_DESCRIPTIONS,
  isSelectableFHLImageModel,
} from "../../lib/fhlImageModels.ts";
import { keyringUserFor, mapFHLImagesProfilesToPoolSlots } from "../../lib/profiles.ts";
import { usePlatform } from "../../platform/context";
import { GetStoredAPIKey } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";

export function FHLImageModelConfig({ active }: { active: boolean }) {
  const { usesFluentUI } = usePlatform();
  const profiles = useStudioStore((state) => state.profiles);
  const imageModelID = useStudioStore((state) => state.imageModelID);
  const proxyMode = useStudioStore((state) => state.proxyMode);
  const proxyURL = useStudioStore((state) => state.proxyURL);
  const setFHLImageModelID = useStudioStore((state) => state.setFHLImageModelID);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setModels(null);
      setMessage(null);
      setError(null);
      setLoading(false);
      setSaving(false);
    }
  }, [active]);

  const visibleModels = useMemo(() => {
    const list = models ? [...models] : [];
    if (imageModelID && !list.includes(imageModelID)) list.unshift(imageModelID);
    return list;
  }, [imageModelID, models]);

  async function savedImagesKey(): Promise<string> {
    const slots = mapFHLImagesProfilesToPoolSlots(profiles);
    for (const profile of slots) {
      if (!profile) continue;
      const key = await GetStoredAPIKey(keyringUserFor(profile.id)).catch(() => "");
      if (key.trim()) return key.trim();
    }
    return "";
  }

  async function handleFetchModels() {
    if (loading || saving) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const apiKey = await savedImagesKey();
      if (!apiKey) throw new Error("请先保存至少一个 FHL Images API Key，再拉取生图模型。");
      const next = await fetchFHLImageAPIModels(apiKey, { proxyMode, proxyURL });
      setModels(next);
      const selectableCount = next.filter(isSelectableFHLImageModel).length;
      setMessage(`已拉取 ${next.length} 个模型，其中 ${selectableCount} 个可用于生图。`);
    } catch (reason: any) {
      setError(reason?.message || "拉取生图模型失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(modelID: string) {
    if (!isSelectableFHLImageModel(modelID) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setFHLImageModelID(modelID);
      setMessage(`已将所有 FHL Images 槽切换为 ${modelID}。`);
    } catch (reason: any) {
      setError(reason?.message || "保存生图模型失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="fhl-image-model-config flex min-w-0 flex-col gap-3" data-testid="fhl-image-model-config">
      <div className={`flex items-start justify-between gap-3 border border-blue-300/70 bg-blue-50 px-3 py-2.5 text-blue-950 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}>
        <div className="flex min-w-0 items-start gap-2.5">
          <Image className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">FHL 生图模型</div>
            <p className="mt-0.5 text-[11px] leading-5 opacity-85">使用已保存的 Images Key 拉取，所有 10 个槽共享选择结果。</p>
          </div>
        </div>
      </div>

      <div
        className={`grid min-w-0 grid-cols-[116px_minmax(0,1fr)] items-start gap-2 border border-black/[0.08] bg-[var(--surface)]/75 px-3 py-2.5 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
        data-testid="fhl-image-model-controls"
      >
        <div className="min-w-0 text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">FHL Images</div>
          <div className="break-all">{imageModelID || "未选择模型"}</div>
        </div>
        <div className="grid min-w-0 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select
            value={imageModelID}
            onChange={(event) => void handleSelect(event.target.value)}
            disabled={loading || saving}
            aria-label="FHL 生图模型"
            title="FHL 生图模型"
            data-testid="fhl-image-model-select"
            className={`focus-ring min-w-0 border border-black/[0.08] bg-white/80 px-2.5 py-2 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:bg-zinc-900 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-70 ${usesFluentUI ? "rounded-[7px]" : "rounded-[10px]"}`}
          >
            {!imageModelID ? <option value="">请先拉取并选择模型</option> : null}
            {visibleModels.map((modelID) => {
              const selectable = isSelectableFHLImageModel(modelID);
              const description = selectable ? FHL_IMAGE_MODEL_DESCRIPTIONS[modelID] : "当前版本不可选";
              const missingFromFetchedList = !!models && modelID === imageModelID && !models.includes(modelID);
              return (
                <option key={modelID} value={modelID} disabled={!selectable}>
                  {modelID} · {description}{missingFromFetchedList ? "（当前已保存，列表未返回）" : ""}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            disabled={loading || saving}
            title="使用已保存的 Images Key 拉取模型列表"
            aria-label="获取 FHL 生图模型"
            className={`focus-ring inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-blue-400 bg-blue-50 px-3 text-[12px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/60 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/20 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
            data-testid="fhl-image-fetch-models"
          >
            {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {loading ? "拉取中" : "拉取模型列表"}
          </button>
        </div>
      </div>

      {error ? <div className="flex items-start gap-2 text-[11px] text-red-700 dark:text-red-300"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div> : null}
      {!error && message ? <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{message}</div> : null}
    </section>
  );
}
