export const UI_AUDIT_VERSION = 1 as const;
export const UI_AUDIT_PROXY_PREFIX = "/__image-studio-audit";
export const UI_AUDIT_INDEX_FILENAME = "index.v1.json";
export const UI_AUDIT_MAX_SESSIONS = 20;

export type UIAuditEventType =
  | "click"
  | "session_start"
  | "run_start"
  | "submit"
  | "job_terminal"
  | "job_error"
  | "job_cancelled"
  | "ui_error_changed"
  | "pagehide";

export type UIAuditSourceKind =
  | "memory"
  | "input-root"
  | "output-root"
  | "external-absolute"
  | "relative";

export interface UIAuditSourceDescriptor {
  kind: UIAuditSourceKind;
  name: string;
}

export interface UIAuditPageInfo {
  url: string;
  version: string;
  platform: string;
}

export interface UIAuditStateSnapshot {
  workspaceId: string;
  mode: "generate" | "edit";
  size: string;
  quality: string;
  batchCount: number;
  styleTag: string;
  runningJobIds: string[];
  jobsTotal: number;
  jobsCompleted: number;
  activeProfileId: string;
  activeProfileName: string;
  settingsOpen: boolean;
  upstreamConfigOpen: boolean;
  historyTimelineOpen: boolean;
  resultDetailOpen: boolean;
  errorMessage: string | null;
  errorRawPath: string | null;
  promptPreview: string;
  negativePromptPreview: string;
  sourceDescriptors: UIAuditSourceDescriptor[];
}

export interface UIAuditEvent {
  uiAuditVersion: typeof UI_AUDIT_VERSION;
  tabSessionId: string;
  runId: string;
  type: UIAuditEventType;
  timestamp: number;
  page: UIAuditPageInfo;
  area: string;
  element: string;
  mouseX?: number;
  mouseY?: number;
  context: UIAuditStateSnapshot;
  details?: Record<string, unknown>;
}

export interface UIAuditSessionMeta {
  uiAuditVersion: typeof UI_AUDIT_VERSION;
  tabSessionId: string;
  runId: string;
  sessionStartedAt: number;
  appVersion: string;
  platform: string;
}

export interface UIAuditSummary {
  uiAuditVersion: typeof UI_AUDIT_VERSION;
  tabSessionId: string;
  runIds: string[];
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  lastState: UIAuditStateSnapshot | null;
  lastError: UIAuditEvent | null;
  lastSubmit: UIAuditEvent | null;
  recentTimeline: UIAuditEvent[];
  recentSystemEvents: UIAuditEvent[];
}

export interface UIAuditSessionIndexEntry {
  tabSessionId: string;
  runIds: string[];
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  latestEventType: UIAuditEventType;
  latestJsonlPath: string;
  latestMarkdownPath: string;
  latestErrorMessage: string;
  platform: string;
  appVersion: string;
  lastUrl: string;
}

export interface UIAuditSessionIndex {
  uiAuditVersion: typeof UI_AUDIT_VERSION;
  updatedAt: number;
  sessions: UIAuditSessionIndexEntry[];
}

export interface UIAuditAppendPayload {
  session: UIAuditSessionMeta;
  events: UIAuditEvent[];
}

export interface UIAuditAppendResponse {
  ok: true;
  accepted: number;
}
