import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] === undefined ? "" : process.argv[index + 1]) : fallback;
}

const cdpPort = Number(readArg("cdp-port"));
const outputDirectory = path.resolve(readArg("output"));
const deviceLabel = readArg("device-label");
const apiLevel = Number(readArg("api-level"));
const seed = Number(readArg("seed"));
const gitCommit = readArg("git-commit");
const verifierGitCommit = readArg("verifier-git-commit");
const apkSha256 = readArg("apk-sha256").toUpperCase();
const deviceSerial = readArg("device-serial");
const adbPathArgument = readArg("adb-path");
const adbPath = path.resolve(adbPathArgument);
const androidPackage = "top.fangtangyuan.fhlstudio.android.debug";
const clipboardHelperPackage = readArg("clipboard-helper-package");
const gfxScrollGateMode = readArg("gfx-scroll-gate", "off");
const gfxScrollGateEnabled = gfxScrollGateMode === "on";
const clipboardHelperApkSha256 = "0597691FAFC60F315C367D0098AF5C6BD5DEB7A11C78D83E7EFDB8E509EA8BA4";

if (
  !Number.isInteger(cdpPort)
  || cdpPort < 1024
  || cdpPort > 65535
  || !outputDirectory
  || !deviceLabel
  || !Number.isInteger(apiLevel)
  || !Number.isInteger(seed)
  || !/^[0-9a-f]{40}$/i.test(gitCommit)
  || !/^[0-9a-f]{40}$/i.test(verifierGitCommit)
  || !/^[0-9a-f]{64}$/i.test(apkSha256)
  || !/^emulator-\d+$/.test(deviceSerial)
  || !adbPathArgument
  || clipboardHelperPackage !== "top.fangtangyuan.fhlstudio.clipboardhelper"
  || !["off", "on"].includes(gfxScrollGateMode)
) {
  throw new Error("Invalid verifier arguments.");
}

const syntheticKeys = Array.from({ length: 10 }, (_, index) => (
  `sk-${seed.toString(16).padStart(2, "0")}${"a".repeat(54)}${(index + 1).toString(16).padStart(8, "0")}`
));
const syntheticClipboard = syntheticKeys.join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function runAdb(args, maxBuffer = 64 * 1024 * 1024, timeoutMs = 60000) {
  return execFileSync(adbPath, ["-s", deviceSerial, ...args], {
    encoding: null,
    maxBuffer,
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function resetGfxInfo() {
  runAdb(["shell", "dumpsys", "gfxinfo", androidPackage, "reset"]);
}

function captureGfxInfo() {
  const raw = runAdb(["shell", "dumpsys", "gfxinfo", androidPackage]).toString("utf8");
  const totalFramesMatch = raw.match(/^\s*Total frames rendered:\s*(\d+)/im);
  const histogramMatch = raw.match(/(?:^|\r?\n)HISTOGRAM:\s*([\s\S]*?)(?=\r?\nGPU HISTOGRAM:|$)/);
  if (!totalFramesMatch || !histogramMatch) {
    throw new Error("Android gfxinfo did not expose a render histogram for the virtual grid gate.");
  }
  const frozenBuckets = [...histogramMatch[1].matchAll(/(\d+)ms=(\d+)/g)]
    .map((match) => ({ milliseconds: Number(match[1]), frames: Number(match[2]) }))
    .filter((bucket) => bucket.milliseconds >= 700 && bucket.frames > 0);
  return {
    totalFrames: Number(totalFramesMatch[1]),
    frozenFrames: frozenBuckets.reduce((total, bucket) => total + bucket.frames, 0),
    frozenBuckets,
  };
}

function readRunAsFile(relativePath) {
  try {
    runAdb(["shell", "run-as", androidPackage, "ls", relativePath]);
  } catch {
    return null;
  }
  return runAdb(["exec-out", "run-as", androidPackage, "cat", relativePath]);
}

function summarizeRegistry(raw) {
  if (!raw) return { exists: false, sha256: null, bytes: 0, groups: 0, tasks: 0, pending: 0 };
  const registry = JSON.parse(raw.toString("utf8"));
  const groups = Array.isArray(registry.groups) ? registry.groups : [];
  const slots = groups.flatMap((group) => (Array.isArray(group.slots) ? group.slots : []));
  return {
    exists: true,
    sha256: sha256(raw),
    bytes: raw.length,
    groups: groups.length,
    tasks: slots.length,
    pending: slots.filter((slot) => slot && (slot.status === "queued" || slot.status === "running")).length,
  };
}

function summarizeAudit(raw) {
  if (!raw) return { exists: false, sha256: null, bytes: 0, events: 0, upstreamSubmitAttempts: 0 };
  const events = raw.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  return {
    exists: true,
    sha256: sha256(raw),
    bytes: raw.length,
    events: events.length,
    upstreamSubmitAttempts: events.filter((event) => event && event.type === "upstream_submit_attempt").length,
  };
}

function summarizeOpaqueFile(raw) {
  return raw
    ? { exists: true, sha256: sha256(raw), bytes: raw.length }
    : { exists: false, sha256: null, bytes: 0 };
}

function captureNativeSnapshot() {
  runAdb(["shell", "run-as", androidPackage, "pwd"]);
  return {
    registry: summarizeRegistry(readRunAsFile("files/jobs/android-jobs.v1.json")),
    audit: summarizeAudit(readRunAsFile("files/jobs/android-job-audit.v1.jsonl")),
    encryptedCredentials: summarizeOpaqueFile(
      readRunAsFile("shared_prefs/image_studio_secure_credentials.xml"),
    ),
  };
}

function installedPackageIdentity(packageName) {
  const packagePathOutput = runAdb(["shell", "pm", "path", packageName]).toString("utf8").trim();
  const packagePathLine = packagePathOutput.split(/\r?\n/).find((line) => line.startsWith("package:"));
  const packagePath = packagePathLine ? packagePathLine.slice(8) : "";
  if (!packagePath) throw new Error("Installed Android APK path was not found.");
  const apkBytes = runAdb(["exec-out", "cat", packagePath]);
  return { sha256: sha256(apkBytes), bytes: apkBytes.length };
}

function resolveLauncherComponent(packageName) {
  const output = runAdb([
    "shell",
    "cmd",
    "package",
    "resolve-activity",
    "--brief",
    "-c",
    "android.intent.category.LAUNCHER",
    packageName,
  ]).toString("utf8");
  const component = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.includes("/"));
  if (!component) throw new Error(`Launcher component was not found for ${packageName}.`);
  return component;
}

function startLauncher(packageName, additionalArgs = [], waitForLaunch = true) {
  runAdb([
    "shell",
    "am",
    "start",
    ...(waitForLaunch ? ["-W"] : []),
    "-n",
    resolveLauncherComponent(packageName),
    ...additionalArgs,
  ], 64 * 1024 * 1024, waitForLaunch ? 30000 : 10000);
}

function prepareNotificationPermissionForVerification() {
  if (apiLevel < 33) {
    return { required: false, beforeGranted: true, changed: false, granted: true };
  }
  const permission = "android.permission.POST_NOTIFICATIONS";
  const readGranted = () => /android\.permission\.POST_NOTIFICATIONS:\s+granted=true/.test(
    runAdb(["shell", "dumpsys", "package", androidPackage]).toString("utf8"),
  );
  const beforeGranted = readGranted();
  if (!beforeGranted) runAdb(["shell", "pm", "grant", androidPackage, permission]);
  const granted = readGranted();
  if (!granted) {
    throw new Error("Android notification permission could not be prepared for UI verification.");
  }
  return { required: true, beforeGranted, changed: !beforeGranted, granted };
}

function findFocusedPackageLine(raw, primaryPattern, fallbackPattern, packageName) {
  const lines = raw.split(/\r?\n/);
  const primaryLines = lines.filter((line) => primaryPattern.test(line));
  const candidates = primaryLines.length > 0
    ? primaryLines
    : lines.filter((line) => fallbackPattern.test(line));
  return candidates.find((line) => line.includes(`${packageName}/`)) || "";
}

function waitForProductForeground(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastResumedLine = "";
  let lastFocusedLine = "";
  do {
    const activityDump = runAdb(["shell", "dumpsys", "activity", "activities"]).toString("utf8");
    const windowDump = runAdb(["shell", "dumpsys", "window"]).toString("utf8");
    lastResumedLine = findFocusedPackageLine(
      activityDump,
      /topResumedActivity/,
      /(?:mResumedActivity|ResumedActivity)/,
      androidPackage,
    );
    lastFocusedLine = findFocusedPackageLine(
      windowDump,
      /mCurrentFocus/,
      /mFocusedApp/,
      androidPackage,
    );
    if (lastResumedLine && lastFocusedLine) {
      return {
        package: androidPackage,
        resumed: true,
        focused: true,
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  } while (Date.now() < deadline);
  throw new Error(
    "Android product Activity did not become resumed and focused before clipboard verification.",
  );
}

function seedSyntheticClipboard() {
  const helperDump = runAdb(["shell", "dumpsys", "package", clipboardHelperPackage]).toString("utf8");
  if (!helperDump.includes(`Package [${clipboardHelperPackage}]`) || helperDump.includes("android.permission.INTERNET")) {
    throw new Error("Clipboard helper is missing or requests network access.");
  }
  const helperIdentity = installedPackageIdentity(clipboardHelperPackage);
  if (helperIdentity.sha256 !== clipboardHelperApkSha256) {
    throw new Error("Clipboard helper APK does not match the reviewed no-network helper.");
  }
  startLauncher(clipboardHelperPackage, ["--ei", "seed", String(seed)], apiLevel > 28);
  return helperIdentity;
}

function clearSyntheticClipboard() {
  startLauncher(clipboardHelperPackage, ["--ez", "clear", "true"], apiLevel > 28);
  startLauncher(androidPackage, [], apiLevel > 28);
  waitForProductForeground();
}

function assertDeviceBinding() {
  const actualApiLevel = Number(runAdb(["shell", "getprop", "ro.build.version.sdk"]).toString("utf8").trim());
  if (actualApiLevel !== apiLevel) throw new Error("Connected emulator API level does not match verifier arguments.");
  const appPid = runAdb(["shell", "pidof", androidPackage]).toString("utf8").trim();
  if (!/^\d+$/.test(appPid)) throw new Error("Android application process is not running.");
  const forwardEntries = runAdb(["forward", "--list"]).toString("utf8").split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 3);
  const expectedLocal = `tcp:${cdpPort}`;
  const expectedRemote = `localabstract:webview_devtools_remote_${appPid}`;
  const bound = forwardEntries.some((parts) => (
    parts[0] === deviceSerial && parts[1] === expectedLocal && parts[2] === expectedRemote
  ));
  if (!bound) throw new Error("CDP port is not bound to the declared emulator and application PID.");
  return { apiLevel: actualApiLevel, appPid, cdpForward: `${expectedLocal} -> ${expectedRemote}` };
}

class CDPClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId;
    this.nextId += 1;
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
      throw new Error((exception && exception.description) || response.exceptionDetails.text);
    }
    return response.result ? response.result.value : undefined;
  }

  async screenshot(fileName) {
    const png = runAdb(["exec-out", "screencap", "-p"], 32 * 1024 * 1024, 30000);
    await fs.writeFile(path.join(outputDirectory, fileName), png);
  }

  close() {
    this.socket.close();
  }
}

