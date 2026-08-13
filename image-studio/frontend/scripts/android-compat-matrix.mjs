import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendDir, "../..");
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const matrixMode = process.env.ANDROID_COMPAT_FULL === "1" || process.argv.includes("--full") ? "full" : "quick";
const outRoot = path.resolve(repoRoot, "compat-screenshots", `android-v2.0.3-${matrixMode}-${runStamp}`);
const reportOutRoot = outRoot.replaceAll("\\", "/");
const vitePortOverride = process.env.ANDROID_COMPAT_PORT?.trim() || "";

const fullViewports = [
  [360, 800],
  [390, 844],
  [430, 932],
  [800, 1280],
];
const quickViewports = [
  [390, 844],
  [430, 932],
];
const fullSafeTops = [24];
const quickSafeTops = [24];
const fullSafeBottoms = [34];
const quickSafeBottoms = [34];
const defaultViews = ["config", "compose", "result", "history"];
const themes = matrixMode === "full" ? ["light", "dark"] : ["light"];

function parseViewportList(value, fallback) {
  if (!value) return fallback;
  const parsed = value.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d+)x(\d+)$/i);
      return match ? [Number(match[1]), Number(match[2])] : null;
    })
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function parseNumberList(value, fallback) {
  if (!value) return fallback;
  const parsed = value.split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0);
  return parsed.length ? parsed : fallback;
}

function parseViewList(value, fallback) {
  if (!value) return fallback;
  const allowed = new Set(defaultViews);
  const parsed = value.split(",")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));
  return parsed.length ? parsed : fallback;
}

function runtimeViewFor(view) {
  return view === "result" ? "canvas" : view === "config" ? "compose" : view;
}

const viewports = parseViewportList(
  process.env.ANDROID_COMPAT_VIEWPORTS,
  matrixMode === "full" ? fullViewports : quickViewports,
);
const safeTops = parseNumberList(
  process.env.ANDROID_COMPAT_SAFE_TOPS,
  matrixMode === "full" ? fullSafeTops : quickSafeTops,
);
const safeBottoms = parseNumberList(
  process.env.ANDROID_COMPAT_SAFE_BOTTOMS,
  matrixMode === "full" ? fullSafeBottoms : quickSafeBottoms,
);
const views = parseViewList(process.env.ANDROID_COMPAT_VIEWS, defaultViews);

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("Playwright is required for the Android compat matrix.");
    console.error("Run this once in image-studio/frontend: npm i -D playwright");
    process.exit(1);
  }
}

function parsePort(value) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`ANDROID_COMPAT_PORT must be an integer: ${value}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`ANDROID_COMPAT_PORT must be between 1024 and 65535: ${value}`);
  }
  return port;
}

function reservePort(port = 0) {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    const onError = (error) => {
      reservation.close();
      reject(error);
    };
    reservation.once("error", onError);
    reservation.listen({ host: "127.0.0.1", port }, () => {
      reservation.removeListener("error", onError);
      const address = reservation.address();
      const selectedPort = typeof address === "object" && address ? address.port : port;
      reservation.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}

function spawnServer(port) {
  const env = {
    ...process.env,
    VITE_TARGET_PLATFORM: "android",
    BROWSER: "none",
  };
  const viteEntry = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
  const args = [
    viteEntry,
    "--mode", "android",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ];
  const child = spawn(process.execPath, args, {
    cwd: frontendDir,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    output += data.toString();
  });
  return { child, args, port, getOutput: () => output };
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function waitForServer(server) {
  const baseURL = `http://127.0.0.1:${server.port}/`;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (code ${server.child.exitCode}):\n${server.getOutput()}`);
    }
    try {
      const response = await fetch(baseURL);
      if (response.ok) return baseURL;
    } catch {
      // The server can take a few polling intervals to bind and serve the entrypoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite server did not start on strict port ${server.port}:\n${server.getOutput()}`);
}

