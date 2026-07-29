import type {
  JobGroupSnapshot,
  JobSlotSnapshot,
  Mode,
  OutputFormatValue,
  QualityValue,
  RequestPolicy,
  SizeValue,
} from "../../types/domain.ts";

export const BROWSER_JOB_PROXY_PREFIX = "/__image-studio-jobs";
export const BROWSER_JOB_REGISTRY_FILENAME = "browser-jobs.v1.json";
export const MAX_BROWSER_JOB_GROUPS = 500;
export const MAX_BROWSER_JOB_SUBMIT_MANY_ITEMS = 50;

export type BrowserJobEvent =
  | { type: "snapshot"; slot: JobSlotSnapshot; group: JobGroupSnapshot }
  | { type: "terminal"; slot: JobSlotSnapshot; group: JobGroupSnapshot }
  | { type: "cancelled"; slot: JobSlotSnapshot; group: JobGroupSnapshot }
  | { type: "error"; slot: JobSlotSnapshot; group: JobGroupSnapshot };

export interface BrowserJobSubmitPayload {
  workspaceId: string;
  mode: Mode;
  prompt: string;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  batchCount: number;
  seed: number;
  negativePrompt: string;
  styleTag?: string;
  sourceImagePaths?: string[];
  batchSourcePath?: string;
  batchSourceSlotIndex?: number;
  maskB64?: string;
  apiKey: string;
  baseURL: string;
  apiMode: "responses" | "images" | "apimart" | "runninghub";
  apiProfileId?: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  requestPolicy: RequestPolicy;
  imagesNewAPICompat?: boolean;
  textModelID: string;
  imageModelID: string;
  continuousGenerateTest?: boolean;
  continuousBatchIndex?: number;
}

export interface BrowserJobSubmitResponse {
  groupId: string;
  jobIds: string[];
  group: JobGroupSnapshot;
}

export interface BrowserJobSubmitManyCredential {
  apiProfileId: string;
  apiProfileName?: string;
  fhlImagesPoolSlot?: number;
  apiKey: string;
  baseURL: string;
  apiMode: "responses" | "images" | "apimart" | "runninghub";
  requestPolicy: RequestPolicy;
  imagesNewAPICompat?: boolean;
  textModelID: string;
  imageModelID: string;
}

export interface BrowserJobSubmitManyTask {
  clientTaskId: string;
  runId?: string;
  workspaceId: string;
  mode: Mode;
  prompt: string;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: OutputFormatValue;
  seed: number;
  negativePrompt: string;
  styleTag?: string;
  sourceImagePaths?: string[];
  batchSourcePath?: string;
  batchSourceSlotIndex?: number;
  maskB64?: string;
  apiProfileId: string;
  continuousGenerateTest?: boolean;
  continuousBatchIndex?: number;
}

export interface BrowserJobSubmitManyRequest {
  runId: string;
  credentials: BrowserJobSubmitManyCredential[];
  tasks: BrowserJobSubmitManyTask[];
}

export interface BrowserJobSubmitManyItemResult {
  clientTaskId: string;
  ok: boolean;
  group?: JobGroupSnapshot;
  error?: string;
}

export interface BrowserJobSubmitManyResponse {
  runId: string;
  results: BrowserJobSubmitManyItemResult[];
}

export interface BrowserJobListResponse {
  workspaceId: string;
  groups: JobGroupSnapshot[];
}

export interface BrowserJobCancelPayload {
  jobIds: string[];
}

export interface BrowserJobCancelResponse {
  cancelledJobIds: string[];
}

export interface BrowserJobRegistry {
  version: 1;
  updatedAt: number;
  groups: JobGroupSnapshot[];
}

export function emptyJobStatusSummary() {
  return {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
  };
}

export function summarizeJobStatuses(slots: JobSlotSnapshot[]) {
  const summary = emptyJobStatusSummary();
  for (const slot of slots) {
    summary[slot.status] += 1;
  }
  return summary;
}

export function sortJobGroupsNewestFirst(groups: JobGroupSnapshot[]) {
  return [...groups].sort((a, b) => b.createdAt - a.createdAt);
}

export function browserJobGroupIsActive(group: JobGroupSnapshot) {
  return group.slots.some((slot) => slot.status === "queued" || slot.status === "running");
}

export function retainBrowserJobGroups(
  groups: JobGroupSnapshot[],
  settledLimit = MAX_BROWSER_JOB_GROUPS,
) {
  const unique = new Map<string, JobGroupSnapshot>();
  for (const group of sortJobGroupsNewestFirst(groups)) {
    if (!unique.has(group.groupId)) unique.set(group.groupId, group);
  }
  const ordered = Array.from(unique.values());
  const active = ordered.filter(browserJobGroupIsActive);
  const settled = ordered
    .filter((group) => !browserJobGroupIsActive(group))
    .slice(0, Math.max(0, Math.floor(settledLimit)));
  return sortJobGroupsNewestFirst([...active, ...settled]);
}
