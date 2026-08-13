import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const command = process.argv[2] ?? "dev";
const explicitMode = process.argv[3] ?? "";
const supportedModes = new Set(["macos", "windows", "linux", "android", "android-pad"]);

function mapHostPlatform(value) {
  switch (value) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "linux";
  }
}

function run(binRelativePath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, binRelativePath), ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binRelativePath} exited with code ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

const mode = explicitMode || process.env.VITE_TARGET_PLATFORM || mapHostPlatform(os.platform());
if (!supportedModes.has(mode)) {
  throw new Error(`Unsupported target platform: ${mode}. Expected one of ${Array.from(supportedModes).join(", ")}`);
}
const env = { ...process.env, VITE_TARGET_PLATFORM: mode };
const viteConfigArgs = mode === "android" || mode === "android-pad"
  ? ["--config", path.join(projectRoot, "vite.config.ts")]
  : [];
if (mode === "android" || mode === "android-pad") {
  env.IMAGE_STUDIO_ANDROID_VERSION_NAME ||= "V2.0.3";
  env.IMAGE_STUDIO_BUILD_ID ||= "local";
  if (!env.IMAGE_STUDIO_GIT_COMMIT) {
    try {
      env.IMAGE_STUDIO_GIT_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: path.resolve(projectRoot, "../.."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      env.IMAGE_STUDIO_GIT_COMMIT = "unknown-commit";
    }
  }
}

if (command === "build") {
  await run("node_modules/typescript/bin/tsc", ["--noEmit"], env);
  await run("node_modules/vite/bin/vite.js", ["build", ...viteConfigArgs, "--mode", mode], env);
} else if (command === "dev") {
  await run("node_modules/vite/bin/vite.js", [...viteConfigArgs, "--mode", mode], env);
} else {
  throw new Error(`Unsupported command: ${command}`);
}
