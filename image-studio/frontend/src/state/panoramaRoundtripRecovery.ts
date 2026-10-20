import {
  buildPanoramaProjectRefFromRoundtrip,
  resolvePanoramaProjectRef,
  resolvePanoramaRoundtripRef,
} from "../panorama/core.ts";
import type { BatchTaskRecord, HistoryItem, SourceImage } from "../types/domain.ts";

function referenceKey(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\\/g, "/").toLowerCase();
}

function panoramaSourceIndex(history: readonly HistoryItem[]): Map<string, HistoryItem> {
  const index = new Map<string, HistoryItem>();
  for (const item of history) {
    if (!resolvePanoramaRoundtripRef(item)) continue;
    for (const value of [item.id, item.savedPath]) {
      const key = referenceKey(value);
      if (key && !index.has(key)) index.set(key, item);
    }
  }
  return index;
}

function sourceCandidate(
  source: Pick<SourceImage, "path">,
  index: ReadonlyMap<string, HistoryItem>,
): HistoryItem | null {
  return index.get(referenceKey(source.path)) ?? null;
}

function sourceWithRecoveredPanoramaMetadata(
  source: SourceImage,
  index: ReadonlyMap<string, HistoryItem>,
): SourceImage {
  if (source.panoramaRoundtrip) return source;
  const candidate = sourceCandidate(source, index);
  const roundtrip = resolvePanoramaRoundtripRef(candidate);
  if (!candidate || !roundtrip) return source;
  return {
    ...source,
    panoramaRoundtrip: roundtrip,
    panoramaProject: source.panoramaProject ?? resolvePanoramaProjectRef(candidate) ?? undefined,
  };
}

function planarRoundtripFromItem(item: HistoryItem | null | undefined): HistoryItem["localEditRoundtrip"] {
  if (item?.localEditRoundtrip?.kind === "planar") return item.localEditRoundtrip;
  return item?.sourceImages
    ?.map((source) => source.localEditRoundtrip)
    .find((roundtrip) => roundtrip?.kind === "planar");
}

export function isLocalEditPastebackTerminal(item: HistoryItem | null | undefined): boolean {
  return item?.localEditPastebackState === "pasted"
    || String(item?.prompt || "").startsWith("(局部贴回)");
}

type PlanarSourceIndex = {
  byId: Map<string, HistoryItem>;
  byPath: Map<string, HistoryItem>;
};

function planarSourceIndex(history: readonly HistoryItem[]): PlanarSourceIndex {
  const byId = new Map<string, HistoryItem>();
  const byPath = new Map<string, HistoryItem>();
  for (const item of history) {
    if (isLocalEditPastebackTerminal(item) || !planarRoundtripFromItem(item)) continue;
    const id = String(item.id || "").trim();
    const path = referenceKey(item.savedPath);
    if (id && !byId.has(id)) byId.set(id, item);
    if (path && !byPath.has(path)) byPath.set(path, item);
  }
  return { byId, byPath };
}

function planarItemForReference(
  index: PlanarSourceIndex,
  value: string | null | undefined,
): HistoryItem | null {
  const exactId = String(value || "").trim();
  return index.byId.get(exactId) ?? index.byPath.get(referenceKey(value)) ?? null;
}

function recoverPlanarSourceMetadata(
  sources: readonly SourceImage[],
  history: readonly HistoryItem[],
): SourceImage[] {
  if (sources.length === 0 || history.length === 0) return sources as SourceImage[];
  const index = planarSourceIndex(history);
  let changed = false;
  const recovered = sources.map((source) => {
    if (source.localEditRoundtrip?.kind === "planar") return source;
    const roundtrip = planarRoundtripFromItem(index.byPath.get(referenceKey(source.path)));
    if (!roundtrip || roundtrip.kind !== "planar") return source;
    changed = true;
    return { ...source, localEditRoundtrip: roundtrip };
  });
  return changed ? recovered : sources as SourceImage[];
}

export function recoverRoundtripSourceMetadata(
  sources: readonly SourceImage[],
  history: readonly HistoryItem[],
): SourceImage[] {
  const panoramaRecovered = recoverPanoramaSourceMetadata(sources, history);
  return recoverPlanarSourceMetadata(panoramaRecovered, history);
}

export function recoverPanoramaSourceMetadata(
  sources: readonly SourceImage[],
  history: readonly HistoryItem[],
): SourceImage[] {
  if (sources.length === 0 || history.length === 0) return sources as SourceImage[];
  const index = panoramaSourceIndex(history);
  let changed = false;
  const recovered = sources.map((source) => {
    const next = sourceWithRecoveredPanoramaMetadata(source, index);
    if (next !== source) changed = true;
    return next;
  });
  return changed ? recovered : sources as SourceImage[];
}

