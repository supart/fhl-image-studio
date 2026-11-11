import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/android-release.yml", import.meta.url), "utf8");

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
}

test("Android release filenames use a validated calendar date instead of a stale hardcoded date", () => {
  assert.match(workflow, /release_date:\s*\n\s*description: Release artifact date \(YYYYMMDD\)/);
  assert.match(workflow, /RELEASE_DATE: \$\{\{ inputs\.release_date \}\}/);
  const verify = step("Verify immutable build identity");
  assert.ok(verify.includes('[[ "$RELEASE_DATE" =~ ^[0-9]{8}$ ]]'));
  assert.ok(verify.includes('date --date="${RELEASE_DATE:0:4}-${RELEASE_DATE:4:2}-${RELEASE_DATE:6:2}" +%Y%m%d'));
  assert.ok(verify.includes('test "$NORMALIZED_RELEASE_DATE" = "$RELEASE_DATE"'));
  const pack = step("Package review artifacts");
  assert.ok(pack.includes('Android-Release-${RELEASE_DATE}"'));
  assert.ok(pack.includes('Android-Source-${RELEASE_DATE}.zip"'));
  assert.doesNotMatch(pack, /20261109/);
});

test("Android final artifact scanning blocks upload and includes every public attachment boundary", () => {
  assert.ok(workflow.indexOf("Package review artifacts") < workflow.indexOf("Scan final release artifacts"));
  assert.ok(workflow.indexOf("Scan final release artifacts") < workflow.indexOf("Upload review artifacts"));
  const scan = step("Scan final release artifacts");
  assert.match(scan, /shell: pwsh/);
  assert.match(scan, /check-android-release-safety\.ps1 -Root "\$PWD"/);
  for (const argument of ["ZipPath", "SourceZipPath", "ApkPath", "AttachmentsRoot"]) {
    assert.match(scan, new RegExp(`-${argument} "dist(?:/[^"\\n]+)?"`));
  }
  assert.match(scan, /-OutputJson \(Join-Path \$env:RUNNER_TEMP "android-release-safety\.json"\)/);
  assert.doesNotMatch(scan, /continue-on-error:|if:\s*always\(\)/);
  const upload = step("Upload review artifacts");
  assert.match(upload, /path: dist\/\*/);
  assert.doesNotMatch(upload, /RUNNER_TEMP|android-release-safety\.json/);
});

test("Android review workflow preserves exact release identity and read-only manual publishing boundary", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /\bpush:|contents: write|action-gh-release|gh release create/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.ok(step("Verify immutable build identity").includes('test "$RELEASE_VERSION_NAME" = "V2.0.5"'));
  assert.ok(step("Verify immutable build identity").includes('test "$RELEASE_VERSION_CODE" = "1050005"'));
  assert.match(step("Verify APK contract and release certificate"), /6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36/);
  assert.match(step("Package review artifacts"), /git archive[^\n]+ HEAD/);
});
