import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const verifier = readFileSync(
  new URL("../../../scripts/verify-android-public-release-emulator.mjs", import.meta.url),
  "utf8",
);

test("public Release emulator verifier uses production package and Release CDP only", () => {
  assert.match(verifier, /top\.fangtangyuan\.fhlstudio\.android/);
  assert.doesNotMatch(verifier, /top\.fangtangyuan\.fhlstudio\.android\.debug/);
  assert.match(verifier, /localabstract:webview_devtools_remote_\$\{pid\}/);
  assert.match(verifier, /debugAudit: typeof window\.AndroidEmulatorAudit !== "undefined"/);
  assert.match(verifier, /debugStore: typeof window\.__imageStudioDebug !== "undefined"/);
  assert.doesNotMatch(verifier, /AndroidEmulatorAudit\?\.|__imageStudioDebug\.getState|run-as/);
});

test("public Release verifier supports isolated Fresh and signed Upgrade installs", () => {
  assert.match(verifier, /\["Fresh", "Upgrade"\]\.includes\(scenario\)/);
  assert.match(verifier, /scenario requires an isolated AVD without the public package installed/);
  assert.match(verifier, /scenario === "Upgrade" && !baselineApkPath/);
  assert.match(verifier, /installApk\(baselineApkPath, false\)/);
  assert.match(verifier, /installApk\(apkPath, true\)/);
  assert.match(verifier, /Installed APK hash does not match the frozen public Release candidate/);
});

test("public Release startup gate observes thirty seconds and reads native jobs without submission", () => {
  assert.match(verifier, /observation-seconds", "30"/);
  assert.match(verifier, /observationSeconds < 30/);
  assert.match(verifier, /nativeInvokeExpression\("ListAndroidJobs", \[id, 700\]\)/);
  assert.match(verifier, /Startup created an automatic Group or Task/);
  assert.match(verifier, /credentialPresenceSnapshot\(client\)/);
  assert.match(verifier, /configuredProfiles !== 0/);
  assert.match(verifier, /upstream_submit_attempt\|FHL Images request\|APIMart submit request/);
  assert.match(verifier, /client\.call\("Network\.enable"/);
  assert.match(verifier, /client\.call\("Network\.enable"[\s\S]*const networkStartIndex = client\.events\.length;[\s\S]*const ready = await waitForReady/);
  assert.match(verifier, /summarizeExternalNetwork\(client, networkStartIndex\)/);
  assert.match(verifier, /externalNetwork\.count !== 0 \|\| externalNetwork\.postCount !== 0/);
  assert.doesNotMatch(verifier, /nativeInvokeExpression\("SubmitAndroidJobs"/);
});

test("public Release UI gate covers transport, quick settings, masked cancel and virtual grids", () => {
  assert.match(verifier, /ready\.images !== "true" \|\| ready\.responses !== "false"/);
  assert.match(verifier, /verifyQuickSettings\(client\)/);
  assert.match(verifier, /Page\.reload/);
  assert.match(verifier, /sk-\*\*\*\*\*\*\*\*\*\*\*\*/);
  assert.match(verifier, /fullKeyLeaks !== 0/);
  assert.match(verifier, /tailLeaks !== 0/);
  assert.match(verifier, /afterBulkCredentials\.configuredProfiles !== 0/);
  assert.match(verifier, /const GRID_COUNTS = \[30, 60, 200\]/);
  assert.match(verifier, /indexedDB\.databases/);
  assert.match(verifier, /maxMountedTiles: 2 \* \(visibleRows \+ 4\)/);
  assert.match(verifier, /cleanupSyntheticGrid\(client\)/);
});

test("public Release verifier produces redacted evidence and never embeds a usable API key", () => {
  assert.match(verifier, /PUBLIC-RELEASE-EMULATOR\.json/);
  assert.match(verifier, /if \(report\.installation && !report\.zeroRequest\)/);
  assert.match(verifier, /workspaceIdHash/);
  assert.match(verifier, /browserFingerprint/);
  assert.doesNotMatch(verifier, /sk-[A-Za-z0-9_-]{32,}/);
  assert.doesNotMatch(verifier, /apiKey\s*:/);
  assert.doesNotMatch(verifier, /Bearer\s+[A-Za-z0-9._-]+/i);
});
