import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const ANDROID_PACKAGE = "top.fangtangyuan.fhlstudio.android";
const GRID_COUNTS = [30, 60, 200];
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

const scenario = arg("scenario");
const adbPath = path.resolve(arg("adb-path"));
const serial = arg("device-serial");
const apkPath = path.resolve(arg("apk"));
const expectedApkSha256 = arg("apk-sha256").toUpperCase();
const baselineApkPath = arg("baseline-apk") ? path.resolve(arg("baseline-apk")) : "";
const outputDirectory = path.resolve(arg("output"));
const cdpPort = Number(arg("cdp-port"));
const observationSeconds = Number(arg("observation-seconds", "30"));
const productGitCommit = arg("git-commit");

if (
  !["Fresh", "Upgrade"].includes(scenario)
  || !adbPath
  || !/^emulator-\d+$/.test(serial)
  || !apkPath
  || !/^[0-9A-F]{64}$/.test(expectedApkSha256)
  || !Number.isInteger(cdpPort)
  || cdpPort < 1024
  || cdpPort > 65535
  || !Number.isFinite(observationSeconds)
  || observationSeconds < 30
  || observationSeconds > 300
  || !/^[0-9a-f]{40}$/i.test(productGitCommit)
  || (scenario === "Upgrade" && !baselineApkPath)
) {
  throw new Error("Invalid public Release emulator verifier arguments.");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function runAdb(args, options = {}) {
  return execFileSync(adbPath, ["-s", serial, ...args], {
    encoding: options.encoding ?? null,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    timeout: options.timeout ?? 60000,
    windowsHide: true,
  });
}

function packageInstalled() {
  const output = runAdb(["shell", "pm", "list", "packages", ANDROID_PACKAGE], { encoding: "utf8" });
  return output.split(/\r?\n/).some((line) => line.trim() === `package:${ANDROID_PACKAGE}`);
}

function installApk(apk, replace) {
  const args = ["install"];
  if (replace) args.push("-r");
  args.push(apk);
  const output = runAdb(args, { encoding: "utf8", timeout: 180000 });
  if (!/^Success\s*$/m.test(output)) throw new Error(`adb install failed: ${output.trim()}`);
}

function installedApkIdentity() {
  const output = runAdb(["shell", "pm", "path", ANDROID_PACKAGE], { encoding: "utf8" });
  const remotePath = output.split(/\r?\n/).find((line) => line.startsWith("package:"))?.slice(8).trim();
  if (!remotePath) throw new Error("Installed public Release APK path was not found.");
  const bytes = runAdb(["exec-out", "cat", remotePath]);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function resolveLauncher() {
  const output = runAdb([
    "shell", "cmd", "package", "resolve-activity", "--brief",
    "-c", "android.intent.category.LAUNCHER", ANDROID_PACKAGE,
  ], { encoding: "utf8" });
  const component = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.includes("/"));
  if (!component) throw new Error("Public Release launcher Activity was not found.");
  return component;
}

function startApp() {
  const output = runAdb(["shell", "am", "start", "-W", "-n", resolveLauncher()], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (!/Status:\s*ok/i.test(output)) throw new Error(`Public Release launch failed: ${output.trim()}`);
}

function currentPid() {
  const pid = runAdb(["shell", "pidof", "-s", ANDROID_PACKAGE], { encoding: "utf8" }).trim();
  if (!/^\d+$/.test(pid)) throw new Error("Public Release process is not running.");
  return pid;
}

function bindCDP() {
  const pid = currentPid();
  try { runAdb(["forward", "--remove", `tcp:${cdpPort}`]); } catch { /* no prior binding */ }
  runAdb(["forward", `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]);
  return { pid, forward: `tcp:${cdpPort} -> localabstract:webview_devtools_remote_${pid}` };
}

class CDPClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        this.events.push(message);
        return;
      }
      if (!this.pending.has(message.id)) return;
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 20000) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception;
      throw new Error(exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  }

  close() { this.socket.close(); }
}

async function connectCDP() {
  const deadline = Date.now() + 20000;
  let page;
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
      page = pages.find((entry) => (
        entry.type === "page"
        && entry.webSocketDebuggerUrl
        && /^https:\/\/appassets\.androidplatform\.net\/assets\/index\.html\?/.test(entry.url || "")
        && /(?:^|[?&])target=android(?:&|$)/.test(entry.url || "")
      ));
      if (page) break;
    } catch { /* WebView is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error("Public Release WebView CDP page was not found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timed out.")), 10000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed.")); }, { once: true });
  });
  return { client: new CDPClient(socket), page: { id: page.id, url: page.url, title: page.title } };
}

function asyncExpression(body) {
  const expression = `(async () => { ${body} })()`;
  Function(`return ${expression};`);
  return expression;
}

function nativeInvokeExpression(method, args) {
  return asyncExpression(`
    const bridge = window.AndroidImageStudio;
    if (!bridge || typeof bridge.invoke !== "function") throw new Error("Android invoke Bridge is unavailable.");
    const requestId = "public-release-verifier-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    return await new Promise((resolve, reject) => {
      const previousResolve = window.__imageStudioNativeResolve;
      const previousReject = window.__imageStudioNativeReject;
      const restore = () => {
        window.__imageStudioNativeResolve = previousResolve;
        window.__imageStudioNativeReject = previousReject;
      };
      const timer = setTimeout(() => { restore(); reject(new Error("Native invoke timed out.")); }, 10000);
      window.__imageStudioNativeResolve = (id, payload) => {
        if (id === requestId) { clearTimeout(timer); restore(); resolve(payload); return; }
        if (typeof previousResolve === "function") previousResolve(id, payload);
      };
      window.__imageStudioNativeReject = (id, message) => {
        if (id === requestId) { clearTimeout(timer); restore(); reject(new Error(String(message))); return; }
        if (typeof previousReject === "function") previousReject(id, message);
      };
      bridge.invoke(requestId, ${JSON.stringify(method)}, JSON.stringify(${JSON.stringify(args)}));
    });
  `);
}

async function waitForReady(client) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await client.evaluate(`(() => ({
      ready: document.readyState === "complete",
      root: Boolean(document.querySelector(".studio")),
      toggle: Boolean(document.querySelector('[data-audit-id="toggle-android-quick-settings"]')),
      images: document.querySelector('[data-audit-id="fhl-transport-images"]')?.getAttribute("aria-pressed") || "",
      responses: document.querySelector('[data-audit-id="fhl-transport-responses"]')?.getAttribute("aria-pressed") || "",
      debugAudit: typeof window.AndroidEmulatorAudit !== "undefined",
      debugStore: typeof window.__imageStudioDebug !== "undefined",
    }))()`);
    if (state?.ready && state.root && state.toggle) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Public Release UI did not become ready.");
}

async function workspaceIds(client) {
  return client.evaluate(`(() => {
    const suffix = ".gptcodex.workspaceSession.v1";
    const ids = new Set(["default"]);
    for (const key of Object.keys(localStorage).filter((item) => item.endsWith(suffix))) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        for (const workspace of Array.isArray(parsed?.workspaces) ? parsed.workspaces : []) {
          if (workspace && typeof workspace.id === "string" && workspace.id.trim()) ids.add(workspace.id.trim());
        }
      } catch { }
    }
    return [...ids].sort();
  })()`);
}

async function jobSnapshot(client) {
  const ids = await workspaceIds(client);
  const workspaces = [];
  for (const id of ids) {
    const response = await client.evaluate(nativeInvokeExpression("ListAndroidJobs", [id, 700]));
    const groups = Array.isArray(response?.groups) ? response.groups : [];
    workspaces.push({
      workspaceIdHash: sha256(Buffer.from(id, "utf8")),
      groups: groups.length,
      tasks: groups.reduce((total, group) => total + (Array.isArray(group?.slots) ? group.slots.length : 0), 0),
    });
  }
  return {
    workspaceCount: workspaces.length,
    groups: workspaces.reduce((total, item) => total + item.groups, 0),
    tasks: workspaces.reduce((total, item) => total + item.tasks, 0),
    workspaces,
  };
}

async function browserFingerprint(client) {
  return client.evaluate(asyncExpression(`
    const sensitiveSuffixes = [
      ".gptcodex.profiles", ".gptcodex.activeProfileId", ".gptcodex.workspaceSession.v1",
      ".gptcodex.fhlTransportMode.v1", ".gptcodex.androidFHLImagesPoolCursor.v1",
    ];
    const entries = Object.keys(localStorage).filter((key) => sensitiveSuffixes.some((suffix) => key.endsWith(suffix)))
      .sort().map((key) => [key, localStorage.getItem(key)]);
    const bytes = new TextEncoder().encode(JSON.stringify(entries));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return {
      entryCount: entries.length,
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase(),
    };
  `));
}

async function credentialPresenceSnapshot(client) {
  return client.evaluate(asyncExpression(`
    const profileKey = Object.keys(localStorage).find((key) => key.endsWith(".gptcodex.profiles"));
    let profiles = [];
    try { profiles = JSON.parse(localStorage.getItem(profileKey) || "[]"); } catch { profiles = []; }
    const namespace = profileKey ? profileKey.slice("image-studio.".length, -".gptcodex.profiles".length) : "";
    const bridge = window.AndroidImageStudio;
    if (!bridge || typeof bridge.invoke !== "function") throw new Error("Android invoke Bridge is unavailable.");
    const invoke = (method, args) => new Promise((resolve, reject) => {
      const requestId = "public-release-credential-check-" + Math.random().toString(36).slice(2);
      const previousResolve = window.__imageStudioNativeResolve;
      const previousReject = window.__imageStudioNativeReject;
      const restore = () => {
        window.__imageStudioNativeResolve = previousResolve;
        window.__imageStudioNativeReject = previousReject;
      };
      window.__imageStudioNativeResolve = (id, payload) => {
        if (id === requestId) { restore(); resolve(payload); return; }
        if (typeof previousResolve === "function") previousResolve(id, payload);
      };
      window.__imageStudioNativeReject = (id, message) => {
        if (id === requestId) { restore(); reject(new Error(String(message))); return; }
        if (typeof previousReject === "function") previousReject(id, message);
      };
      bridge.invoke(requestId, method, JSON.stringify(args));
    });
    let configuredProfiles = 0;
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      if (!profile || typeof profile.id !== "string") continue;
      const credential = String(await invoke("GetStoredAPIKey", ["profile:" + namespace + ":" + profile.id]) || "");
      if (credential.trim()) configuredProfiles += 1;
    }
    return { profileCount: Array.isArray(profiles) ? profiles.length : 0, configuredProfiles };
  `));
}

async function verifyQuickSettings(client) {
  const initial = await client.evaluate(`(() => {
    const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
    return {
      expanded: toggle?.getAttribute("aria-expanded") === "true",
      controlsMounted: Boolean(document.querySelector("#android-header-quick-settings")),
    };
  })()`);
  if (!initial.expanded || !initial.controlsMounted) throw new Error("Quick settings did not default to expanded.");
  await client.evaluate(`document.querySelector('[data-audit-id="toggle-android-quick-settings"]').click()`);
  await waitForQuickState(client, false);
  await client.call("Page.enable");
  await client.call("Page.reload", { ignoreCache: true }, 15000);
  const collapsed = await waitForQuickState(client, false);
  await client.evaluate(`document.querySelector('[data-audit-id="toggle-android-quick-settings"]').click()`);
  const restored = await waitForQuickState(client, true);
  return { initial, collapsedAfterReload: collapsed, restored };
}

async function waitForQuickState(client, expanded) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await client.evaluate(`(() => {
      const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
      return {
        expanded: toggle?.getAttribute("aria-expanded") === "true",
        controlsMounted: Boolean(document.querySelector("#android-header-quick-settings")),
        rootState: document.documentElement.dataset.androidQuickSettings || "",
      };
    })()`);
    if (value.expanded === expanded && value.controlsMounted === expanded) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Quick settings persistence did not settle.");
}

async function verifyBulkCancel(client) {
  const keys = Array.from({ length: 10 }, (_, index) => `sk-${(index + 1).toString(16).padStart(2, "0")}${"a".repeat(62)}`);
  return client.evaluate(asyncExpression(`
    const waitFor = async (predicate, label) => {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for " + label);
    };
    const fullKeys = ${JSON.stringify(keys)};
    document.querySelector('[data-audit-id="open-upstream-config"]').click();
    await waitFor(() => document.querySelector(".android-upstream-modal-card"), "upstream dialog");
    const poolButton = await waitFor(() => [...document.querySelectorAll("button")].find((button) => (
      button.offsetParent && (button.textContent || "").trim().startsWith("FHL Images 10")
    )), "FHL pool button");
    poolButton.click();
    const pool = await waitFor(() => document.querySelector(".android-fhl-pool"), "FHL pool");
    const pendingBefore = pool.querySelectorAll(".android-fhl-slot-status.pending").length;
    pool.querySelector('[data-audit-id="fhl-bulk-config-open"]').click();
    const dialog = await waitFor(() => document.querySelector(".android-fhl-bulk-dialog-card"), "bulk dialog");
    const input = dialog.querySelector('[data-audit-id="fhl-bulk-api-input"]');
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => fullKeys.join("\\n") } });
    input.dispatchEvent(paste);
    await waitFor(() => dialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10, "masked previews");
    const surface = [dialog.innerText, dialog.textContent, dialog.outerHTML, ...[...dialog.querySelectorAll("input,textarea")].map((node) => node.value)].join("\\n");
    const beforeCancel = {
      previews: dialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
      fixedMasks: [...dialog.querySelectorAll(".android-fhl-bulk-preview-row")].filter((row) => (
        (row.textContent || "").replace(/\\s+/g, "").includes("sk-************")
      )).length,
      textareaEmpty: input.value === "",
      fullKeyLeaks: fullKeys.filter((key) => surface.includes(key)).length,
      tailLeaks: fullKeys.filter((key) => surface.includes(key.slice(-8))).length,
    };
    dialog.querySelector('[data-audit-id="fhl-bulk-cancel"]').click();
    await waitFor(() => !document.querySelector(".android-fhl-bulk-dialog-card"), "bulk dialog close");
    const pendingAfter = pool.querySelectorAll(".android-fhl-slot-status.pending").length;
    document.querySelector(".android-upstream-modal-card .android-upstream-modal-header button")?.click();
    return { pendingBefore, pendingAfter, ...beforeCancel };
  `), 30000);
}

async function injectSyntheticGrid(client, count) {
  return client.evaluate(asyncExpression(`
    const count = ${count};
    const ids = Array.from({ length: count }, (_, index) => "public-release-grid-${count}-" + (index + 1));
    const workspaceKey = Object.keys(localStorage).find((key) => key.endsWith(".gptcodex.workspaceSession.v1"));
    if (!workspaceKey) throw new Error("Workspace session key was not found.");
    const originalWorkspace = localStorage.getItem(workspaceKey);
    const workspaceSession = JSON.parse(originalWorkspace);
    const workspace = (workspaceSession.workspaces || []).find((item) => item.id === workspaceSession.activeWorkspaceId)
      || (workspaceSession.workspaces || [])[0];
    if (!workspace) throw new Error("Active workspace was not found.");
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const dbName = databases.map((item) => item.name).find((name) => name && name.startsWith("image-studio-"));
    if (!dbName) throw new Error("Production history database was not found.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("history", "readwrite");
      const store = transaction.objectStore("history");
      for (let index = 0; index < count; index += 1) store.put({
        id: ids[index], createdAt: 1893456000000 + index, mode: "generate", apiMode: "images",
        apiLabel: "FHL" + ((index % 10) + 1), prompt: "synthetic-offline-result-" + (index + 1),
        imageB64: ${JSON.stringify(ONE_PIXEL_PNG)}, outputWidth: 1152, outputHeight: 2048,
        elapsedSec: index + 1, batchIndex: index, searchText: "synthetic", searchTokens: ["s"],
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    workspace.batchResultIds = ids;
    workspace.currentImageId = ids[0];
    workspace.resultGridOpen = true;
    workspaceSession.activeWorkspaceId = workspace.id;
    localStorage.setItem(workspaceKey, JSON.stringify(workspaceSession));
    sessionStorage.setItem("public-release-grid-cleanup", JSON.stringify({ dbName, ids, workspaceKey, originalWorkspace }));
    return true;
  `), 30000);
}

async function verifyGrid(client, count) {
  await waitForReady(client);
  await client.evaluate(`(() => {
    const navigation = document.querySelector(".android-bottom-nav") || document.querySelector(".android-rail");
    const canvasButton = navigation?.querySelector("button:nth-child(2)");
    if (!canvasButton) throw new Error("Canvas navigation button was not found.");
    canvasButton.click();
    return true;
  })()`);
  return client.evaluate(asyncExpression(`
    const expectedRows = Math.ceil(${count} / 2);
    const deadline = performance.now() + 15000;
    let viewport = null;
    while (performance.now() < deadline) {
      viewport = document.querySelector(".batch-grid-virtual-scroll");
      if (viewport && Number(viewport.dataset.batchGridTotalRows) === expectedRows) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!viewport) throw new Error("Virtual grid was not mounted.");
    const sample = () => {
      const rows = [...viewport.querySelectorAll(".batch-grid-virtual-row")];
      const mountedTiles = viewport.querySelectorAll(".batch-grid-tile").length;
      const rowHeight = rows[0]?.getBoundingClientRect().height || 1;
      const stride = rowHeight + 8;
      const firstVisible = Math.floor(viewport.scrollTop / stride);
      const lastVisible = Math.ceil((viewport.scrollTop + viewport.clientHeight) / stride);
      const visibleRows = Math.max(0, lastVisible - firstVisible);
      return {
        startRow: Number(viewport.dataset.batchGridStartRow),
        endRow: Number(viewport.dataset.batchGridEndRow),
        totalRows: Number(viewport.dataset.batchGridTotalRows),
        mountedTiles,
        mountedImages: viewport.querySelectorAll("img").length,
        maxMountedTiles: 2 * (visibleRows + 4),
        everyRowAtMostTwo: rows.every((row) => row.children.length > 0 && row.children.length <= 2),
        scrollable: viewport.scrollHeight > viewport.clientHeight,
      };
    };
    const initial = sample();
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    const bottomDeadline = performance.now() + 8000;
    while (performance.now() < bottomDeadline && Number(viewport.dataset.batchGridEndRow) !== expectedRows) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const bottom = sample();
    const includesLast = [...viewport.querySelectorAll(".batch-grid-index")].some((node) => Number(node.textContent) === ${count});
    const passed = initial.totalRows === expectedRows && initial.startRow === 0
      && initial.mountedTiles <= initial.maxMountedTiles && initial.mountedImages === initial.mountedTiles
      && initial.everyRowAtMostTwo && initial.scrollable
      && bottom.endRow === expectedRows && bottom.mountedTiles <= bottom.maxMountedTiles
      && bottom.everyRowAtMostTwo && includesLast;
    return { count: ${count}, expectedRows, initial, bottom, includesLast, passed };
  `), 30000);
}

async function cleanupSyntheticGrid(client) {
  return client.evaluate(asyncExpression(`
    const raw = sessionStorage.getItem("public-release-grid-cleanup");
    if (!raw) return { cleaned: true, removed: 0 };
    const cleanup = JSON.parse(raw);
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(cleanup.dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("history", "readwrite");
      const store = transaction.objectStore("history");
      for (const id of cleanup.ids) store.delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    localStorage.setItem(cleanup.workspaceKey, cleanup.originalWorkspace);
    sessionStorage.removeItem("public-release-grid-cleanup");
    return { cleaned: true, removed: cleanup.ids.length };
  `), 30000);
}

function logEvidence() {
  const jobs = runAdb(["logcat", "-d", "-v", "threadtime", "FHLImageStudioJobs:I", "AndroidRuntime:E", "ActivityManager:E", "*:S"], {
    encoding: "utf8",
  });
  const crash = runAdb(["logcat", "-b", "crash", "-d", "-v", "threadtime"], { encoding: "utf8" });
  const upstreamAttempts = (jobs.match(/upstream_submit_attempt|FHL Images request|APIMart submit request/g) || []).length;
  const crashes = (crash.match(new RegExp(ANDROID_PACKAGE.replaceAll(".", "\\."), "g")) || []).length;
  const anrs = (jobs.match(new RegExp(`ANR in ${ANDROID_PACKAGE.replaceAll(".", "\\.")}`, "g")) || []).length;
  return { jobs, crash, summary: { upstreamAttempts, crashes, anrs } };
}

function summarizeExternalNetwork(client, startIndex) {
  const requests = client.events.slice(startIndex).filter((event) => event.method === "Network.requestWillBeSent")
    .map((event) => event.params?.request)
    .filter((request) => request && /^https?:\/\//i.test(request.url || ""))
    .map((request) => {
      const parsed = new URL(request.url);
      return { method: String(request.method || "GET").toUpperCase(), host: parsed.host.toLowerCase() };
    })
    .filter((request) => request.host !== "appassets.androidplatform.net");
  return {
    count: requests.length,
    postCount: requests.filter((request) => request.method === "POST").length,
    hostHashes: [...new Set(requests.map((request) => sha256(Buffer.from(request.host, "utf8"))))].sort(),
  };
}

await fs.mkdir(outputDirectory, { recursive: true });
const startedAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  status: "failed",
  scenario,
  startedAt,
  finishedAt: null,
  packageName: ANDROID_PACKAGE,
  productGitCommit,
  apkSha256: expectedApkSha256,
  observationSeconds,
  installation: null,
  cdp: null,
  startup: null,
  quickSettings: null,
  bulkCancel: null,
  virtualGrid: [],
  zeroRequest: null,
  cleanup: null,
  failure: null,
};

let client;
try {
  if (packageInstalled()) {
    throw new Error(`${scenario} scenario requires an isolated AVD without the public package installed.`);
  }
  if (scenario === "Fresh") {
    installApk(apkPath, false);
  } else {
    installApk(baselineApkPath, false);
    startApp();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    installApk(apkPath, true);
  }
  const identity = installedApkIdentity();
  if (identity.sha256 !== expectedApkSha256) throw new Error("Installed APK hash does not match the frozen public Release candidate.");
  report.installation = { scenario, candidate: identity, baselineUsed: scenario === "Upgrade" };

  runAdb(["logcat", "-c"]);
  startApp();
  report.cdp = { binding: bindCDP() };
  const connected = await connectCDP();
  client = connected.client;
  report.cdp.page = connected.page;
  await client.call("Network.enable", {}, 10000);
  const networkStartIndex = client.events.length;
  const ready = await waitForReady(client);
  if (ready.debugAudit || ready.debugStore) throw new Error("Release exposes a Debug-only audit surface.");
  if (ready.images !== "true" || ready.responses !== "false") throw new Error("Fresh public preference is not Images API or Responses entry is missing.");

  const beforeJobs = await jobSnapshot(client);
  if (beforeJobs.groups !== 0 || beforeJobs.tasks !== 0) throw new Error("Isolated public AVD is not task-free before observation.");
  const credentials = await credentialPresenceSnapshot(client);
  if (credentials.configuredProfiles !== 0) throw new Error("Isolated public Release contains a configured API credential.");
  const beforeBrowser = await browserFingerprint(client);
  await new Promise((resolve) => setTimeout(resolve, observationSeconds * 1000));
  const afterObservationJobs = await jobSnapshot(client);
  const afterObservationBrowser = await browserFingerprint(client);
  report.startup = { ready, credentials, beforeJobs, afterObservationJobs };
  if (afterObservationJobs.groups !== 0 || afterObservationJobs.tasks !== 0) throw new Error("Startup created an automatic Group or Task.");
  if (beforeBrowser.sha256 !== afterObservationBrowser.sha256) throw new Error("Startup changed persisted browser business state.");

  report.quickSettings = await verifyQuickSettings(client);
  const beforeBulkJobs = await jobSnapshot(client);
  const beforeBulkBrowser = await browserFingerprint(client);
  report.bulkCancel = await verifyBulkCancel(client);
  const afterBulkJobs = await jobSnapshot(client);
  const afterBulkBrowser = await browserFingerprint(client);
  const afterBulkCredentials = await credentialPresenceSnapshot(client);
  if (
    report.bulkCancel.previews !== 10
    || report.bulkCancel.fixedMasks !== 10
    || !report.bulkCancel.textareaEmpty
    || report.bulkCancel.fullKeyLeaks !== 0
    || report.bulkCancel.tailLeaks !== 0
    || report.bulkCancel.pendingAfter !== report.bulkCancel.pendingBefore
    || JSON.stringify(beforeBulkJobs) !== JSON.stringify(afterBulkJobs)
    || beforeBulkBrowser.sha256 !== afterBulkBrowser.sha256
    || afterBulkCredentials.configuredProfiles !== 0
  ) throw new Error("Bulk paste mask or cancel zero-side-effect invariant failed.");

  for (const count of GRID_COUNTS) {
    await injectSyntheticGrid(client, count);
    await client.call("Page.enable");
    await client.call("Page.reload", { ignoreCache: true }, 15000);
    const grid = await verifyGrid(client, count);
    report.virtualGrid.push(grid);
    if (!grid.passed) throw new Error(`Virtual grid invariant failed for ${count} synthetic results.`);
    report.cleanup = await cleanupSyntheticGrid(client);
    await client.call("Page.reload", { ignoreCache: true }, 15000);
    await waitForReady(client);
  }

  const finalJobs = await jobSnapshot(client);
  const finalBrowser = await browserFingerprint(client);
  const externalNetwork = summarizeExternalNetwork(client, networkStartIndex);
  const logs = logEvidence();
  await fs.writeFile(path.join(outputDirectory, "release-jobs.log"), logs.jobs, "utf8");
  await fs.writeFile(path.join(outputDirectory, "release-crash.log"), logs.crash, "utf8");
  report.zeroRequest = { finalJobs, externalNetwork, logSummary: logs.summary };
  if (finalJobs.groups !== 0 || finalJobs.tasks !== 0) throw new Error("Verifier left a Group or Task behind.");
  if (finalBrowser.sha256 !== afterObservationBrowser.sha256) throw new Error("Verifier did not restore persisted browser business state.");
  if (logs.summary.upstreamAttempts !== 0 || logs.summary.crashes !== 0 || logs.summary.anrs !== 0) {
    throw new Error("Release log evidence contains an upstream attempt, crash, or ANR.");
  }
  if (externalNetwork.count !== 0 || externalNetwork.postCount !== 0) {
    throw new Error("Release WebView made an external network request during zero-request acceptance.");
  }
  report.status = "passed";
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (client) {
    try { report.cleanup = await cleanupSyntheticGrid(client); } catch { /* preserve original failure */ }
  }
} finally {
  client?.close();
  try { runAdb(["forward", "--remove", `tcp:${cdpPort}`]); } catch { /* best effort */ }
  if (report.installation && !report.zeroRequest) {
    try {
      const logs = logEvidence();
      await fs.writeFile(path.join(outputDirectory, "release-jobs.log"), logs.jobs, "utf8");
      await fs.writeFile(path.join(outputDirectory, "release-crash.log"), logs.crash, "utf8");
      report.zeroRequest = { finalJobs: null, logSummary: logs.summary };
    } catch { /* the primary failure remains authoritative */ }
  }
  report.finishedAt = new Date().toISOString();
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDirectory, "PUBLIC-RELEASE-EMULATOR.json"), bytes);
  await fs.writeFile(path.join(outputDirectory, "PUBLIC-RELEASE-EMULATOR.sha256"), `${sha256(bytes)}  PUBLIC-RELEASE-EMULATOR.json\n`, "ascii");
}

if (report.status !== "passed") throw new Error(report.failure || "Public Release emulator verification failed.");
console.log(`Public Android Release emulator verification passed: ${scenario}.`);
