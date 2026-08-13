import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const safetyScript = fileURLToPath(
  new URL("../../../scripts/check-android-release-safety.ps1", import.meta.url),
);
const safetySource = readFileSync(safetyScript, "utf8");

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function writeZip(sourceDirectory, destination) {
  const zipDestination = destination.toLowerCase().endsWith(".zip") ? destination : `${destination}.zip`;
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "& { param($source, $destination) Compress-Archive -LiteralPath $source -DestinationPath $destination -Force }",
      sourceDirectory,
      zipDestination,
    ],
    sourceDirectory,
  );
  if (zipDestination !== destination) renameSync(zipDestination, destination);
}

function scan(root, sourceZip, apk, attachments, report) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      safetyScript,
      "-Root",
      root,
      "-SourceZipPath",
      sourceZip,
      "-ApkPath",
      apk,
      "-AttachmentsRoot",
      attachments,
      "-OutputJson",
      report,
    ],
    { encoding: "utf8" },
  );
}

test("Android public safety gate covers worktree, reachable blobs, source ZIP, APK, and attachments", () => {
  assert.match(safetySource, /\[string\]\$SourceZipPath/);
  assert.match(safetySource, /\[string\]\$ApkPath/);
  assert.match(safetySource, /\[string\]\$AttachmentsRoot/);
  assert.match(safetySource, /Invoke-GitText -Arguments @\("rev-list", "HEAD"\)/);
  assert.match(safetySource, /function Add-GitBlobToSection/);
  assert.match(safetySource, /\$process\.StandardOutput\.BaseStream\.CopyToAsync\(\$memory\)/);
  assert.match(safetySource, /Add-ZipToSection -Section \$report\.sourceZip/);
  assert.match(safetySource, /Add-ZipToSection -Section \$report\.apk/);
  assert.match(safetySource, /Get-ChildItem -LiteralPath \$resolvedAttachments -Recurse -Force -File/);
  assert.match(safetySource, /\[int\]\$Section\.readErrors/);
  assert.match(safetySource, /\$workspacePathPattern = \[regex\]::Escape/);
  assert.match(safetySource, /'I:' \+ \[IO\.Path\]::DirectorySeparatorChar \+ 'AI'/);
});

test("Android public safety gate permits explicit synthetic values and rejects secrets in every artifact boundary", () => {
  const temp = mkdtempSync(join(tmpdir(), "android-release-safety-"));
  try {
    const repo = join(temp, "repo");
    const sourceContent = join(temp, "source-content");
    const apkContent = join(temp, "apk-content");
    const attachments = join(temp, "attachments");
    mkdirSync(repo);
    mkdirSync(sourceContent);
    mkdirSync(apkContent);
    mkdirSync(attachments);

    run("git", ["init", "--initial-branch=main"], repo);
    run("git", ["config", "user.name", "Safety Fixture"], repo);
    run("git", ["config", "user.email", "safety@example.invalid"], repo);
    writeFileSync(join(repo, "README.md"), "fixture with sk-synthetic-placeholder-00000000000000000000\n");
    run("git", ["add", "README.md"], repo);
    run("git", ["commit", "-m", "safe synthetic fixture"], repo);

    writeFileSync(join(sourceContent, "source.txt"), "Bearer synthetic-placeholder-token-000000000000\n");
    writeFileSync(join(apkContent, "classes.txt"), "api_key='fixture-placeholder-value-000000'\n");
    writeFileSync(join(attachments, "README.txt"), "dummy test attachment\n");
    const sourceZip = join(temp, "source.zip");
    const apk = join(temp, "app.apk");
    writeZip(sourceContent, sourceZip);
    writeZip(apkContent, apk);

    const safeReport = join(temp, "safe.json");
    const safe = scan(repo, sourceZip, apk, attachments, safeReport);
    const safeJson = JSON.parse(readFileSync(safeReport, "utf8"));
    assert.equal(safe.status, 0, JSON.stringify(safeJson));
    assert.equal(safeJson.status, "passed");
    assert.equal(safeJson.issueCount, 0);

    const suspiciousKey = ["sk", "a".repeat(40)].join("-");
    const suspiciousBearer = ["Bearer", "b".repeat(40)].join(" ");
    const suspiciousPassword = `storePassword='${"c".repeat(24)}'`;
    writeFileSync(join(repo, "historical.txt"), `${suspiciousKey}\n`);
    run("git", ["add", "historical.txt"], repo);
    run("git", ["commit", "-m", "historical unsafe fixture"], repo);
    rmSync(join(repo, "historical.txt"));
    run("git", ["add", "-A"], repo);
    run("git", ["commit", "-m", "remove visible fixture"], repo);

    writeFileSync(join(sourceContent, "source.txt"), `${suspiciousBearer}\n`);
    writeFileSync(join(apkContent, "classes.txt"), `${suspiciousPassword}\n`);
    writeFileSync(join(attachments, "private-session.log"), `${suspiciousKey}\n`);
    rmSync(sourceZip);
    rmSync(apk);
    writeZip(sourceContent, sourceZip);
    writeZip(apkContent, apk);

    const unsafeReport = join(temp, "unsafe.json");
    const unsafe = scan(repo, sourceZip, apk, attachments, unsafeReport);
    assert.equal(unsafe.status, 1, "the gate must reject suspicious release material");
    const unsafeJson = JSON.parse(readFileSync(unsafeReport, "utf8"));
    assert.equal(unsafeJson.status, "failed");
    assert.ok(unsafeJson.gitReachable.secretPatternFiles >= 1);
    assert.ok(unsafeJson.sourceZip.secretPatternFiles >= 1);
    assert.ok(unsafeJson.apk.secretPatternFiles >= 1);
    assert.ok(unsafeJson.attachments.secretPatternFiles >= 1);
    assert.ok(unsafeJson.attachments.privateLogFiles >= 1);

    const privateWorkspacePath = ["I:", "AI", "Image-Studio", "private-worktree", "report.json"].join("\\");
    writeFileSync(join(repo, "local-path.txt"), `${privateWorkspacePath}\n`);
    const localPathReport = join(temp, "local-path.json");
    const localPath = scan(repo, sourceZip, apk, attachments, localPathReport);
    assert.equal(localPath.status, 1, "the gate must reject this machine's private workspace path");
    const localPathJson = JSON.parse(readFileSync(localPathReport, "utf8"));
    assert.ok(localPathJson.root.privatePathFiles >= 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