async function connect() {
  const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
  const page = pages.find((entry) => (
    entry.type === "page"
    && entry.webSocketDebuggerUrl
    && /^https:\/\/appassets\.androidplatform\.net\/assets\/index\.html\?/.test(entry.url || "")
    && /(?:^|[?&])target=android(?:&|$)/.test(entry.url || "")
  ));
  if (!page) throw new Error("Android WebView CDP page was not found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timed out.")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error || new Error("CDP connection failed."));
    }, { once: true });
  });
  return { client: new CDPClient(socket), page };
}

function asyncExpression(body) {
  const expression = `(async () => { ${body} })()`;
  // Compile without executing so verifier-owned syntax fails before touching the WebView.
  Function(`return ${expression};`);
  return expression;
}

function clipboardSummaryExpression() {
  return asyncExpression(`
    const readClipboard = () => new Promise((resolve, reject) => {
      const bridge = window.AndroidImageStudio;
      if (!bridge || typeof bridge.invoke !== "function") {
        reject(new Error("Android clipboard bridge is unavailable."));
        return;
      }
      const requestId = "bulk-verifier-clipboard-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      const previousResolve = window.__imageStudioNativeResolve;
      const previousReject = window.__imageStudioNativeReject;
      const restore = () => {
        window.__imageStudioNativeResolve = previousResolve;
        window.__imageStudioNativeReject = previousReject;
      };
      window.__imageStudioNativeResolve = (id, payload) => {
        if (id === requestId) {
          restore();
          resolve(String(payload === undefined || payload === null ? "" : payload));
          return;
        }
        if (typeof previousResolve === "function") previousResolve(id, payload);
      };
      window.__imageStudioNativeReject = (id, message) => {
        if (id === requestId) {
          restore();
          reject(new Error(String(message)));
          return;
        }
        if (typeof previousReject === "function") previousReject(id, message);
      };
      bridge.invoke(requestId, "ReadClipboardText", "[]");
    });
    const raw = await readClipboard();
    const bytes = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return {
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase(),
      length: raw.length,
      lineCount: raw ? raw.split(/\\r?\\n/).length : 0,
    };
  `);
}

function quickSettingsSnapshotExpression() {
  return `(() => {
    const suffix = ".androidQuickSettingsCollapsed.v1";
    const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
    const controls = document.querySelector("#android-header-quick-settings");
    const root = document.documentElement;
    const header = document.querySelector(".android-app-header");
    return {
      ready: document.readyState === "complete" && Boolean(toggle),
      title: toggle ? toggle.getAttribute("title") || "" : "",
      ariaLabel: toggle ? toggle.getAttribute("aria-label") || "" : "",
      ariaExpanded: toggle ? toggle.getAttribute("aria-expanded") || "" : "",
      ariaControls: toggle ? toggle.getAttribute("aria-controls") || "" : "",
      controlsMounted: Boolean(controls),
      rootState: root.dataset.androidQuickSettings || "",
      headerHeight: header ? header.getBoundingClientRect().height : 0,
      preferenceEntries: Object.keys(localStorage)
        .filter((key) => key.endsWith(suffix))
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    };
  })()`;
}

function quickSettingsBusinessSnapshotExpression() {
  return asyncExpression(`
    const deadline = performance.now() + 8000;
    while (!(window.__imageStudioDebug && window.__imageStudioDebug.getState) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const state = window.__imageStudioDebug && window.__imageStudioDebug.getState
      ? window.__imageStudioDebug.getState()
      : null;
    if (!state) throw new Error("Android debug store is unavailable for quick-settings audit.");
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const profiles = (Array.isArray(state.profiles) ? state.profiles : []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      apiMode: profile.apiMode,
      requestPolicy: profile.requestPolicy,
      baseURL: profile.baseURL,
      textModelID: profile.textModelID,
      imageModelID: profile.imageModelID,
      concurrencyLimit: profile.concurrencyLimit,
      continuousPoolEnabled: profile.continuousPoolEnabled === true,
      fhlImagesPoolSlot: Number.isInteger(profile.fhlImagesPoolSlot) ? profile.fhlImagesPoolSlot : null,
      fhlImagesPoolKeyHint: profile.fhlImagesPoolKeyHint === undefined ? null : profile.fhlImagesPoolKeyHint,
      imagesNewAPICompat: profile.imagesNewAPICompat === true,
      createdAt: profile.createdAt,
      lastUsedAt: profile.lastUsedAt === undefined ? null : profile.lastUsedAt,
    }));
    const history = (Array.isArray(state.history) ? state.history : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    const batchResults = (Array.isArray(state.batchResults) ? state.batchResults : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      batchIndex: item.batchIndex,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    const jobGroups = Object.keys(state.jobGroupsByWorkspace || {}).sort().map((workspaceId) => ({
      workspaceId,
      groups: (Array.isArray(state.jobGroupsByWorkspace[workspaceId])
        ? state.jobGroupsByWorkspace[workspaceId]
        : []).map((group) => ({
          id: group.id,
          status: group.status,
          submissionId: group.clientSubmissionId,
          apiMode: group.apiMode,
          apiProfileId: group.apiProfileId,
          fhlImagesPoolSlot: group.fhlImagesPoolSlot,
          slots: (Array.isArray(group.slots) ? group.slots : []).map((slot) => ({
            id: slot.id,
            status: slot.status,
            submissionId: slot.clientSubmissionId,
            apiMode: slot.apiMode,
            apiProfileId: slot.apiProfileId,
            fhlImagesPoolSlot: slot.fhlImagesPoolSlot,
          })),
        })),
    }));
    const cursorEntries = Object.keys(localStorage)
      .filter((key) => key.endsWith("gptcodex.androidFHLImagesPoolCursor.v1"))
      .sort()
      .map((key) => [key, localStorage.getItem(key)]);
    return {
      fingerprint: await digest({
        activeProfileId: state.activeProfileId,
        fhlTransportMode: state.fhlTransportMode,
        profiles,
        history,
        batchResults,
        jobGroups,
        cursorEntries,
      }),
      profileCount: profiles.length,
      historyCount: history.length,
      batchResultCount: batchResults.length,
      jobGroupCount: jobGroups.reduce((total, workspace) => total + workspace.groups.length, 0),
      cursorEntryCount: cursorEntries.length,
    };
  `);
}

async function waitForQuickSettings(client, expectedExpanded, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const snapshot = await client.evaluate(quickSettingsSnapshotExpression(), 3000);
      const expanded = snapshot && snapshot.ariaExpanded === "true";
      if (
        snapshot
        && snapshot.ready
        && expanded === expectedExpanded
        && snapshot.rootState === (expectedExpanded ? "expanded" : "collapsed")
        && snapshot.controlsMounted === expectedExpanded
      ) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const suffix = lastError && lastError.message ? ` ${lastError.message}` : "";
  throw new Error(`Timed out waiting for Android quick settings state.${suffix}`);
}

async function reloadWebViewAndWait(client, expectedExpanded) {
  await client.call("Page.enable", {}, 10000);
  await client.call("Page.reload", { ignoreCache: true }, 15000);
  return waitForQuickSettings(client, expectedExpanded, 30000);
}

function assertQuickSettingsSnapshot(snapshot, expectedExpanded) {
  const expectedLabel = expectedExpanded ? "折叠快速设置" : "展开快速设置";
  if (
    !snapshot
    || snapshot.title !== expectedLabel
    || snapshot.ariaLabel !== expectedLabel
    || snapshot.ariaExpanded !== (expectedExpanded ? "true" : "false")
    || snapshot.ariaControls !== "android-header-quick-settings"
    || snapshot.controlsMounted !== expectedExpanded
    || snapshot.rootState !== (expectedExpanded ? "expanded" : "collapsed")
    || !(snapshot.headerHeight > 0)
  ) {
    throw new Error(`Android quick settings accessibility or mount state is invalid for ${expectedLabel}.`);
  }
}

async function waitForQuickSettingsBusiness(client, expectedFingerprint, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await client.evaluate(quickSettingsBusinessSnapshotExpression(), 5000);
      if (latest && latest.fingerprint === expectedFingerprint) return latest;
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const actual = latest && latest.fingerprint ? latest.fingerprint : "unavailable";
  throw new Error(`Android business state did not recover after quick-settings reload: ${actual}.`);
}

async function waitForQuickSettingsReady(client, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const snapshot = await client.evaluate(quickSettingsSnapshotExpression(), 3000);
      if (snapshot && snapshot.ready) return snapshot;
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Android quick settings toggle.");
}

async function setQuickSettingsExpanded(client, expectedExpanded) {
  const current = await waitForQuickSettingsReady(client);
  if ((current.ariaExpanded === "true") !== expectedExpanded) {
    await client.evaluate(`(() => {
      const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
      if (!toggle) throw new Error("Android quick settings toggle is unavailable.");
      toggle.click();
      return true;
    })()`);
  }
  return waitForQuickSettings(client, expectedExpanded);
}

