import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const frontendRoot = new URL("../", import.meta.url);
const sourceRoot = new URL("../../..", import.meta.url);

async function readFrontendSource(relativePath) {
  return readFile(new URL(relativePath, frontendRoot), "utf8");
}

const presentationStyleFiles = [
  "src/styles/fluent/_windows-theme.css",
  "src/styles/fluent/_windows-controls.css",
  "src/styles/fluent/_windows-compose.css",
  "src/styles/fluent/_windows-history.css",
  "src/styles/fluent/_windows-flyouts.css",
  "src/styles/fluent/_responsive.css",
];

test("Windows desktop presentation CSS is independent from the native host platform", async () => {
  for (const relativePath of presentationStyleFiles) {
    const source = await readFile(new URL(relativePath, frontendRoot), "utf8");
    assert.match(
      source,
      /data-presentation-platform="windows"/,
      `${relativePath} must opt into the Windows presentation contract`,
    );
    assert.doesNotMatch(
      source,
      /data-platform="windows"/,
      `${relativePath} must not require a Windows host`,
    );
  }
});

test("Windows presentation keeps the V2.0.3 Fluent palette and compact dimensions", async () => {
  const theme = await readFile(
    new URL("src/styles/fluent/_windows-theme.css", frontendRoot),
    "utf8",
  );

  for (const token of [
    "--accent: #005fb8",
    "--bg: #f3f3f3",
    "--panel: #fbfbfb",
    "--surface: #ffffff",
    "--accent: #60cdff",
    "--bg: #202020",
    "--panel: #2b2b2b",
    "--surface: #333333",
    "--fluent-pane-left: 360px",
    "--fluent-pane-right: 320px",
    "--card-radius: 8px",
    "--control-radius: 4px",
  ]) {
    assert.ok(theme.includes(token), `missing V2.0.3 visual token: ${token}`);
  }

  assert.match(
    theme,
    /\.app-header\s*\{[\s\S]*?min-height:\s*48px;/,
    "the desktop header must keep the compact 48px contract",
  );
  assert.match(
    theme,
    /\.workspace-bar\s*\{[\s\S]*?min-height:\s*38px;/,
    "the workspace bar must keep the compact 38px contract",
  );
  assert.match(
    theme,
    /html\[data-platform="macos"\]\[data-presentation-platform="windows"\]\[data-ui-family="fluent"\]\s+\.app-header\s*\{[\s\S]*?padding-left:\s*86px;/,
    "the macOS traffic-light inset must remain 86px",
  );
});

test("macOS development and packaging force the Windows parity desktop variant", async () => {
  const platformVite = await readFile(
    new URL("scripts/platform-vite.mjs", frontendRoot),
    "utf8",
  );
  const packageScript = await readFile(
    new URL("scripts/package-local-macos-app.sh", sourceRoot),
    "utf8",
  );

  assert.match(
    platformVite,
    /mode === "macos"\s*\?\s*"windows-parity"\s*:\s*"native"/,
  );
  assert.match(platformVite, /VITE_DESKTOP_UI_VARIANT:\s*desktopUIVariant/);
  assert.match(packageScript, /export VITE_DESKTOP_UI_VARIANT="windows-parity"/);
  assert.match(
    packageScript,
    /path\.basename\(outputFilename\)\s*!==\s*outputFilename/,
    "the packager must reject executable names with path components",
  );
});

test("Windows presentation routes every desktop shell surface through the parity flags", async () => {
  const controlPanel = await readFrontendSource("src/components/panel/ControlPanel.tsx");
  const historyRail = await readFrontendSource("src/components/history/HistoryRail.tsx");
  const toolbar = await readFrontendSource("src/components/canvas/Toolbar.tsx");
  const statusBar = await readFrontendSource("src/components/canvas/StatusBar.tsx");

  assert.match(controlPanel, /usesMacDesktopUI,\s*usesWindowsDesktopUI/);
  assert.match(controlPanel, /const compactWindowsCompose\s*=\s*usesWindowsDesktopUI/);
  assert.match(controlPanel, /compactWindowsCompose\s*\?\s*\([\s\S]*?<WindowsComposePanel/);
  assert.match(controlPanel, /compactMacCompose\s*&&\s*\([\s\S]*?<MacComposePanel/);
  assert.match(controlPanel, /usesMacDesktopUI\s*\?\s*\([\s\S]*?<MacAdvancedPanel/);
  assert.match(controlPanel, /:\s*\([\s\S]*?<DesktopAdvancedPanel/);

  assert.match(historyRail, /usesMacDesktopUI,\s*usesWindowsDesktopUI/);
  assert.match(historyRail, /if\s*\(usesWindowsDesktopUI\)\s*\{[\s\S]*?<WindowsHistoryRail/);
  assert.match(historyRail, /visibleDesktopEntries\s*=\s*usesWindowsDesktopUI/);

  assert.match(toolbar, /usesMacDesktopUI/);
  assert.match(toolbar, /if\s*\(usesMacDesktopUI\)\s*\{/);
  assert.match(statusBar, /usesMacDesktopUI,\s*usesWindowsDesktopUI/);
  assert.match(statusBar, /usesWindowsDesktopUI\s*\?\s*"statusbar"/);
  assert.match(statusBar, /if\s*\(usesMacDesktopUI\)\s*return\s+null/);
});

test("macOS host-only file operations stay keyed to isMacHost, while Windows native APIs stay keyed to isWindowsHost", async () => {
  const historyTile = await readFrontendSource("src/components/history/HistoryTile.tsx");
  const resultDetailDrawer = await readFrontendSource("src/components/panel/ResultDetailDrawer.tsx");
  const storeShared = await readFrontendSource("src/state/studioStore.shared.ts");

  assert.match(historyTile, /const\s*\{\s*isMacHost[\s\S]*?usesMacDesktopUI/);
  assert.match(historyTile, /if\s*\(isMacHost\s*&&\s*item\.savedPath\)/);
  assert.match(resultDetailDrawer, /const\s*\{\s*isMacHost[\s\S]*?usesFluentUI/);
  assert.match(resultDetailDrawer, /if\s*\(isMacHost\s*&&\s*resolvedDetail\.savedPath\)/);

  assert.match(storeShared, /import\s*\{\s*isWindowsHost\s*\}\s*from\s*"\.\.\/platform"/);
  assert.match(storeShared, /if\s*\(isWindowsHost\)\s*\{/);
  assert.doesNotMatch(storeShared, /if\s*\(isWindows\)\s*\{/);
});
