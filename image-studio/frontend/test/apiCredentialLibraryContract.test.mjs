import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("desktop configuration has one fixed credential library and one verified wipe action", () => {
  const desktop = source("../src/components/panel/FHLDesktopAPIConfig.tsx");
  const panel = source("../src/components/panel/APICredentialLibrary.tsx");
  const clear = source("../src/lib/apiCredentialClear.ts");
  const runtime = source("../src/lib/apiCredentialClearRuntime.ts");
  const settings = source("../src/components/panel/SettingsPanel.tsx");

  assert.ok(desktop.indexOf("<APICredentialLibrary") < desktop.indexOf("<FHLTextAPIConfig"));
  assert.match(panel, /data-audit-id="api-credential-library"/);
  assert.match(panel, /本机 API 凭据库/);
  assert.match(panel, /一键清空全部 API/);
  assert.match(panel, /确认永久清空/);
  assert.match(panel, /历史记录、生成图片、工作区、预设和普通设置不会被删除/);
  assert.match(panel, /disabled=\{activeWork \|\| isClearing\}/);
  assert.match(settings, /管理 API 凭据/);

  assert.match(clear, /deleteAndVerifyAPIKeyUsers/);
  assert.match(clear, /failedUsers\.length > 0/);
  assert.ok(clear.indexOf("deleteAndVerifyAPIKeyUsers") < clear.indexOf("persistProfiles([])"));
  assert.match(clear, /clearRunningHub/);
  assert.match(clear, /clearLocalFiles/);
  assert.match(runtime, /DeleteStoredAPIKey/);
  assert.match(runtime, /GetStoredAPIKey/);
  assert.match(runtime, /clearBrowserCredentialStorage/);
  assert.match(runtime, /clearLegacyAPIKeys/);
});