function quickPreferenceEntriesMatch(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function writeQuickSettingsPreferenceEntries(client, entries) {
  await client.evaluate(`(() => {
    const suffix = ".androidQuickSettingsCollapsed.v1";
    for (const key of Object.keys(localStorage).filter((item) => item.endsWith(suffix))) {
      localStorage.removeItem(key);
    }
    for (const entry of ${JSON.stringify(entries)}) localStorage.setItem(entry[0], entry[1]);
    return true;
  })()`);
}

async function restoreQuickSettings(client, entries, expectedExpanded) {
  if (!client || !entries) return null;
  await writeQuickSettingsPreferenceEntries(client, entries);
  const snapshot = await reloadWebViewAndWait(client, expectedExpanded);
  assertQuickSettingsSnapshot(snapshot, expectedExpanded);
  if (!quickPreferenceEntriesMatch(snapshot.preferenceEntries, entries)) {
    throw new Error("Android quick settings preference was not restored exactly.");
  }
  return snapshot;
}

async function installGridAuditHooks(client) {
  return client.evaluate(`(() => {
    const state = window.__imageStudioDebug && window.__imageStudioDebug.getState
      ? window.__imageStudioDebug.getState()
      : null;
    if (!state) throw new Error("Android debug store is unavailable while installing grid audit hooks.");
    window.__androidBulkGridVerifierOriginal = {
      batchResults: Array.isArray(state.batchResults) ? state.batchResults : [],
      resultGridOpen: Boolean(state.resultGridOpen),
    };
    window.__androidBulkGridVerifierCounters = {
      creates: 0,
      revokes: 0,
      createdURLs: new Set(),
      outstanding: new Set(),
      duplicateTrackedRevokes: 0,
      externalRevokes: 0,
    };
    window.__androidBulkGridVerifierOriginalCreate = URL.createObjectURL.bind(URL);
    window.__androidBulkGridVerifierOriginalRevoke = URL.revokeObjectURL.bind(URL);
    window.__androidBulkGridVerifierGenerationClicks = 0;
    window.__androidBulkGridVerifierClickListener = (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) return;
      if (target.matches(
        ".android-phone-sticky-cta > button.liquid-primary-button, "
        + ".android-pad-side-cta button.liquid-primary-button, "
        + ".android-pad-cta button.liquid-primary-button"
      )) window.__androidBulkGridVerifierGenerationClicks += 1;
    };
    document.addEventListener("click", window.__androidBulkGridVerifierClickListener, true);
    URL.createObjectURL = (...args) => {
      window.__androidBulkGridVerifierCounters.creates += 1;
      const url = window.__androidBulkGridVerifierOriginalCreate(...args);
      window.__androidBulkGridVerifierCounters.createdURLs.add(url);
      window.__androidBulkGridVerifierCounters.outstanding.add(url);
      return url;
    };
    URL.revokeObjectURL = (...args) => {
      window.__androidBulkGridVerifierCounters.revokes += 1;
      const url = args[0];
      if (window.__androidBulkGridVerifierCounters.createdURLs.has(url)) {
        if (!window.__androidBulkGridVerifierCounters.outstanding.delete(url)) {
          window.__androidBulkGridVerifierCounters.duplicateTrackedRevokes += 1;
        }
      } else {
        window.__androidBulkGridVerifierCounters.externalRevokes += 1;
      }
      return window.__androidBulkGridVerifierOriginalRevoke(...args);
    };
    return true;
  })()`);
}

await fs.mkdir(outputDirectory, { recursive: true });
const verifierSource = await fs.readFile(new URL(import.meta.url), "utf8");
const verifierScriptSha256 = sha256(Buffer.from(verifierSource.replace(/\r\n/g, "\n"), "utf8"));
const committedVerifierSource = execFileSync(
  "git",
  ["show", `${verifierGitCommit}:scripts/verify-android-bulk-ui-and-grid.mjs`],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
);
const committedVerifierScriptSha256 = sha256(
  Buffer.from(committedVerifierSource.replace(/\r\n/g, "\n"), "utf8"),
);
if (verifierScriptSha256 !== committedVerifierScriptSha256) {
  throw new Error("Verifier source does not match the declared verifier commit.");
}
const deviceBinding = assertDeviceBinding();
const installedApk = installedPackageIdentity(androidPackage);
if (installedApk.sha256 !== apkSha256) {
  throw new Error("Installed Android APK hash does not match the frozen candidate.");
}
const nativeBefore = captureNativeSnapshot();
if (nativeBefore.registry.pending !== 0) {
  throw new Error("Android UI verifier requires zero queued or running native tasks.");
}
const startedAt = new Date().toISOString();
let clipboardSeeded = false;
let clipboardHelperIdentity = null;
const devicePreparation = {
  notificationPermission: null,
  productForeground: null,
};
let client = null;
let page = null;
try {
  devicePreparation.notificationPermission = prepareNotificationPermissionForVerification();
  clipboardHelperIdentity = seedSyntheticClipboard();
  clipboardSeeded = true;
  startLauncher(androidPackage, [], apiLevel > 28);
  devicePreparation.productForeground = waitForProductForeground();
  assertDeviceBinding();
  ({ client, page } = await connect());
} catch (preflightError) {
  let clipboardCleared = !clipboardSeeded;
  if (clipboardSeeded) {
    try {
      clearSyntheticClipboard();
      clipboardCleared = true;
    } catch { }
  }
  const preflightReport = {
    schemaVersion: 3,
    status: "failed",
    startedAt,
    finishedAt: new Date().toISOString(),
    deviceLabel,
    apiLevel,
    deviceSerial,
    productGitCommit: gitCommit,
    verifierGitCommit,
    verifierScriptSha256,
    apkSha256,
    installedApk,
    deviceBinding,
    devicePreparation,
    clipboard: {
      helperPackage: clipboardHelperPackage,
      helperApk: clipboardHelperIdentity,
      seeded: clipboardSeeded,
      cleared: clipboardCleared,
    },
    nativeState: { before: nativeBefore, after: null },
    failure: String(preflightError && preflightError.message !== undefined ? preflightError.message : preflightError),
  };
  try {
    preflightReport.nativeState.after = captureNativeSnapshot();
  } catch { }
  const preflightReportBytes = Buffer.from(`${JSON.stringify(preflightReport, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDirectory, "ui-grid-report.json"), preflightReportBytes);
  await fs.writeFile(
    path.join(outputDirectory, "artifact-manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      productGitCommit: gitCommit,
      verifierGitCommit,
      verifierScriptSha256,
      apkSha256,
      deviceSerial,
      artifacts: [{
        file: "ui-grid-report.json",
        bytes: preflightReportBytes.length,
        sha256: sha256(preflightReportBytes),
      }],
    }, null, 2)}\n`,
    "utf8",
  );
  throw preflightError;
}
const report = {
  schemaVersion: 3,
  status: "running",
  startedAt,
  finishedAt: null,
  deviceLabel,
  apiLevel,
  deviceSerial,
  productGitCommit: gitCommit,
  verifierGitCommit,
  verifierScriptSha256,
  apkSha256,
  installedApk,
  apkServiceIdentity: null,
  deviceBinding,
  devicePreparation,
  gfxScrollGate: {
    enabled: gfxScrollGateEnabled,
    thresholdMs: 700,
  },
  syntheticInputSha256: sha256(Buffer.from(syntheticClipboard, "utf8")),
  clipboard: {
    helperPackage: clipboardHelperPackage,
    helperApk: clipboardHelperIdentity,
    expectedSha256: sha256(Buffer.from(syntheticClipboard, "utf8")),
    observedSha256: null,
    observedLength: 0,
    seeded: true,
    cleared: false,
  },
  page: { title: page.title, url: page.url },
  paidWork: null,
  nativeState: { before: nativeBefore, beforeClipboardClear: null, after: null },
  quickSettings: null,
  bulkDialog: null,
  virtualGrid: [],
  cleanup: null,
  failure: "",
};

let baseline = null;
let originalQuickSettingsPreferenceEntries = null;
let originalQuickSettingsExpanded = true;
let quickSettingsRestored = false;
try {
  const apkServiceIdentity = await client.evaluate(asyncExpression(`
    const directScriptURLs = [...document.scripts].map((script) => script.src).filter((url) => url);
    const loadedScriptURLs = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\\.js(?:[?#]|$)/.test(url));
    const scriptURLs = [...new Set([...directScriptURLs, ...loadedScriptURLs])];
    let identity = "";
    for (const scriptURL of scriptURLs) {
      const source = await (await fetch(scriptURL, { cache: "no-store" })).text();
      const match = source.match(/IMAGE_STUDIO_SERVICE_INSTANCE_ID:["']([^"']+)["']/);
      if (match) {
        identity = match[1];
        break;
      }
    }
    return identity;
  `), 15000);
  const expectedServicePrefix = `android-V2.0.3-${gitCommit}-`;
  if (!apkServiceIdentity || !apkServiceIdentity.startsWith(expectedServicePrefix)) {
    throw new Error("Installed APK service identity does not match the declared product commit.");
  }
  report.apkServiceIdentity = apkServiceIdentity;
  const seededClipboard = await client.evaluate(clipboardSummaryExpression(), 15000);
  report.clipboard.observedSha256 = seededClipboard.sha256;
  report.clipboard.observedLength = seededClipboard.length;
  report.clipboard.observedLineCount = seededClipboard.lineCount;
  if (
    seededClipboard.sha256 !== report.clipboard.expectedSha256
    || seededClipboard.length !== syntheticClipboard.length
    || seededClipboard.lineCount !== syntheticKeys.length
  ) {
    throw new Error("System clipboard does not match this verifier's synthetic input.");
  }
  baseline = await client.evaluate(asyncExpression(`
    const deadline = performance.now() + 8000;
    while (!(window.__imageStudioDebug && window.__imageStudioDebug.getState) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const state = window.__imageStudioDebug && window.__imageStudioDebug.getState
      ? window.__imageStudioDebug.getState()
      : null;
    if (!state) throw new Error("Android debug store is unavailable.");
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const profileStructure = (Array.isArray(state.profiles) ? state.profiles : []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      apiMode: profile.apiMode,
      requestPolicy: profile.requestPolicy,
      baseURL: profile.baseURL,
      textModelID: profile.textModelID,
      imageModelID: profile.imageModelID,
      concurrencyLimit: profile.concurrencyLimit,
      continuousPoolEnabled: profile.continuousPoolEnabled === true,
      fhlImagesPoolSlot: Number.isInteger(profile.fhlImagesPoolSlot) ? profile.fhlImagesPoolSlot : null,
      fhlImagesPoolKeyHint: profile.fhlImagesPoolKeyHint === undefined ? null : profile.fhlImagesPoolKeyHint,
      imagesNewAPICompat: profile.imagesNewAPICompat === true,
      createdAt: profile.createdAt,
      lastUsedAt: profile.lastUsedAt === undefined ? null : profile.lastUsedAt,
    }));
    const cursorEntries = Object.keys(localStorage)
      .filter((key) => key.endsWith("gptcodex.androidFHLImagesPoolCursor.v1"))
      .sort()
      .map((key) => [key, localStorage.getItem(key)]);
    const localStorageEntries = Object.keys(localStorage).sort().map((key) => {
      const value = localStorage.getItem(key);
      if (!key.endsWith("gptcodex.workspaceSession.v1") || !value) return [key, value];
      try {
        const parsed = JSON.parse(value);
        parsed.updatedAt = 0;
        return [key, JSON.stringify(parsed)];
      } catch {
        return [key, value];
      }
    });
    const historyStructure = (Array.isArray(state.history) ? state.history : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    const batchResultStructure = (Array.isArray(state.batchResults) ? state.batchResults : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      batchIndex: item.batchIndex,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    return {
      profileCount: Array.isArray(state.profiles) ? state.profiles.length : -1,
      profileFingerprint: await digest({ activeProfileId: state.activeProfileId, profiles: profileStructure }),
      cursorFingerprint: await digest(cursorEntries),
      cursorEntryCount: cursorEntries.length,
      localStorageFingerprint: await digest(localStorageEntries),
      historyCount: Array.isArray(state.history) ? state.history.length : -1,
      historyFingerprint: await digest(historyStructure),
      androidView: document.querySelector(".studio")
        ? document.querySelector(".studio").getAttribute("data-android-view")
        : "",
      pendingDrafts: document.querySelectorAll(".android-fhl-slot-status.pending").length,
      batchResults: Array.isArray(state.batchResults) ? state.batchResults.length : -1,
      batchResultFingerprint: await digest(batchResultStructure),
      resultGridOpen: Boolean(state.resultGridOpen),
    };
  `), 15000);
  if (baseline.resultGridOpen || baseline.pendingDrafts !== 0) {
    throw new Error("Android UI verifier requires a closed, draft-free result-grid baseline.");
  }

  const quickBeforeNative = captureNativeSnapshot();
  const initialQuickSettings = await waitForQuickSettingsReady(client);
  assertQuickSettingsSnapshot(initialQuickSettings, initialQuickSettings.ariaExpanded === "true");
  originalQuickSettingsPreferenceEntries = initialQuickSettings.preferenceEntries;
  originalQuickSettingsExpanded = initialQuickSettings.ariaExpanded === "true";
  const quickBusinessBefore = await client.evaluate(quickSettingsBusinessSnapshotExpression(), 15000);
  const expandedBefore = await setQuickSettingsExpanded(client, true);
  assertQuickSettingsSnapshot(expandedBefore, true);
  const collapsed = await setQuickSettingsExpanded(client, false);
  assertQuickSettingsSnapshot(collapsed, false);
  const expandedPreferenceMap = new Map(expandedBefore.preferenceEntries);
  const preferenceCandidates = collapsed.preferenceEntries.filter((entry) => (
    entry[1] === "1" && expandedPreferenceMap.get(entry[0]) !== "1"
  ));
  const preferenceKey = preferenceCandidates.length === 1 ? preferenceCandidates[0][0] : "";
  if (!preferenceKey) {
    throw new Error("Android quick settings did not write one strict namespaced preference.");
  }
  const collapsedReloaded = await reloadWebViewAndWait(client, false);
  assertQuickSettingsSnapshot(collapsedReloaded, false);
  const expandedAfterToggle = await setQuickSettingsExpanded(client, true);
  assertQuickSettingsSnapshot(expandedAfterToggle, true);
  const expandedReloaded = await reloadWebViewAndWait(client, true);
  assertQuickSettingsSnapshot(expandedReloaded, true);
  await writeQuickSettingsPreferenceEntries(client, []);
  const missingRestored = await reloadWebViewAndWait(client, true);
  assertQuickSettingsSnapshot(missingRestored, true);
  await writeQuickSettingsPreferenceEntries(client, [[preferenceKey, "corrupt"]]);
  const corruptRestored = await reloadWebViewAndWait(client, true);
  assertQuickSettingsSnapshot(corruptRestored, true);
  await writeQuickSettingsPreferenceEntries(client, [[preferenceKey, "1"]]);
  const strictRestored = await reloadWebViewAndWait(client, false);
  assertQuickSettingsSnapshot(strictRestored, false);
  await writeQuickSettingsPreferenceEntries(client, originalQuickSettingsPreferenceEntries);
  await setQuickSettingsExpanded(client, true);
  await writeQuickSettingsPreferenceEntries(client, originalQuickSettingsPreferenceEntries);
  const expandedForBulk = await waitForQuickSettings(client, true);
  assertQuickSettingsSnapshot(expandedForBulk, true);
  const quickBusinessAfter = await waitForQuickSettingsBusiness(client, quickBusinessBefore.fingerprint, 30000);
  const quickAfterNative = captureNativeSnapshot();
  const quickPaidWork = {
    groups: quickAfterNative.registry.groups - quickBeforeNative.registry.groups,
    tasks: quickAfterNative.registry.tasks - quickBeforeNative.registry.tasks,
    upstreamPosts: quickAfterNative.audit.upstreamSubmitAttempts - quickBeforeNative.audit.upstreamSubmitAttempts,
  };
  report.quickSettings = {
    initial: initialQuickSettings,
    expandedBefore,
    collapsed,
    collapsedReloaded,
    expandedAfterToggle,
    expandedReloaded,
    missingRestored,
    corruptRestored,
    strictRestored,
    expandedForBulk,
    businessBefore: quickBusinessBefore,
    businessAfter: quickBusinessAfter,
    paidWork: quickPaidWork,
  };
  if (
    expandedBefore.title !== "折叠快速设置"
    || expandedBefore.ariaLabel !== "折叠快速设置"
    || expandedBefore.ariaControls !== "android-header-quick-settings"
    || collapsed.title !== "展开快速设置"
    || collapsed.ariaLabel !== "展开快速设置"
    || collapsed.ariaExpanded !== "false"
    || collapsed.controlsMounted
    || collapsed.rootState !== "collapsed"
    || !quickPreferenceEntriesMatch(collapsedReloaded.preferenceEntries, collapsed.preferenceEntries)
    || expandedAfterToggle.title !== "折叠快速设置"
    || expandedAfterToggle.ariaExpanded !== "true"
    || !expandedAfterToggle.controlsMounted
    || expandedAfterToggle.rootState !== "expanded"
    || !quickPreferenceEntriesMatch(expandedReloaded.preferenceEntries, expandedAfterToggle.preferenceEntries)
    || missingRestored.ariaExpanded !== "true"
    || !missingRestored.controlsMounted
    || missingRestored.preferenceEntries.length !== 0
    || corruptRestored.ariaExpanded !== "true"
    || !corruptRestored.controlsMounted
    || !quickPreferenceEntriesMatch(corruptRestored.preferenceEntries, [[preferenceKey, "corrupt"]])
    || strictRestored.ariaExpanded !== "false"
    || strictRestored.controlsMounted
    || !quickPreferenceEntriesMatch(strictRestored.preferenceEntries, [[preferenceKey, "1"]])
    || !quickPreferenceEntriesMatch(expandedForBulk.preferenceEntries, originalQuickSettingsPreferenceEntries)
    || quickBusinessAfter.fingerprint !== quickBusinessBefore.fingerprint
    || quickPaidWork.groups !== 0
    || quickPaidWork.tasks !== 0
    || quickPaidWork.upstreamPosts !== 0
    || quickAfterNative.registry.sha256 !== quickBeforeNative.registry.sha256
    || quickAfterNative.audit.sha256 !== quickBeforeNative.audit.sha256
    || quickAfterNative.encryptedCredentials.sha256 !== quickBeforeNative.encryptedCredentials.sha256
  ) {
    throw new Error("Android quick settings collapse, restore, or zero-paid-work invariant failed.");
  }

  await installGridAuditHooks(client);

  const bulkResult = await client.evaluate(asyncExpression(`
    const waitFor = async (predicate, label, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for " + label);
    };
    const visible = (element) => Boolean(element && element.offsetParent);
    const click = (element, label) => {
      if (!visible(element)) throw new Error(label + " is not visible.");
      element.click();
    };
    const tokenValues = ${JSON.stringify(syntheticKeys)};
    const rawClipboard = ${JSON.stringify(syntheticClipboard)};
    const auditSurface = (root) => {
      const attributeValues = [...root.querySelectorAll("*")].flatMap((element) => (
        [...element.attributes].map((attribute) => attribute.value)
      ));
      const controlValues = [...root.querySelectorAll("input, textarea")].map((element) => element.value);
      const surface = [root.innerText, root.textContent, root.outerHTML, ...attributeValues, ...controlValues].join("\\n");
      return {
        fullKeyLeakCount: tokenValues.filter((key) => surface.includes(key)).length,
        tailLeakCount: tokenValues.filter((key) => surface.includes(key.slice(-8))).length,
      };
    };
    const staleBulkClose = document.querySelector(".android-fhl-bulk-dialog-card .app-modal-header button");
    if (staleBulkClose) staleBulkClose.click();
    const staleUpstreamClose = document.querySelector(".android-upstream-modal-card .android-upstream-modal-header button");
    if (staleUpstreamClose) staleUpstreamClose.click();
    const openConfig = await waitFor(
      () => document.querySelector('[data-audit-id="open-upstream-config"]'),
      "upstream config button",
    );
    click(openConfig, "upstream config button");
    await waitFor(() => document.querySelector(".android-upstream-modal-card"), "upstream config dialog");
    const poolButton = await waitFor(
      () => [...document.querySelectorAll("button")].find((button) => (
        visible(button) && (button.innerText || "").trim().startsWith("FHL Images 10")
      )),
      "FHL ten-slot button",
    );
    click(poolButton, "FHL ten-slot button");
    const poolRegion = await waitFor(
      () => document.querySelector('[aria-label="FHL API 10槽配置"]'),
      "FHL ten-slot region",
    );
    const pendingBefore = poolRegion.querySelectorAll(".android-fhl-slot-status.pending").length;
    const savedHintLeakBefore = /sk-[^\\s]+/i.test(poolRegion.innerText || "");
    click(poolRegion.querySelector('[data-audit-id="fhl-bulk-config-open"]'), "bulk config button");
    const bulkDialog = await waitFor(
      () => document.querySelector(".android-fhl-bulk-dialog-card"),
      "bulk dialog",
    );
    click(bulkDialog.querySelector('[data-audit-id="fhl-bulk-read-clipboard"]'), "system clipboard button");
    await waitFor(
      () => bulkDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10,
      "ten system clipboard previews",
    );
    const systemReadAudit = auditSurface(bulkDialog);
    const systemRead = {
      previewCount: bulkDialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
      fixedMaskCount: [...bulkDialog.querySelectorAll(".android-fhl-bulk-preview-row")].filter((row) => (
        /FHL\\d+sk-\\*{12}/.test((row.textContent || "").replace(/\\s+/g, ""))
      )).length,
      textareaValueLength: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? bulkDialog.querySelector("#android-fhl-bulk-api-input").value.length
        : -1,
      textareaRows: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? Number(bulkDialog.querySelector("#android-fhl-bulk-api-input").getAttribute("rows") || 0)
        : -1,
      recognizedHint: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? bulkDialog.querySelector("#android-fhl-bulk-api-input").getAttribute("placeholder") || ""
        : "",
      textareaHeight: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? bulkDialog.querySelector("#android-fhl-bulk-api-input").getBoundingClientRect().height
        : -1,
      textareaMinHeight: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? getComputedStyle(bulkDialog.querySelector("#android-fhl-bulk-api-input")).minHeight
        : "",
      textareaResize: bulkDialog.querySelector("#android-fhl-bulk-api-input")
        ? getComputedStyle(bulkDialog.querySelector("#android-fhl-bulk-api-input")).resize
        : "",
      ...systemReadAudit,
    };
    click(bulkDialog.querySelector('[data-audit-id="fhl-bulk-cancel"]'), "bulk cancel button");
    await waitFor(() => !document.querySelector(".android-fhl-bulk-dialog-card"), "bulk dialog close");
    const pendingAfterCancel = poolRegion.querySelectorAll(".android-fhl-slot-status.pending").length;
    click(poolRegion.querySelector('[data-audit-id="fhl-bulk-config-open"]'), "bulk config button");
    const manualDialog = await waitFor(
      () => document.querySelector(".android-fhl-bulk-dialog-card"),
      "bulk dialog reopen",
    );
    const input = manualDialog.querySelector("#android-fhl-bulk-api-input");
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: { getData: () => rawClipboard } });
    input.dispatchEvent(pasteEvent);
    await waitFor(
      () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10,
      "ten manual paste previews",
    );
    const manualValidHint = input.getAttribute("placeholder") || "";

    const emulatorAudit = window.AndroidEmulatorAudit;
    if (!emulatorAudit || typeof emulatorAudit.enabled !== "function" || emulatorAudit.enabled() !== true) {
      throw new Error("Synthetic clipboard failure injection requires an Android emulator audit session.");
    }
    const bridge = window.AndroidImageStudio;
    if (!bridge || typeof bridge.invoke !== "function") {
      throw new Error("Android clipboard bridge is unavailable for failure injection.");
    }
    const originalNativeResolve = window.__imageStudioNativeResolve;
    const originalNativeReject = window.__imageStudioNativeReject;
    if (typeof originalNativeResolve !== "function" || typeof originalNativeReject !== "function") {
      throw new Error("Android clipboard callbacks are unavailable for failure injection.");
    }
    const clipboardMock = { mode: "passthrough", deferred: null };
    window.__imageStudioNativeResolve = (requestId, payload) => {
      if (clipboardMock.mode === "empty") {
        originalNativeResolve(requestId, "");
        return;
      }
      if (clipboardMock.mode === "reject") {
        originalNativeReject(requestId, "synthetic clipboard rejection");
        return;
      }
      if (clipboardMock.mode === "defer") {
        clipboardMock.deferred = { requestId, payload };
        return;
      }
      originalNativeResolve(requestId, payload);
    };
    window.__imageStudioNativeReject = (requestId, message) => {
      if (clipboardMock.mode === "defer") {
        clipboardMock.deferred = { requestId, rejected: true, message };
        return;
      }
      originalNativeReject(requestId, message);
    };
    const readButton = manualDialog.querySelector('[data-audit-id="fhl-bulk-read-clipboard"]');
    const confirmButton = () => manualDialog.querySelector('[data-audit-id="fhl-bulk-confirm"]');
    const inputState = () => ({
      previewCount: manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
      confirmDisabled: Boolean(confirmButton() && confirmButton().disabled),
      textareaValueLength: input.value.length,
      recognizedHintPresent: (input.getAttribute("placeholder") || "").includes("已识别"),
      ...auditSurface(manualDialog),
    });
    let emptyClipboard;
    let rejectedClipboard;
    let staleClipboard;
    try {
      clipboardMock.mode = "empty";
      click(readButton, "synthetic empty clipboard button");
      await waitFor(
        () => (manualDialog.innerText || "").includes("剪贴板里没有文本。"),
        "empty clipboard error",
      );
      emptyClipboard = inputState();

      input.dispatchEvent(pasteEvent);
      await waitFor(
        () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10,
        "valid previews before clipboard rejection",
      );
      clipboardMock.mode = "reject";
      click(readButton, "synthetic rejected clipboard button");
      await waitFor(
        () => (manualDialog.innerText || "").includes("读取剪贴板失败，请重试。"),
        "clipboard rejection error",
      );
      rejectedClipboard = inputState();

      input.dispatchEvent(pasteEvent);
      await waitFor(
        () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10,
        "valid previews before stale clipboard result",
      );
      clipboardMock.mode = "defer";
      click(readButton, "synthetic deferred clipboard button");
      await waitFor(() => Boolean(clipboardMock.deferred), "deferred clipboard request");
      const staleInvalidPasteEvent = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(staleInvalidPasteEvent, "clipboardData", { value: { getData: () => "not-an-api" } });
      input.dispatchEvent(staleInvalidPasteEvent);
      await waitFor(
        () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 0,
        "newer invalid replacement before stale clipboard result",
      );
      const deferred = clipboardMock.deferred;
      clipboardMock.deferred = null;
      clipboardMock.mode = "passthrough";
      if (deferred.rejected) originalNativeReject(deferred.requestId, deferred.message);
      else originalNativeResolve(deferred.requestId, deferred.payload);
      await new Promise((resolve) => setTimeout(resolve, 200));
      staleClipboard = inputState();
    } finally {
      window.__imageStudioNativeResolve = originalNativeResolve;
      window.__imageStudioNativeReject = originalNativeReject;
    }

    const invalidPasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(invalidPasteEvent, "clipboardData", { value: { getData: () => "not-an-api" } });
    input.dispatchEvent(invalidPasteEvent);
    await waitFor(
      () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 0,
      "invalid replacement preview clear",
    );
    const confirmAfterInvalid = manualDialog.querySelector('[data-audit-id="fhl-bulk-confirm"]');
    const invalidReplacement = {
      previewCount: manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
      confirmDisabled: Boolean(confirmAfterInvalid && confirmAfterInvalid.disabled),
      recognizedHintPresent: (input.getAttribute("placeholder") || "").includes("已识别"),
      invalidMessagePresent: (manualDialog.innerText || "").includes("没有识别到有效 API"),
      ...auditSurface(manualDialog),
    };
    const validPasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(validPasteEvent, "clipboardData", { value: { getData: () => rawClipboard } });
    input.dispatchEvent(validPasteEvent);
    await waitFor(
      () => manualDialog.querySelectorAll(".android-fhl-bulk-preview-row").length === 10,
      "ten restored manual paste previews",
    );
    const manualAudit = auditSurface(manualDialog);
    click(manualDialog.querySelector('[data-audit-id="fhl-bulk-confirm"]'), "bulk confirm button");
    await waitFor(
      () => poolRegion.querySelectorAll(".android-fhl-slot-status.pending").length === 10,
      "ten pending drafts",
    );
    const collapsedInputCount = poolRegion.querySelectorAll("[data-fhl-pool-slot]").length;
    click(poolRegion.querySelector(".android-fhl-slot-toggle"), "first slot toggle");
    const firstInput = await waitFor(
      () => poolRegion.querySelector("[data-fhl-pool-slot='1']"),
      "first slot input",
    );
    const stagedAudit = auditSurface(poolRegion);
    const stagedInput = {
      valueLength: firstInput.value.length,
      placeholder: firstInput.getAttribute("placeholder") || "",
      ...stagedAudit,
    };
    const failedChecks = [
      ["system-preview-count", systemRead.previewCount === 10],
      ["system-fixed-mask-count", systemRead.fixedMaskCount === 10],
      ["system-textarea-empty", systemRead.textareaValueLength === 0],
      ["system-textarea-rows", systemRead.textareaRows === 2],
      ["system-recognized-hint", systemRead.recognizedHint === "已识别 10 个 API，需修改请重新粘贴覆盖"],
      ["system-textarea-height", systemRead.textareaHeight >= 63 && systemRead.textareaHeight <= 65],
      ["system-textarea-min-height", systemRead.textareaMinHeight === "64px"],
      ["system-textarea-resize", systemRead.textareaResize === "none"],
      ["system-full-key-private", systemRead.fullKeyLeakCount === 0],
      ["system-tail-private", systemRead.tailLeakCount === 0],
      ["cancel-preserves-drafts", pendingAfterCancel === pendingBefore],
      ["manual-full-key-private", manualAudit.fullKeyLeakCount === 0],
      ["manual-tail-private", manualAudit.tailLeakCount === 0],
      ["manual-recognized-hint", manualValidHint === "已识别 10 个 API，需修改请重新粘贴覆盖"],
      ["empty-preview-cleared", emptyClipboard.previewCount === 0],
      ["empty-confirm-disabled", emptyClipboard.confirmDisabled],
      ["empty-textarea-cleared", emptyClipboard.textareaValueLength === 0],
      ["empty-hint-cleared", !emptyClipboard.recognizedHintPresent],
      ["empty-full-key-private", emptyClipboard.fullKeyLeakCount === 0],
      ["empty-tail-private", emptyClipboard.tailLeakCount === 0],
      ["rejected-preview-cleared", rejectedClipboard.previewCount === 0],
      ["rejected-confirm-disabled", rejectedClipboard.confirmDisabled],
      ["rejected-textarea-cleared", rejectedClipboard.textareaValueLength === 0],
      ["rejected-hint-cleared", !rejectedClipboard.recognizedHintPresent],
      ["rejected-full-key-private", rejectedClipboard.fullKeyLeakCount === 0],
      ["rejected-tail-private", rejectedClipboard.tailLeakCount === 0],
      ["stale-preview-cleared", staleClipboard.previewCount === 0],
      ["stale-confirm-disabled", staleClipboard.confirmDisabled],
      ["stale-textarea-cleared", staleClipboard.textareaValueLength === 0],
      ["stale-hint-cleared", !staleClipboard.recognizedHintPresent],
      ["stale-full-key-private", staleClipboard.fullKeyLeakCount === 0],
      ["stale-tail-private", staleClipboard.tailLeakCount === 0],
      ["invalid-preview-cleared", invalidReplacement.previewCount === 0],
      ["invalid-confirm-disabled", invalidReplacement.confirmDisabled],
      ["invalid-hint-cleared", !invalidReplacement.recognizedHintPresent],
      ["invalid-message-visible", invalidReplacement.invalidMessagePresent],
      ["invalid-full-key-private", invalidReplacement.fullKeyLeakCount === 0],
      ["invalid-tail-private", invalidReplacement.tailLeakCount === 0],
      ["confirmed-slots-collapsed", collapsedInputCount === 0],
      ["staged-input-empty", stagedInput.valueLength === 0],
      ["staged-placeholder-visible", stagedInput.placeholder.includes("批量预填已就绪")],
      ["staged-full-key-private", stagedInput.fullKeyLeakCount === 0],
      ["staged-tail-private", stagedInput.tailLeakCount === 0],
      ["saved-hint-private", !savedHintLeakBefore],
    ].filter(([, passed]) => !passed).map(([name]) => name);
    return {
      pendingBefore,
      pendingAfterCancel,
      savedHintLeakBefore,
      systemRead,
      manualPaste: {
        previewCount: 10,
        recognizedHint: manualValidHint,
        emptyClipboard,
        rejectedClipboard,
        staleClipboard,
        invalidReplacement,
        ...manualAudit,
      },
      confirmedPendingCount: 10,
      collapsedInputCount,
      stagedInput,
      failedChecks,
    };
  `), 30000);
  report.bulkDialog = bulkResult;
  if (bulkResult.failedChecks.length > 0) {
    throw new Error(`Android bulk dialog checks failed: ${bulkResult.failedChecks.join(", ")}.`);
  }
  report.screenshotPrivacyWaitMs = apiLevel >= 33 ? 5000 : 0;
  if (report.screenshotPrivacyWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, report.screenshotPrivacyWaitMs));
  }

  const dialogClip = await client.evaluate(`(() => {
    const element = document.querySelector(".android-upstream-modal-card");
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, innerHeight - rect.y), scale: 1 };
  })()`);
  if (dialogClip) await client.screenshot("bulk-confirmed-masked.png", dialogClip);

  const closeResult = await client.evaluate(asyncExpression(`
    const waitFor = async (predicate, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out while closing the upstream dialog.");
    };
    const closeButton = document.querySelector(".android-upstream-modal-card .android-upstream-modal-header button");
    if (closeButton) closeButton.click();
    await waitFor(() => !document.querySelector(".android-upstream-modal-card"));
    const reopenButton = document.querySelector('[data-audit-id="open-upstream-config"]');
    if (reopenButton) reopenButton.click();
    await waitFor(() => document.querySelector(".android-upstream-modal-card"));
    const poolButton = await waitFor(() => [...document.querySelectorAll("button")].find((button) => (
      button.offsetParent && (button.innerText || "").trim().startsWith("FHL Images 10")
    )));
    poolButton.click();
    const region = await waitFor(() => document.querySelector('[aria-label="FHL API 10槽配置"]'));
    const pendingAfterParentReopen = region.querySelectorAll(".android-fhl-slot-status.pending").length;
    const visibleKeyFragment = /sk-[^\\s]+/i.test(region.innerText || "");
    const finalCloseButton = document.querySelector(".android-upstream-modal-card .android-upstream-modal-header button");
    if (finalCloseButton) finalCloseButton.click();
    return { pendingAfterParentReopen, visibleKeyFragment };
  `));
  report.bulkDialog.parentReopen = closeResult;
  if (closeResult.pendingAfterParentReopen !== 0 || closeResult.visibleKeyFragment) {
    throw new Error("Parent close did not discard bulk drafts or retained a visible key fragment.");
  }

  for (const itemCount of [30, 60, 200]) {
    if (gfxScrollGateEnabled) resetGfxInfo();
    const metrics = await client.evaluate(asyncExpression(`
      const waitFor = async (predicate, label, timeoutMs = 8000) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Timed out waiting for " + label);
      };
      const count = ${itemCount};
      const state = window.__imageStudioDebug && window.__imageStudioDebug.getState
        ? window.__imageStudioDebug.getState()
        : null;
      const previewB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const navigation = document.querySelector(".android-bottom-nav") || document.querySelector(".android-rail");
      const canvasButton = navigation ? navigation.querySelector("button:nth-child(2)") : null;
      if (!canvasButton) throw new Error("Android canvas navigation button is unavailable.");
      canvasButton.click();
      await waitFor(() => document.querySelector('.studio[data-android-view="canvas"]'), "canvas view");
      const items = Array.from({ length: count }, (_, index) => ({
        id: "emulator-virtual-${deviceLabel}-${itemCount}-" + (index + 1),
        createdAt: 1700000000000 + index,
        mode: "generate",
        apiMode: "images",
        apiLabel: "FHL" + ((index % 10) + 1),
        prompt: "synthetic preview " + (index + 1),
        imageB64: previewB64,
        outputWidth: 1152,
        outputHeight: 2048,
        elapsedSec: index + 1,
      }));
      state.setField("batchResults", items);
      state.setField("resultGridOpen", true);
      const expectedRows = Math.ceil(count / 2);
      const viewport = await waitFor(() => {
        const candidate = document.querySelector(".batch-grid-virtual-scroll");
        if (!candidate) return null;
        const totalRows = Number(candidate.getAttribute("data-batch-grid-total-rows") || -1);
        const firstIndex = Number(candidate.querySelector(".batch-grid-index")
          ? candidate.querySelector(".batch-grid-index").textContent
          : -1);
        return totalRows === expectedRows && firstIndex === 1 ? candidate : null;
      }, "current virtual grid");
      await waitFor(
        () => viewport.querySelectorAll('img[src^="blob:"]').length > 0
          && Number(viewport.getAttribute("data-batch-grid-total-rows") || -1) === expectedRows,
        "current virtual images",
      );
      const rows = [...viewport.querySelectorAll(".batch-grid-virtual-row")];
      const firstRowHeight = rows[0] ? rows[0].getBoundingClientRect().height : 0;
      const rowStride = Math.max(1, firstRowHeight + 8);
      const mountSamples = [];
      const waitForWindowCommit = (expectedStartRow, expectedEndRow, label) => new Promise((resolve, reject) => {
        const matches = () => (
          Number(viewport.getAttribute("data-batch-grid-start-row") || -1) === expectedStartRow
          && Number(viewport.getAttribute("data-batch-grid-end-row") || -1) === expectedEndRow
        );
        if (matches()) {
          resolve();
          return;
        }
        const observer = new MutationObserver(() => {
          if (!matches()) return;
          clearTimeout(timer);
          observer.disconnect();
          resolve();
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error("Timed out waiting for " + label));
        }, 8000);
        observer.observe(viewport, {
          attributes: true,
          attributeFilter: ["data-batch-grid-start-row", "data-batch-grid-end-row"],
        });
      });
      const captureMountSample = (label) => {
        const scrollTop = viewport.scrollTop;
        const firstVisibleRow = Math.floor(Math.max(0, scrollTop) / rowStride);
        const lastVisibleRowExclusive = Math.ceil(
          (Math.max(0, scrollTop) + Math.max(1, viewport.clientHeight)) / rowStride,
        );
        const visibleRows = Math.max(0, lastVisibleRowExclusive - firstVisibleRow);
        const expectedStartRow = Math.max(0, firstVisibleRow - 2);
        const expectedEndRow = Math.min(expectedRows, lastVisibleRowExclusive + 2);
        const startRow = Number(viewport.getAttribute("data-batch-grid-start-row") || -1);
        const endRow = Number(viewport.getAttribute("data-batch-grid-end-row") || -1);
        const mountedRowElements = [...viewport.querySelectorAll(".batch-grid-virtual-row")];
        const mountedRows = mountedRowElements.length;
        const mountedTiles = viewport.querySelectorAll(".batch-grid-tile").length;
        const mountedRowIndexes = mountedRowElements.map((row) => Number(row.getAttribute("data-batch-grid-row")));
        const expectedRowIndexes = Array.from(
          { length: Math.max(0, expectedEndRow - expectedStartRow) },
          (_, index) => expectedStartRow + index,
        );
        const mountedItemIndexes = [...viewport.querySelectorAll(".batch-grid-index")]
          .map((node) => Number(node.textContent));
        const expectedItemIndexes = Array.from(
          { length: Math.max(0, Math.min(count, expectedEndRow * 2) - expectedStartRow * 2) },
          (_, index) => expectedStartRow * 2 + index + 1,
        );
        const windowIdentityMatches = JSON.stringify(mountedRowIndexes) === JSON.stringify(expectedRowIndexes)
          && JSON.stringify(mountedItemIndexes) === JSON.stringify(expectedItemIndexes);
        const maxMountedTiles = 2 * (visibleRows + 4);
        const sample = {
          label,
          scrollTop,
          firstVisibleRow,
          lastVisibleRowExclusive,
          visibleRows,
          expectedStartRow,
          expectedEndRow,
          startRow,
          endRow,
          mountedRows,
          mountedTiles,
          mountedRowIndexes,
          mountedItemIndexes,
          windowIdentityMatches,
          maxMountedTiles,
        };
        mountSamples.push(sample);
        if (
          startRow !== expectedStartRow
          || endRow !== expectedEndRow
          || mountedRows !== expectedEndRow - expectedStartRow
          || mountedTiles > maxMountedTiles
          || !windowIdentityMatches
        ) {
          throw new Error("Virtual mount window invariant failed for " + count + " at " + label);
        }
        return sample;
      };
      const initialMount = captureMountSample("initial");
      const initial = {
        totalRows: Number(viewport.getAttribute("data-batch-grid-total-rows") || -1),
        startRow: Number(viewport.getAttribute("data-batch-grid-start-row") || -1),
        endRow: Number(viewport.getAttribute("data-batch-grid-end-row") || -1),
        mountedRows: rows.length,
        mountedTiles: viewport.querySelectorAll(".batch-grid-tile").length,
        mountedImages: viewport.querySelectorAll("img").length,
        visibleRows: initialMount.visibleRows,
        maxMountedTiles: initialMount.maxMountedTiles,
        everyRowAtMostTwo: rows.every((row) => row.children.length > 0 && row.children.length <= 2),
        scrollable: viewport.scrollHeight > viewport.clientHeight,
        touchAction: getComputedStyle(viewport).touchAction,
        hostTouchAction: getComputedStyle(document.querySelector(".android-stage-host")).touchAction,
        scrollTop: viewport.scrollTop,
        creates: window.__androidBulkGridVerifierCounters.creates,
        revokes: window.__androidBulkGridVerifierCounters.revokes,
      };
      if (
        initial.totalRows !== expectedRows
        || initial.startRow !== 0
        || initial.mountedTiles > initial.maxMountedTiles
        || initial.mountedImages !== initial.mountedTiles
        || !initial.everyRowAtMostTwo
        || !initial.scrollable
        || initial.touchAction !== "pan-y"
        || initial.hostTouchAction !== "pan-y"
      ) throw new Error("Initial virtual grid invariant failed for " + count);
      viewport.scrollTop = viewport.scrollHeight;
      viewport.dispatchEvent(new Event("scroll"));
      await waitFor(() => Number(viewport.getAttribute("data-batch-grid-start-row") || 0) > 0, "bottom virtual rows");
      const bottomMount = captureMountSample("bottom");
      const bottomRows = [...viewport.querySelectorAll(".batch-grid-virtual-row")];
      const bottom = {
        endRow: Number(viewport.getAttribute("data-batch-grid-end-row") || -1),
        mountedTiles: viewport.querySelectorAll(".batch-grid-tile").length,
        visibleRows: bottomMount.visibleRows,
        maxMountedTiles: bottomMount.maxMountedTiles,
        includesLast: [...viewport.querySelectorAll(".batch-grid-index")].some((node) => Number(node.textContent) === count),
        everyRowAtMostTwo: bottomRows.every((row) => row.children.length > 0 && row.children.length <= 2),
        scrollTop: viewport.scrollTop,
      };
      if (
        bottom.endRow !== expectedRows
        || bottom.mountedTiles > bottom.maxMountedTiles
        || !bottom.includesLast
        || !bottom.everyRowAtMostTwo
      ) throw new Error("Bottom virtual grid invariant failed for " + count);
      state.setField("batchResults", items.map((item, index) => (
        index === Math.min(14, count - 1) ? { ...item, elapsedSec: item.elapsedSec + 1 } : item
      )));
      const updatedIndex = Math.min(14, count - 1);
      await waitFor(() => {
        const currentState = window.__imageStudioDebug.getState();
        const currentItem = currentState.batchResults[updatedIndex];
        return currentItem && currentItem.elapsedSec === items[updatedIndex].elapsedSec + 1;
      }, "same-batch state update");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      captureMountSample("same-batch-update");
      const scrollAfterUpdate = viewport.scrollTop;
      if (Math.abs(scrollAfterUpdate - bottom.scrollTop) > 1) {
        throw new Error("Same-batch update changed scroll position for " + count);
      }
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const frameIntervals = [];
      let previousFrame = await new Promise((resolve) => requestAnimationFrame(resolve));
      for (let index = 0; index < 12; index += 1) {
        const currentFrame = await new Promise((resolve) => requestAnimationFrame(resolve));
        frameIntervals.push(currentFrame - previousFrame);
        previousFrame = currentFrame;
      }
      frameIntervals.sort((left, right) => left - right);
      const baselineFrameMs = frameIntervals[Math.floor(frameIntervals.length / 2)] || 16.7;
      const dispatchDurations = [];
      const frameDelays = [];
      const windowCommitLatencies = [];
      const rafCallbackDurations = [];
      const originalRequestAnimationFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => originalRequestAnimationFrame.call(window, (timestamp) => {
        const callbackStarted = performance.now();
        try {
          return callback(timestamp);
        } finally {
          rafCallbackDurations.push(performance.now() - callbackStarted);
        }
      });
      try {
        for (let index = 0; index < 24; index += 1) {
          const phase = index < 12 ? index / 11 : (23 - index) / 11;
          const started = performance.now();
          viewport.scrollTop = Math.round(maxScrollTop * phase);
          viewport.dispatchEvent(new Event("scroll"));
          dispatchDurations.push(performance.now() - started);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const firstVisibleRow = Math.floor(Math.max(0, viewport.scrollTop) / rowStride);
          const lastVisibleRowExclusive = Math.ceil(
            (Math.max(0, viewport.scrollTop) + Math.max(1, viewport.clientHeight)) / rowStride,
          );
          const expectedStartRow = Math.max(0, firstVisibleRow - 2);
          const expectedEndRow = Math.min(expectedRows, lastVisibleRowExclusive + 2);
          await waitForWindowCommit(expectedStartRow, expectedEndRow, "virtual window commit " + count + "/" + index);
          const commitLatencyMs = performance.now() - started;
          windowCommitLatencies.push(commitLatencyMs);
          frameDelays.push(Math.max(0, commitLatencyMs - baselineFrameMs));
          captureMountSample("scroll-" + index + "-commit");
          await new Promise((resolve) => originalRequestAnimationFrame.call(window, resolve));
          captureMountSample("scroll-" + index + "-post-raf");
        }
        await new Promise((resolve) => originalRequestAnimationFrame.call(window, resolve));
        captureMountSample("scroll-final");
      } finally {
        window.requestAnimationFrame = originalRequestAnimationFrame;
      }
      dispatchDurations.sort((left, right) => left - right);
      frameDelays.sort((left, right) => left - right);
      windowCommitLatencies.sort((left, right) => left - right);
      rafCallbackDurations.sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(dispatchDurations.length * 0.95) - 1);
      const callbackP95Index = Math.max(0, Math.ceil(rafCallbackDurations.length * 0.95) - 1);
      const p95DispatchMs = dispatchDurations[p95Index] || 0;
      const p95RafCallbackMs = rafCallbackDurations[callbackP95Index] || 0;
      const p95WindowCommitLatencyMs = windowCommitLatencies[p95Index] || 0;
      const p95ScrollProcessingMs = p95RafCallbackMs;
      const peakMountSample = mountSamples.reduce((peak, sample) => (
        !peak || sample.mountedTiles > peak.mountedTiles ? sample : peak
      ), null);
      const mountViolations = mountSamples.filter((sample) => (
        sample.startRow !== sample.expectedStartRow
        || sample.endRow !== sample.expectedEndRow
        || sample.mountedRows !== sample.expectedEndRow - sample.expectedStartRow
        || sample.mountedTiles > sample.maxMountedTiles
        || !sample.windowIdentityMatches
      ));
      const performanceMetrics = {
        samples: dispatchDurations.length,
        callbackSamples: rafCallbackDurations.length,
        baselineFrameMs,
        p95DispatchMs,
        p95ScrollProcessingMs,
        p95RafCallbackMs,
        p95WindowCommitLatencyMs,
        p95WindowCommitDelayMs: frameDelays[p95Index] || 0,
        p95FrameDelayMs: frameDelays[p95Index] || 0,
        maxDispatchMs: dispatchDurations[dispatchDurations.length - 1] || 0,
        maxScrollProcessingMs: rafCallbackDurations[rafCallbackDurations.length - 1] || 0,
        maxRafCallbackMs: rafCallbackDurations[rafCallbackDurations.length - 1] || 0,
        maxWindowCommitLatencyMs: windowCommitLatencies[windowCommitLatencies.length - 1] || 0,
        maxFrameDelayMs: frameDelays[frameDelays.length - 1] || 0,
        mountedTiles: viewport.querySelectorAll(".batch-grid-tile").length,
        peakMountedTiles: peakMountSample ? peakMountSample.mountedTiles : 0,
        peakMountedTileLimit: peakMountSample ? peakMountSample.maxMountedTiles : 0,
        peakMountSample,
        mountSampleCount: mountSamples.length,
        mountViolations,
        creates: window.__androidBulkGridVerifierCounters.creates,
        revokes: window.__androidBulkGridVerifierCounters.revokes,
        outstandingBlobURLs: window.__androidBulkGridVerifierCounters.outstanding.size,
        duplicateTrackedBlobRevokes: window.__androidBulkGridVerifierCounters.duplicateTrackedRevokes,
        externalBlobRevokes: window.__androidBulkGridVerifierCounters.externalRevokes,
      };
      const performancePassed = p95DispatchMs < 8
        && p95ScrollProcessingMs < 8
        && p95WindowCommitLatencyMs < 250
        && performanceMetrics.revokes > initial.revokes
        && performanceMetrics.duplicateTrackedBlobRevokes === 0
        && performanceMetrics.mountViolations.length === 0;
      return {
        itemCount: count,
        initial,
        bottom,
        scrollAfterUpdate,
        mountSamples,
        performance: performanceMetrics,
        performancePassed,
      };
    `), 30000);
    if (gfxScrollGateEnabled) {
      metrics.gfxScroll = captureGfxInfo();
    }
    report.virtualGrid.push(metrics);
    await client.screenshot(`virtual-grid-${itemCount}.png`);
    if (metrics.gfxScroll && metrics.gfxScroll.frozenFrames !== 0) {
      throw new Error(
        `Virtual grid gfx gate detected ${metrics.gfxScroll.frozenFrames} frame(s) at or above 700ms for ${itemCount}.`,
      );
    }
    if (!metrics.performancePassed) {
      throw new Error(
        `Virtual grid performance or Blob release invariant failed for ${itemCount}: `
        + `dispatchP95=${metrics.performance.p95DispatchMs.toFixed(3)}ms, `
        + `processingP95=${metrics.performance.p95ScrollProcessingMs.toFixed(3)}ms, `
        + `creates=${metrics.performance.creates}, revokes=${metrics.performance.revokes}.`,
      );
    }
  }

  const restored = await client.evaluate(asyncExpression(`
    const getState = window.__imageStudioDebug && window.__imageStudioDebug.getState;
    const state = getState ? getState() : null;
    const original = window.__androidBulkGridVerifierOriginal;
    if (original) {
      state.setField("batchResults", original.batchResults);
      state.setField("resultGridOpen", original.resultGridOpen);
    }
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const current = getState ? getState() : null;
      if (
        current
        && (Array.isArray(current.batchResults) ? current.batchResults.length : -1) === original.batchResults.length
        && Boolean(current.resultGridOpen) === Boolean(original.resultGridOpen)
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const blobDeadline = performance.now() + 8000;
    while (performance.now() < blobDeadline) {
      const counters = window.__androidBulkGridVerifierCounters;
      if (
        !document.querySelector(".batch-grid-virtual-scroll")
        && counters
        && counters.outstanding.size === 0
        && counters.duplicateTrackedRevokes === 0
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
      const blobCleanup = {
        creates: window.__androidBulkGridVerifierCounters.creates,
        revokes: window.__androidBulkGridVerifierCounters.revokes,
        outstanding: window.__androidBulkGridVerifierCounters.outstanding.size,
        duplicateTrackedRevokes: window.__androidBulkGridVerifierCounters.duplicateTrackedRevokes,
        externalRevokes: window.__androidBulkGridVerifierCounters.externalRevokes,
        gridMounted: Boolean(document.querySelector(".batch-grid-virtual-scroll")),
      };
    if (window.__androidBulkGridVerifierOriginalCreate) URL.createObjectURL = window.__androidBulkGridVerifierOriginalCreate;
    if (window.__androidBulkGridVerifierOriginalRevoke) URL.revokeObjectURL = window.__androidBulkGridVerifierOriginalRevoke;
    const originalView = ${JSON.stringify(baseline.androidView)};
    const viewIndex = { compose: 0, canvas: 1, history: 2 }[originalView];
    const nav = document.querySelector(".android-bottom-nav") || document.querySelector(".android-rail");
    const navButtons = nav ? nav.querySelectorAll("button") : [];
    if (Number.isInteger(viewIndex) && navButtons[viewIndex]) navButtons[viewIndex].click();
    const viewDeadline = performance.now() + 8000;
    while (performance.now() < viewDeadline) {
      const studio = document.querySelector(".studio");
      if (studio && studio.getAttribute("data-android-view") === originalView) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const current = getState ? getState() : null;
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const profileStructure = (Array.isArray(current.profiles) ? current.profiles : []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      apiMode: profile.apiMode,
      requestPolicy: profile.requestPolicy,
      baseURL: profile.baseURL,
      textModelID: profile.textModelID,
      imageModelID: profile.imageModelID,
      concurrencyLimit: profile.concurrencyLimit,
      continuousPoolEnabled: profile.continuousPoolEnabled === true,
      fhlImagesPoolSlot: Number.isInteger(profile.fhlImagesPoolSlot) ? profile.fhlImagesPoolSlot : null,
      fhlImagesPoolKeyHint: profile.fhlImagesPoolKeyHint === undefined ? null : profile.fhlImagesPoolKeyHint,
      imagesNewAPICompat: profile.imagesNewAPICompat === true,
      createdAt: profile.createdAt,
      lastUsedAt: profile.lastUsedAt === undefined ? null : profile.lastUsedAt,
    }));
    const cursorEntries = Object.keys(localStorage)
      .filter((key) => key.endsWith("gptcodex.androidFHLImagesPoolCursor.v1"))
      .sort()
      .map((key) => [key, localStorage.getItem(key)]);
    const localStorageEntries = Object.keys(localStorage).sort().map((key) => {
      const value = localStorage.getItem(key);
      if (!key.endsWith("gptcodex.workspaceSession.v1") || !value) return [key, value];
      try {
        const parsed = JSON.parse(value);
        parsed.updatedAt = 0;
        return [key, JSON.stringify(parsed)];
      } catch {
        return [key, value];
      }
    });
    const historyStructure = (Array.isArray(current.history) ? current.history : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    const batchResultStructure = (Array.isArray(current.batchResults) ? current.batchResults : []).map((item) => ({
      id: item.id,
      imageId: item.imageId,
      apiMode: item.apiMode,
      apiLabel: item.apiLabel,
      apiProfileId: item.apiProfileId,
      apiProfileName: item.apiProfileName,
      fhlImagesPoolSlot: item.fhlImagesPoolSlot,
      mode: item.mode,
      createdAt: item.createdAt,
      taskId: item.taskId,
      batchIndex: item.batchIndex,
      imageB64Length: typeof item.imageB64 === "string" ? item.imageB64.length : 0,
    }));
    return {
      profileCount: Array.isArray(current.profiles) ? current.profiles.length : -1,
      profileFingerprint: await digest({ activeProfileId: current.activeProfileId, profiles: profileStructure }),
      cursorFingerprint: await digest(cursorEntries),
      cursorEntryCount: cursorEntries.length,
      localStorageFingerprint: await digest(localStorageEntries),
      historyCount: Array.isArray(current.history) ? current.history.length : -1,
      historyFingerprint: await digest(historyStructure),
      androidView: document.querySelector(".studio")
        ? document.querySelector(".studio").getAttribute("data-android-view")
        : "",
      pendingDrafts: document.querySelectorAll(".android-fhl-slot-status.pending").length,
      batchResults: Array.isArray(current.batchResults) ? current.batchResults.length : -1,
      batchResultFingerprint: await digest(batchResultStructure),
      resultGridOpen: Boolean(current.resultGridOpen),
      blobCleanup,
      generationClicks: Number(window.__androidBulkGridVerifierGenerationClicks || 0),
    };
  `));
  report.restored = { baseline, ...restored };
  if (
    restored.profileCount !== baseline.profileCount
    || restored.profileFingerprint !== baseline.profileFingerprint
    || restored.cursorFingerprint !== baseline.cursorFingerprint
    || restored.cursorEntryCount !== baseline.cursorEntryCount
    || restored.localStorageFingerprint !== baseline.localStorageFingerprint
    || restored.historyCount !== baseline.historyCount
    || restored.historyFingerprint !== baseline.historyFingerprint
    || restored.androidView !== baseline.androidView
    || restored.pendingDrafts !== baseline.pendingDrafts
    || restored.batchResults !== baseline.batchResults
    || restored.batchResultFingerprint !== baseline.batchResultFingerprint
    || restored.resultGridOpen !== baseline.resultGridOpen
    || restored.blobCleanup.gridMounted
    || restored.blobCleanup.outstanding !== 0
    || restored.blobCleanup.duplicateTrackedRevokes !== 0
    || restored.generationClicks !== 0
  ) {
    throw new Error("Frontend state did not return to its exact redacted baseline.");
  }
  report.cleanup = {
    status: "passed",
    ...restored.blobCleanup,
    generationClicks: restored.generationClicks,
  };
  const nativeAfter = captureNativeSnapshot();
  report.nativeState.beforeClipboardClear = nativeAfter;
  report.paidWork = {
    generationClicks: restored.generationClicks,
    groups: nativeAfter.registry.groups - nativeBefore.registry.groups,
    tasks: nativeAfter.registry.tasks - nativeBefore.registry.tasks,
    upstreamPosts: nativeAfter.audit.upstreamSubmitAttempts - nativeBefore.audit.upstreamSubmitAttempts,
  };
  if (
    report.paidWork.groups !== 0
    || report.paidWork.generationClicks !== 0
    || report.paidWork.tasks !== 0
    || report.paidWork.upstreamPosts !== 0
    || nativeAfter.registry.sha256 !== nativeBefore.registry.sha256
    || nativeAfter.audit.sha256 !== nativeBefore.audit.sha256
    || nativeAfter.encryptedCredentials.sha256 !== nativeBefore.encryptedCredentials.sha256
  ) {
    throw new Error("Native task, audit, or encrypted credential state changed during the UI-only verifier.");
  }
  await client.evaluate(`(() => {
    if (window.__androidBulkGridVerifierClickListener) {
      document.removeEventListener("click", window.__androidBulkGridVerifierClickListener, true);
    }
    delete window.__androidBulkGridVerifierOriginal;
    delete window.__androidBulkGridVerifierCounters;
    delete window.__androidBulkGridVerifierOriginalCreate;
    delete window.__androidBulkGridVerifierOriginalRevoke;
    delete window.__androidBulkGridVerifierGenerationClicks;
    delete window.__androidBulkGridVerifierClickListener;
    return true;
  })()`);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error && error.message !== undefined ? error.message : error);
  try {
    await client.screenshot("failure.png");
  } catch { }
  try {
    const failedCleanup = await client.evaluate(asyncExpression(`
      const bulkCancel = document.querySelector('[data-audit-id="fhl-bulk-cancel"]');
      if (bulkCancel) bulkCancel.click();
      const upstreamClose = document.querySelector(".android-upstream-modal-card .android-upstream-modal-header button");
      if (upstreamClose) upstreamClose.click();
      const state = window.__imageStudioDebug && window.__imageStudioDebug.getState
        ? window.__imageStudioDebug.getState()
        : null;
      const original = window.__androidBulkGridVerifierOriginal;
      if (state && original) {
        state.setField("batchResults", original.batchResults);
        state.setField("resultGridOpen", original.resultGridOpen);
      }
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        const current = window.__imageStudioDebug && window.__imageStudioDebug.getState
          ? window.__imageStudioDebug.getState()
          : null;
        const counters = window.__androidBulkGridVerifierCounters;
        if (
          current
          && (!original || (
            current.batchResults.length === original.batchResults.length
            && Boolean(current.resultGridOpen) === Boolean(original.resultGridOpen)
          ))
          && !document.querySelector(".android-fhl-bulk-dialog-card")
          && !document.querySelector(".android-upstream-modal-card")
          && !document.querySelector(".batch-grid-virtual-scroll")
          && (!counters || (
            counters.outstanding.size === 0
            && counters.duplicateTrackedRevokes === 0
          ))
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const originalView = ${JSON.stringify(baseline && baseline.androidView ? baseline.androidView : "compose")};
      const viewIndex = { compose: 0, canvas: 1, history: 2 }[originalView];
      const nav = document.querySelector(".android-bottom-nav") || document.querySelector(".android-rail");
      const navButtons = nav ? nav.querySelectorAll("button") : [];
      if (Number.isInteger(viewIndex) && navButtons[viewIndex]) navButtons[viewIndex].click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const current = window.__imageStudioDebug && window.__imageStudioDebug.getState
        ? window.__imageStudioDebug.getState()
        : null;
      const counters = window.__androidBulkGridVerifierCounters || {
        creates: 0,
        revokes: 0,
        createdURLs: new Set(),
        outstanding: new Set(),
        duplicateTrackedRevokes: 0,
        externalRevokes: 0,
      };
      const generationClicks = Number(window.__androidBulkGridVerifierGenerationClicks || 0);
      if (window.__androidBulkGridVerifierOriginalCreate) URL.createObjectURL = window.__androidBulkGridVerifierOriginalCreate;
      if (window.__androidBulkGridVerifierOriginalRevoke) URL.revokeObjectURL = window.__androidBulkGridVerifierOriginalRevoke;
      const passed = Boolean(
        current
        && (!original || (
          current.batchResults.length === original.batchResults.length
          && Boolean(current.resultGridOpen) === Boolean(original.resultGridOpen)
        ))
        && !document.querySelector(".android-fhl-bulk-dialog-card")
        && !document.querySelector(".android-upstream-modal-card")
        && !document.querySelector(".batch-grid-virtual-scroll")
        && document.querySelector(".studio")
        && document.querySelector(".studio").getAttribute("data-android-view") === originalView
        && counters.outstanding.size === 0
        && counters.duplicateTrackedRevokes === 0
      );
      if (window.__androidBulkGridVerifierClickListener) {
        document.removeEventListener("click", window.__androidBulkGridVerifierClickListener, true);
      }
      delete window.__androidBulkGridVerifierOriginal;
      delete window.__androidBulkGridVerifierCounters;
      delete window.__androidBulkGridVerifierOriginalCreate;
      delete window.__androidBulkGridVerifierOriginalRevoke;
      delete window.__androidBulkGridVerifierGenerationClicks;
      delete window.__androidBulkGridVerifierClickListener;
      return {
        status: passed ? "passed" : "failed",
        creates: counters.creates,
        revokes: counters.revokes,
        outstanding: counters.outstanding.size,
        duplicateTrackedRevokes: counters.duplicateTrackedRevokes,
        externalRevokes: counters.externalRevokes,
        generationClicks,
      };
    `));
    report.cleanup = failedCleanup;
    if (failedCleanup.status !== "passed") report.failure += " Cleanup verification failed.";
  } catch (cleanupError) {
    report.cleanup = {
      status: "failed",
      error: String(cleanupError && cleanupError.message !== undefined ? cleanupError.message : cleanupError),
    };
    report.failure += " Cleanup execution failed.";
  }
  try {
    if (originalQuickSettingsPreferenceEntries) {
      await restoreQuickSettings(
        client,
        originalQuickSettingsPreferenceEntries,
        originalQuickSettingsExpanded,
      );
      quickSettingsRestored = true;
    }
  } catch (quickRestoreError) {
    report.failure += " Android quick settings preference cleanup failed.";
    if (report.quickSettings) {
      report.quickSettings.cleanupError = String(
        quickRestoreError && quickRestoreError.message !== undefined
          ? quickRestoreError.message
          : quickRestoreError,
      );
    }
  }
  try {
    const nativeAfter = captureNativeSnapshot();
    report.nativeState.beforeClipboardClear = nativeAfter;
    report.paidWork = {
      generationClicks: report.cleanup && Number.isFinite(report.cleanup.generationClicks)
        ? report.cleanup.generationClicks
        : -1,
      groups: nativeAfter.registry.groups - nativeBefore.registry.groups,
      tasks: nativeAfter.registry.tasks - nativeBefore.registry.tasks,
      upstreamPosts: nativeAfter.audit.upstreamSubmitAttempts - nativeBefore.audit.upstreamSubmitAttempts,
    };
  } catch { }
} finally {
  if (!quickSettingsRestored && client && originalQuickSettingsPreferenceEntries) {
    try {
      await restoreQuickSettings(
        client,
        originalQuickSettingsPreferenceEntries,
        originalQuickSettingsExpanded,
      );
      quickSettingsRestored = true;
    } catch (quickRestoreError) {
      report.status = "failed";
      report.failure += " Android quick settings preference final restore failed.";
      if (report.quickSettings) {
        report.quickSettings.finalRestoreError = String(
          quickRestoreError && quickRestoreError.message !== undefined
            ? quickRestoreError.message
            : quickRestoreError,
        );
      }
    }
  }
  if (report.quickSettings) report.quickSettings.restored = quickSettingsRestored;
  try {
    clearSyntheticClipboard();
    assertDeviceBinding();
    const clearedClipboard = await client.evaluate(clipboardSummaryExpression(), 15000);
    report.clipboard.clearedSha256 = clearedClipboard.sha256;
    report.clipboard.clearedLength = clearedClipboard.length;
    report.clipboard.clearedLineCount = clearedClipboard.lineCount;
    report.clipboard.cleared = clearedClipboard.length === 0 && clearedClipboard.lineCount === 0;
    if (!report.clipboard.cleared) {
      throw new Error("Synthetic clipboard is not empty after cleanup.");
    }
  } catch (clipboardError) {
    report.status = "failed";
    report.clipboard.cleared = false;
    report.failure += " Synthetic clipboard cleanup verification failed.";
  }
  try {
    const finalNative = captureNativeSnapshot();
    report.nativeState.after = finalNative;
    const finalGenerationClicks = report.cleanup && Number.isFinite(report.cleanup.generationClicks)
      ? report.cleanup.generationClicks
      : null;
    report.paidWork = {
      generationClicks: finalGenerationClicks,
      groups: finalNative.registry.groups - nativeBefore.registry.groups,
      tasks: finalNative.registry.tasks - nativeBefore.registry.tasks,
      upstreamPosts: finalNative.audit.upstreamSubmitAttempts - nativeBefore.audit.upstreamSubmitAttempts,
    };
    if (
      report.paidWork.groups !== 0
      || (report.status === "passed" && report.paidWork.generationClicks !== 0)
      || report.paidWork.tasks !== 0
      || report.paidWork.upstreamPosts !== 0
      || finalNative.registry.sha256 !== nativeBefore.registry.sha256
      || finalNative.audit.sha256 !== nativeBefore.audit.sha256
      || finalNative.encryptedCredentials.sha256 !== nativeBefore.encryptedCredentials.sha256
    ) {
      report.status = "failed";
      report.failure += " Final native state changed across clipboard cleanup and application resume.";
    }
  } catch (nativeFinalError) {
    report.status = "failed";
    report.failure += " Final native state verification failed.";
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(outputDirectory, "ui-grid-report.json");
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const artifacts = [];
  for (const entry of (await fs.readdir(outputDirectory, { withFileTypes: true }))
    .filter((item) => item.isFile() && item.name !== "artifact-manifest.json")
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const bytes = await fs.readFile(path.join(outputDirectory, entry.name));
    artifacts.push({ file: entry.name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await fs.writeFile(
    path.join(outputDirectory, "artifact-manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      status: report.status,
      productGitCommit: gitCommit,
      verifierGitCommit,
      verifierScriptSha256,
      apkSha256,
      deviceSerial,
      artifacts,
    }, null, 2)}\n`,
    "utf8",
  );
  if (client) client.close();
}

if (report.status !== "passed") {
  throw new Error(report.failure || "Android bulk/grid verification failed.");
}

console.log(`Android bulk/grid verification passed: ${deviceLabel} API ${apiLevel}`);
