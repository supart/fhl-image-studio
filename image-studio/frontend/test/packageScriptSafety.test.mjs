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

test("manual release workflow publishes only macOS and source assets", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/release.yml", sourceRoot),
    "utf8",
  );

  assert.match(workflow, /FHL-Image-Studio-Desktop-V2\.0\.3-macOS-AppleSilicon\.dmg/);
  assert.match(workflow, /FHL-Image-Studio-Desktop-V2\.0\.3-Source\.zip/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tag_name:\s*\$\{\{ inputs\.tag \}\}/);
  assert.doesNotMatch(workflow, /push:\s*\n\s*tags:/);
  assert.doesNotMatch(workflow, /FHL-Image-Studio-Desktop-V2\.0\.3-Windows-Portable\.zip/);
  assert.doesNotMatch(workflow, /nsis|package-windows-installer|Windows-Setup/i);
});

test("macOS source launcher builds a private arm64 CLI when no binary is packaged", async () => {
  const launcher = await readFile(new URL("image-cli", sourceRoot), "utf8");

  assert.match(launcher, /build_source_cli/);
  assert.match(launcher, /\$DATA_ROOT\/runtime\/cli/);
  assert.match(launcher, /GOOS=darwin GOARCH=arm64 go build/);
  assert.match(launcher, /-buildvcs=false/);
  assert.match(launcher, /chmod 700/);
  assert.doesNotMatch(launcher, /api[_-]?key\s*=/i);
});

test("desktop platform verifier skips the optional Android shell when it is absent", async () => {
  const verifier = await readFile(
    new URL("scripts/verify-local-platform-kernel.mjs", sourceRoot),
    "utf8",
  );

  assert.match(verifier, /existsSync\(androidWrapper\)/);
  assert.match(verifier, /skipReason/);
  assert.match(verifier, /android-shell\/gradlew is not present/);
});

test("macOS release packaging pins the complete Node, Go, and Wails toolchain", async () => {
  const script = await readFile(
    new URL("scripts/package-local-macos-app.sh", sourceRoot),
    "utf8",
  );

  assert.match(script, /Expected Node v24\.13\.1/);
  assert.match(script, /Expected Go 1\.26\.3/);
  assert.match(script, /WAILS_VERSION="v2\.12\.0"/);
  assert.match(script, /FHL_REQUIRE_EXACT_TOOLCHAIN/);
  assert.match(script, /WAILS_APP_BUNDLE=.*fhl-studio\.app/);
  assert.match(script, /mv "\$WAILS_APP_BUNDLE" "\$APP_BUNDLE"/);
  assert.match(script, /CFBundleExecutable -string "\$APP_NAME"/);
  assert.match(script, /Contents\/MacOS\/\$APP_NAME/);
  assert.match(script, /ENTITLEMENTS_PATH=.*entitlements\.plist/);
  assert.match(script, /plutil -lint "\$ENTITLEMENTS_PATH"/);
  assert.match(script, /--options runtime --entitlements "\$ENTITLEMENTS_PATH"/);
});

test("macOS hardened runtime permits only the executable memory required by the AVIF fallback", async () => {
  const entitlements = await readFile(
    new URL("image-studio/build/darwin/entitlements.plist", sourceRoot),
    "utf8",
  );

  assert.match(entitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.app-sandbox/);
});
