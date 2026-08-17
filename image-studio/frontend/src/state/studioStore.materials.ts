import {
  OpenMaterialSyncDir,
  SyncMaterialGroupToOutput,
} from "../platform/runtime/host.ts";
import type { MaterialOutputSyncItemLike } from "../platform/runtime/hostTypes.ts";
import type {
  HistoryItem,
  MaterialGroup,
  MaterialGroupKind,
  MaterialRef,
  SourceImage,
} from "../types/domain.ts";
import {
  createMaterialGroupInput,
  materialRefKey,
  mergeSources,
  persistMaterialGroups,
  refsFromSources,
  uniqueMaterialGroupName,
  uniqueMaterialRefs,
} from "./materialLibrary.ts";
import {
  materializeHistoryItem,
  materializeMediaRefForHistoryItem,
  withMediaAssetRef,
} from "./studioStore.runtime.ts";
import type { StudioState } from "./studioStore.types.ts";
import { patchWorkspaceRuntime } from "./workspaceRuntime.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

function pathLeaf(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? "";
}

async function sourceFromHistoryForMaterial(
  store: StateAdapter,
  item: HistoryItem,
): Promise<SourceImage | null> {
  const full = await materializeHistoryItem(item, {
    setState: (fn) => store.setState((state) => fn(state)),
  }).catch(() => null);
  if (!full?.savedPath) return null;
  let previewItem = full;
  if (!previewItem.previewUrl && !previewItem.previewBlob && !previewItem.imageB64) {
    const ref = await materializeMediaRefForHistoryItem(full).catch(() => null);
    if (ref) previewItem = withMediaAssetRef(previewItem, ref);
  }
  return {
    path: full.savedPath,
    name: pathLeaf(full.savedPath) || "source.png",
    size: 0,
    imageBlob: previewItem.previewUrl ? null : (previewItem.previewBlob ?? previewItem.imageBlob ?? null),
    imageB64: previewItem.previewUrl ? undefined : previewItem.imageB64,
    previewUrl: previewItem.previewUrl,
  };
}

export function materialSyncItemsForGroup(
  group: MaterialGroup,
  historyById: Map<string, HistoryItem>,
): MaterialOutputSyncItemLike[] {
  return group.items.map((ref, index) => {
    if (ref.kind === "source") {
      const savedPath = ref.source.path?.trim() ?? "";
      const suggestedName = ref.source.name?.trim() || pathLeaf(savedPath);
      return {
        historyId: savedPath ? `source:${savedPath}` : `source:${group.id}:${index}`,
        savedPath,
        suggestedName,
        missingReason: savedPath ? undefined : "Missing source path",
      };
    }
    const item = historyById.get(ref.historyId);
    if (!item) {
      return {
        historyId: ref.historyId,
        savedPath: "",
        suggestedName: `${ref.historyId}.png`,
        missingReason: "History item not found",
      };
    }
    const savedPath = item.savedPath?.trim() ?? "";
    return {
      historyId: item.id,
      savedPath,
      suggestedName: savedPath ? pathLeaf(savedPath) : `${item.imageId || item.id}.png`,
      missingReason: savedPath ? undefined : "History item has no saved path",
    };
  });
}

