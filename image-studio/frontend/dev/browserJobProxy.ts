import { Buffer } from "node:buffer";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  BROWSER_JOB_PROXY_PREFIX,
  BROWSER_JOB_REGISTRY_FILENAME,
  MAX_BROWSER_JOB_GROUPS,
  MAX_BROWSER_JOB_SUBMIT_MANY_ITEMS,
  emptyJobStatusSummary,
  retainBrowserJobGroups,
  summarizeJobStatuses,
  type BrowserJobCancelResponse,
  type BrowserJobEvent,
  type BrowserJobListResponse,
  type BrowserJobRegistry,
  type BrowserJobSubmitManyItemResult,
  type BrowserJobSubmitManyRequest,
  type BrowserJobSubmitManyResponse,
  type BrowserJobSubmitPayload,
  type BrowserJobSubmitResponse,
} from "../src/platform/runtime/browserJobContracts.ts";
import type {
  JobGroupSnapshot,
  JobSlotSnapshot,
  JobStatus,
} from "../src/types/domain.ts";

type JobSubscriber = {
  res: ServerResponse;
  req: IncomingMessage;
  heartbeat?: ReturnType<typeof setInterval>;
};

type RunningProcess = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  cancelled: boolean;
  startedAt: number;
  lastActivityAt: number;
  timeoutTimer?: ReturnType<typeof setInterval>;
  timedOutMessage?: string;
};

type SequentialJobQueue = {
  payload: BrowserJobSubmitPayload;
};

type RegisteredBrowserJob = {
  payload: BrowserJobSubmitPayload;
  group: JobGroupSnapshot;
};

type BrowserJobManagerHooks = {
  disableSpawning?: boolean;
  onRegistryWrite?: () => void;
};

const BROWSER_JOB_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_JOB_DEFAULT_MAX_RUNTIME_MS = 20 * 60 * 1000;
const BROWSER_JOB_APIMART_MAX_RUNTIME_MS = 35 * 60 * 1000;
const BROWSER_JOB_TIMEOUT_CHECK_INTERVAL_MS = 15 * 1000;
const BROWSER_JOB_SSE_HEARTBEAT_MS = 15 * 1000;
const BROWSER_JOB_PERSIST_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000] as const;
const APIMART_OFFICIAL_BASE_URL = "https://api.apimart.ai";
const APIMART_LEGACY_BASE_URL = "https://api.apib.ai";

function minutesLabel(ms: number) {
  return `${Math.round(ms / 60_000)} 分钟`;
}

function maxRuntimeForPayload(payload: BrowserJobSubmitPayload) {
  return payload.apiMode === "apimart"
    ? BROWSER_JOB_APIMART_MAX_RUNTIME_MS
    : BROWSER_JOB_DEFAULT_MAX_RUNTIME_MS;
}

function timeoutSwitchHint(payload: BrowserJobSubmitPayload) {
  return payload.apiMode === "apimart" ? "请稍后重试。" : "建议切换 APIMart 或稍后重试。";
}

function timeoutMessageForPayload(
  payload: BrowserJobSubmitPayload,
  reason: "idle" | "runtime",
  durationMs: number,
) {
  const duration = minutesLabel(durationMs);
  const hint = timeoutSwitchHint(payload);
  return reason === "idle"
    ? `生成任务超过 ${duration} 没有收到进度更新，已自动判定失败。${hint}`
    : `生成任务超过 ${duration} 仍未返回结果，已自动判定失败。${hint}`;
}

function clearProcessTimeout(proc: RunningProcess) {
  if (!proc.timeoutTimer) return;
  clearInterval(proc.timeoutTimer);
  proc.timeoutTimer = undefined;
}

