import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  UI_AUDIT_INDEX_FILENAME,
  UI_AUDIT_MAX_SESSIONS,
  UI_AUDIT_PROXY_PREFIX,
  UI_AUDIT_VERSION,
  type UIAuditAppendPayload,
  type UIAuditEvent,
  type UIAuditSessionIndex,
  type UIAuditSessionIndexEntry,
  type UIAuditSummary,
} from "../src/platform/runtime/uiAuditContracts";

function sendJSON(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJSONBody(req: IncomingMessage, maxBytes = 512 * 1024) {
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

function safeSessionFileBase(tabSessionId: string): string {
  const safe = String(tabSessionId || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return safe || "session";
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatTs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Date(value).toLocaleString("sv-SE", { hour12: false });
}

function escapePipe(value: unknown) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function relativeAuditPath(root: string, target: string) {
  const relative = path.relative(root, target).replace(/\\/g, "/");
  return relative || ".";
}

function stripSensitiveDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  const blocked = /api.?key|authorization|imageb64|base64/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (blocked.test(key)) continue;
    if (typeof value === "string" && value.startsWith("data:")) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeEvent(event: UIAuditEvent): UIAuditEvent {
  return {
    ...event,
    details: stripSensitiveDetails(event.details),
    context: {
      ...event.context,
      errorRawPath: event.context.errorRawPath || null,
      promptPreview: String(event.context.promptPreview || ""),
      negativePromptPreview: String(event.context.negativePromptPreview || ""),
      sourceDescriptors: Array.isArray(event.context.sourceDescriptors)
        ? event.context.sourceDescriptors.map((source) => ({
            kind: source.kind,
            name: String(source.name || ""),
          }))
        : [],
    },
  };
}

type SessionCache = {
  events: UIAuditEvent[];
  summary: UIAuditSummary;
};

class UIAuditManager {
  private index: UIAuditSessionIndex = {
    uiAuditVersion: UI_AUDIT_VERSION,
    updatedAt: Date.now(),
    sessions: [],
  };

  private readonly cache = new Map<string, SessionCache>();

  constructor(
    private readonly projectRoot: string,
    private readonly auditDir: string,
    private readonly indexPath: string,
  ) {}

  async init() {
    await fs.mkdir(this.auditDir, { recursive: true });
    const raw = await fs.readFile(this.indexPath, "utf8").catch(() => "");
    const parsed = raw.trim() ? safeJsonParse(raw) : null;
    if (parsed?.uiAuditVersion === UI_AUDIT_VERSION && Array.isArray(parsed?.sessions)) {
      this.index = {
        uiAuditVersion: UI_AUDIT_VERSION,
        updatedAt: Number(parsed.updatedAt) || Date.now(),
        sessions: parsed.sessions as UIAuditSessionIndexEntry[],
      };
    }
    await this.trimSessions();
    await this.persistIndex();
  }

  async append(payload: UIAuditAppendPayload) {
    const sessionId = String(payload.session?.tabSessionId || "").trim();
    if (!sessionId) throw new Error("tabSessionId is required");

    const events = (payload.events || [])
      .map(sanitizeEvent)
      .filter((event) => event.tabSessionId === sessionId);
    if (events.length === 0) return { ok: true as const, accepted: 0 };

    const fileBase = safeSessionFileBase(sessionId);
    const jsonlPath = path.join(this.auditDir, `session-${fileBase}.jsonl`);
    const markdownPath = path.join(this.auditDir, `session-${fileBase}.md`);

    let session = this.cache.get(sessionId);
    if (!session) {
      const existingEvents = await this.readSessionEvents(jsonlPath);
      session = {
        events: existingEvents,
        summary: this.buildSummary(sessionId, existingEvents),
      };
      this.cache.set(sessionId, session);
    }

    await fs.mkdir(this.auditDir, { recursive: true });
    const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    await fs.appendFile(jsonlPath, lines, "utf8");

    session.events.push(...events);
    session.summary = this.buildSummary(sessionId, session.events);
    await fs.writeFile(markdownPath, this.renderSummaryMarkdown(session.summary), "utf8");

    const entry = this.buildIndexEntry(payload, session.summary, jsonlPath, markdownPath);
    this.index.sessions = [
      entry,
      ...this.index.sessions.filter((item) => item.tabSessionId !== sessionId),
    ].sort((a, b) => b.lastEventAt - a.lastEventAt);

    await this.trimSessions();
    await this.persistIndex();
    return { ok: true as const, accepted: events.length };
  }

  private async trimSessions() {
    const sessions = [...this.index.sessions].sort((a, b) => b.lastEventAt - a.lastEventAt);
    const keep = sessions.slice(0, UI_AUDIT_MAX_SESSIONS);
    const drop = sessions.slice(UI_AUDIT_MAX_SESSIONS);
    this.index.sessions = keep;

    for (const entry of drop) {
      const jsonl = path.join(this.projectRoot, entry.latestJsonlPath);
      const markdown = path.join(this.projectRoot, entry.latestMarkdownPath);
      await fs.rm(jsonl, { force: true }).catch(() => undefined);
      await fs.rm(markdown, { force: true }).catch(() => undefined);
      this.cache.delete(entry.tabSessionId);
    }
  }

  private async persistIndex() {
    this.index.updatedAt = Date.now();
    await fs.writeFile(this.indexPath, JSON.stringify(this.index, null, 2), "utf8");
  }

  private async readSessionEvents(jsonlPath: string): Promise<UIAuditEvent[]> {
    const raw = await fs.readFile(jsonlPath, "utf8").catch(() => "");
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeJsonParse(line))
      .filter((event): event is UIAuditEvent => !!event && event.uiAuditVersion === UI_AUDIT_VERSION);
  }

  private buildSummary(tabSessionId: string, events: UIAuditEvent[]): UIAuditSummary {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const runIds = Array.from(new Set(sorted.map((event) => event.runId)));
    const lastState = sorted.length > 0 ? sorted[sorted.length - 1].context : null;
    const lastError = [...sorted].reverse().find((event) => event.type === "job_error" || event.type === "ui_error_changed") ?? null;
    const lastSubmit = [...sorted].reverse().find((event) => event.type === "submit") ?? null;
    const recentTimeline = sorted.slice(-50);
    const recentSystemEvents = sorted.filter((event) => event.type !== "click").slice(-20);

    return {
      uiAuditVersion: UI_AUDIT_VERSION,
      tabSessionId,
      runIds,
      firstEventAt: sorted[0]?.timestamp ?? 0,
      lastEventAt: sorted[sorted.length - 1]?.timestamp ?? 0,
      eventCount: sorted.length,
      lastState,
      lastError,
      lastSubmit,
      recentTimeline,
      recentSystemEvents,
    };
  }

  private buildIndexEntry(
    payload: UIAuditAppendPayload,
    summary: UIAuditSummary,
    jsonlPath: string,
    markdownPath: string,
  ): UIAuditSessionIndexEntry {
    const latestEvent = summary.recentTimeline[summary.recentTimeline.length - 1];
    return {
      tabSessionId: payload.session.tabSessionId,
      runIds: summary.runIds,
      firstEventAt: summary.firstEventAt,
      lastEventAt: summary.lastEventAt,
      eventCount: summary.eventCount,
      latestEventType: latestEvent?.type ?? "run_start",
      latestJsonlPath: relativeAuditPath(this.projectRoot, jsonlPath),
      latestMarkdownPath: relativeAuditPath(this.projectRoot, markdownPath),
      latestErrorMessage: summary.lastError?.context.errorMessage || "",
      platform: payload.session.platform,
      appVersion: payload.session.appVersion,
      lastUrl: latestEvent?.page.url || "",
    };
  }

  private renderSummaryMarkdown(summary: UIAuditSummary) {
    const lastState = summary.lastState;
    const lastError = summary.lastError;
    const lastSubmit = summary.lastSubmit;
    const lines: string[] = [];

    lines.push(`# UI Audit Session ${summary.tabSessionId}`);
    lines.push("");
    lines.push(`- uiAuditVersion: ${summary.uiAuditVersion}`);
    lines.push(`- runIds: ${summary.runIds.join(", ") || "-"}`);
    lines.push(`- firstEventAt: ${formatTs(summary.firstEventAt)}`);
    lines.push(`- lastEventAt: ${formatTs(summary.lastEventAt)}`);
    lines.push(`- eventCount: ${summary.eventCount}`);
    lines.push("");

    lines.push("## Session Info");
    lines.push("");
    if (!lastState) {
      lines.push("- No state snapshot");
    } else {
      lines.push(`- workspaceId: ${lastState.workspaceId || "-"}`);
      lines.push(`- mode: ${lastState.mode}`);
      lines.push(`- size: ${lastState.size}`);
      lines.push(`- quality: ${lastState.quality}`);
      lines.push(`- batchCount: ${lastState.batchCount}`);
      lines.push(`- activeProfile: ${lastState.activeProfileName || lastState.activeProfileId || "-"}`);
      lines.push(`- runningJobIds: ${lastState.runningJobIds.join(", ") || "-"}`);
      lines.push(`- jobs: ${lastState.jobsCompleted}/${lastState.jobsTotal}`);
      lines.push(`- settingsOpen: ${lastState.settingsOpen}`);
      lines.push(`- upstreamConfigOpen: ${lastState.upstreamConfigOpen}`);
      lines.push(`- historyTimelineOpen: ${lastState.historyTimelineOpen}`);
      lines.push(`- resultDetailOpen: ${lastState.resultDetailOpen}`);
      lines.push(`- promptPreview: ${lastState.promptPreview || "-"}`);
      lines.push(`- negativePromptPreview: ${lastState.negativePromptPreview || "-"}`);
      lines.push(
        `- sources: ${lastState.sourceDescriptors.map((source) => `${source.kind}:${source.name}`).join(", ") || "-"}`,
      );
    }
    lines.push("");

    lines.push("## Latest Error");
    lines.push("");
    if (!lastError) {
      lines.push("- None");
    } else {
      lines.push(`- time: ${formatTs(lastError.timestamp)}`);
      lines.push(`- type: ${lastError.type}`);
      lines.push(`- area: ${lastError.area}`);
      lines.push(`- element: ${lastError.element}`);
      lines.push(`- message: ${lastError.context.errorMessage || escapePipe(lastError.details?.errorMessage) || "-"}`);
      lines.push(`- rawPath: ${lastError.context.errorRawPath || escapePipe(lastError.details?.rawPath) || "-"}`);
    }
    lines.push("");

    lines.push("## Latest Submit");
    lines.push("");
    if (!lastSubmit) {
      lines.push("- None");
    } else {
      lines.push(`- time: ${formatTs(lastSubmit.timestamp)}`);
      lines.push(`- mode: ${escapePipe(lastSubmit.details?.mode) || lastSubmit.context.mode}`);
      lines.push(`- batchCount: ${escapePipe(lastSubmit.details?.batchCount) || lastSubmit.context.batchCount}`);
      lines.push(`- size: ${escapePipe(lastSubmit.details?.size) || lastSubmit.context.size}`);
      lines.push(`- quality: ${escapePipe(lastSubmit.details?.quality) || lastSubmit.context.quality}`);
      lines.push(`- promptPreview: ${escapePipe(lastSubmit.details?.promptPreview) || lastSubmit.context.promptPreview || "-"}`);
      lines.push(`- sourceCount: ${escapePipe(lastSubmit.details?.sourceCount) || lastSubmit.context.sourceDescriptors.length}`);
    }
    lines.push("");

    lines.push("## Recent Timeline (Last 50)");
    lines.push("");
    lines.push("| Time | Type | Area | Element | Note |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const event of summary.recentTimeline) {
      const note = event.type === "click"
        ? `${event.context.mode} · ${event.context.size} · ${event.context.promptPreview || "-"}`
        : String(
            event.details?.errorMessage
            || event.details?.stage
            || event.context.errorMessage
            || event.details?.promptPreview
            || "",
          );
      lines.push(
        `| ${formatTs(event.timestamp)} | ${escapePipe(event.type)} | ${escapePipe(event.area)} | ${escapePipe(event.element)} | ${escapePipe(note || "-")} |`,
      );
    }
    lines.push("");

    lines.push("## Recent System Events");
    lines.push("");
    if (summary.recentSystemEvents.length === 0) {
      lines.push("- None");
    } else {
      for (const event of summary.recentSystemEvents) {
        lines.push(`- ${formatTs(event.timestamp)} · ${event.type} · ${event.area} · ${event.element}`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }
}

export function createUIAuditProxyPlugin(opts: { projectRoot: string; outputDir: string }) {
  const auditDir = path.join(opts.outputDir, "log", "ui-audit");
  const indexPath = path.join(auditDir, UI_AUDIT_INDEX_FILENAME);
  const manager = new UIAuditManager(opts.projectRoot, auditDir, indexPath);

  return {
    name: "image-studio-ui-audit-proxy",
    async configureServer(server) {
      await manager.init();
      server.middlewares.use(UI_AUDIT_PROXY_PREFIX, async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          if (req.method === "POST" && url.pathname === "/append") {
            const payload = await readJSONBody(req) as UIAuditAppendPayload;
            const result = await manager.append(payload);
            sendJSON(res, 200, result);
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