export function createMaterialActions(store: StateAdapter) {
  return {
    openMaterialManager() {
      store.setState({ materialManagerOpen: true });
    },

    closeMaterialManager() {
      store.setState({ materialManagerOpen: false });
    },

    createMaterialGroup(
      kind: MaterialGroupKind,
      name: string,
      items: MaterialRef[] = [],
      description = "",
    ): string {
      const resolvedName = uniqueMaterialGroupName(store.getState().materialGroups, kind, name)
        || (kind === "referenceSet" ? "Reference Set" : "Folder");
      const nextGroup = createMaterialGroupInput(kind, resolvedName, items, Date.now(), description);
      store.setState((state) => {
        const next = [...state.materialGroups, nextGroup];
        persistMaterialGroups(next);
        return { materialGroups: next };
      });
      return nextGroup.id;
    },

    renameMaterialGroup(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      store.setState((state) => {
        const next = state.materialGroups.map((group) => (
          group.id === id ? { ...group, name: trimmed, updatedAt: Date.now() } : group
        ));
        persistMaterialGroups(next);
        return { materialGroups: next };
      });
    },

    deleteMaterialGroup(id: string) {
      store.setState((state) => {
        const next = state.materialGroups.filter((group) => group.id !== id);
        persistMaterialGroups(next);
        return { materialGroups: next };
      });
    },

    moveHistoryItemsToMaterialGroup(groupId: string, historyIds: string[]) {
      const refs = historyIds
        .filter((historyId) => store.getState().history.some((item) => item.id === historyId))
        .map((historyId) => ({ kind: "history", historyId }) satisfies MaterialRef);
      if (refs.length === 0) return;
      store.setState((state) => {
        const next = state.materialGroups.map((group) => (
          group.id === groupId
            ? { ...group, items: uniqueMaterialRefs([...group.items, ...refs]), updatedAt: Date.now() }
            : group
        ));
        persistMaterialGroups(next);
        return { materialGroups: next };
      });
    },

    removeMaterialItem(groupId: string, itemRef: MaterialRef) {
      const targetKey = materialRefKey(itemRef);
      store.setState((state) => {
        const next = state.materialGroups.map((group) => (
          group.id === groupId
            ? { ...group, items: group.items.filter((item) => materialRefKey(item) !== targetKey), updatedAt: Date.now() }
            : group
        ));
        persistMaterialGroups(next);
        return { materialGroups: next };
      });
    },

    createReferenceSetFromCurrentSources(name: string): string | null {
      const refs = refsFromSources(store.getState().sources);
      if (refs.length === 0) {
        store.getState().pushToast("Current sources are empty; nothing to save as a reference set", "warn", 2400);
        return null;
      }
      const groupId = store.getState().createMaterialGroup("referenceSet", name || "Reference Set", refs);
      store.getState().pushToast(`Created a reference set with ${refs.length} items`, "success", 2200);
      return groupId;
    },

    async applyMaterialReferenceSet(groupId: string, mode: "append" | "replace") {
      const state = store.getState();
      const group = state.materialGroups.find((item) => item.id === groupId && item.kind === "referenceSet");
      if (!group) return;
      const historyById = new Map(state.history.map((item) => [item.id, item]));
      const sources: SourceImage[] = [];
      for (const ref of group.items) {
        if (ref.kind === "source") {
          sources.push(ref.source);
          continue;
        }
        const item = historyById.get(ref.historyId);
        if (!item) continue;
        const source = await sourceFromHistoryForMaterial(store, item);
        if (source) sources.push(source);
      }
      if (sources.length === 0) {
        store.getState().pushToast("Reference set does not contain any usable source images", "warn", 2400);
        return;
      }
      const nextSources = mergeSources(store.getState().sources, sources, mode);
      store.setState((current) => ({
        sources: nextSources,
        mode: "edit",
        materialManagerOpen: false,
        workspaces: patchWorkspaceRuntime(current.workspaces, current.activeWorkspaceId, {
          sources: nextSources,
          mode: "edit",
        }),
      }));
      store.getState().pushToast(
        mode === "replace"
          ? `Replaced sources with ${nextSources.length} reference images`
          : `Added ${sources.length} reference images`,
        "success",
        2200,
      );
    },

    async syncMaterialGroupToOutput(groupId: string) {
      const state = store.getState();
      const group = state.materialGroups.find((item) => item.id === groupId);
      if (!group) {
        state.pushToast("Material group was not found for output sync", "warn", 2600);
        return null;
      }
      const historyById = new Map(state.history.map((item) => [item.id, item]));
      const items = materialSyncItemsForGroup(group, historyById);
      try {
        const result = await SyncMaterialGroupToOutput(group.kind, group.name, items);
        if (result.synced > 0 && result.missing > 0) {
          store.getState().pushToast(`Synced ${result.synced} items to output; ${result.missing} were missing`, "warn", 3600);
        } else if (result.synced > 0) {
          store.getState().pushToast(`已同步 ${result.synced} 项到 output`, "success", 2600);
        } else if (result.missing > 0) {
          store.getState().pushToast(`Skipped ${result.missing} missing items during output sync`, "warn", 3600);
        } else {
          store.getState().pushToast("Material group synced to output", "success", 2200);
        }
        return result;
      } catch (error: any) {
        store.getState().pushToast(`同步到 output 失败：${error?.message ?? error}`, "error", 4200);
        return null;
      }
    },

    async syncAllMaterialGroupsToOutput() {
      const state = store.getState();
      const groups = state.materialGroups.filter((group) => group.kind === "folder" || group.kind === "referenceSet");
      if (groups.length === 0) {
        state.pushToast("No folders or reference sets are available for output sync", "warn", 2600);
        return;
      }
      const historyById = new Map(state.history.map((item) => [item.id, item]));
      let synced = 0;
      let missing = 0;
      let failed = 0;
      for (const group of groups) {
        try {
          const result = await SyncMaterialGroupToOutput(
            group.kind,
            group.name,
            materialSyncItemsForGroup(group, historyById),
          );
          synced += result.synced;
          missing += result.missing;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        store.getState().pushToast(`Synced ${synced} items; ${missing} missing; ${failed} groups failed`, "warn", 4600);
      } else if (missing > 0) {
        store.getState().pushToast(`Synced ${synced} items to output; ${missing} were missing`, "warn", 4200);
      } else {
        store.getState().pushToast(`Synced ${synced} items to output`, "success", 3200);
      }
    },

    async openMaterialSyncDir(path?: string) {
      try {
        await OpenMaterialSyncDir(path ?? "");
      } catch (error: any) {
        store.getState().pushToast(`打开同步目录失败：${error?.message ?? error}`, "error", 3600);
      }
    },
  };
}
