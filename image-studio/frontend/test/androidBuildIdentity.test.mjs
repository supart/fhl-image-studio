import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(testDir, "..");

test("Android service identity is derived from version, commit and explicit build ID", () => {
  const viteConfig = fs.readFileSync(path.join(frontendRoot, "vite.config.ts"), "utf8");
  const platformVite = fs.readFileSync(path.join(frontendRoot, "scripts", "platform-vite.mjs"), "utf8");

  assert.match(viteConfig, /isAndroidWebViewTarget\s*\?\s*`android-\$\{androidBuildVersion\}-\$\{androidGitCommit\}-\$\{androidBuildId\}`/);
  assert.match(platformVite, /IMAGE_STUDIO_ANDROID_VERSION_NAME/);
  assert.match(platformVite, /IMAGE_STUDIO_GIT_COMMIT/);
  assert.match(platformVite, /IMAGE_STUDIO_BUILD_ID/);
  assert.match(platformVite, /\["--config", path\.join\(projectRoot, "vite\.config\.ts"\)\]/);
});

test("random service identity remains outside the Android build branch", () => {
  const viteConfig = fs.readFileSync(path.join(frontendRoot, "vite.config.ts"), "utf8");
  const androidBranch = viteConfig.match(/const serviceInstanceId = isAndroidWebViewTarget([\s\S]*?);/);

  assert.ok(androidBranch, "service identity branch was not found");
  assert.match(androidBranch[1], /androidBuildVersion/);
  assert.match(androidBranch[1], /androidGitCommit/);
  assert.match(androidBranch[1], /androidBuildId/);
  assert.match(androidBranch[1], /:\s*`vite-\$\{Date\.now\(\)/);
});

test("Android verifier inspects the built APK service identity", () => {
  const verifier = fs.readFileSync(path.resolve(frontendRoot, "..", "..", "scripts", "verify-android-v2.0.3.ps1"), "utf8");

  assert.match(verifier, /Read-AndroidServiceIdentity/);
  assert.match(verifier, /debug-service-identity/);
  assert.match(verifier, /debug-random-service-identity-absent/);
  assert.match(verifier, /IMAGE_STUDIO_GIT_COMMIT/);
  assert.match(verifier, /IMAGE_STUDIO_BUILD_ID/);
});

test("Android Kotlin lambdas avoid nondeterministic D8 synthetic checksums", () => {
  const gradle = fs.readFileSync(path.resolve(frontendRoot, "..", "..", "android-shell", "app", "build.gradle.kts"), "utf8");

  assert.match(gradle, /-Xlambdas=class/);
  assert.match(gradle, /-Xsam-conversions=class/);
});
