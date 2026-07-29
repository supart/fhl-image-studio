import { spawn } from "node:child_process";

const root = process.cwd();
const androidSdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${root}/.tmp/android-sdk`;
const javaHome = process.env.IMAGE_STUDIO_JAVA_HOME || process.env.JAVA_HOME || `${root}/.tmp/jdk/jdk-17.0.19+10/Contents/Home`;
const androidUserHome = process.env.ANDROID_USER_HOME || `${root}/.tmp/android-home/.android`;
const homeDir = process.env.HOME || `${root}/.tmp/android-home`;

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.label} exited with code ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

const steps = [
  {
    label: "frontend test",
    cmd: "npm",
    args: ["run", "test"],
    cwd: `${root}/image-studio/frontend`,
  },
  {
    label: "frontend build",
    cmd: "npm",
    args: ["run", "build"],
    cwd: `${root}/image-studio/frontend`,
  },
  {
    label: "worker test",
    cmd: "npm",
    args: ["run", "test"],
    cwd: `${root}/cloudflare-worker`,
  },
  {
    label: "local smoke check",
    cmd: "node",
    args: ["scripts/local-smoke-check.mjs"],
    cwd: root,
  },
  {
    label: "android debug assemble",
    cmd: "./gradlew",
    args: [":app:assembleDebug"],
    cwd: `${root}/android-shell`,
    env: {
      GRADLE_USER_HOME: `${root}/.tmp/gradle-home-arm64`,
      JAVA_HOME: javaHome,
      ANDROID_HOME: androidSdkRoot,
      ANDROID_SDK_ROOT: androidSdkRoot,
      ANDROID_USER_HOME: androidUserHome,
      HOME: homeDir,
    },
  },
  {
    label: "go backend test",
    cmd: "go",
    args: ["test", "./..."],
    cwd: `${root}/image-studio`,
    env: {
      GOPATH: `${root}/.gopath`,
      GOMODCACHE: `${root}/.gomodcache`,
      GOCACHE: `${root}/.gocache`,
    },
  },
  {
    label: "local macOS release verify",
    cmd: "node",
    args: ["scripts/verify-local-macos-release.mjs"],
    cwd: root,
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.label}`);
  await runStep(step);
}

console.log("\nAll local platform-kernel verification steps passed.");
