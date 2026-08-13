import {
  BROWSER_JOB_PROXY_PREFIX,
  type BrowserJobCancelPayload,
  type BrowserJobCancelResponse,
  type BrowserJobEvent,
  type BrowserJobListResponse,
  type BrowserJobSubmitPayload,
  type BrowserJobSubmitResponse,
} from "./browserJobContracts.ts";

function browserOrigin(): string {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return "http://127.0.0.1";
  }
  if (window.location.origin) return window.location.origin;
  try {
    return new URL(window.location.href || "http://127.0.0.1").origin;
  } catch {
    return "http://127.0.0.1";
  }
}

async function readJSON<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `${response.status} ${response.statusText}`);
  }
  return JSON.parse(raw) as T;
}

export async function submitBrowserJobGroup(payload: BrowserJobSubmitPayload): Promise<BrowserJobSubmitResponse> {
  const response = await fetch(`${BROWSER_JOB_PROXY_PREFIX}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJSON<BrowserJobSubmitResponse>(response);
}

export async function listBrowserJobGroups(workspaceId: string, limit = 50): Promise<BrowserJobListResponse> {
  const url = new URL(`${browserOrigin()}${BROWSER_JOB_PROXY_PREFIX}`);
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return readJSON<BrowserJobListResponse>(response);
}

export async function cancelBrowserJobs(jobIds: string[]): Promise<BrowserJobCancelResponse> {
  const payload: BrowserJobCancelPayload = { jobIds };
  const response = await fetch(`${BROWSER_JOB_PROXY_PREFIX}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJSON<BrowserJobCancelResponse>(response);
}

function parseSSEPayload(raw: string): BrowserJobEvent | null {
  const lines = raw.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as BrowserJobEvent;
  } catch {
    return null;
  }
}

export function subscribeToBrowserJob(
  jobId: string,
  onEvent: (event: BrowserJobEvent) => void,
  onError?: (error: Error) => void,
) {
  const controller = new AbortController();
  void (async () => {
    try {
      const url = new URL(`${browserOrigin()}${BROWSER_JOB_PROXY_PREFIX}/events`);
      url.searchParams.set("jobId", jobId);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`job event stream unavailable: ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = parseSSEPayload(chunk);
          if (payload) onEvent(payload);
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      const finalPayload = parseSSEPayload(buffer);
      if (finalPayload) onEvent(finalPayload);
    } catch (error) {
      if (controller.signal.aborted) return;
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return () => controller.abort();
}
