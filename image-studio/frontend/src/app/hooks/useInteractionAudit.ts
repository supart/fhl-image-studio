import { useEffect, useMemo, useRef } from "react";
import { usePlatform } from "../../platform/context";
import { appVersion } from "../../lib/version";
import { useStudioStore } from "../../state/studioStore";
import type { StudioState } from "../../state/studioStore.types";
import type { JobGroupSnapshot, JobSlotSnapshot, SourceImage } from "../../types/domain";
import {
  appendUIAuditEvents,
  auditPathLeaf,
  classifyAuditSourceKind,
  makeUIAuditID,
  sanitizeAuditPath,
  truncateAuditText,
} from "../../platform/runtime/uiAuditClient";
import {
  UI_AUDIT_VERSION,
  type UIAuditEvent,
  type UIAuditPageInfo,
  type UIAuditSessionMeta,
  type UIAuditStateSnapshot,
} from "../../platform/runtime/uiAuditContracts";

const TAB_SESSION_KEY = "imageStudio.audit.tabSessionId";
const FLUSH_BATCH_SIZE = 10;
const FLUSH_DELAY_MS = 1500;

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function readOrCreateTabSessionId(): { id: string; created: boolean } {
  if (typeof sessionStorage === "undefined") return { id: makeUIAuditID("tab"), created: true };
  const existing = sessionStorage.getItem(TAB_SESSION_KEY)?.trim();
  if (existing) return { id: existing, created: false };
  const created = makeUIAuditID("tab");
  sessionStorage.setItem(TAB_SESSION_KEY, created);
  return { id: created, created: true };
}

function areaFromElement(target: EventTarget | null): string {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return "unknown";
  const explicit = element.closest<HTMLElement>("[data-audit-area]")?.dataset.auditArea?.trim();
  if (explicit) return explicit;
  if (element.closest("[role='dialog'], .app-modal-backdrop, .context-menu")) return "modal";
  if (element.closest(".history-rail")) return "history";
  if (element.closest(".control-panel")) return "control-panel";
  if (element.closest(".canvas-shell, .stage-host, .source-strip, .toolbar")) return "canvas";
  if (element.closest(".footer-bar")) return "footer";
  if (element.closest(".workspace-bar")) return "workspace-bar";
  if (element.closest(".app-header")) return "header";
  return "unknown";
}

function elementTextLabel(element: HTMLElement): string {
  const explicit = element.dataset.auditLabel?.trim();
  if (explicit) return truncateAuditText(explicit, 80);
  const title = element.getAttribute("title")?.trim();
  if (title) return truncateAuditText(title, 80);
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) return truncateAuditText(aria, 80);
  if (element instanceof HTMLInputElement) {
    return truncateAuditText(element.placeholder || element.value || element.name || "input", 80);
  }
  if (element instanceof HTMLTextAreaElement) {
    return truncateAuditText(element.placeholder || element.name || "textarea", 80);
  }
  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions?.[0]?.textContent?.trim();
    return truncateAuditText(selected || element.name || "select", 80);
  }
  const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
  if (text) return truncateAuditText(text, 80);
  return truncateAuditText(element.tagName.toLowerCase(), 80);
}

function elementFromTarget(target: EventTarget | null): string {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return "unknown";
  const explicit = element.closest<HTMLElement>("[data-audit-id]")?.dataset.auditId?.trim();
  if (explicit) return explicit;
  const interactive = element.closest<HTMLElement>("button, a, input, textarea, select, [role='button'], [role='tab'], [role='menuitem']");
  if (interactive) {
    const role = interactive.getAttribute("role")?.trim();
    const tag = interactive.tagName.toLowerCase();
    const label = elementTextLabel(interactive);
    return `${role || tag}:${label || tag}`;
  }
  return `${element.tagName.toLowerCase()}:${elementTextLabel(element)}`;
}

function buildSourceDescriptors(sources: SourceImage[]) {
  return sources.map((source) => ({
    kind: classifyAuditSourceKind(source.path),
    name: truncateAuditText(source.name || auditPathLeaf(source.path), 80),
  }));
}