function matchingPanoramaSource(
  item: HistoryItem,
  index: ReadonlyMap<string, HistoryItem>,
): HistoryItem | null {
  const references = [
    item.parentId,
    item.panoramaProject?.shotHistoryId,
    ...(item.sourceImages ?? []).map((source) => source.path),
  ];
  for (const reference of references) {
    const candidate = index.get(referenceKey(reference));
    if (candidate && candidate.id !== item.id) return candidate;
  }
  return null;
}

function sourceImageFromHistoryItem(item: HistoryItem): SourceImage | null {
  const path = String(item.savedPath || "").trim();
  if (!path) return null;
  return {
    path,
    name: path.split(/[\\/]/).pop() || "panorama-shot.png",
    size: 0,
    width: item.width ?? item.previewWidth,
    height: item.height ?? item.previewHeight,
    imageBlob: null,
    panoramaRoundtrip: resolvePanoramaRoundtripRef(item) ?? undefined,
    panoramaProject: resolvePanoramaProjectRef(item) ?? undefined,
  };
}

export function recoverPanoramaItemMetadata(
  item: HistoryItem,
  history: readonly HistoryItem[],
): HistoryItem {
  if (item.panoramaProject?.role === "pasted-panorama") return item;
  if (item.panoramaRoundtrip || history.length === 0) return item;
  const index = panoramaSourceIndex(history);
  const recoveredSources = recoverPanoramaSourceMetadata(item.sourceImages ?? [], history);
  const nestedRoundtrip = recoveredSources
    .map((source) => source.panoramaRoundtrip)
    .find((roundtrip) => !!roundtrip);
  const candidate = matchingPanoramaSource(item, index);
  const roundtrip = nestedRoundtrip ?? resolvePanoramaRoundtripRef(candidate);
  if (!roundtrip) return item;

  const candidateSource = candidate ? sourceImageFromHistoryItem(candidate) : null;
  const sourceImages = recoveredSources.length > 0
    ? recoveredSources
    : candidateSource ? [candidateSource] : item.sourceImages;
  const sourceProject = candidate ? resolvePanoramaProjectRef(candidate) : null;
  const panoramaProject = item.panoramaProject
    ?? (sourceProject?.sourceHistoryId
      ? {
          ...sourceProject,
          role: "edited-shot" as const,
          shotHistoryId: sourceProject.shotHistoryId ?? candidate?.id,
          editedShotHistoryId: item.id,
        }
      : buildPanoramaProjectRefFromRoundtrip(roundtrip, "edited-shot", {
          shotHistoryId: candidate?.id,
          editedShotHistoryId: item.id,
        }));
  return {
    ...item,
    sourceImages,
    panoramaRoundtrip: roundtrip,
    panoramaProject,
  };
}

function sourceImagesFromTask(task: Pick<BatchTaskRecord, "sourceImagePaths" | "sourceImages">): SourceImage[] {
  if ((task.sourceImages?.length ?? 0) > 0) return task.sourceImages ?? [];
  return (task.sourceImagePaths ?? []).map((path) => ({
    path,
    name: path.split(/[\\/]/).pop() || "source.png",
    size: 0,
  }));
}

export function recoverPanoramaItemMetadataFromTask(
  item: HistoryItem,
  task: Pick<BatchTaskRecord, "batchSourcePath" | "sourceImagePaths" | "sourceImages"> | null | undefined,
  history: readonly HistoryItem[],
): HistoryItem {
  if (!task || item.panoramaRoundtrip) return recoverPanoramaItemMetadata(item, history);
  const taskSources = sourceImagesFromTask(task);
  const candidate = {
    ...item,
    parentId: item.parentId ?? task.batchSourcePath ?? task.sourceImagePaths?.[0],
    sourceImages: (item.sourceImages?.length ?? 0) > 0 ? item.sourceImages : taskSources,
  };
  const recovered = recoverPanoramaItemMetadata(candidate, history);
  return recovered.panoramaRoundtrip ? recovered : item;
}

type RoundtripRecoveryTask = Pick<
  BatchTaskRecord,
  "batchSourcePath" | "sourceImagePaths" | "sourceImages" | "localEditRoundtrip"
>;

function recoverPlanarItemMetadataFromTask(
  item: HistoryItem,
  task: RoundtripRecoveryTask | null | undefined,
  history: readonly HistoryItem[],
): HistoryItem {
  if (isLocalEditPastebackTerminal(item) || item.localEditRoundtrip?.kind === "planar") return item;

  const itemNested = planarRoundtripFromItem({ ...item, localEditRoundtrip: undefined });
  const taskTop = task?.localEditRoundtrip?.kind === "planar" ? task.localEditRoundtrip : undefined;
  const taskNested = task?.sourceImages
    ?.map((source) => source.localEditRoundtrip)
    .find((roundtrip) => roundtrip?.kind === "planar");
  let roundtrip = itemNested ?? taskTop ?? taskNested;

  if (!roundtrip && history.length > 0) {
    const index = planarSourceIndex(history);
    const references = [
      item.parentId,
      ...(item.sourceImages ?? []).map((source) => source.path),
      task?.batchSourcePath,
      ...(task?.sourceImagePaths ?? []),
    ];
    for (const reference of references) {
      const candidate = planarItemForReference(index, reference);
      if (!candidate || candidate.id === item.id) continue;
      roundtrip = planarRoundtripFromItem(candidate);
      if (roundtrip) break;
    }
  }

  return roundtrip?.kind === "planar" ? { ...item, localEditRoundtrip: roundtrip } : item;
}