function sendJSON(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function openEventStream(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function clearSubscriberHeartbeat(subscriber: JobSubscriber) {
  if (!subscriber.heartbeat) return;
  clearInterval(subscriber.heartbeat);
  subscriber.heartbeat = undefined;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isTransientRegistryWriteError(error: unknown) {
  const code = String((error as { code?: unknown })?.code || "").toUpperCase();
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE";
}

function registryWriteErrorMessage(error: unknown) {
  return String((error as { message?: unknown })?.message || error || "unknown error");
}

async function readJSONBody(req: IncomingMessage, maxBytes = 4 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanBase64(value: string) {
  const raw = String(value || "").trim();
  const comma = raw.indexOf(",");
  return (comma >= 0 ? raw.slice(comma + 1) : raw).replace(/\s+/g, "");
}

function genId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toWindowsPath(raw: string) {
  return String(raw || "").trim();
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractMessageFromErrorPayload(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const directMessage = typeof record.message === "string" ? record.message.trim() : "";
  if (directMessage) return directMessage;
  const directError = typeof record.error === "string" ? record.error.trim() : "";
  if (directError) return directError;
  const nestedError = extractMessageFromErrorPayload(record.error);
  if (nestedError) return nestedError;
  const nestedResponse = extractMessageFromErrorPayload(record.response);
  if (nestedResponse) return nestedResponse;
  const nestedData = extractMessageFromErrorPayload(record.data);
  if (nestedData) return nestedData;
  return "";
}

function extractRawResponseErrorMessage(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parsed = safeJsonParse(text);
  const parsedMessage = extractMessageFromErrorPayload(parsed);
  if (parsedMessage) return parsedMessage;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    const lineMessage = extractMessageFromErrorPayload(safeJsonParse(payload));
    if (lineMessage) return lineMessage;
  }
  return "";
}

function genericHTTPError(raw: string) {
  const message = String(raw || "").trim();
  return /^upstream HTTP \d{3}$/i.test(message)
    || /^HTTP \d{3}$/i.test(message)
    || /^上游返回\s*\d{3}\s*:?$/i.test(message);
}

function extractAPIMartTaskIdFromText(raw: unknown): string {
  const match = String(raw || "").match(/\btask[-_](?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]{5,}\b/i);
  return match?.[0] ?? "";
}

async function readRawResponseErrorMessage(rawPath: unknown, logDir: string): Promise<string> {
  const raw = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!raw) return "";
  const candidates = [raw];
  const baseName = path.basename(raw);
  if (baseName && !candidates.includes(path.join(logDir, baseName))) {
    candidates.push(path.join(logDir, baseName));
  }
  for (const candidate of candidates) {
    try {
      const body = await fs.readFile(candidate, "utf8");
      const message = extractRawResponseErrorMessage(body);
      if (message) return message;
    } catch {
      // The CLI may emit paths through a different Windows code page. In that
      // case the basename fallback above is enough for files in output/log.
    }
  }
  return "";
}

async function readRawResponseTaskId(rawPath: unknown, logDir: string): Promise<string> {
  const raw = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!raw) return "";
  const candidates = [raw];
  const baseName = path.basename(raw);
  if (baseName && !candidates.includes(path.join(logDir, baseName))) {
    candidates.push(path.join(logDir, baseName));
  }
  for (const candidate of candidates) {
    try {
      const body = await fs.readFile(candidate, "utf8");
      const taskId = extractAPIMartTaskIdFromText(body);
      if (taskId) return taskId;
    } catch {
      // See readRawResponseErrorMessage: paths can be mojibake when emitted by
      // the CLI, so the basename fallback handles normal output/log files.
    }
  }
  return "";
}

function modeActionLabel(mode: string) {
  return mode === "edit" ? "edit" : "generate";
}

function effectiveAPIModeForJob(_mode: string, apiMode: "responses" | "images" | "apimart" | "runninghub") {
  return apiMode;
}

function effectiveBaseURLForCLI(payload: BrowserJobSubmitPayload) {
  const raw = String(payload.baseURL || "").trim();
  if (payload.apiMode !== "apimart") return raw;
  const normalized = raw.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return normalized === APIMART_OFFICIAL_BASE_URL ? APIMART_LEGACY_BASE_URL : raw;
}

function shouldRunSequentially(payload: BrowserJobSubmitPayload) {
  return payload.mode === "edit"
    && (Math.max(1, payload.batchCount) > 1 || (payload.sourceImagePaths?.length ?? 0) > 1);
}

function normalizeAttemptSummary(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function friendlyJobError(raw: string, fallbackMode: string) {
  const message = String(raw || "").trim();
  const lower = message.toLowerCase();
  if (message.includes("无可用账号") || message.includes("请稍后重试") || lower.includes("no available account") || lower.includes("503")) {
    return "FHL 账号池暂时繁忙，已自动重试；仍失败请稍后重试。";
  }
  if (fallbackMode === "contact_sheet") {
    return `多参考图直传失败，已尝试合成参考图兼容模式。${message ? `\n${message}` : ""}`;
  }
  return message;
}

async function consumeLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim()) onLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

export class BrowserJobManager {
  private registry: BrowserJobRegistry = { version: 1, updatedAt: Date.now(), groups: [] };
  private readonly running = new Map<string, RunningProcess>();
  private readonly subscribers = new Map<string, Set<JobSubscriber>>();
  private readonly workspaceSubscribers = new Map<string, Set<JobSubscriber>>();
  private readonly sequentialQueues = new Map<string, SequentialJobQueue>();
  private persistSequence = 0;
  private persistedSequence = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly repoRoot: string;
  private readonly outputDir: string;
  private readonly inputDir: string;
  private readonly cliExePath: string;
  private readonly registryPath: string;
  private readonly hooks: BrowserJobManagerHooks;

  constructor(
    repoRoot: string,
    outputDir: string,
    inputDir: string,
    cliExePath: string,
    registryPath: string,
    hooks: BrowserJobManagerHooks = {},
  ) {
    this.repoRoot = repoRoot;
    this.outputDir = outputDir;
    this.inputDir = inputDir;
    this.cliExePath = cliExePath;
    this.registryPath = registryPath;
    this.hooks = hooks;
  }

  async init() {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(this.inputDir, { recursive: true });
    const raw = await fs.readFile(this.registryPath, "utf8").catch(() => "");
    const parsed = raw.trim() ? safeJsonParse(raw) : null;
    if (parsed?.version === 1 && Array.isArray(parsed?.groups)) {
      this.registry = {
        version: 1,
        updatedAt: Number(parsed.updatedAt) || Date.now(),
        groups: parsed.groups as JobGroupSnapshot[],
      };
    }
    let touched = false;
    const restoredGroups = this.registry.groups
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((group) => {
        const slots = group.slots.map((slot) => {
          if (slot.status === "queued" || slot.status === "running") {
            touched = true;
            return {
              ...slot,
              status: "interrupted" as JobStatus,
              updatedAt: Date.now(),
              finishedAt: slot.finishedAt ?? Date.now(),
              errorMessage: slot.errorMessage || "本地服务已重启，任务状态中断。",
            };
          }
          return slot;
        });
        return {
          ...group,
          apiMode: group.apiMode === "images" || group.apiMode === "apimart" || group.apiMode === "runninghub"
            ? group.apiMode
            : "responses",
          slots,
          slotIds: slots.map((slot) => slot.jobId),
          statusSummary: summarizeJobStatuses(slots),
        };
      });
    this.registry.groups = retainBrowserJobGroups(restoredGroups, MAX_BROWSER_JOB_GROUPS);
    if (touched) await this.persist();
  }

  listWorkspace(workspaceId: string, limit = MAX_BROWSER_JOB_GROUPS): BrowserJobListResponse {
    const groups = retainBrowserJobGroups(
      this.registry.groups.filter((group) => group.workspaceId === workspaceId),
      Math.max(1, limit),
    );
    return {
      workspaceId,
      groups,
    };
  }

  private createRegisteredJob(
    payload: BrowserJobSubmitPayload,
    metadata: { runId?: string; clientTaskId?: string } = {},
  ): RegisteredBrowserJob {
    const effectivePayload: BrowserJobSubmitPayload = {
      ...payload,
      apiMode: effectiveAPIModeForJob(payload.mode, payload.apiMode),
    };
    const now = Date.now();
    const groupId = genId("group");
    const slots: JobSlotSnapshot[] = Array.from({ length: Math.max(1, effectivePayload.batchCount) }, (_, index) => ({
      jobId: genId("job"),
      groupId,
      workspaceId: effectivePayload.workspaceId,
      batchIndex: index,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      stage: "排队中",
      elapsedSec: 0,
      bytes: 0,
    }));
    const group: JobGroupSnapshot = {
      groupId,
      runId: String(metadata.runId || "").trim() || undefined,
      clientTaskId: String(metadata.clientTaskId || "").trim() || undefined,
      workspaceId: effectivePayload.workspaceId,
      createdAt: now,
      mode: effectivePayload.mode,
      apiMode: effectivePayload.apiMode,
      apiProfileId: typeof effectivePayload.apiProfileId === "string" ? effectivePayload.apiProfileId.trim() || undefined : undefined,
      apiProfileName: typeof effectivePayload.apiProfileName === "string" ? effectivePayload.apiProfileName.trim() || undefined : undefined,
      prompt: effectivePayload.prompt,
      batchCount: slots.length,
      size: effectivePayload.size,
      quality: effectivePayload.quality,
      outputFormat: effectivePayload.outputFormat,
      negativePrompt: effectivePayload.negativePrompt,
      styleTag: effectivePayload.styleTag || "",
      seed: effectivePayload.seed || 0,
      sourceImagePaths: effectivePayload.sourceImagePaths?.map(toWindowsPath).filter(Boolean) ?? [],
      batchSourcePath: typeof effectivePayload.batchSourcePath === "string"
        ? toWindowsPath(effectivePayload.batchSourcePath).trim() || undefined
        : undefined,
      batchSourceSlotIndex: Number.isFinite(Number(effectivePayload.batchSourceSlotIndex))
        ? Math.max(0, Math.floor(Number(effectivePayload.batchSourceSlotIndex)))
        : undefined,
      continuousGenerateTest: effectivePayload.continuousGenerateTest === true,
      continuousBatchIndex: Number.isFinite(Number(effectivePayload.continuousBatchIndex))
        ? Math.max(0, Math.floor(Number(effectivePayload.continuousBatchIndex)))
        : undefined,
      slotIds: slots.map((slot) => slot.jobId),
      slots,
      statusSummary: summarizeJobStatuses(slots),
    };
    return { payload: effectivePayload, group };
  }

  private registerGroups(groups: JobGroupSnapshot[]) {
    if (groups.length === 0) return;
    const groupIds = new Set(groups.map((group) => group.groupId));
    this.registry.groups = retainBrowserJobGroups(
      [...groups, ...this.registry.groups.filter((entry) => !groupIds.has(entry.groupId))],
      MAX_BROWSER_JOB_GROUPS,
    );
  }

  private findGroupByClientTaskId(clientTaskId: string) {
    const cleanId = String(clientTaskId || "").trim();
    if (!cleanId) return null;
    return this.registry.groups.find((group) => group.clientTaskId === cleanId) ?? null;
  }

  private startRegisteredJob(registration: RegisteredBrowserJob, persistBeforeSpawn: boolean) {
    if (this.hooks.disableSpawning) return;
    const { group, payload } = registration;
    if (shouldRunSequentially(payload)) {
      this.sequentialQueues.set(group.groupId, { payload });
      void this.startNextQueuedSlot(group.groupId);
      return;
    }
    for (const slot of group.slots) {
      void this.spawnSlot(group.groupId, slot.jobId, payload, persistBeforeSpawn)
        .catch((error) => this.failRegisteredSlotStart(group.groupId, slot.jobId, error));
    }
  }

  private async failRegisteredSlotStart(groupId: string, jobId: string, error: unknown) {
    const existing = this.getSlot(jobId);
    if (!existing || existing.status === "cancelled" || existing.status === "failed") return;
    const now = Date.now();
    const slot = this.updateSlot(jobId, {
      status: "failed",
      updatedAt: now,
      finishedAt: now,
      stage: "启动失败",
      errorMessage: String((error as { message?: unknown })?.message || error || "failed to start job"),
    });
    await this.persist();
    const group = this.getGroup(groupId);
    if (slot && group) this.emit(jobId, { type: "error", slot, group });
    void this.startNextQueuedSlot(groupId);
  }

  async submit(payload: BrowserJobSubmitPayload): Promise<BrowserJobSubmitResponse> {
    if (!(await this.cliAvailable())) {
      throw new Error("后台任务代理不可用：缺少 runtime\\cli\\gptcodex-image.exe");
    }
    const registration = this.createRegisteredJob(payload);
    this.registerGroups([registration.group]);
    await this.persist();
    this.startRegisteredJob(registration, true);
    const group = this.getGroup(registration.group.groupId)!;
    return {
      groupId: group.groupId,
      jobIds: group.slots.map((slot) => slot.jobId),
      group,
    };
  }

  async submitMany(request: BrowserJobSubmitManyRequest): Promise<BrowserJobSubmitManyResponse> {
    if (!(await this.cliAvailable())) {
      throw new Error("后台任务代理不可用：缺少 runtime\\cli\\gptcodex-image.exe");
    }
    const tasks = Array.isArray(request?.tasks) ? request.tasks : [];
    if (tasks.length > MAX_BROWSER_JOB_SUBMIT_MANY_ITEMS) {
      throw new Error(`submit-many accepts at most ${MAX_BROWSER_JOB_SUBMIT_MANY_ITEMS} tasks`);
    }
    const runId = String(request?.runId || "").trim() || genId("run");
    const credentials = new Map(
      (Array.isArray(request?.credentials) ? request.credentials : [])
        .map((credential) => [String(credential.apiProfileId || "").trim(), credential] as const)
        .filter(([profileId]) => !!profileId),
    );
    const registrations: RegisteredBrowserJob[] = [];
    const registrationByClientTaskId = new Map<string, RegisteredBrowserJob>();
    const results: BrowserJobSubmitManyItemResult[] = [];

    for (const task of tasks) {
      const clientTaskId = String(task?.clientTaskId || "").trim();
      if (!clientTaskId) {
        results.push({ clientTaskId: "", ok: false, error: "clientTaskId is required" });
        continue;
      }
      const existing = this.findGroupByClientTaskId(clientTaskId);
      if (existing) {
        results.push({ clientTaskId, ok: true, group: existing });
        continue;
      }
      const duplicate = registrationByClientTaskId.get(clientTaskId);
      if (duplicate) {
        results.push({ clientTaskId, ok: true, group: duplicate.group });
        continue;
      }
      const profileId = String(task.apiProfileId || "").trim();
      const credential = credentials.get(profileId);
      if (!profileId || !credential) {
        results.push({ clientTaskId, ok: false, error: "API credential is missing" });
        continue;
      }
      if (!String(credential.apiKey || "").trim()) {
        results.push({ clientTaskId, ok: false, error: "API key is missing" });
        continue;
      }
      if (!String(task.workspaceId || "").trim() || !String(task.prompt || "").trim()) {
        results.push({ clientTaskId, ok: false, error: "workspaceId and prompt are required" });
        continue;
      }

      const { clientTaskId: _clientTaskId, runId: taskRunId, ...taskPayload } = task;
      const registration = this.createRegisteredJob({
        ...taskPayload,
        batchCount: 1,
        apiKey: credential.apiKey,
        baseURL: credential.baseURL,
        apiMode: credential.apiMode,
        apiProfileId: profileId,
        apiProfileName: credential.apiProfileName,
        requestPolicy: credential.requestPolicy,
        imagesNewAPICompat: credential.imagesNewAPICompat,
        textModelID: credential.textModelID,
        imageModelID: credential.imageModelID,
      }, {
        runId: String(taskRunId || "").trim() || runId,
        clientTaskId,
      });
      registrations.push(registration);
      registrationByClientTaskId.set(clientTaskId, registration);
      results.push({ clientTaskId, ok: true, group: registration.group });
    }

    this.registerGroups(registrations.map((registration) => registration.group));
    if (registrations.length > 0) await this.persist();
    for (const registration of registrations) this.startRegisteredJob(registration, false);

    return {
      runId,
      results: results.map((result) => {
        if (!result.ok) return result;
        const group = this.findGroupByClientTaskId(result.clientTaskId) ?? result.group;
        return { ...result, group };
      }),
    };
  }

  async cancel(jobIds: string[]): Promise<BrowserJobCancelResponse> {
    const cancelledJobIds: string[] = [];
    for (const jobId of jobIds) {
      const running = this.running.get(jobId);
      const slot = this.getSlot(jobId);
      if (!slot) continue;
      if (running) {
        running.cancelled = true;
        running.child.kill();
        // The child can still be alive after kill() returns. Keep this slot
        // running until its close/error handler confirms the process exited.
        cancelledJobIds.push(jobId);
        continue;
      }
      if (slot.status !== "queued" && slot.status !== "running") continue;
      this.updateSlot(jobId, {
        status: "cancelled",
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        stage: "已取消",
        errorMessage: "",
      });
      await this.persist();
      const current = this.getSlot(jobId);
      const group = current ? this.getGroup(current.groupId) : null;
      if (current && group) {
        this.emit(jobId, { type: "cancelled", slot: current, group });
      }
      cancelledJobIds.push(jobId);
      void this.startNextQueuedSlot(slot.groupId);
    }
    return { cancelledJobIds };
  }

  subscribe(jobId: string, req: IncomingMessage, res: ServerResponse) {
    const slot = this.getSlot(jobId);
    const group = slot ? this.getGroup(slot.groupId) : null;
    if (!slot || !group) {
      sendJSON(res, 404, { error: "job not found" });
      return;
    }
    openEventStream(res);
    res.write(`data: ${JSON.stringify({ type: "snapshot", slot, group } satisfies BrowserJobEvent)}\n\n`);
    if (slot.status === "queued" || slot.status === "running") {
      const bucket = this.subscribers.get(jobId) ?? new Set<JobSubscriber>();
      const subscriber = { req, res };
      bucket.add(subscriber);
      this.subscribers.set(jobId, bucket);
      req.on("close", () => {
        const active = this.subscribers.get(jobId);
        if (!active) return;
        clearSubscriberHeartbeat(subscriber);
        active.delete(subscriber);
        if (active.size === 0) this.subscribers.delete(jobId);
      });
      return;
    }
    const terminalType = slot.status === "cancelled"
      ? "cancelled"
      : slot.status === "succeeded"
        ? "terminal"
        : "error";
    res.write(`data: ${JSON.stringify({ type: terminalType, slot, group } satisfies BrowserJobEvent)}\n\n`);
    res.end();
  }

  subscribeWorkspace(workspaceId: string, req: IncomingMessage, res: ServerResponse) {
    openEventStream(res);
    const subscriber: JobSubscriber = { req, res };
    const bucket = this.workspaceSubscribers.get(workspaceId) ?? new Set<JobSubscriber>();
    bucket.add(subscriber);
    this.workspaceSubscribers.set(workspaceId, bucket);

    for (const group of this.registry.groups) {
      if (group.workspaceId !== workspaceId) continue;
      for (const slot of group.slots) {
        if (slot.status !== "queued" && slot.status !== "running") continue;
        res.write(`data: ${JSON.stringify({ type: "snapshot", slot, group } satisfies BrowserJobEvent)}\n\n`);
      }
    }

    subscriber.heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearSubscriberHeartbeat(subscriber);
      }
    }, BROWSER_JOB_SSE_HEARTBEAT_MS);
    subscriber.heartbeat.unref?.();

    req.on("close", () => {
      clearSubscriberHeartbeat(subscriber);
      const active = this.workspaceSubscribers.get(workspaceId);
      if (!active) return;
      active.delete(subscriber);
      if (active.size === 0) this.workspaceSubscribers.delete(workspaceId);
    });
  }

  private async cliAvailable() {
    try {
      await fs.access(this.cliExePath);
      return true;
    } catch {
      return false;
    }
  }

  private persist() {
    const requestedSequence = ++this.persistSequence;
    this.persistChain = this.persistChain.then(async () => {
      if (this.persistedSequence >= requestedSequence) return;
      const snapshotSequence = this.persistSequence;
      const persisted = await this.writeRegistrySnapshot();
      if (persisted) this.persistedSequence = snapshotSequence;
    });
    return this.persistChain;
  }

  private async writeRegistrySnapshot() {
    this.registry.updatedAt = Date.now();
    const payload = JSON.stringify(this.registry, null, 2);
    for (let attempt = 0; attempt <= BROWSER_JOB_PERSIST_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
        await fs.writeFile(this.registryPath, payload, "utf8");
        this.hooks.onRegistryWrite?.();
        return true;
      } catch (error) {
        const canRetry = isTransientRegistryWriteError(error) && attempt < BROWSER_JOB_PERSIST_RETRY_DELAYS_MS.length;
        if (canRetry) {
          await delay(BROWSER_JOB_PERSIST_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        console.warn(`[browser-job] failed to persist registry ${this.registryPath}: ${registryWriteErrorMessage(error)}`);
        return false;
      }
    }
    return false;
  }

  private getGroup(groupId: string) {
    return this.registry.groups.find((group) => group.groupId === groupId) ?? null;
  }

  private getSlot(jobId: string) {
    for (const group of this.registry.groups) {
      const slot = group.slots.find((entry) => entry.jobId === jobId);
      if (slot) return slot;
    }
    return null;
  }

  private updateSlot(jobId: string, patch: Partial<JobSlotSnapshot>) {
    for (let groupIndex = 0; groupIndex < this.registry.groups.length; groupIndex += 1) {
      const group = this.registry.groups[groupIndex];
      const slotIndex = group.slots.findIndex((entry) => entry.jobId === jobId);
      if (slotIndex < 0) continue;
      const nextSlot = {
        ...group.slots[slotIndex],
        ...patch,
      };
      const nextSlots = [...group.slots];
      nextSlots[slotIndex] = nextSlot;
      this.registry.groups[groupIndex] = {
        ...group,
        slots: nextSlots,
        slotIds: nextSlots.map((slot) => slot.jobId),
        statusSummary: summarizeJobStatuses(nextSlots),
      };
      return nextSlot;
    }
    return null;
  }

  private emit(jobId: string, event: BrowserJobEvent) {
    const listeners = this.subscribers.get(jobId);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    if (listeners && listeners.size > 0) {
      for (const subscriber of Array.from(listeners)) {
        try {
          subscriber.res.write(payload);
          if (event.type !== "snapshot") {
            clearSubscriberHeartbeat(subscriber);
            subscriber.res.end();
            listeners.delete(subscriber);
          }
        } catch {
          clearSubscriberHeartbeat(subscriber);
          try { subscriber.res.end(); } catch {}
          listeners.delete(subscriber);
        }
      }
      if (listeners.size === 0) this.subscribers.delete(jobId);
    }

    const workspaceListeners = this.workspaceSubscribers.get(event.group.workspaceId);
    if (workspaceListeners && workspaceListeners.size > 0) {
      for (const subscriber of Array.from(workspaceListeners)) {
        try {
          subscriber.res.write(payload);
        } catch {
          clearSubscriberHeartbeat(subscriber);
          try { subscriber.res.end(); } catch {}
          workspaceListeners.delete(subscriber);
        }
      }
      if (workspaceListeners.size === 0) this.workspaceSubscribers.delete(event.group.workspaceId);
    }
    if (event.type !== "snapshot") {
      this.registry.groups = retainBrowserJobGroups(this.registry.groups, MAX_BROWSER_JOB_GROUPS);
      void this.persist();
    }
  }

  private async startNextQueuedSlot(groupId: string) {
    const queue = this.sequentialQueues.get(groupId);
    if (!queue) return;
    const group = this.getGroup(groupId);
    if (!group) {
      this.sequentialQueues.delete(groupId);
      return;
    }
    const runningInGroup = group.slots.some((slot) => slot.status === "running" && this.running.has(slot.jobId));
    if (runningInGroup) return;
    const next = group.slots.find((slot) => slot.status === "queued");
    if (!next) {
      this.sequentialQueues.delete(groupId);
      return;
    }
    await this.spawnSlot(groupId, next.jobId, queue.payload);
  }

  private async spawnSlot(
    groupId: string,
    jobId: string,
    payload: BrowserJobSubmitPayload,
    persistBeforeSpawn = true,
  ) {
    const startedAt = Date.now();
    const slot = this.updateSlot(jobId, {
      status: "running",
      startedAt,
      updatedAt: startedAt,
      stage: "启动中",
      elapsedSec: 0,
      bytes: 0,
    });
    if (persistBeforeSpawn) await this.persist();
    const group = this.getGroup(groupId);
    if (slot && group) this.emit(jobId, { type: "snapshot", slot, group });

    // A cancellation can arrive while the slot is persisted but before spawn()
    // creates its child process. Do not start a process for that terminal slot.
    if (this.getSlot(jobId)?.status === "cancelled") {
      void this.startNextQueuedSlot(groupId);
      return;
    }

    const args = [
      "--no-input",
      "--json",
      "--jsonl-events",
      "--base-url", effectiveBaseURLForCLI(payload),
      "--api-mode", payload.apiMode,
      "--request-policy", payload.requestPolicy,
      "--text-model", payload.textModelID,
      "--image-model", payload.imageModelID,
      "--mode", modeActionLabel(payload.mode),
      "--prompt", payload.prompt,
      "--size", payload.size,
      "--quality", payload.quality,
      "--output-format", payload.outputFormat,
      "--out-dir", this.outputDir,
      "--raw-dir", path.join(this.outputDir, "log"),
      "--input-dir", this.inputDir,
      "--partial-images", "1",
    ];
    if (payload.negativePrompt.trim()) {
      args.push("--negative-prompt", payload.negativePrompt.trim());
    }
    if (payload.apiMode === "images" && payload.imagesNewAPICompat === true) {
      args.push("--images-newapi-compat");
    }
    const effectiveSeed = Number.isFinite(Number(payload.seed)) && Number(payload.seed) > 0
      ? Number(payload.seed) + slot!.batchIndex
      : 0;
    if (effectiveSeed > 0) {
      args.push("--seed", String(effectiveSeed));
    }
    for (const imagePath of payload.sourceImagePaths ?? []) {
      if (imagePath.trim()) args.push("--image", toWindowsPath(imagePath));
    }
    if (payload.maskB64?.trim()) {
      const maskPath = path.join(this.outputDir, "log", `${jobId}-mask.png`);
      await fs.writeFile(maskPath, Buffer.from(cleanBase64(payload.maskB64), "base64"));
      args.push("--mask", maskPath);
    }

    if (this.getSlot(jobId)?.status === "cancelled") {
      void this.startNextQueuedSlot(groupId);
      return;
    }

    const child = spawn(this.cliExePath, args, {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        IMAGE_STUDIO_API_KEY: payload.apiKey,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc: RunningProcess = {
      child,
      stdout: "",
      cancelled: false,
      startedAt,
      lastActivityAt: startedAt,
    };
    this.running.set(jobId, proc);
    proc.timeoutTimer = setInterval(() => {
      const active = this.running.get(jobId);
      if (active !== proc) {
        clearProcessTimeout(proc);
        return;
      }
      if (proc.cancelled || proc.timedOutMessage) return;
      const now = Date.now();
      const maxRuntimeMs = maxRuntimeForPayload(payload);
      const runtimeMs = now - proc.startedAt;
      const idleMs = now - proc.lastActivityAt;
      if (runtimeMs > maxRuntimeMs) {
        proc.timedOutMessage = timeoutMessageForPayload(payload, "runtime", maxRuntimeMs);
      } else if (idleMs > BROWSER_JOB_IDLE_TIMEOUT_MS) {
        proc.timedOutMessage = timeoutMessageForPayload(payload, "idle", BROWSER_JOB_IDLE_TIMEOUT_MS);
      }
      if (proc.timedOutMessage) {
        proc.child.kill();
      }
    }, BROWSER_JOB_TIMEOUT_CHECK_INTERVAL_MS);

    void consumeLines(child.stdout, (line) => {
      proc.lastActivityAt = Date.now();
      proc.stdout += line;
    });
    void consumeLines(child.stderr, async (line) => {
      proc.lastActivityAt = Date.now();
      const parsed = safeJsonParse(line);
      if (parsed?.type === "progress") {
        const current = this.updateSlot(jobId, {
          status: "running",
          updatedAt: Date.now(),
          stage: String(parsed.stage || "处理中"),
          elapsedSec: Number.isFinite(Number(parsed.elapsedSec)) ? Number(parsed.elapsedSec) : 0,
          bytes: Number.isFinite(Number(parsed.bytes)) ? Number(parsed.bytes) : 0,
        });
        await this.persist();
        const nextGroup = current ? this.getGroup(groupId) : null;
        if (current && nextGroup) this.emit(jobId, { type: "snapshot", slot: current, group: nextGroup });
        return;
      }
      if (parsed?.type === "log") {
        const current = this.updateSlot(jobId, {
          updatedAt: Date.now(),
          stage: String(parsed.message || "处理中"),
        });
        await this.persist();
        const nextGroup = current ? this.getGroup(groupId) : null;
        if (current && nextGroup) this.emit(jobId, { type: "snapshot", slot: current, group: nextGroup });
      }
    });

    child.on("error", async (error) => {
      if (this.running.get(jobId) !== proc) return;
      clearProcessTimeout(proc);
      this.running.delete(jobId);
      const timedOut = !proc.cancelled && !!proc.timedOutMessage;
      const current = this.updateSlot(jobId, {
        status: proc.cancelled ? "cancelled" : "failed",
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        stage: proc.cancelled ? "已取消" : timedOut ? "超时失败" : "启动失败",
        errorMessage: proc.cancelled ? "" : proc.timedOutMessage || String(error.message || error),
      });
      await this.persist();
      const nextGroup = current ? this.getGroup(groupId) : null;
      if (current && nextGroup) {
        this.emit(jobId, {
          type: proc.cancelled ? "cancelled" : "error",
          slot: current,
          group: nextGroup,
        });
      }
      void this.startNextQueuedSlot(groupId);
    });

    child.on("close", async (code, signal) => {
      if (this.running.get(jobId) !== proc) return;
      clearProcessTimeout(proc);
      this.running.delete(jobId);
      const rawResult = safeJsonParse(proc.stdout);
      const ok = !!rawResult?.ok;
      const cancelled = proc.cancelled;
      const timedOut = !cancelled && !!proc.timedOutMessage;
      const fallbackMode = typeof rawResult?.fallbackMode === "string" ? rawResult.fallbackMode.trim() : "";
      const fallbackInputPath = typeof rawResult?.fallbackInputPath === "string" ? rawResult.fallbackInputPath.trim() : "";
      const fallbackReason = typeof rawResult?.fallbackReason === "string" ? rawResult.fallbackReason.trim() : "";
      const rawResultError = typeof rawResult?.error === "string" ? rawResult.error.trim() : "";
      const rawPathError = await readRawResponseErrorMessage(rawResult?.rawPath, path.join(this.outputDir, "log"));
      const rawPathTaskId = await readRawResponseTaskId(rawResult?.rawPath, path.join(this.outputDir, "log"));
      const apimartTaskId = typeof rawResult?.apimartTaskId === "string" && rawResult.apimartTaskId.trim()
        ? rawResult.apimartTaskId.trim()
        : extractAPIMartTaskIdFromText(rawResultError || rawPathError) || rawPathTaskId;
      const rawError = cancelled ? "" : proc.timedOutMessage || (rawPathError && genericHTTPError(rawResultError)
        ? rawPathError
        : rawResultError
          ? rawResultError
          : rawPathError
            ? rawPathError
            : code && code !== 0
              ? `CLI exited with code ${code}${signal ? ` (${signal})` : ""}`
              : "");
      const nextStatus: JobStatus = cancelled
        ? "cancelled"
        : ok && !timedOut
          ? "succeeded"
          : "failed";
      const current = this.updateSlot(jobId, {
        status: nextStatus,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        stage: cancelled ? "已取消" : timedOut ? "超时失败" : ok ? "已完成" : "失败",
        elapsedSec: Number.isFinite(Number(rawResult?.elapsedSec)) ? Number(rawResult.elapsedSec) : 0,
        savedPath: typeof rawResult?.imagePath === "string" ? rawResult.imagePath : "",
        rawPath: typeof rawResult?.rawPath === "string" ? rawResult.rawPath : "",
        apimartTaskId,
        errorMessage: friendlyJobError(rawError, fallbackMode),
        revisedPrompt: typeof rawResult?.revisedPrompt === "string" ? rawResult.revisedPrompt : "",
        sourceEvent: typeof rawResult?.sourceEvent === "string" ? rawResult.sourceEvent : "",
        fallbackMode,
        fallbackInputPath,
        fallbackReason,
        attemptSummary: normalizeAttemptSummary(rawResult?.attemptSummary),
      });
      await this.persist();
      const nextGroup = current ? this.getGroup(groupId) : null;
      if (!current || !nextGroup) return;
      const eventType: BrowserJobEvent["type"] = cancelled
        ? "cancelled"
        : ok && !timedOut
          ? "terminal"
          : "error";
      this.emit(jobId, { type: eventType, slot: current, group: nextGroup });
      void this.startNextQueuedSlot(groupId);
    });
  }
}

export function createBrowserJobProxyPlugin(opts: {
  repoRoot: string;
  outputDir: string;
  inputDir: string;
}) {
  const cliExePath = path.join(opts.repoRoot, "runtime", "cli", "gptcodex-image.exe");
  const registryPath = path.join(opts.outputDir, "log", BROWSER_JOB_REGISTRY_FILENAME);
  const manager = new BrowserJobManager(opts.repoRoot, opts.outputDir, opts.inputDir, cliExePath, registryPath);

  function mountBrowserJobProxy(server: any) {
    server.middlewares.use(BROWSER_JOB_PROXY_PREFIX, async (req, res, next) => {
      try {
        const url = new URL(req.url || "/", "http://localhost");
        if (req.method === "GET" && url.pathname === "/") {
          const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
          const limit = Number(url.searchParams.get("limit") || MAX_BROWSER_JOB_GROUPS);
          if (!workspaceId) {
            sendJSON(res, 400, { error: "workspaceId is required" });
            return;
          }
          sendJSON(res, 200, manager.listWorkspace(workspaceId, limit));
          return;
        }
        if (req.method === "GET" && url.pathname === "/events") {
          const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
          const jobId = String(url.searchParams.get("jobId") || "").trim();
          if (workspaceId) {
            manager.subscribeWorkspace(workspaceId, req, res);
            return;
          }
          if (!jobId) {
            sendJSON(res, 400, { error: "workspaceId or jobId is required" });
            return;
          }
          manager.subscribe(jobId, req, res);
          return;
        }
        if (req.method === "POST" && url.pathname === "/submit") {
          const payload = await readJSONBody(req) as BrowserJobSubmitPayload;
          const result = await manager.submit(payload);
          sendJSON(res, 200, result);
          return;
        }
        if (req.method === "POST" && url.pathname === "/submit-many") {
          const payload = await readJSONBody(req, 64 * 1024 * 1024) as BrowserJobSubmitManyRequest;
          const result = await manager.submitMany(payload);
          sendJSON(res, 200, result);
          return;
        }
        if (req.method === "POST" && url.pathname === "/cancel") {
          const payload = await readJSONBody(req) as { jobIds?: string[] };
          const result = await manager.cancel(Array.isArray(payload.jobIds) ? payload.jobIds : []);
          sendJSON(res, 200, result satisfies BrowserJobCancelResponse);
          return;
        }
        next();
      } catch (error: any) {
        sendJSON(res, 500, { error: String(error?.message || error) });
      }
    });
  }

  return {
    name: "image-studio-browser-job-proxy",
    async configureServer(server) {
      await manager.init();
      mountBrowserJobProxy(server);
    },
    async configurePreviewServer(server) {
      await manager.init();
      mountBrowserJobProxy(server);
    },
  } satisfies Plugin;
}