function buildAuditContext(state: StudioState): UIAuditStateSnapshot {
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeProfileId);
  return {
    workspaceId: state.activeWorkspaceId,
    mode: state.mode,
    size: state.size,
    quality: state.quality,
    batchCount: state.batchCount,
    styleTag: state.styleTag,
    runningJobIds: [...state.runningJobs],
    jobsTotal: state.jobsTotal,
    jobsCompleted: state.jobsCompleted,
    activeProfileId: state.activeProfileId,
    activeProfileName: activeProfile?.name?.trim() || "",
    settingsOpen: state.settingsOpen,
    upstreamConfigOpen: state.upstreamModalOpen,
    historyTimelineOpen: state.historyTimelineOpen,
    resultDetailOpen: state.resultDetail !== null,
    errorMessage: state.errorMessage ? truncateAuditText(state.errorMessage, 240) : null,
    errorRawPath: sanitizeAuditPath(state.errorRawPath),
    promptPreview: truncateAuditText(state.prompt, 120),
    negativePromptPreview: truncateAuditText(state.negativePrompt, 80),
    sourceDescriptors: buildSourceDescriptors(state.sources),
  };
}

function makePageInfo(platform: string): UIAuditPageInfo {
  const href = typeof window !== "undefined" && window.location?.href ? window.location.href : "";
  return {
    url: href,
    version: appVersion,
    platform,
  };
}

function groupMap(groupsByWorkspace: Record<string, JobGroupSnapshot[]>): Map<string, JobGroupSnapshot> {
  const out = new Map<string, JobGroupSnapshot>();
  for (const groups of Object.values(groupsByWorkspace)) {
    for (const group of groups) out.set(group.groupId, group);
  }
  return out;
}

function slotMap(groupsByWorkspace: Record<string, JobGroupSnapshot[]>): Map<string, JobSlotSnapshot> {
  const out = new Map<string, JobSlotSnapshot>();
  for (const groups of Object.values(groupsByWorkspace)) {
    for (const group of groups) {
      for (const slot of group.slots) out.set(slot.jobId, slot);
    }
  }
  return out;
}

