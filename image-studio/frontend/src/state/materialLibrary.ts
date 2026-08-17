import type { HistoryItem, MaterialGroup, MaterialGroupKind, MaterialRef, SourceImage } from "../types/domain";
import { storageKey } from "../lib/storageNamespace.ts";
import { buildHistoryPromptGroups, normalizeHistoryPrompt } from "../components/history/historyPromptGroups.ts";

export const MATERIAL_LIBRARY_KEY = storageKey("gptcodex.materialLibrary.v1");

function genMaterialId() {
  return `mat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function materialRefKey(ref: MaterialRef): string {
  if (ref.kind === "history") return `history:${ref.historyId}`;
  return `source:${ref.source.path || ref.source.name}`;
}

export function uniqueMaterialRefs(items: MaterialRef[]): MaterialRef[] {
  const seen = new Set<string>();
  const out: MaterialRef[] = [];
  for (const item of items) {
    const key = materialRefKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function uniqueMaterialGroupName(
  groups: MaterialGroup[],
  kind: MaterialGroupKind,
  name: string,
): string {
  const base = name.trim();
  if (!base) return "";
  const existing = new Set(
    groups
      .filter((group) => group.kind === kind)
      .map((group) => group.name.trim().toLowerCase()),
  );
  if (!existing.has(base.toLowerCase())) return base;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}

export function createMaterialGroupInput(
  kind: MaterialGroupKind,
  name: string,
  items: MaterialRef[] = [],
  now = Date.now(),
  description = "",
): MaterialGroup {
  return {
    id: genMaterialId(),
    name: name.trim() || (kind === "referenceSet" ? "参考图组" : "新建文件夹"),
    description: description.trim() || undefined,
    kind,
    items: uniqueMaterialRefs(items),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeMaterialGroups(value: unknown, historyIds?: Set<string>): MaterialGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: MaterialGroup[] = [];
  const groupIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<MaterialGroup>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : genMaterialId();
    if (groupIds.has(id)) continue;
    const kind: MaterialGroupKind = item.kind === "referenceSet" ? "referenceSet" : "folder";
    const refs = Array.isArray(item.items) ? item.items : [];
    const normalizedRefs = refs.flatMap((ref): MaterialRef[] => {
      if (!ref || typeof ref !== "object") return [];
      const candidate = ref as MaterialRef;
      if (candidate.kind === "history" && typeof candidate.historyId === "string" && candidate.historyId.trim()) {
        const historyId = candidate.historyId.trim();
        if (historyIds && !historyIds.has(historyId)) return [];
        return [{ kind: "history", historyId }];
      }
      if (candidate.kind === "source" && candidate.source && typeof candidate.source === "object") {
        const source = candidate.source as SourceImage;
        const path = typeof source.path === "string" ? source.path : "";
        const name = typeof source.name === "string" && source.name.trim()
          ? source.name.trim()
          : path.split(/[\\/]/).pop() ?? "source.png";
        if (!path && !source.imageB64 && !source.previewUrl) return [];
        return [{
          kind: "source",
          source: {
            path,
            name,
            size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0,
            previewUrl: typeof source.previewUrl === "string" ? source.previewUrl : undefined,
            imageBlob: null,
            imageB64: typeof source.imageB64 === "string" ? source.imageB64 : undefined,
          },
        }];
      }
      return [];
    });
    groupIds.add(id);
    groups.push({
      id,
      name: typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : kind === "referenceSet" ? "参考图组" : "新建文件夹",
      description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined,
      kind,
      items: uniqueMaterialRefs(normalizedRefs),
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
    });
  }
  return groups;
}

export function loadMaterialGroups(history?: HistoryItem[]): MaterialGroup[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MATERIAL_LIBRARY_KEY);
    if (!raw) return [];
    const historyIds = history ? new Set(history.map((item) => item.id)) : undefined;
    return normalizeMaterialGroups(JSON.parse(raw), historyIds);
  } catch {
    return [];
  }
}

export function persistMaterialGroups(groups: MaterialGroup[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MATERIAL_LIBRARY_KEY, JSON.stringify(groups));
  } catch {}
}

export function pruneMaterialGroupsForHistory(groups: MaterialGroup[], history: HistoryItem[]): MaterialGroup[] {
  const ids = new Set(history.map((item) => item.id));
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.kind !== "history" || ids.has(item.historyId)),
  }));
}

export function removeHistoryRefsFromMaterialGroups(groups: MaterialGroup[], historyIds: string[]): MaterialGroup[] {
  const ids = new Set(historyIds);
  if (ids.size === 0) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.kind !== "history" || !ids.has(item.historyId)),
    updatedAt: group.items.some((item) => item.kind === "history" && ids.has(item.historyId)) ? Date.now() : group.updatedAt,
  }));
}

export function groupedHistoryIds(groups: MaterialGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.kind !== "folder") continue;
    for (const item of group.items) {
      if (item.kind === "history") ids.add(item.historyId);
    }
  }
  return ids;
}

export function promptGroupedHistoryIds(history: HistoryItem[], excludedIds: Set<string> = new Set()): Set<string> {
  const ids = new Set<string>();
  for (const group of buildHistoryPromptGroups(history)) {
    const visibleItems = group.items.filter((item) => !excludedIds.has(item.id));
    if (visibleItems.length <= 1) continue;
    for (const item of visibleItems) ids.add(item.id);
  }
  return ids;
}

export function ungroupedHistoryItems(history: HistoryItem[], groups: MaterialGroup[]): HistoryItem[] {
  const manualIds = groupedHistoryIds(groups);
  return history.filter((item) => !manualIds.has(item.id));
}

export function smartPromptMaterialGroups(history: HistoryItem[], groups: MaterialGroup[]) {
  const manualIds = groupedHistoryIds(groups);
  return buildHistoryPromptGroups(history)
    .filter((group) => group.items.length > 1)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !manualIds.has(item.id)),
    }))
    .filter((group) => group.items.length > 1 && normalizeHistoryPrompt(group.prompt));
}

export function refsFromHistoryIds(ids: string[]): MaterialRef[] {
  return uniqueMaterialRefs(ids.map((historyId) => ({ kind: "history", historyId })));
}

export function refsFromSources(sources: SourceImage[]): MaterialRef[] {
  return uniqueMaterialRefs(sources.map((source) => ({
    kind: "source",
    source: {
      path: source.path,
      name: source.name,
      size: source.size,
      previewUrl: source.previewUrl,
      imageBlob: null,
      imageB64: source.previewUrl ? undefined : source.imageB64,
    },
  })));
}

export function sourceKey(source: SourceImage): string {
  return source.path || source.previewUrl || source.imageB64 || source.name;
}

export function mergeSources(existing: SourceImage[], incoming: SourceImage[], mode: "append" | "replace"): SourceImage[] {
  const base = mode === "replace" ? [] : [...existing];
  const seen = new Set(base.map(sourceKey));
  for (const source of incoming) {
    const key = sourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    base.push(source);
  }
  return base;
}
