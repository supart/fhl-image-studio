import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const powerShellCommand = process.platform === "win32" ? "powershell.exe" : "pwsh";
const sourceRoot = new URL("../../..", import.meta.url);
const helperPath = decodeURIComponent(new URL("scripts/portable-photoshop-integration.ps1", sourceRoot).pathname)
  .replace(/^\/(\w:)/, "$1")
  .replaceAll("/", "\\");
const packageScript = await readFile(new URL("scripts/package-windows-portable.ps1", sourceRoot), "utf8");
const integrationHelper = await readFile(new URL("scripts/portable-photoshop-integration.ps1", sourceRoot), "utf8");
const portableLauncherBytes = await readFile(new URL("scripts/portable-windows-launcher.ps1", sourceRoot));
const sourceRootPath = fileURLToPath(sourceRoot);
const packageScriptPath = join(sourceRootPath, "scripts", "package-windows-portable.ps1");
const builtExePath = join(sourceRootPath, "image-studio", "build", "bin", "FHL Studio 方汤圆版 V2.0.4.exe");

async function hasPowerShell() {
  try {
    await execFile(powerShellCommand, ["-NoProfile", "-Command", "exit 0"]);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const powerShellAvailable = await hasPowerShell();

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPowerShell(body) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `. ${psQuote(helperPath)}`,
    body,
  ].join("\n");
  const result = await execFile(powerShellCommand, ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

test("Portable packaging generates the fixed non-sensitive Photoshop integration file", () => {
  assert.match(packageScript, /portable-photoshop-integration\.ps1/);
  assert.match(packageScript, /Write-FhlPhotoshopIntegrationMetadata/);
  assert.match(packageScript, /-FileName "FHL Studio Photoshop 对接文件\.json"/);
  assert.match(integrationHelper, /FHL Studio Photoshop 对接文件\.json/);
  assert.match(packageScript, /\.fhl-studio-portable/);
  assert.match(packageScript, /Copy-Item -LiteralPath \$BuiltExe[\s\S]*?Write-FhlPhotoshopIntegrationMetadata/);
  assert.doesNotMatch(packageScript, /apiKey|sessionToken|baseURL|credentialManager|absolutePath/i);
  assert.deepEqual([...portableLauncherBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "Portable launcher must be UTF-8 BOM for Windows PowerShell 5.1");
});

test("Portable packaging writes the integration file beside the marker in an isolated output", async (t) => {
  if (!powerShellAvailable) {
    t.skip(`requires ${powerShellCommand}`);
    return;
  }
  try {
    await access(builtExePath);
  } catch {
    t.skip("requires the existing V2.0.4 development Wails EXE fixture");
    return;
  }

  const outputRoot = await mkdtemp(join(tmpdir(), "fhl-portable-contract-"));
  try {
    await execFile(powerShellCommand, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      packageScriptPath,
      "-OutputRoot",
      outputRoot,
      "-SkipBuild",
      "-SkipCliBuild",
    ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });

    const entries = await readdir(outputRoot, { withFileTypes: true });
    const packageName = entries.find((entry) => entry.isDirectory());
    assert.ok(packageName, "isolated Portable package directory is missing");
    const packageRoot = join(outputRoot, packageName.name);
    const integrationPath = join(packageRoot, "FHL Studio Photoshop 对接文件.json");
    const metadata = JSON.parse(await readFile(integrationPath, "utf8"));
    await access(join(packageRoot, ".fhl-studio-portable"));
    assert.deepEqual(metadata, {
      productId: "fhl-image-studio-desktop",
      integrationFileFormatMajor: 1,
      psBridgeProtocolMajor: 1,
      launchPath: "FHL Studio 方汤圆版 V2.0.4.exe",
      displayName: "FHL Studio 方汤圆版",
      desktopVersion: "V2.0.4",
    });
    assert.ok(entries.some((entry) => entry.isFile() && entry.name.endsWith(".zip")), "Portable ZIP is missing");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("Portable Photoshop integration metadata validates generation, corruption, identity, protocol, traversal and upgrade", async (t) => {
  if (!powerShellAvailable) {
    t.skip(`requires ${powerShellCommand}`);
    return;
  }
  const output = await runPowerShell(`
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("fhl-ps-contract-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $exe204 = Join-Path $root 'FHL Studio 方汤圆版 V2.0.4.exe'
  New-Item -ItemType File -Path $exe204 | Out-Null
  $path204 = Write-FhlPhotoshopIntegrationMetadata -PackageRoot $root -LaunchPath 'FHL Studio 方汤圆版 V2.0.4.exe' -DesktopVersion 'V2.0.4'
  $valid = Read-FhlPhotoshopIntegrationMetadata -PackageRoot $root
  $fields = @($valid.PSObject.Properties.Name)
  $sensitive = @('apiKey', 'sessionToken', 'baseURL', 'credentialManager', 'userConfig', 'absolutePath', 'image', 'history') | Where-Object { $fields -contains $_ }
  $validResult = ($path204 -like '*FHL Studio Photoshop 对接文件.json' -and $valid.productId -eq 'fhl-image-studio-desktop' -and [int]$valid.integrationFileFormatMajor -eq 1 -and [int]$valid.psBridgeProtocolMajor -eq 1 -and $valid.launchPath -eq 'FHL Studio 方汤圆版 V2.0.4.exe' -and @($sensitive).Count -eq 0)

  Remove-Item -LiteralPath $path204 -Force
  try { Read-FhlPhotoshopIntegrationMetadata -PackageRoot $root | Out-Null; $missing = $false } catch { $missing = $true }
  Set-Content -LiteralPath $path204 -Value '{not-json' -Encoding UTF8
  try { Read-FhlPhotoshopIntegrationMetadata -PackageRoot $root | Out-Null; $format = $false } catch { $format = $true }

  $wrongProduct = New-FhlPhotoshopIntegrationMetadata -LaunchPath 'FHL Studio 方汤圆版 V2.0.4.exe' -DesktopVersion 'V2.0.4'; $wrongProduct.productId = 'other-product'
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $wrongProduct -PackageRoot $root | Out-Null; $product = $false } catch { $product = $true }
  $wrongProtocol = New-FhlPhotoshopIntegrationMetadata -LaunchPath 'FHL Studio 方汤圆版 V2.0.4.exe' -DesktopVersion 'V2.0.4'; $wrongProtocol.psBridgeProtocolMajor = 2
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $wrongProtocol -PackageRoot $root | Out-Null; $protocol = $false } catch { $protocol = $true }
  $wrongFormatType = New-FhlPhotoshopIntegrationMetadata -LaunchPath 'FHL Studio 方汤圆版 V2.0.4.exe' -DesktopVersion 'V2.0.4'; $wrongFormatType.integrationFileFormatMajor = '1'
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $wrongFormatType -PackageRoot $root | Out-Null; $formatType = $false } catch { $formatType = $true }
  $wrongProtocolType = New-FhlPhotoshopIntegrationMetadata -LaunchPath 'FHL Studio 方汤圆版 V2.0.4.exe' -DesktopVersion 'V2.0.4'; $wrongProtocolType.psBridgeProtocolMajor = '1'
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $wrongProtocolType -PackageRoot $root | Out-Null; $protocolType = $false } catch { $protocolType = $true }
  $traversal = New-FhlPhotoshopIntegrationMetadata -LaunchPath '..\\outside.exe' -DesktopVersion 'V2.0.4'
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $traversal -PackageRoot $root | Out-Null; $escape = $false } catch { $escape = $true }
  $absolute = New-FhlPhotoshopIntegrationMetadata -LaunchPath 'C:\\outside.exe' -DesktopVersion 'V2.0.4'
  try { Assert-FhlPhotoshopIntegrationMetadata -Metadata $absolute -PackageRoot $root | Out-Null; $absoluteRejected = $false } catch { $absoluteRejected = $true }

  $exe205 = Join-Path $root 'FHL Studio 方汤圆版 V2.0.5.exe'; New-Item -ItemType File -Path $exe205 | Out-Null
  $path205 = Write-FhlPhotoshopIntegrationMetadata -PackageRoot $root -LaunchPath 'FHL Studio 方汤圆版 V2.0.5.exe' -DesktopVersion 'V2.0.5'
  $upgraded = Read-FhlPhotoshopIntegrationMetadata -PackageRoot $root
  $upgradeResult = ($path205 -eq $path204 -and @($upgraded.PSObject.Properties.Name) -join ',' -eq ($fields -join ',') -and $upgraded.desktopVersion -eq 'V2.0.5')
  [pscustomobject]@{ valid = $validResult; missing = $missing; format = $format; product = $product; protocol = $protocol; formatType = $formatType; protocolType = $protocolType; traversal = $escape; absolute = $absoluteRejected; upgrade = $upgradeResult } | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
`);
  const result = JSON.parse(output.split(/\r?\n/).at(-1));
  for (const [name, value] of Object.entries(result)) {
    assert.equal(value, true, `${name} contract check failed: ${output}`);
  }
});
