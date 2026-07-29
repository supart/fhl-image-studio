import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sourceRoot = new URL("../../..", import.meta.url);

test("Windows packaging uses explicit tools and exact current-build artifacts", async () => {
  const script = await readFile(
    new URL("scripts/package-windows-portable-v2.0.3.ps1", sourceRoot),
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

test("release workflow publishes the portable zip without an installer toolchain", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/release.yml", sourceRoot),
    "utf8",
  );

  assert.match(workflow, /FHL-Image-Studio-Desktop-V2\.0\.3-Windows-Portable\.zip/);
  assert.doesNotMatch(workflow, /nsis|package-windows-installer|Windows-Setup/i);
});
