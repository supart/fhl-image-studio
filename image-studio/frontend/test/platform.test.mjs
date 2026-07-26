import assert from "node:assert/strict";
import test from "node:test";

const realWindow = globalThis.window;
const realDocument = globalThis.document;
const realNavigator = globalThis.navigator;

function installPlatformEnv({ width, height, userAgent, platform = "Linux armv8l", uaDataPlatform = "Android", search = "" }) {
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    location: { search },
    addEventListener() {},
    removeEventListener() {},
    visualViewport: {
      addEventListener() {},
      removeEventListener() {},
    },
  };
  globalThis.document = {
    documentElement: {
      dataset: {},
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent,
      platform,
      userAgentData: { platform: uaDataPlatform },
    },
  });
}

async function withPlatformEnv(env, run) {
  try {
    installPlatformEnv(env);
    return await run();
  } finally {
    globalThis.window = realWindow;
    globalThis.document = realDocument;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: realNavigator,
    });
  }
}

function loadPlatformModule() {
  return import(`../src/platform/index.ts?platform-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("Android compact portrait stays on phone target", async () => {
  await withPlatformEnv({
    width: 412,
    height: 915,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
  }, async () => {
    const platform = await loadPlatformModule();
    assert.equal(platform.targetPlatformForViewport(), "android");
    assert.equal(platform.readRuntimePlatformState().isAndroidPhone, true);
    assert.equal(platform.readRuntimePlatformState().isAndroidPad, false);
  });
});

test("Android medium width landscape upgrades to pad target", async () => {
  await withPlatformEnv({
    width: 700,
    height: 520,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Tablet)",
  }, async () => {
    const platform = await loadPlatformModule();
    assert.equal(platform.targetPlatformForViewport(), "android-pad");
    assert.equal(platform.readRuntimePlatformState().isAndroidPad, true);
  });
});

test("Android medium width portrait remains phone target", async () => {
  await withPlatformEnv({
    width: 700,
    height: 1024,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Tablet)",
  }, async () => {
    const platform = await loadPlatformModule();
    assert.equal(platform.targetPlatformForViewport(), "android");
    assert.equal(platform.readRuntimePlatformState().isAndroidPhone, true);
  });
});

test("Android expanded width portrait upgrades to pad target and applies attributes", async () => {
  await withPlatformEnv({
    width: 900,
    height: 1280,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Foldable)",
  }, async () => {
    const platform = await loadPlatformModule();
    platform.applyPlatformAttributes(globalThis.document.documentElement);
    assert.equal(platform.targetPlatformForViewport(), "android-pad");
    assert.equal(globalThis.document.documentElement.dataset.platform, "android");
    assert.equal(globalThis.document.documentElement.dataset.targetPlatform, "android-pad");
    assert.equal(globalThis.document.documentElement.dataset.uiFamily, "android");
  });
});

test("Linux desktop shares the Fluent UI family", async () => {
  await withPlatformEnv({
    width: 1440,
    height: 900,
    platform: "Linux x86_64",
    uaDataPlatform: "Linux",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
  }, async () => {
    const platform = await loadPlatformModule();
    platform.applyPlatformAttributes(globalThis.document.documentElement);
    const state = platform.readRuntimePlatformState();
    assert.equal(state.platform, "linux");
    assert.equal(state.uiFamily, "fluent");
    assert.equal(state.usesFluentUI, true);
    assert.equal(globalThis.document.documentElement.dataset.uiFamily, "fluent");
  });
});

test("macOS keeps the Apple UI family", async () => {
  await withPlatformEnv({
    width: 1440,
    height: 900,
    platform: "MacIntel",
    uaDataPlatform: "macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/605.1.15",
  }, async () => {
    const platform = await loadPlatformModule();
    const state = platform.readRuntimePlatformState();
    assert.equal(state.platform, "macos");
    assert.equal(state.uiFamily, "apple");
    assert.equal(state.usesFluentUI, false);
    assert.equal(state.usesAppleUI, true);
  });
});

test("macOS Windows parity keeps Mac host capabilities with Fluent presentation", async () => {
  await withPlatformEnv({
    width: 1440,
    height: 900,
    platform: "MacIntel",
    uaDataPlatform: "macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 13_0) AppleWebKit/605.1.15",
    search: "?ui=windows-parity",
  }, async () => {
    const platform = await loadPlatformModule();
    platform.applyPlatformAttributes(globalThis.document.documentElement);
    const state = platform.readRuntimePlatformState();
    assert.equal(state.hostPlatform, "macos");
    assert.equal(state.presentationPlatform, "windows");
    assert.equal(state.isMacHost, true);
    assert.equal(state.isWindowsHost, false);
    assert.equal(state.usesWindowsDesktopUI, true);
    assert.equal(state.usesFluentUI, true);
    assert.equal(platform.submitShortcutLabel, "⌘Enter");
    assert.equal(globalThis.document.documentElement.dataset.platform, "macos");
    assert.equal(globalThis.document.documentElement.dataset.presentationPlatform, "windows");
  });
});
test("platform-vite enables Node env proxy for local preview upstream proxies", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../scripts/platform-vite.mjs", import.meta.url), "utf8");
  assert.match(source, /NODE_USE_ENV_PROXY:\s*process\.env\.NODE_USE_ENV_PROXY\s*\|\|\s*"1"/);
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /env,/);
});

test("platform-vite keeps browser-backed dev profiles on one loopback origin", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../scripts/platform-vite.mjs", import.meta.url), "utf8");
  assert.match(source, /IMAGE_STUDIO_DEV_HOST\?\.trim\(\)\s*\|\|\s*"127\.0\.0\.1"/);
  assert.match(source, /\["--mode", mode, "--host", devHost\]/);
});
