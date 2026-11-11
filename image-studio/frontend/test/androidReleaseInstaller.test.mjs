import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const installer = path.join(root, "scripts/install-android-release-candidate.ps1");
const certificate = "6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36";
const source = fs.readFileSync(installer, "utf8");

test("formal installer keeps UI, credentials and destructive operations out of its installation channel", () => {
  assert.match(source, /caller_must_read_fresh_screen_and_verify_package_through_mcp/);
  assert.match(source, /caller_confirmed_isolated_idle_baseline/);
  assert.match(source, /apk_v2_signature_missing/);
  assert.match(source, /installed_candidate_apk_hash_mismatch/);
  assert.doesNotMatch(source, /@\(['"](?:uninstall|clear|logcat|input|forward)['"]/);
  assert.doesNotMatch(source, /['"]run-as['"]|Runtime\.evaluate|__imageStudioNative/);
  assert.doesNotMatch(source, /Write-(?:Output|Host).*\$(?:DeviceSerial|LeaseId)/);
});

test("formal installer rejects unsafe inputs before any ADB invocation", { skip: process.platform !== "win32" }, () => {
  const scratchRoot = path.join(root, ".tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(scratchRoot, "release-installer-gates-"));
  const marker = path.join(fixtureRoot, "adb-called.txt");
  const apk = path.join(fixtureRoot, "fixture.apk");
  const adb = path.join(fixtureRoot, "adb-fixture.cmd");
  const signer = path.join(fixtureRoot, "signer-fixture.cmd");
  const analyzer = path.join(fixtureRoot, "analyzer-fixture.cmd");
  const payload = Buffer.from("not an installable APK; fixture only", "utf8");
  const hash = createHash("sha256").update(payload).digest("hex");
  fs.writeFileSync(apk, payload);
  fs.writeFileSync(adb, `@echo off\r\necho called>"${marker}"\r\nexit /b 73\r\n`);
  const writeSigner = (digest = certificate, v2 = true) => fs.writeFileSync(signer, `@echo off\r\necho Signer #1 certificate SHA-256 digest: ${digest.toLowerCase()}\r\necho Verified using v2 scheme ^(APK Signature Scheme v2^): ${v2}\r\n`);
  writeSigner();
  const writeAnalyzer = ({ minSdk = 28, debuggable = "false" } = {}) => fs.writeFileSync(analyzer, `@echo off\r\nif "%~2"=="application-id" echo top.fangtangyuan.fhlstudio.android\r\nif "%~2"=="version-name" echo V2.0.5\r\nif "%~2"=="version-code" echo 1050005\r\nif "%~2"=="min-sdk" echo ${minSdk}\r\nif "%~2"=="target-sdk" echo 34\r\n${debuggable ? `if "%~2"=="debuggable" echo ${debuggable}\r\n` : ""}exit /b 0\r\n`);
  writeAnalyzer();
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const defaults = {
    ApkPath: apk,
    ExpectedApkSha256: hash,
    ExpectedVersionName: "V2.0.5",
    ExpectedVersionCode: "1050005",
    ExpectedCertificateSha256: certificate,
    Scenario: "Fresh",
    DeviceId: "codex_api36",
    DeviceSerial: "127.0.0.1:5555",
    LeaseId: "fixture-placeholder-lease",
    AdbPath: adb,
    ApkSignerPath: signer,
    ApkAnalyzerPath: analyzer,
  };
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  function check(overrides, category, { parameterFailure = false, confirmIdle = false } = {}) {
    const values = { ...defaults, ...overrides };
    const command = `& ${quote(installer)} ${Object.entries(values).map(([key, value]) => `-${key} ${quote(value)}`).join(" ")}${confirmIdle ? " -ConfirmedIsolatedIdleBaseline" : ""}`;
    const child = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
      encoding: "utf8", windowsHide: true, timeout: 30000,
    });
    assert.equal(child.error, undefined, category);
    assert.notEqual(child.status, 0, category);
    assert.equal(fs.existsSync(marker), false, `${category}: must not invoke ADB`);
    if (!parameterFailure) {
      const result = JSON.parse(child.stdout.trim());
      assert.equal(result.failureCategory, category);
      assert.equal(result.packageInstalled, false);
      assert.equal(result.credentialRead, false);
      assert.equal(result.appOpened, false);
      assert.doesNotMatch(child.stdout, /fixture-placeholder-lease|127\.0\.0\.1|release-installer-gates-/);
    }
  }
  try {
    check({ ExpectedCertificateSha256: "0".repeat(64) }, "official_certificate_pin_mismatch");
    check({ DeviceSerial: "emulator-5554", ExpectedCertificateSha256: "0".repeat(64) }, "official_certificate_pin_mismatch");
    check({ DeviceSerial: "192.0.2.1:5555" }, "non-loopback transport", { parameterFailure: true });
    check({ DeviceSerial: "127.0.0.1:65536" }, "mcp_loopback_transport_port_rejected");
    check({ ApkPath: path.join(os.tmpdir(), "outside-project.apk") }, "project_path_rejected");
    check({ ExpectedApkSha256: "0".repeat(64) }, "candidate_apk_hash_mismatch");
    check({ Scenario: "Upgrade" }, "upgrade_requires_caller_confirmed_idle_baseline");
    check({ Scenario: "Upgrade" }, "upgrade_requires_baseline_hash", { confirmIdle: true });
    writeSigner("0".repeat(64));
    check({}, "apk_certificate_mismatch");
    writeSigner(certificate, false);
    check({}, "apk_v2_signature_missing");
    writeSigner();
    writeAnalyzer({ debuggable: "true" });
    check({}, "apk_debuggable_or_unproven");
    writeAnalyzer({ debuggable: "" });
    check({}, "apk_debuggable_or_unproven");
    writeAnalyzer({ minSdk: 27 });
    check({}, "apk_sdk_contract_mismatch");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