export function recoverRoundtripItemMetadata(
  item: HistoryItem,
  history: readonly HistoryItem[],
): HistoryItem {
  return recoverPlanarItemMetadataFromTask(recoverPanoramaItemMetadata(item, history), null, history);
}

export function recoverRoundtripItemMetadataFromTask(
  item: HistoryItem,
  task: RoundtripRecoveryTask | null | undefined,
  history: readonly HistoryItem[],
): HistoryItem {
  const panoramaRecovered = recoverPanoramaItemMetadataFromTask(item, task, history);
  return recoverPlanarItemMetadataFromTask(panoramaRecovered, task, history);
}

export function panoramaSourcePathsForMetadataRecovery(
  history: readonly HistoryItem[],
  tasksById: Readonly<Record<string, BatchTaskRecord>>,
  workspaceSources: readonly SourceImage[],
): string[] {
  const paths = new Set<string>();
  const add = (value: string | null | undefined) => {
    const path = String(value || "").trim();
    if (path) paths.add(path);
  };
  for (const source of workspaceSources) {
    if (!source.panoramaRoundtrip && source.localEditRoundtrip?.kind !== "planar") add(source.path);
  }
  const missingHistoryIds = new Set<string>();
  for (const item of history) {
    if (item.panoramaProject?.role === "pasted-panorama" || isLocalEditPastebackTerminal(item)) continue;
    if (resolvePanoramaRoundtripRef(item) || planarRoundtripFromItem(item)) continue;
    missingHistoryIds.add(item.id);
    add(item.parentId);
    for (const source of item.sourceImages ?? []) add(source.path);
  }
  for (const task of Object.values(tasksById)) {
    if (task.panoramaRoundtrip || task.localEditRoundtrip?.kind === "planar" || !task.historyItemId || !missingHistoryIds.has(task.historyItemId)) continue;
    add(task.batchSourcePath);
    for (const path of task.sourceImagePaths ?? []) add(path);
  }
  return Array.from(paths);
}

export function panoramaHistoryIdsForMetadataRecovery(history: readonly HistoryItem[]): string[] {
  const ids = new Set<string>();
  const addProject = (project: SourceImage["panoramaProject"] | HistoryItem["panoramaProject"]) => {
    if (!project) return;
    if (project.shotHistoryId) ids.add(project.shotHistoryId);
  };
  for (const item of history) {
    if (item.panoramaProject?.role === "pasted-panorama" || isLocalEditPastebackTerminal(item)) continue;
    if (resolvePanoramaRoundtripRef(item) || planarRoundtripFromItem(item)) continue;
    addProject(item.panoramaProject);
    for (const source of item.sourceImages ?? []) addProject(source.panoramaProject);
    if (item.parentId) ids.add(item.parentId);
  }
  return Array.from(ids);
}

export function recoverPanoramaHistoryMetadata(
  history: readonly HistoryItem[],
  tasksById: Readonly<Record<string, BatchTaskRecord>> = {},
): {
  items: HistoryItem[];
  repaired: HistoryItem[];
} {
  const tasks = Object.values(tasksById);
  const repaired: HistoryItem[] = [];
  const items = history.map((item) => {
    const task = tasks.find((candidate) => (
      candidate.historyItemId === item.id
      || (!!candidate.savedPath && candidate.savedPath === item.savedPath)
    ));
    const next = recoverPanoramaItemMetadataFromTask(item, task, history);
    if (next !== item) repaired.push(next);
    return next;
  });
  return { items, repaired };
}

export function recoverRoundtripHistoryMetadata(
  history: readonly HistoryItem[],
  tasksById: Readonly<Record<string, BatchTaskRecord>> = {},
): {
  items: HistoryItem[];
  repaired: HistoryItem[];
} {
  const tasks = Object.values(tasksById);
  const repaired: HistoryItem[] = [];
  const items = history.map((item) => {
    const task = tasks.find((candidate) => (
      candidate.historyItemId === item.id
      || (!!candidate.savedPath && referenceKey(candidate.savedPath) === referenceKey(item.savedPath))
    ));
    const next = recoverRoundtripItemMetadataFromTask(item, task, history);
    if (next !== item) repaired.push(next);
    return next;
  });
  return { items, repaired };
}
