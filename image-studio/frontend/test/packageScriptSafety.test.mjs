import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sourceRoot = new URL("../../..", import.meta.url);

function assertBefore(source, earlier, later, message) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assert.notEqual(earlierIndex, -1, `missing prerequisite: ${earlier}`);
  assert.notEqual(laterIndex, -1, `missing protected action: ${later}`);
  assert.ok(earlierIndex < laterIndex, message);
}

function workflowJob(source, name) {
  const start = source.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing workflow job: ${name}`);
  const remainder = source.slice(start + 1);
  const next = remainder.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? remainder : remainder.slice(0, next + 1);
}

test("Windows packaging uses explicit tools and exact current-build artifacts", async () => {
  const script = await readFile(
    new URL("scripts/package-windows-portable.ps1", sourceRoot),
    "utf8",
  );

  assert.match(script, /\[string\]\$GoExe\s*=\s*""/);
  assert.match(script, /\[string\]\$WailsExe\s*=\s*""/);
  assert.match(script, /Resolve-ToolCommand "go" \$GoExe/);
  assert.match(script, /Resolve-ToolCommand "wails" \$WailsExe/);
  assert.match(script, /Assert-StrictChildPath \$ReleaseAssets \$PackageRoot/);
  assert.match(script, /LastWriteTimeUtc -lt \$BuildStartedAt/);

  assert.doesNotMatch(script, /V1\.0\.0|待确认可删除|旧工作区/);
  assert.doesNotMatch(script, /LegacyBuiltExe|build\\bin\\fhl-studio\.exe/);
  assert.doesNotMatch(script, /Get-WailsCommand|knownCandidates/);
});

test("portable and source packages preserve the optional editable header promotion TXT", async () => {
  const [portable, sourcePackage] = await Promise.all([
    readFile(new URL("scripts/package-windows-portable.ps1", sourceRoot), "utf8"),
    readFile(new URL("scripts/prepare-release-source.ps1", sourceRoot), "utf8"),
  ]);

  assert.match(portable, /Copy-IfExists \(Join-Path \$Root "顶部推广信息\.txt"\) \(Join-Path \$PackageRoot "顶部推广信息\.txt"\)/);
  assert.match(sourcePackage, /"顶部推广信息\.txt"/);
  assert.doesNotMatch(portable, /Set-Content[^\n]+顶部推广信息\.txt/);
  assert.doesNotMatch(sourcePackage, /Set-Content[^\n]+顶部推广信息\.txt/);
});

test("release workflow publishes the portable zip without an installer toolchain", async () => {
  const [workflow, manifest] = await Promise.all([
    readFile(new URL(".github/workflows/release.yml", sourceRoot), "utf8"),
    readFile(new URL("product-version.json", sourceRoot), "utf8").then(JSON.parse),
  ]);

  assert.match(workflow, new RegExp(manifest.windowsTag.replaceAll(".", "\\.")));
  assert.match(workflow, /REQUESTED_TAG.*windowsTag/s);
  assert.match(workflow, /package-windows-portable\.ps1/);
  assert.doesNotMatch(workflow, /nsis|package-windows-installer|Windows-Setup/i);
});

test("CI uses exact desktop Go packages and keeps build and hygiene gates", async () => {
  const workflow = await readFile(new URL(".github/workflows/ci.yml", sourceRoot), "utf8");
  const goWindowsJob = workflowJob(workflow, "go-windows");
  const desktopStep = goWindowsJob.match(
    /- name: Vet and test desktop[\s\S]*?(?=\n\s{2}[a-z][a-z-]+:|\n\s{6}- name:|$)/,
  )?.[0];
  assert.ok(desktopStep, "desktop vet/test step is missing");
  assert.match(desktopStep, /go vet \. \.\/backend/);
  assert.match(desktopStep, /go test \. \.\/backend/);
  assert.doesNotMatch(desktopStep, /go (?:vet|test) \.\/\.\.\./);

  assert.match(goWindowsJob, /npm run build:windows/);
  assert.match(workflowJob(workflow, "frontend-targets"), /npm run build:\$\{\{ matrix\.target \}\}/);

  const wailsJob = workflowJob(workflow, "wails-windows");
  assertBefore(
    wailsJob,
    "sync-version-metadata.mjs --check",
    "wails build -platform windows/amd64",
    "Wails CI must check version metadata before building",
  );

  const hygieneJob = workflowJob(workflow, "release-hygiene");
  assertBefore(
    hygieneJob,
    "sync-version-metadata.mjs --check",
    ".\\scripts\\check-compliance-package.ps1 -Root .",
    "release hygiene must check version metadata before scanning the source package",
  );
});

test("portable and source packaging fail on version drift before output side effects", async () => {
  const [portable, sourcePackage] = await Promise.all([
    readFile(new URL("scripts/package-windows-portable.ps1", sourceRoot), "utf8"),
    readFile(new URL("scripts/prepare-release-source.ps1", sourceRoot), "utf8"),
  ]);
  const portableBody = portable.slice(portable.indexOf("$Root = Resolve-SourceRoot"));
  const sourceBody = sourcePackage.slice(sourcePackage.indexOf("$Root = Resolve-SourceRoot"));

  for (const action of [
    "Ensure-Dir $ReleaseAssets",
    "Build-CliRuntime $Root $GoCommand",
    "Remove-Item -LiteralPath $PackageRoot",
    "Copy-Item -LiteralPath $BuiltExe",
    "Compress-Archive -LiteralPath $PackageRoot",
  ]) {
    assertBefore(
      portableBody,
      "sync-version-metadata.mjs\") --check",
      action,
      `portable version check must run before ${action}`,
    );
  }

  for (const action of [
    "Ensure-Dir $ReleaseRoot",
    "Remove-Item -LiteralPath $StageRoot",
    "Copy-IfExists (Join-Path $Root $file)",
    "Copy-Tree (Join-Path $Root $dir)",
  ]) {
    assertBefore(
      sourceBody,
      "sync-version-metadata.mjs\") --check",
      action,
      `source version check must run before ${action}`,
    );
  }
});

test("release identity validation precedes packaging and publication", async () => {
  const workflow = await readFile(new URL(".github/workflows/release.yml", sourceRoot), "utf8");
  for (const action of [
    "Install Wails CLI",
    "package-windows-portable.ps1",
    "actions/upload-artifact@v4",
    "softprops/action-gh-release@v2",
  ]) {
    assertBefore(
      workflow,
      "sync-version-metadata.mjs --check",
      action,
      `release identity must be validated before ${action}`,
    );
  }
});