export function useInteractionAudit() {
  const platform = usePlatform();
  const enabled = useMemo(() => isLocalPreviewHost(), []);
  const queueRef = useRef<UIAuditEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  const runStartedAtRef = useRef<number>(Date.now());
  const sessionMetaRef = useRef<UIAuditSessionMeta | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const { id: tabSessionId, created } = readOrCreateTabSessionId();
    const runId = makeUIAuditID("run");
    const page = makePageInfo(platform.targetPlatform);
    sessionMetaRef.current = {
      uiAuditVersion: UI_AUDIT_VERSION,
      tabSessionId,
      runId,
      sessionStartedAt: created ? Date.now() : Date.now(),
      appVersion: page.version,
      platform: page.platform,
    };
    runStartedAtRef.current = Date.now();

    const flush = async (options?: { immediate?: boolean; preferBeacon?: boolean }) => {
      if (!sessionMetaRef.current || queueRef.current.length === 0) return;
      const events = queueRef.current;
      queueRef.current = [];
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      await appendUIAuditEvents({ session: sessionMetaRef.current, events }, {
        keepalive: !!options?.immediate,
        preferBeacon: !!options?.preferBeacon,
      });
    };

    const scheduleFlush = () => {
      if (queueRef.current.length >= FLUSH_BATCH_SIZE) {
        void flush({ immediate: true });
        return;
      }
      if (timerRef.current != null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, FLUSH_DELAY_MS);
    };

    const pushEvent = (event: Omit<UIAuditEvent, "uiAuditVersion" | "tabSessionId" | "runId">, options?: { immediate?: boolean; preferBeacon?: boolean }) => {
      if (!sessionMetaRef.current) return;
      queueRef.current.push({
        uiAuditVersion: UI_AUDIT_VERSION,
        tabSessionId: sessionMetaRef.current.tabSessionId,
        runId: sessionMetaRef.current.runId,
        ...event,
      });
      if (options?.immediate) {
        void flush({ immediate: true, preferBeacon: options.preferBeacon });
      } else {
        scheduleFlush();
      }
    };

    const stateAtMount = useStudioStore.getState();
    if (created) {
      pushEvent({
        type: "session_start",
        timestamp: Date.now(),
        page,
        area: "app",
        element: "session",
        context: buildAuditContext(stateAtMount),
      }, { immediate: true });
    }
    pushEvent({
      type: "run_start",
      timestamp: Date.now(),
      page,
      area: "app",
      element: "run",
      context: buildAuditContext(stateAtMount),
    }, { immediate: true });

    const handleClick = (event: MouseEvent) => {
      const state = useStudioStore.getState();
      pushEvent({
        type: "click",
        timestamp: Date.now(),
        page: makePageInfo(platform.targetPlatform),
        area: areaFromElement(event.target),
        element: elementFromTarget(event.target),
        mouseX: Math.round(event.clientX),
        mouseY: Math.round(event.clientY),
        context: buildAuditContext(state),
      });
    };

    const handlePageHide = () => {
      const state = useStudioStore.getState();
      pushEvent({
        type: "pagehide",
        timestamp: Date.now(),
        page: makePageInfo(platform.targetPlatform),
        area: "app",
        element: "pagehide",
        context: buildAuditContext(state),
      }, { immediate: true, preferBeacon: true });
    };

    const unsubscribe = useStudioStore.subscribe((state, prevState) => {
      const now = Date.now();
      const pageNow = makePageInfo(platform.targetPlatform);

      if (state.errorMessage !== prevState.errorMessage || state.errorRawPath !== prevState.errorRawPath) {
        pushEvent({
          type: "ui_error_changed",
          timestamp: now,
          page: pageNow,
          area: "app",
          element: "ui-error",
          context: buildAuditContext(state),
          details: {
            errorMessage: state.errorMessage ? truncateAuditText(state.errorMessage, 240) : null,
            errorRawPath: sanitizeAuditPath(state.errorRawPath),
          },
        }, { immediate: true });
      }

      const prevGroups = groupMap(prevState.jobGroupsByWorkspace);
      const nextGroups = groupMap(state.jobGroupsByWorkspace);
      for (const [groupId, group] of nextGroups.entries()) {
        if (prevGroups.has(groupId)) continue;
        if (group.createdAt < runStartedAtRef.current - 1000) continue;
        pushEvent({
          type: "submit",
          timestamp: now,
          page: pageNow,
          area: "control-panel",
          element: "submit",
          context: buildAuditContext(state),
          details: {
            groupId,
            workspaceId: group.workspaceId,
            mode: group.mode,
            batchCount: group.batchCount,
            size: group.size,
            quality: group.quality,
            outputFormat: group.outputFormat,
            promptPreview: truncateAuditText(group.prompt, 120),
            sourceCount: group.sourceImagePaths?.length ?? 0,
          },
        }, { immediate: true });
      }

      const prevSlots = slotMap(prevState.jobGroupsByWorkspace);
      const nextSlots = slotMap(state.jobGroupsByWorkspace);
      for (const [jobId, slot] of nextSlots.entries()) {
        const prevSlot = prevSlots.get(jobId);
        if (!prevSlot) continue;
        if (slot.status === prevSlot.status) continue;
        if ((slot.updatedAt ?? 0) < runStartedAtRef.current - 1000) continue;
        const terminalDetails = {
          jobId,
          groupId: slot.groupId,
          workspaceId: slot.workspaceId,
          status: slot.status,
          batchIndex: slot.batchIndex,
          stage: truncateAuditText(slot.stage || "", 120),
          errorMessage: slot.errorMessage ? truncateAuditText(slot.errorMessage, 240) : "",
          rawPath: sanitizeAuditPath(slot.rawPath),
          savedPath: sanitizeAuditPath(slot.savedPath),
          sourceEvent: slot.sourceEvent || "",
        };
        if (slot.status === "succeeded") {
          pushEvent({
            type: "job_terminal",
            timestamp: now,
            page: pageNow,
            area: "history",
            element: "job-terminal",
            context: buildAuditContext(state),
            details: terminalDetails,
          }, { immediate: true });
        } else if (slot.status === "cancelled") {
          pushEvent({
            type: "job_cancelled",
            timestamp: now,
            page: pageNow,
            area: "history",
            element: "job-cancelled",
            context: buildAuditContext(state),
            details: terminalDetails,
          }, { immediate: true });
        } else if (slot.status === "failed" || slot.status === "interrupted") {
          pushEvent({
            type: "job_error",
            timestamp: now,
            page: pageNow,
            area: "history",
            element: "job-error",
            context: buildAuditContext(state),
            details: terminalDetails,
          }, { immediate: true });
        }
      }
    });

    window.addEventListener("click", handleClick, true);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      unsubscribe();
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("pagehide", handlePageHide);
      void flush({ immediate: true, preferBeacon: true });
    };
  }, [enabled, platform.targetPlatform]);
}