function truncate(value, max = 500) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max)}...[truncated]`;
}

function redact(value) {
  return truncate(value).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]");
}

async function createPageDiagnostics(page) {
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (consoleMessages.length < 40) {
      const location = message.location();
      consoleMessages.push({
        type: message.type(),
        text: redact(message.text()),
        location: {
          url: redact(location.url || ""),
          lineNumber: location.lineNumber,
          columnNumber: location.columnNumber,
        },
      });
    }
  });
  page.on("pageerror", (error) => {
    if (pageErrors.length < 20) pageErrors.push(redact(error?.stack || error?.message || error));
  });
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Runtime.enable");
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      if (pageErrors.length >= 20) return;
      pageErrors.push({
        text: redact(exceptionDetails.exception?.description || exceptionDetails.text || "unknown"),
        url: redact(exceptionDetails.url || ""),
        lineNumber: exceptionDetails.lineNumber,
        columnNumber: exceptionDetails.columnNumber,
        scriptId: exceptionDetails.scriptId || "",
      });
    });
  } catch {
    // Page-level diagnostics remain available when CDP is unavailable.
  }
  page.on("requestfailed", (request) => {
    if (requestFailures.length < 20) {
      requestFailures.push({
        url: redact(request.url()),
        method: request.method(),
        failure: redact(request.failure()?.errorText || "unknown"),
      });
    }
  });
  return {
    reset() {
      consoleMessages.length = 0;
      pageErrors.length = 0;
      requestFailures.length = 0;
    },
    snapshot() {
      return { console: [...consoleMessages], pageErrors: [...pageErrors], requestFailures: [...requestFailures] };
    },
  };
}

async function waitForStudioReady(page) {
  await page.waitForFunction(() => {
    const getState = window.__imageStudioDebug?.getState;
    if (typeof getState !== "function") return false;
    const state = getState();
    return typeof state.activeWorkspaceId === "string"
      && state.activeWorkspaceId.length > 0
      && Array.isArray(state.workspaces)
      && state.workspaces.some((workspace) => workspace?.id === state.activeWorkspaceId);
  }, null, { timeout: 10_000 });
}

async function openUpstreamConfigFromUI(page) {
  const manageButton = page.getByRole("button", { name: "管理上游配置", exact: true });
  await manageButton.waitFor({ state: "visible", timeout: 5_000 });
  await manageButton.click({ timeout: 5_000 });
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5_000 });
}

async function readModalAndDebugState(page) {
  try {
    return await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const visibleDialogs = dialogs.filter((dialog) => {
        const style = getComputedStyle(dialog);
        const rect = dialog.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      let state = null;
      let stateError = "";
      const getState = window.__imageStudioDebug?.getState;
      if (typeof getState === "function") {
        try { state = getState(); } catch (error) { stateError = String(error?.message || error); }
      }
      return {
        readyState: document.readyState,
        href: window.location.href,
        studioView: document.querySelector(".studio")?.getAttribute("data-android-view") || "",
        dialogCount: dialogs.length,
        visibleDialogCount: visibleDialogs.length,
        dialogLabels: visibleDialogs.map((dialog) => dialog.getAttribute("aria-label") || "").slice(0, 5),
        debugAvailable: typeof getState === "function",
        debugState: state ? {
          activeWorkspaceId: typeof state.activeWorkspaceId === "string" ? state.activeWorkspaceId : "",
          activeProfileId: typeof state.activeProfileId === "string" ? state.activeProfileId : "",
          upstreamModalOpen: state.upstreamModalOpen === true,
          upstreamReturnTarget: typeof state.upstreamReturnTarget === "string" ? state.upstreamReturnTarget : "",
          settingsOpen: state.settingsOpen === true,
        } : null,
        debugStateError: stateError,
      };
    });
  } catch (error) {
    return { readError: redact(error?.stack || error?.message || error) };
  }
}

async function captureViewFailure({ page, diagnostics, suffix, view, runtimeView, width, height, safeTop, safeBottom, theme, url, stage, error }) {
  const screenshotPath = path.join(outRoot, `${suffix}-${view}-failure.png`);
  let screenshotError = "";
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (screenshotFailure) {
    screenshotError = redact(screenshotFailure?.message || screenshotFailure);
  }
  const diagnostic = {
    kind: "view-setup-failure",
    stage,
    error: redact(error?.stack || error?.message || error),
    url: redact(url || page.url()),
    view,
    runtimeView,
    viewport: { width, height, safeTop, safeBottom },
    theme,
    screenshot: screenshotPath.replaceAll("\\", "/"),
    screenshotError,
    modalDebugState: await readModalAndDebugState(page),
    ...diagnostics.snapshot(),
  };
  await fs.writeFile(
    path.join(outRoot, `${suffix}-${view}-failure.json`),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
    "utf8",
  );
  return diagnostic;
}

async function run() {
  const { chromium } = await importPlaywright();
  await fs.mkdir(outRoot, { recursive: true });
  let selectedPort = null;
  let server = null;
  let baseURL = "";
  let browser;
  const failures = [];
  const virtualGridMeasurements = [];
  let fatalError = null;
  let casesCompleted = 0;
  try {
    selectedPort = await reservePort(vitePortOverride ? parsePort(vitePortOverride) : 0);
    server = spawnServer(selectedPort);
    baseURL = `http://127.0.0.1:${selectedPort}/`;
    await waitForServer(server);
    browser = await chromium.launch();
    console.log(`Android compat matrix mode: ${matrixMode}`);
    console.log(`Android compat cases: ${viewports.length * safeTops.length * safeBottoms.length * views.length * themes.length}`);
    console.log(`Android compat target: ${baseURL}`);
    for (const [width, height] of viewports) {
      for (const safeTop of safeTops) {
        for (const safeBottom of safeBottoms) {
          for (const theme of themes) {
            const context = await browser.newContext({
              viewport: { width, height },
              colorScheme: theme,
              deviceScaleFactor: 3,
              isMobile: true,
              hasTouch: true,
              userAgent: "Mozilla/5.0 (Linux; Android 14; FHL Compat Matrix) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
            });
            await context.addInitScript(() => {
              const prefix = String.fromCharCode(115, 107, 45);
              const keys = Array.from({ length: 12 }, (_, index) => (
                `${prefix}${String.fromCharCode(97 + index).repeat(12)}${String(index + 1).padStart(4, "0")}`
              ));
              const clipboardText = [...keys, keys[0], "", "invalid line"].join("\n");
              window.__androidBulkMatrixClipboardText = clipboardText;
              window.__androidMatrixObjectURLCreates = 0;
              window.__androidMatrixObjectURLRevokes = 0;
              const originalCreateObjectURL = URL.createObjectURL.bind(URL);
              const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
              URL.createObjectURL = (...args) => {
                window.__androidMatrixObjectURLCreates += 1;
                return originalCreateObjectURL(...args);
              };
              URL.revokeObjectURL = (...args) => {
                window.__androidMatrixObjectURLRevokes += 1;
                return originalRevokeObjectURL(...args);
              };
              Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: { readText: async () => clipboardText },
              });
            });
            const page = await context.newPage();
            let postRequestCount = 0;
            page.on("request", (request) => {
              if (
                request.method() === "POST"
                && !new URL(request.url()).pathname.startsWith("/__image-studio-audit/")
              ) {
                postRequestCount += 1;
              }
            });
            const diagnostics = await createPageDiagnostics(page);
            const suffix = `${width}x${height}-top${safeTop}-bottom${safeBottom}-${theme}`;
            for (const view of views) {
              diagnostics.reset();
              const runtimeView = runtimeViewFor(view);
              const preview = view === "result" || view === "history" ? "&preview=mac-workspace" : "";
              const url = `${baseURL}?target=android&safeTop=${safeTop}&safeBottom=${safeBottom}&compatView=${runtimeView}${preview}`;
              try {
              await page.goto(url, { waitUntil: "domcontentloaded" });
              await page.waitForFunction(() => Boolean(window.__imageStudioDebug?.getState));
              await waitForStudioReady(page);
              await page.evaluate(() => {
                const keys = [];
                for (let index = 0; index < localStorage.length; index += 1) {
                  const key = localStorage.key(index) ?? "";
                  if (key.endsWith(".androidQuickSettingsCollapsed.v1")) keys.push(key);
                }
                keys.forEach((key) => localStorage.removeItem(key));
              });
              await page.reload({ waitUntil: "domcontentloaded" });
              await page.waitForFunction(() => Boolean(window.__imageStudioDebug?.getState));
              await waitForStudioReady(page);
              await page.evaluate(({ targetView, targetTheme }) => {
                window.__imageStudioDebug?.getState().setTheme(targetTheme);
                document.querySelector(".studio")?.setAttribute("data-android-view", targetView);
              }, { targetView: runtimeView, targetTheme: theme });
              const quickSettingsExpanded = await page.evaluate(() => {
                const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
                const quickSettings = document.querySelector("#android-header-quick-settings");
                return {
                  togglePresent: Boolean(toggle),
                  toggleLabel: toggle?.getAttribute("aria-label") ?? "",
                  expanded: toggle?.getAttribute("aria-expanded") ?? "",
                  quickSettingsPresent: Boolean(quickSettings),
                  rootState: document.documentElement.getAttribute("data-android-quick-settings") ?? "",
                };
              });
              if (
                !quickSettingsExpanded.togglePresent
                || quickSettingsExpanded.toggleLabel !== "折叠快速设置"
                || quickSettingsExpanded.expanded !== "true"
                || !quickSettingsExpanded.quickSettingsPresent
                || quickSettingsExpanded.rootState !== "expanded"
              ) {
                throw new Error(`Android quick settings did not default expanded: ${JSON.stringify(quickSettingsExpanded)}`);
              }
              await page.locator('[data-audit-id="toggle-android-quick-settings"]').click();
              const quickSettingsCollapsed = await page.evaluate(() => {
                const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
                const header = document.querySelector(".app-header")?.getBoundingClientRect();
                const studio = document.querySelector(".studio")?.getBoundingClientRect();
                let storedValue = "";
                for (let index = 0; index < localStorage.length; index += 1) {
                  const key = localStorage.key(index) ?? "";
                  if (key.endsWith(".androidQuickSettingsCollapsed.v1")) storedValue = localStorage.getItem(key) ?? "";
                }
                return {
                  toggleLabel: toggle?.getAttribute("aria-label") ?? "",
                  expanded: toggle?.getAttribute("aria-expanded") ?? "",
                  quickSettingsPresent: Boolean(document.querySelector("#android-header-quick-settings")),
                  rootState: document.documentElement.getAttribute("data-android-quick-settings") ?? "",
                  storedValue,
                  headerHeight: header?.height ?? 0,
                  contentGap: header && studio ? studio.top - header.bottom : 0,
                };
              });
              if (
                quickSettingsCollapsed.toggleLabel !== "展开快速设置"
                || quickSettingsCollapsed.expanded !== "false"
                || quickSettingsCollapsed.quickSettingsPresent
                || quickSettingsCollapsed.rootState !== "collapsed"
                || quickSettingsCollapsed.storedValue !== "1"
                || quickSettingsCollapsed.headerHeight > 100
                || quickSettingsCollapsed.contentGap > 20
              ) {
                throw new Error(`Android quick settings did not collapse cleanly: ${JSON.stringify(quickSettingsCollapsed)}`);
              }
              const postCountBeforeQuickSettingsReload = postRequestCount;
              await page.reload({ waitUntil: "domcontentloaded" });
              await page.waitForFunction(() => Boolean(window.__imageStudioDebug?.getState));
              await waitForStudioReady(page);
              const quickSettingsRestored = await page.evaluate(({ targetView, targetTheme }) => {
                window.__imageStudioDebug?.getState().setTheme(targetTheme);
                document.querySelector(".studio")?.setAttribute("data-android-view", targetView);
                const toggle = document.querySelector('[data-audit-id="toggle-android-quick-settings"]');
                return {
                  toggleLabel: toggle?.getAttribute("aria-label") ?? "",
                  expanded: toggle?.getAttribute("aria-expanded") ?? "",
                  quickSettingsPresent: Boolean(document.querySelector("#android-header-quick-settings")),
                };
              }, { targetView: runtimeView, targetTheme: theme });
              if (
                quickSettingsRestored.toggleLabel !== "展开快速设置"
                || quickSettingsRestored.expanded !== "false"
                || quickSettingsRestored.quickSettingsPresent
              ) {
                throw new Error(`Android quick settings collapse was not restored: ${JSON.stringify(quickSettingsRestored)}`);
              }
              if (postRequestCount !== postCountBeforeQuickSettingsReload) {
                throw new Error("Android quick settings collapse or reload emitted an upstream POST");
              }
              await page.locator('[data-audit-id="toggle-android-quick-settings"]').click();
              await page.waitForFunction(() => Boolean(document.querySelector("#android-header-quick-settings")));
              if (view === "result") {
                const postCountBeforeVirtualGrid = postRequestCount;
                const syntheticItemCount = width <= 360 ? 30 : width <= 390 ? 60 : 200;
                const objectURLCountBeforeVirtualGrid = await page.evaluate(() => ({
                  creates: window.__androidMatrixObjectURLCreates ?? 0,
                  revokes: window.__androidMatrixObjectURLRevokes ?? 0,
                }));
                await page.getByRole("button", { name: "画布", exact: true }).click();
                await page.locator('.studio[data-android-view="canvas"]').waitFor({ state: "visible", timeout: 5_000 });
                await page.evaluate((itemCount) => {
                  const state = window.__imageStudioDebug?.getState();
                  const previewB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
                  const items = Array.from({ length: itemCount }, (_, index) => ({
                    id: `android-virtual-grid-${index + 1}`,
                    createdAt: 1_700_000_000_000 + index,
                    mode: "generate",
                    apiMode: "images",
                    apiLabel: `FHL${(index % 10) + 1}`,
                    prompt: `synthetic preview ${index + 1}`,
                    imageB64: previewB64,
                    outputWidth: 1152,
                    outputHeight: 2048,
                    elapsedSec: index + 1,
                  }));
                  state?.setField("batchResults", items);
                  state?.setField("resultGridOpen", true);
                }, syntheticItemCount);
                const virtualGrid = page.locator(".batch-grid-virtual-scroll");
                await virtualGrid.waitFor({ state: "visible", timeout: 5_000 });
                await page.waitForFunction(() => document.querySelectorAll(
                  '.batch-grid-virtual-row img[src^="blob:"]',
                ).length > 0);
                const initialVirtualMetrics = await page.evaluate((objectURLBaseline) => {
                  const viewport = document.querySelector(".batch-grid-virtual-scroll");
                  const rows = [...document.querySelectorAll(".batch-grid-virtual-row")];
                  const startRow = Number(viewport?.getAttribute("data-batch-grid-start-row") ?? -1);
                  const endRow = Number(viewport?.getAttribute("data-batch-grid-end-row") ?? -1);
                  const firstRowHeight = rows[0]?.getBoundingClientRect().height ?? 0;
                  const visibleRows = Math.ceil((viewport?.clientHeight ?? 0) / Math.max(1, firstRowHeight + 8));
                  return {
                    totalRows: Number(viewport?.getAttribute("data-batch-grid-total-rows") ?? -1),
                    startRow,
                    endRow,
                    renderedRows: rows.length,
                    renderedTiles: document.querySelectorAll(".batch-grid-virtual-row .batch-grid-tile").length,
                    renderedImages: document.querySelectorAll(".batch-grid-virtual-row img").length,
                    maxMountedTiles: 2 * (visibleRows + 4),
                    everyRowHasAtMostTwo: rows.every((row) => row.children.length > 0 && row.children.length <= 2),
                    scrollable: (viewport?.scrollHeight ?? 0) > (viewport?.clientHeight ?? 0),
                    touchAction: viewport ? getComputedStyle(viewport).touchAction : "",
                    hostTouchAction: getComputedStyle(document.querySelector(".android-stage-host")).touchAction,
                    objectURLCreates: (window.__androidMatrixObjectURLCreates ?? 0) - objectURLBaseline.creates,
                  };
                }, objectURLCountBeforeVirtualGrid);
                if (
                  initialVirtualMetrics.totalRows !== Math.ceil(syntheticItemCount / 2)
                  || initialVirtualMetrics.startRow !== 0
                  || initialVirtualMetrics.renderedRows !== initialVirtualMetrics.endRow
                  || initialVirtualMetrics.renderedTiles > initialVirtualMetrics.maxMountedTiles
                  || initialVirtualMetrics.renderedImages !== initialVirtualMetrics.renderedTiles
                  || !initialVirtualMetrics.everyRowHasAtMostTwo
                  || !initialVirtualMetrics.scrollable
                  || initialVirtualMetrics.touchAction !== "pan-y"
                  || initialVirtualMetrics.hostTouchAction !== "pan-y"
                  || initialVirtualMetrics.objectURLCreates > initialVirtualMetrics.maxMountedTiles * 2
                ) {
                  throw new Error(`Android virtual batch grid initial metrics invalid: ${JSON.stringify(initialVirtualMetrics)}`);
                }
                await virtualGrid.evaluate((element) => {
                  element.scrollTop = element.scrollHeight;
                  element.dispatchEvent(new Event("scroll"));
                });
                await page.waitForFunction(() => Number(
                  document.querySelector(".batch-grid-virtual-scroll")?.getAttribute("data-batch-grid-start-row") ?? 0,
                ) > 0);
                const bottomVirtualMetrics = await page.evaluate(() => {
                  const viewport = document.querySelector(".batch-grid-virtual-scroll");
                  const rows = [...document.querySelectorAll(".batch-grid-virtual-row")];
                  return {
                    endRow: Number(viewport?.getAttribute("data-batch-grid-end-row") ?? -1),
                    scrollTop: viewport?.scrollTop ?? 0,
                    renderedTiles: document.querySelectorAll(".batch-grid-virtual-row .batch-grid-tile").length,
                    visibleIndexes: [...document.querySelectorAll(".batch-grid-index")]
                      .map((node) => Number(node.textContent?.trim() ?? 0)),
                    everyRowHasAtMostTwo: rows.every((row) => row.children.length > 0 && row.children.length <= 2),
                  };
                });
                if (
                  bottomVirtualMetrics.endRow !== Math.ceil(syntheticItemCount / 2)
                  || bottomVirtualMetrics.renderedTiles > initialVirtualMetrics.maxMountedTiles
                  || !bottomVirtualMetrics.visibleIndexes.includes(syntheticItemCount)
                  || !bottomVirtualMetrics.everyRowHasAtMostTwo
                ) {
                  throw new Error(`Android virtual batch grid bottom metrics invalid: ${JSON.stringify(bottomVirtualMetrics)}`);
                }
                await page.evaluate(() => {
                  const state = window.__imageStudioDebug?.getState();
                  const items = Array.isArray(state?.batchResults) ? state.batchResults : [];
                  state?.setField("batchResults", items.map((item, index) => (
                    index === 14 ? { ...item, elapsedSec: Number(item.elapsedSec ?? 0) + 1 } : item
                  )));
                });
                await page.waitForTimeout(100);
                const scrollTopAfterUpdate = await virtualGrid.evaluate((element) => element.scrollTop);
                if (Math.abs(scrollTopAfterUpdate - bottomVirtualMetrics.scrollTop) > 1) {
                  throw new Error("virtual batch grid lost scroll position after an in-batch status update");
                }
                const scrollPerformance = await virtualGrid.evaluate(async (element, objectURLBaseline) => {
                  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
                  const durations = [];
                  for (let index = 0; index < 24; index += 1) {
                    const phase = index < 12 ? index / 11 : (23 - index) / 11;
                    const startedAt = performance.now();
                    element.scrollTop = Math.round(maxScrollTop * phase);
                    element.dispatchEvent(new Event("scroll"));
                    durations.push(performance.now() - startedAt);
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                  }
                  durations.sort((a, b) => a - b);
                  const percentileIndex = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
                  return {
                    sampleCount: durations.length,
                    p95DispatchMs: durations[percentileIndex] ?? 0,
                    maxDispatchMs: durations[durations.length - 1] ?? 0,
                    mountedTiles: document.querySelectorAll(".batch-grid-virtual-row .batch-grid-tile").length,
                    objectURLRevokes: (window.__androidMatrixObjectURLRevokes ?? 0) - objectURLBaseline.revokes,
                  };
                }, objectURLCountBeforeVirtualGrid);
                if (scrollPerformance.p95DispatchMs >= 8) {
                  throw new Error(`virtual batch grid scroll p95 exceeded 8ms: ${JSON.stringify(scrollPerformance)}`);
                }
                if (scrollPerformance.objectURLRevokes <= 0) {
                  throw new Error("virtual batch grid did not release offscreen Blob URLs while scrolling");
                }
                virtualGridMeasurements.push({
                  suffix,
                  width,
                  height,
                  theme,
                  itemCount: syntheticItemCount,
                  initial: initialVirtualMetrics,
                  bottom: bottomVirtualMetrics,
                  performance: scrollPerformance,
                });
                if (postRequestCount !== postCountBeforeVirtualGrid) {
                  throw new Error("virtual batch grid emitted an upstream POST");
                }
              }
              if (view === "config") {
                await openUpstreamConfigFromUI(page);
                await page.getByRole("button", { name: /FHL Images 10 槽/ }).click();
                const poolRegion = page.getByRole("region", { name: "FHL API 10槽配置" });
                await poolRegion.waitFor({ state: "visible", timeout: 5_000 });
                const beforeBulkPaste = await page.evaluate(() => {
                  const state = window.__imageStudioDebug?.getState();
                  return {
                    profileCount: Array.isArray(state?.profiles) ? state.profiles.length : -1,
                    groupCount: Object.values(state?.jobGroupsByWorkspace ?? {})
                      .reduce((total, groups) => total + (Array.isArray(groups) ? groups.length : 0), 0),
                  };
                });
                const postCountBeforeBulkPaste = postRequestCount;
                const pendingCountBeforeBulkPaste = await page.locator(".android-fhl-slot-status.pending").count();
                await poolRegion.getByRole("button", { name: "批量配置 10 个 API", exact: true }).click();
                const bulkDialog = page.locator(".android-fhl-bulk-dialog-card");
                await bulkDialog.waitFor({ state: "visible", timeout: 5_000 });
                if (await page.locator(".android-fhl-slot-status.pending").count() !== pendingCountBeforeBulkPaste) {
                  throw new Error("opening bulk dialog changed drafts before confirmation");
                }
                await page.evaluate(() => {
                  const text = window.__androidBulkMatrixClipboardText ?? "";
                  navigator.clipboard.readText = () => new Promise((resolve) => {
                    setTimeout(() => resolve(text), 150);
                  });
                });
                await bulkDialog.getByRole("button", { name: "读取系统剪贴板", exact: true }).click();
                await bulkDialog.getByRole("button", { name: "取消", exact: true }).click();
                await bulkDialog.waitFor({ state: "hidden", timeout: 5_000 });
                await poolRegion.getByRole("button", { name: "批量配置 10 个 API", exact: true }).click();
                await bulkDialog.waitFor({ state: "visible", timeout: 5_000 });
                await page.waitForTimeout(250);
                const cancelledReadState = await bulkDialog.evaluate((dialog) => ({
                  previewCount: dialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
                  textareaValue: dialog.querySelector("#android-fhl-bulk-api-input")?.value ?? "",
                  confirmDisabled: dialog.querySelector('[data-audit-id="fhl-bulk-confirm"]')?.disabled ?? false,
                  visibleText: dialog.textContent ?? "",
                }));
                if (
                  cancelledReadState.previewCount !== 0
                  || cancelledReadState.textareaValue !== ""
                  || !cancelledReadState.confirmDisabled
                  || cancelledReadState.visibleText.includes("有效 10")
                ) {
                  throw new Error("cancelled clipboard read repopulated the reopened bulk dialog");
                }
                await page.evaluate(() => {
                  const text = window.__androidBulkMatrixClipboardText ?? "";
                  navigator.clipboard.readText = async () => text;
                });
                await bulkDialog.getByRole("button", { name: "读取系统剪贴板", exact: true }).click();
                await page.waitForFunction(() => document.querySelectorAll(".android-fhl-bulk-preview-row").length === 10);
                const compactPasteInput = await bulkDialog.locator("#android-fhl-bulk-api-input").evaluate((element) => ({
                  value: element.value,
                  rows: element.rows,
                  placeholder: element.getAttribute("placeholder") ?? "",
                  height: element.getBoundingClientRect().height,
                  resize: getComputedStyle(element).resize,
                }));
                if (
                  compactPasteInput.value !== ""
                  || compactPasteInput.rows !== 2
                  || compactPasteInput.placeholder !== "已识别 10 个 API，需修改请重新粘贴覆盖"
                  || compactPasteInput.height > 66
                  || compactPasteInput.resize !== "none"
                ) {
                  throw new Error(`bulk dialog input is not compact or sanitized: ${JSON.stringify(compactPasteInput)}`);
                }
                await bulkDialog.locator("#android-fhl-bulk-api-input").evaluate((element) => {
                  const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
                  Object.defineProperty(pasteEvent, "clipboardData", {
                    value: { getData: () => "invalid replacement" },
                  });
                  element.dispatchEvent(pasteEvent);
                });
                await page.waitForFunction(() => document.querySelectorAll(".android-fhl-bulk-preview-row").length === 0);
                const invalidReplacementState = await bulkDialog.evaluate((dialog) => ({
                  confirmDisabled: dialog.querySelector('[data-audit-id="fhl-bulk-confirm"]')?.disabled ?? false,
                  previewCount: dialog.querySelectorAll(".android-fhl-bulk-preview-row").length,
                  value: dialog.querySelector("#android-fhl-bulk-api-input")?.value ?? "",
                }));
                if (
                  !invalidReplacementState.confirmDisabled
                  || invalidReplacementState.previewCount !== 0
                  || invalidReplacementState.value !== ""
                ) {
                  throw new Error(`invalid re-paste retained the previous batch: ${JSON.stringify(invalidReplacementState)}`);
                }
                await bulkDialog.locator("#android-fhl-bulk-api-input").evaluate((element) => {
                  const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
                  Object.defineProperty(pasteEvent, "clipboardData", {
                    value: { getData: () => window.__androidBulkMatrixClipboardText ?? "" },
                  });
                  element.dispatchEvent(pasteEvent);
                });
                await page.waitForFunction(() => document.querySelectorAll(".android-fhl-bulk-preview-row").length === 10);
                const replacementMasks = await bulkDialog.locator(".android-fhl-bulk-preview-row").allTextContents();
                if (replacementMasks.length !== 10 || replacementMasks.some((text) => !/FHL\d+sk-\*{12}/.test(text.replace(/\s+/g, "")))) {
                  throw new Error("valid re-paste did not replace the batch with ten fixed masks");
                }
                const maskedPreview = await bulkDialog.locator(".android-fhl-bulk-preview-row").allTextContents();
                if (maskedPreview.length !== 10 || maskedPreview.some((text) => !/FHL\d+sk-\*{12}/.test(text.replace(/\s+/g, "")))) {
                  throw new Error("bulk dialog did not render ten fixed masked previews");
                }
                const dialogLeakAudit = await bulkDialog.evaluate((dialog) => {
                  const keys = Array.from(new Set(
                    (window.__androidBulkMatrixClipboardText ?? "")
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter((line) => line.startsWith("sk-")),
                  ));
                  const attributeValues = [...dialog.querySelectorAll("*")].flatMap((element) => (
                    [...element.attributes].map((attribute) => attribute.value)
                  ));
                  const controlValues = [...dialog.querySelectorAll("input, textarea")].map((element) => element.value);
                  const surface = [dialog.innerText, dialog.textContent, dialog.outerHTML, ...attributeValues, ...controlValues].join("\n");
                  return {
                    fullKeyLeakCount: keys.filter((key) => surface.includes(key)).length,
                    tailLeakCount: keys.filter((key) => surface.includes(key.slice(-8))).length,
                  };
                });
                if (dialogLeakAudit.fullKeyLeakCount !== 0 || dialogLeakAudit.tailLeakCount !== 0) {
                  throw new Error(`bulk dialog leaked synthetic API material: ${JSON.stringify(dialogLeakAudit)}`);
                }
                await page.screenshot({
                  path: path.join(outRoot, `${suffix}-bulk-dialog.png`),
                  fullPage: true,
                });
                const dialogScrollBody = bulkDialog.locator(".android-fhl-bulk-dialog-body");
                await dialogScrollBody.evaluate((element) => {
                  element.scrollTop = element.scrollHeight;
                });
                await page.waitForTimeout(50);
                const dialogReachability = await bulkDialog.evaluate((dialog) => {
                  const body = dialog.querySelector(".android-fhl-bulk-dialog-body");
                  const preview = dialog.querySelector(".android-fhl-bulk-preview");
                  const actions = dialog.querySelector(".android-fhl-bulk-actions");
                  if (preview) preview.scrollTop = preview.scrollHeight;
                  const previewRect = preview?.getBoundingClientRect();
                  const actionsRect = actions?.getBoundingClientRect();
                  const lastPreviewRect = preview?.lastElementChild?.getBoundingClientRect();
                  return {
                    bodyScrolled: (body?.scrollTop ?? 0) > 0 || (body?.scrollHeight ?? 0) <= (body?.clientHeight ?? 0),
                    previewVisible: Boolean(previewRect && previewRect.bottom > 0 && previewRect.top < innerHeight),
                    actionsVisible: Boolean(actionsRect && actionsRect.top >= 0 && actionsRect.bottom <= innerHeight),
                    lastPreviewVisible: Boolean(
                      previewRect
                      && lastPreviewRect
                      && lastPreviewRect.top >= previewRect.top
                      && lastPreviewRect.bottom <= previewRect.bottom + 1
                    ),
                  };
                });
                if (
                  !dialogReachability.bodyScrolled
                  || !dialogReachability.previewVisible
                  || !dialogReachability.actionsVisible
                  || !dialogReachability.lastPreviewVisible
                ) {
                  throw new Error(`bulk dialog controls or preview are unreachable: ${JSON.stringify(dialogReachability)}`);
                }
                await bulkDialog.getByRole("button", { name: "取消", exact: true }).click();
                await bulkDialog.waitFor({ state: "hidden", timeout: 5_000 });
                if (await page.locator(".android-fhl-slot-status.pending").count() !== pendingCountBeforeBulkPaste) {
                  throw new Error("cancelling bulk dialog changed drafts");
                }
                await poolRegion.getByRole("button", { name: "批量配置 10 个 API", exact: true }).click();
                await bulkDialog.locator("#android-fhl-bulk-api-input").evaluate((element) => {
                  const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
                  Object.defineProperty(pasteEvent, "clipboardData", {
                    value: {
                      getData: () => window.__androidBulkMatrixClipboardText ?? "",
                    },
                  });
                  element.dispatchEvent(pasteEvent);
                });
                await page.waitForFunction(() => document.querySelectorAll(".android-fhl-bulk-preview-row").length === 10);
                if (await bulkDialog.locator("#android-fhl-bulk-api-input").inputValue() !== "") {
                  throw new Error("manual paste left raw API text in the dialog input DOM value");
                }
                await bulkDialog.getByRole("button", { name: "确认预填 10 个", exact: true }).click();
                await page.waitForFunction(() => document.querySelectorAll(".android-fhl-slot-status.pending").length === 10);
                const afterBulkPaste = await page.evaluate(() => {
                  const state = window.__imageStudioDebug?.getState();
                  const message = document.querySelector(".android-fhl-pool-message.success")?.textContent ?? "";
                  return {
                    profileCount: Array.isArray(state?.profiles) ? state.profiles.length : -1,
                    groupCount: Object.values(state?.jobGroupsByWorkspace ?? {})
                      .reduce((total, groups) => total + (Array.isArray(groups) ? groups.length : 0), 0),
                    pendingCount: document.querySelectorAll(".android-fhl-slot-status.pending").length,
                    expandedInputCount: document.querySelectorAll("[data-fhl-pool-slot]").length,
                    summarySafe: message.includes("已预填 10")
                      && message.includes("空行 1")
                      && message.includes("重复 1")
                      && message.includes("无效行 15")
                      && message.includes("忽略 2"),
                  };
                });
                if (afterBulkPaste.profileCount !== beforeBulkPaste.profileCount) {
                  throw new Error("bulk paste changed persisted profile count before save");
                }
                if (afterBulkPaste.groupCount !== beforeBulkPaste.groupCount) {
                  throw new Error("bulk paste created a job group before save");
                }
                if (postRequestCount !== postCountBeforeBulkPaste) {
                  throw new Error("bulk paste emitted an upstream POST before save");
                }
                if (afterBulkPaste.pendingCount !== 10 || afterBulkPaste.expandedInputCount !== 0) {
                  throw new Error("bulk confirmation did not create ten collapsed pending drafts");
                }
                if (!afterBulkPaste.summarySafe) {
                  throw new Error("bulk paste summary did not report empty, duplicate, invalid and overflow counts");
                }
                await poolRegion.locator(".android-fhl-slot-toggle").first().click();
                const stagedDraftLeakAudit = await poolRegion.evaluate((region) => {
                  const keys = Array.from(new Set(
                    (window.__androidBulkMatrixClipboardText ?? "")
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter((line) => line.startsWith("sk-")),
                  ));
                  const attributeValues = [...region.querySelectorAll("*")].flatMap((element) => (
                    [...element.attributes].map((attribute) => attribute.value)
                  ));
                  const controlValues = [...region.querySelectorAll("input, textarea")].map((element) => element.value);
                  const surface = [region.innerText, region.textContent, region.outerHTML, ...attributeValues, ...controlValues].join("\n");
                  const input = region.querySelector("[data-fhl-pool-slot='1']");
                  return {
                    fullKeyLeakCount: keys.filter((key) => surface.includes(key)).length,
                    tailLeakCount: keys.filter((key) => surface.includes(key.slice(-8))).length,
                    inputValue: input?.value ?? "",
                    placeholder: input?.getAttribute("placeholder") ?? "",
                  };
                });
                if (
                  stagedDraftLeakAudit.fullKeyLeakCount !== 0
                  || stagedDraftLeakAudit.tailLeakCount !== 0
                  || stagedDraftLeakAudit.inputValue !== ""
                  || !stagedDraftLeakAudit.placeholder.includes("批量预填已就绪")
                ) {
                  throw new Error(`bulk staged draft leaked synthetic API material: ${JSON.stringify(stagedDraftLeakAudit)}`);
                }
              }
              await page.waitForTimeout(250);
            const metrics = await page.evaluate(() => {
              const header = document.querySelector(".app-header")?.getBoundingClientRect();
              const studio = document.querySelector(".studio")?.getBoundingClientRect();
              const firstCard = document.querySelector('[role="dialog"], .android-phone-hero, .android-canvas-shell, .history-rail, .canvas-shell')?.getBoundingClientRect();
              const nav = document.querySelector(".android-bottom-nav")?.getBoundingClientRect();
               const title = document.querySelector(".android-header-title")?.getBoundingClientRect();
               const actions = document.querySelector(".android-header-actions")?.getBoundingClientRect();
               const transport = document.querySelector('[data-audit-id="fhl-transport-mode"]')?.getBoundingClientRect();
               const transportImagesElement = document.querySelector('[data-audit-id="fhl-transport-images"]');
               const transportResponsesElement = document.querySelector('[data-audit-id="fhl-transport-responses"]');
               const transportImages = transportImagesElement?.getBoundingClientRect();
               const transportResponses = transportResponsesElement?.getBoundingClientRect();
               const dialog = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
              const css = getComputedStyle(document.documentElement);
              return {
                header,
                studio,
                firstCard,
                nav,
                 title,
                 actions,
                 transport,
                 transportImages,
                 transportResponses,
                 transportImagesPressed: transportImagesElement?.getAttribute("aria-pressed") ?? "",
                 transportResponsesPressed: transportResponsesElement?.getAttribute("aria-pressed") ?? "",
                 dialog,
                viewportWidth: window.innerWidth,
                horizontalOverflow: Math.max(
                  document.documentElement.scrollWidth,
                  document.body.scrollWidth,
                ) - window.innerWidth,
                headerSafeTop: css.getPropertyValue("--android-header-safe-top-value").trim(),
                headerHeight: css.getPropertyValue("--android-header-height").trim(),
                contentHeight: css.getPropertyValue("--android-content-height").trim(),
              };
             });
             const caseFailures = [];
             const maximumHeaderHeight = width <= 430 ? 154 : 132;
             if (!metrics.header || metrics.header.top < -1) caseFailures.push("header missing or above viewport");
             if (metrics.header && metrics.header.height > maximumHeaderHeight) {
               caseFailures.push(`header too tall: ${metrics.header.height} > ${maximumHeaderHeight}`);
             }
            if (metrics.studio && metrics.header && metrics.studio.top - metrics.header.bottom > 20) {
              caseFailures.push(`large gap after header: ${metrics.studio.top - metrics.header.bottom}`);
            }
            if (metrics.nav && metrics.nav.bottom > height + 2) caseFailures.push("bottom nav overflows viewport");
            if (metrics.title && metrics.title.width < 110) caseFailures.push(`title too narrow: ${metrics.title.width}`);
            if (metrics.horizontalOverflow > 2) caseFailures.push(`horizontal overflow: ${metrics.horizontalOverflow}`);
            if (metrics.dialog && (metrics.dialog.left < -2 || metrics.dialog.right > metrics.viewportWidth + 2)) {
              caseFailures.push("dialog overflows viewport horizontally");
            }
             if (metrics.title && metrics.actions) {
              const headerItemsOverlap =
                metrics.title.left < metrics.actions.right - 1
                && metrics.title.right > metrics.actions.left + 1
                && metrics.title.top < metrics.actions.bottom - 1
                && metrics.title.bottom > metrics.actions.top + 1;
               if (headerItemsOverlap) caseFailures.push("header title overlaps actions");
             }
             if (!metrics.transport || !metrics.transportImages || !metrics.transportResponses) {
               caseFailures.push("FHL transport selector is missing");
             } else {
               if (metrics.transport.left < -2 || metrics.transport.right > metrics.viewportWidth + 2) {
                 caseFailures.push("FHL transport selector overflows viewport");
               }
               if (metrics.transportImages.right > metrics.transportResponses.left + 1) {
                 caseFailures.push("FHL transport options overlap or are out of order");
               }
               if (metrics.transportImagesPressed !== "true" || metrics.transportResponsesPressed !== "false") {
                 caseFailures.push("FHL transport selector does not default to Images API");
               }
               if (width <= 380 && metrics.actions && metrics.transport.width < metrics.actions.width - 2) {
                 caseFailures.push("FHL transport selector does not own the narrow-screen row");
               }
             }
            if (caseFailures.length) failures.push({ suffix, theme, view, failures: caseFailures, metrics });
            await page.screenshot({ path: path.join(outRoot, `${suffix}-${view}.png`), fullPage: false });
              } catch (error) {
                failures.push(await captureViewFailure({
                  page,
                  diagnostics,
                  suffix,
                  view,
                  runtimeView,
                  width,
                  height,
                  safeTop,
                  safeBottom,
                  theme,
                  url,
                  stage: "view-setup-or-geometry",
                  error,
                }));
              }
              casesCompleted += 1;
            }
            await context.close();
          }
        }
      }
    }
  } catch (error) {
    fatalError = redact(error?.stack || error?.message || error);
    console.error(fatalError);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) stopProcessTree(server.child);
  }
  const expectedCases = viewports.length * safeTops.length * safeBottoms.length * views.length * themes.length;
  const report = {
    outRoot: reportOutRoot,
    mode: matrixMode,
    expectedCases,
    casesCompleted,
    target: {
      baseURL,
      host: "127.0.0.1",
      port: selectedPort,
      requestedPort: vitePortOverride || null,
      portAllocation: vitePortOverride ? "caller-provided-loopback-port" : "ephemeral-loopback-port",
      strictPort: true,
      provenance: "isolated loopback Vite process started by android-compat-matrix.mjs",
      command: server?.args?.map((arg) => arg.replaceAll("\\", "/")) || [],
      pid: server?.child?.pid ?? null,
      platform: "android",
    },
    serverOutput: redact(server?.getOutput() || ""),
    virtualGridMeasurements,
    failures,
    fatalError,
  };
  await fs.writeFile(path.join(outRoot, "matrix-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Android compat screenshots: ${outRoot}`);
  if (fatalError || failures.length || casesCompleted !== expectedCases) {
    console.error(`Compat matrix failures: ${failures.length}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
