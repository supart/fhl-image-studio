import { DEFAULT_FHL_SIZE } from "../lib/generationDefaults.ts";
import { DEFAULT_CONCURRENCY_LIMIT } from "../lib/profiles.ts";
import { storageKey } from "../lib/storageNamespace.ts";
import type { Workspace } from "../types/domain";
import { MATERIAL_LIBRARY_KEY } from "./materialLibrary.ts";
import type { StudioState } from "./studioStore.types";
import {
  APPLICATION_SETTING_DEFAULT_STORAGE_VALUES,
  APPLICATION_SETTINGS_DEFAULTS,
} from "./studioStore.settings.ts";
import { defaultBatchProcessConfig } from "./workspaceRuntime.ts";
export { createDefaultWorkspace } from "./workspaceDefaults.ts";

export type ResetSummary = {
  historyEntriesCleared: number;
  fullHistoryEntriesCleared: number;
  workspacesReset: number;
  taskRecordsCleared: number;
  promptHistoryEntriesCleared: number;
  presetsCleared: number;
  materialGroupsCleared: number;
  localContentEntriesCleared: number;
  apiConfigurationsPreserved: number;
  defaultsRestored: string[];
  warnings: string[];
};

export type ResetStorageSummary = {
  contentEntriesCleared: number;
  settingEntriesDefaulted: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CONTENT_KEYS = [
  storageKey("gptcodex.promptHistory"),
  storageKey("gptcodex.presets"),
  MATERIAL_LIBRARY_KEY,
  storageKey("gptcodex.workspaceSession.v1"),
  storageKey("gptcodex.starPrompted"),
  storageKey("gptcodex.quote.idx"),
] as const;

const DEFAULT_SETTING_VALUES = [
  ...APPLICATION_SETTING_DEFAULT_STORAGE_VALUES,
  [storageKey("gptcodex.fhlImagesPool.perApiConcurrencyLimit.v1"), String(DEFAULT_CONCURRENCY_LIMIT)],
] as const;

export const APPLICATION_RESET_DEFAULT_LABELS = [
  "主题",
  "字号",
  "执行内核",
  "输出格式",
  "代理",
  "共享并发",
  "输出目录",
] as const;

export class ApplicationStateEpoch {
  private value = 0;

  capture(): number {
    return this.value;
  }

  advance(): number {
    this.value += 1;
    return this.value;
  }

  isCurrent(captured: number): boolean {
    return captured === this.value;
  }
}

export const applicationStateEpoch = new ApplicationStateEpoch();

export function resetNonAPIStorage(storage: StorageLike = localStorage): ResetStorageSummary {
  let contentEntriesCleared = 0;
  for (const key of CONTENT_KEYS) {
    if (storage.getItem(key) !== null) contentEntriesCleared += 1;
    storage.removeItem(key);
  }
  for (const [key, value] of DEFAULT_SETTING_VALUES) storage.setItem(key, value);
  return {
    contentEntriesCleared,
    settingEntriesDefaulted: DEFAULT_SETTING_VALUES.length,
  };
}

export function createApplicationResetPatch(workspace: Workspace): Partial<StudioState> {
  return {
    mode: "generate",
    promptPrefix: "",
    prompt: "",
    optimizationGuidance: "",
    negativePrompt: "",
    size: DEFAULT_FHL_SIZE,
    quality: "medium",
    ...APPLICATION_SETTINGS_DEFAULTS,
    seed: 0,
    noPromptRevision: true,
    sources: [],
    reversePromptImage: null,
    runningJobs: [],
    jobsTotal: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    progress: null,
    streamPreview: null,
    streamPreviews: {},
    lastLogLine: "",
    errorMessage: null,
    errorRawPath: null,
    isRunning: false,
    lastPayload: null,
    runningJobMeta: {},
    jobGroupsByWorkspace: {},
    batchTasksById: {},
    currentImage: null,
    sourcePreviewReturnImage: null,
    history: [],
    historyHasMore: false,
    historyLoading: false,
    historyCursor: null,
    batchResults: [],
    selectedBatchTaskId: null,
    resultGridOpen: false,
    historyGalleryOpen: false,
    historyGallerySinglePreviewId: null,
    historyGallerySort: "newest",
    materialManagerOpen: false,
    materialGroups: [],
    historyRailCollapsed: false,
    historyTimelineOpen: false,
    tool: "pan",
    brushSize: 30,
    brushMode: "paint",
    annotationKind: "rect",
    annotationColor: "#ff4d4d",
    selectedAnnotationId: null,
    maskDataURL: null,
    strokes: [],
    annotations: [],
    undoStack: [],
    redoStack: [],
    workspacePromptOperations: {},
    compareB: null,
    compareMode: "curtain",
    compareSplit: 0.5,
    recentDurations: [],
    viewZoom: 1,
    canvasViewResetTick: 0,
    fullscreen: false,
    starPromptOpen: false,
    starPromptSource: "auto",
    promptHistory: [],
    batchCount: 1,
    continuousGenerateTest: false,
    fhlPoolPerAPIConcurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
    fhlPoolEffectiveConcurrencyByProfileId: {},
    editSourceMode: "manual",
    batchProcess: defaultBatchProcessConfig(),
    editAutoAspectUserLocked: false,
    presets: [],
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    styleTag: "",
    resultDetail: null,
    panoramaViewerItem: null,
    panoramaAlignTarget: null,
    upstreamModalOpen: false,
    upstreamReturnTarget: "app",
  };
}

export function countPreservedAPIConfigurations(state: Pick<StudioState, "profiles" | "fhlTextAPIConfigured">): number {
  return state.profiles.length + (state.fhlTextAPIConfigured ? 1 : 0);
}
