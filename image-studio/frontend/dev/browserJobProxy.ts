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
  emptyJobStatusSummary,
  summarizeJobStatuses,
  type BrowserJobCancelResponse,
  type BrowserJobEvent,
  type BrowserJobListResponse,
  type BrowserJobRegistry,
  type BrowserJobSubmitPayload,
  type BrowserJobSubmitResponse,
} from "../src/platform/runtime/browserJobContracts";
import type {
  JobGroupSnapshot,
  JobSlotSnapshot,
  JobStatus,
} from "../src/types/domain";

type JobSubscriber = {
  res: ServerResponse;
  req: IncomingMessage;
};

type RunningProcess = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  cancelled: boolean;
};

type SequentialJobQueue = {
  payload: BrowserJobSubmitPayload;
};

function sendJSON(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

function modeActionLabel(mode: string) {
  return mode === "edit" ? "edit" : "generate";
}

function effectiveAPIModeForJob(_mode: string, apiMode: "responses" | "images") {
  return apiMode;
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

class BrowserJobManager {
  private registry: BrowserJobRegistry = { version: 1, updatedAt: Date.now(), groups: [] };
  private readonly running = new Map<string, RunningProcess>();
  private readonly subscribers = new Map<string, Set<JobSubscriber>>();
  private readonly sequentialQueues = new Map<string, SequentialJobQueue>();

  constructor(
    private readonly repoRoot: string,
    private readonly outputDir: string,
    private readonly inputDir: string,
    private readonly cliExePath: string,
    private readonly registryPath: string,
  ) {}

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
    this.registry.groups = this.registry.groups
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_BROWSER_JOB_GROUPS)
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
          apiMode: group.apiMode === "images" ? "images" : "responses",
          slots,
          slotIds: slots.map((slot) => slot.jobId),
          statusSummary: summarizeJobStatuses(slots),
        };
      });
    if (touched) await this.persist();
  }

  listWorkspace(workspaceId: string, limit = MAX_BROWSER_JOB_GROUPS): BrowserJobListResponse {
    const groups = this.registry.groups
      .filter((group) => group.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
    return {
      workspaceId,
      groups,
    };
  }

  async submit(payload: BrowserJobSubmitPayload): Promise<BrowserJobSubmitResponse> {
    if (!(await this.cliAvailable())) {
      throw new Error("后台任务代理不可用：缺少 runtime\\cli\\gptcodex-image.exe");
    }
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
      workspaceId: effectivePayload.workspaceId,
      createdAt: now,
      mode: effectivePayload.mode,
      apiMode: effectivePayload.apiMode,
      prompt: effectivePayload.prompt,
      batchCount: slots.length,
      size: effectivePayload.size,
      quality: effectivePayload.quality,
      outputFormat: effectivePayload.outputFormat,
      negativePrompt: effectivePayload.negativePrompt,
      styleTag: effectivePayload.styleTag || "",
      seed: effectivePayload.seed || 0,
      sourceImagePaths: effectivePayload.sourceImagePaths?.map(toWindowsPath).filter(Boolean) ?? [],
      slotIds: slots.map((slot) => slot.jobId),
      slots,
      statusSummary: summarizeJobStatuses(slots),
    };
    this.registry.groups = [group, ...this.registry.groups.filter((entry) => entry.groupId !== groupId)]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_BROWSER_JOB_GROUPS);
    await this.persist();
    if (shouldRunSequentially(effectivePayload)) {
      this.sequentialQueues.set(groupId, { payload: effectivePayload });
      void this.startNextQueuedSlot(groupId);
    } else {
      for (const slot of slots) {
        void this.spawnSlot(groupId, slot.jobId, effectivePayload);
      }
    }
    return {
      groupId,
      jobIds: slots.map((slot) => slot.jobId),
      group: this.getGroup(groupId)!,
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
        this.running.delete(jobId);
      }
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
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ type: "snapshot", slot, group } satisfies BrowserJobEvent)}\n\n`);
    if (slot.status === "queued" || slot.status === "running") {
      const bucket = this.subscribers.get(jobId) ?? new Set<JobSubscriber>();
      const subscriber = { req, res };
      bucket.add(subscriber);
      this.subscribers.set(jobId, bucket);
      req.on("close", () => {
        const active = this.subscribers.get(jobId);
        if (!active) return;
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

  private async cliAvailable() {
    try {
      await fs.access(this.cliExePath);
      return true;
    } catch {
      return false;
    }
  }

  private async persist() {
    this.registry.updatedAt = Date.now();
    await fs.writeFile(this.registryPath, JSON.stringify(this.registry, null, 2), "utf8");
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
    if (!listeners || listeners.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const subscriber of Array.from(listeners)) {
      try {
        subscriber.res.write(payload);
        if (event.type !== "snapshot") {
          subscriber.res.end();
          listeners.delete(subscriber);
        }
      } catch {
        try { subscriber.res.end(); } catch {}
        listeners.delete(subscriber);
      }
    }
    if (listeners.size === 0) this.subscribers.delete(jobId);
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

  private async spawnSlot(groupId: string, jobId: string, payload: BrowserJobSubmitPayload) {
    const slot = this.updateSlot(jobId, {
      status: "running",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      stage: "启动中",
      elapsedSec: 0,
      bytes: 0,
    });
    await this.persist();
    const group = this.getGroup(groupId);
    if (slot && group) this.emit(jobId, { type: "snapshot", slot, group });

    const args = [
      "--no-input",
      "--json",
      "--jsonl-events",
      "--base-url", payload.baseURL,
      "--api-key", payload.apiKey,
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

    const child = spawn(this.cliExePath, args, {
      cwd: this.repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc: RunningProcess = {
      child,
      stdout: "",
      cancelled: false,
    };
    this.running.set(jobId, proc);

    void consumeLines(child.stdout, (line) => {
      proc.stdout += line;
    });
    void consumeLines(child.stderr, async (line) => {
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
      this.running.delete(jobId);
      const current = this.updateSlot(jobId, {
        status: proc.cancelled ? "cancelled" : "failed",
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        stage: proc.cancelled ? "已取消" : "启动失败",
        errorMessage: proc.cancelled ? "" : String(error.message || error),
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
      this.running.delete(jobId);
      const rawResult = safeJsonParse(proc.stdout);
      const ok = !!rawResult?.ok;
      const cancelled = proc.cancelled;
      const fallbackMode = typeof rawResult?.fallbackMode === "string" ? rawResult.fallbackMode.trim() : "";
      const fallbackInputPath = typeof rawResult?.fallbackInputPath === "string" ? rawResult.fallbackInputPath.trim() : "";
      const fallbackReason = typeof rawResult?.fallbackReason === "string" ? rawResult.fallbackReason.trim() : "";
      const rawError = cancelled ? "" : (typeof rawResult?.error === "string" && rawResult.error.trim()
        ? rawResult.error.trim()
        : code && code !== 0
          ? `CLI exited with code ${code}${signal ? ` (${signal})` : ""}`
          : "");
      const nextStatus: JobStatus = cancelled
        ? "cancelled"
        : ok
          ? "succeeded"
          : "failed";
      const current = this.updateSlot(jobId, {
        status: nextStatus,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        stage: cancelled ? "已取消" : ok ? "已完成" : "失败",
        elapsedSec: Number.isFinite(Number(rawResult?.elapsedSec)) ? Number(rawResult.elapsedSec) : 0,
        savedPath: typeof rawResult?.imagePath === "string" ? rawResult.imagePath : "",
        rawPath: typeof rawResult?.rawPath === "string" ? rawResult.rawPath : "",
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
        : ok
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

  return {
    name: "image-studio-browser-job-proxy",
    async configureServer(server) {
      await manager.init();
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
            const jobId = String(url.searchParams.get("jobId") || "").trim();
            if (!jobId) {
              sendJSON(res, 400, { error: "jobId is required" });
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
    },
  } satisfies Plugin;
}
