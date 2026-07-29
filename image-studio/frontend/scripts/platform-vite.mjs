import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
const env = { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "1", VITE_TARGET_PLATFORM: mode };
// Browser fallback credentials are origin-scoped, so keep the local dev origin stable.
const devHost = process.env.IMAGE_STUDIO_DEV_HOST?.trim() || "127.0.0.1";

if (command === "build") {
  await run("node_modules/typescript/bin/tsc", ["--noEmit"], env);
  await run("node_modules/vite/bin/vite.js", ["build", "--mode", mode], env);
} else if (command === "dev") {
  await run("node_modules/vite/bin/vite.js", ["--mode", mode, "--host", devHost], env);
} else {
  throw new Error(`Unsupported command: ${command}`);
}
