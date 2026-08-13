import {
  UI_AUDIT_PROXY_PREFIX,
  UI_AUDIT_VERSION,
  type UIAuditAppendPayload,
  type UIAuditAppendResponse,
  type UIAuditSourceKind,
} from "./uiAuditContracts.ts";
import { runtimeID } from "../../lib/runtimeCompat.ts";

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  if (typeof fetch !== "function") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function truncateAuditText(value: string, limit: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}...`;
}

export function auditPathLeaf(filePath: string): string {
  const raw = String(filePath || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

export function sanitizeAuditPath(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const forward = raw.replace(/\\/g, "/");
  const inputIdx = forward.toLowerCase().lastIndexOf("/input/");
  if (inputIdx >= 0) return raw.slice(inputIdx + 1).replace(/\//g, "\\");
  const outputIdx = forward.toLowerCase().lastIndexOf("/output/");
  if (outputIdx >= 0) return raw.slice(outputIdx + 1).replace(/\//g, "\\");
  if (raw.startsWith("memory://")) return raw;
  return auditPathLeaf(raw);
}

export function classifyAuditSourceKind(filePath: string | null | undefined): UIAuditSourceKind {
  const raw = String(filePath || "").trim();
  if (!raw) return "relative";
  const lower = raw.replace(/\\/g, "/").toLowerCase();
  if (lower.startsWith("memory://")) return "memory";
  if (/(^|\/)input\//.test(lower)) return "input-root";
  if (/(^|\/)output\//.test(lower)) return "output-root";
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) return "external-absolute";
  return "relative";
}

export async function appendUIAuditEvents(
  payload: UIAuditAppendPayload,
  options?: { keepalive?: boolean; preferBeacon?: boolean },
): Promise<boolean> {
  if (!isLocalPreviewHost() || !payload.events.length) return false;
  const body = JSON.stringify(payload);

  if (options?.preferBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const ok = navigator.sendBeacon(
        `${UI_AUDIT_PROXY_PREFIX}/append`,
        new Blob([body], { type: "application/json; charset=utf-8" }),
      );
      if (ok) return true;
    } catch {
      // Fall through to fetch.
    }
  }

  try {
    const response = await fetch(`${UI_AUDIT_PROXY_PREFIX}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: !!options?.keepalive,
    });
    if (!response.ok) return false;
    const data = await response.json() as UIAuditAppendResponse;
    return data.ok === true && data.accepted >= payload.events.length;
  } catch {
    return false;
  }
}

export function makeUIAuditID(prefix: string): string {
  return runtimeID(prefix);
}

export { UI_AUDIT_VERSION };
