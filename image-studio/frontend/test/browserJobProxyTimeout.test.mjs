import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const proxySource = readFileSync(path.join(frontendRoot, "dev", "browserJobProxy.ts"), "utf8");

test("browser job proxy times out silent and overlong child processes", () => {
  assert.match(proxySource, /BROWSER_JOB_IDLE_TIMEOUT_MS\s*=\s*10 \* 60 \* 1000/);
  assert.match(proxySource, /BROWSER_JOB_DEFAULT_MAX_RUNTIME_MS\s*=\s*20 \* 60 \* 1000/);
  assert.match(proxySource, /BROWSER_JOB_APIMART_MAX_RUNTIME_MS\s*=\s*35 \* 60 \* 1000/);
  assert.match(proxySource, /BROWSER_JOB_TIMEOUT_CHECK_INTERVAL_MS\s*=\s*15 \* 1000/);
  assert.match(proxySource, /proc\.lastActivityAt = Date\.now\(\);\s+proc\.stdout \+= line;/s);
  assert.match(proxySource, /proc\.lastActivityAt = Date\.now\(\);\s+const parsed = safeJsonParse\(line\);/s);
  assert.match(proxySource, /proc\.timedOutMessage = timeoutMessageForPayload\(payload, "runtime", maxRuntimeMs\);/);
  assert.match(proxySource, /proc\.timedOutMessage = timeoutMessageForPayload\(payload, "idle", BROWSER_JOB_IDLE_TIMEOUT_MS\);/);
  assert.match(proxySource, /proc\.child\.kill\(\);/);
});

test("browser job proxy records timeout as a failed terminal state", () => {
  assert.match(proxySource, /const timedOut = !cancelled && !!proc\.timedOutMessage;/);
  assert.match(proxySource, /stage: cancelled \? "已取消" : timedOut \? "超时失败"/);
  assert.match(proxySource, /const rawError = cancelled \? "" : proc\.timedOutMessage \|\|/);
  assert.match(proxySource, /errorMessage: friendlyJobError\(rawError, fallbackMode\)/);
  assert.match(proxySource, /: ok && !timedOut\s+\? "succeeded"\s+: "failed"/);
});

test("browser job proxy clears timeout timers from the terminal callbacks", () => {
  const procClearCount = proxySource.match(/clearProcessTimeout\(proc\);/g)?.length ?? 0;
  assert.ok(procClearCount >= 2);
});

test("browser job proxy retains a running cancellation until child close or error settles it", () => {
  const cancelStart = proxySource.indexOf("  async cancel(jobIds: string[]): Promise<BrowserJobCancelResponse> {");
  const cancelEnd = proxySource.indexOf("\n  subscribe(jobId", cancelStart);
  const cancelSource = proxySource.slice(cancelStart, cancelEnd);
  const runningCancel = cancelSource.match(/if \(running\) \{([\s\S]*?)\n      \}/)?.[1] ?? "";

  assert.match(runningCancel, /running\.cancelled = true;/);
  assert.match(runningCancel, /running\.child\.kill\(\);/);
  assert.match(runningCancel, /cancelledJobIds\.push\(jobId\);\s+continue;/s);
  assert.doesNotMatch(runningCancel, /clearProcessTimeout\(running\)|this\.running\.delete|this\.updateSlot|this\.emit/);
  assert.match(proxySource, /child\.on\("error"[\s\S]*?if \(this\.running\.get\(jobId\) !== proc\) return;[\s\S]*?this\.running\.delete\(jobId\)[\s\S]*?status: proc\.cancelled \? "cancelled"/);
  assert.match(proxySource, /child\.on\("close"[\s\S]*?if \(this\.running\.get\(jobId\) !== proc\) return;[\s\S]*?this\.running\.delete\(jobId\)[\s\S]*?const nextStatus: JobStatus = cancelled\s+\? "cancelled"/);
});

test("browser job proxy does not spawn after cancellation during startup", () => {
  const startupCancelChecks = proxySource.match(/if \(this\.getSlot\(jobId\)\?\.status === "cancelled"\) \{\s+void this\.startNextQueuedSlot\(groupId\);\s+return;/gs)?.length ?? 0;
  assert.ok(startupCancelChecks >= 2);
});

test("browser job proxy retries transient registry write locks without crashing Vite", () => {
  assert.match(proxySource, /BROWSER_JOB_PERSIST_RETRY_DELAYS_MS\s*=\s*\[80, 160, 320, 640, 1000\] as const/);
  assert.match(proxySource, /function isTransientRegistryWriteError/);
  assert.match(proxySource, /code === "EBUSY"/);
  assert.match(proxySource, /code === "EPERM"/);
  assert.match(proxySource, /await delay\(BROWSER_JOB_PERSIST_RETRY_DELAYS_MS\[attempt\]\);/);
  assert.match(proxySource, /console\.warn\(`\[browser-job\] failed to persist registry/);
  assert.match(proxySource, /private persist\(\)[\s\S]*this\.persistChain = this\.persistChain\.then/);
  assert.match(proxySource, /private async writeRegistrySnapshot\(\)[\s\S]*return false;/);
});

test("browser job proxy is available in Vite dev and preview servers", () => {
  assert.match(proxySource, /function mountBrowserJobProxy\(server: any\)/);
  assert.match(proxySource, /async configureServer\(server\) \{\s+await manager\.init\(\);\s+mountBrowserJobProxy\(server\);/s);
  assert.match(proxySource, /async configurePreviewServer\(server\) \{\s+await manager\.init\(\);\s+mountBrowserJobProxy\(server\);/s);
});

test("browser job proxy surfaces raw upstream error messages", () => {
  assert.match(proxySource, /function extractRawResponseErrorMessage\(raw: string\): string/);
  assert.match(proxySource, /function genericHTTPError\(raw: string\)/);
  assert.match(proxySource, /async function readRawResponseErrorMessage\(rawPath: unknown, logDir: string\): Promise<string>/);
  assert.match(proxySource, /const rawResultError = typeof rawResult\?\.error === "string" \? rawResult\.error\.trim\(\) : "";/);
  assert.match(proxySource, /const rawPathError = await readRawResponseErrorMessage\(rawResult\?\.rawPath, path\.join\(this\.outputDir, "log"\)\);/);
  assert.match(proxySource, /rawPathError && genericHTTPError\(rawResultError\)\s+\? rawPathError/s);
});
