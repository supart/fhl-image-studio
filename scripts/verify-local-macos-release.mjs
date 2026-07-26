import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appBundle = resolve(process.argv[2] || join(root, "image-studio/build/bin/FHL Studio.app"));
const dmgPath = resolve(process.argv[3] || join(root, "release-assets/FHL-Image-Studio-Desktop-V2.0.3-macOS-AppleSilicon.dmg"));
const plistPath = join(appBundle, "Contents/Info.plist");

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env || {}) },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

async function plistValue(key) {
  const result = await run("plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  return result.stdout.trim();
}

await access(appBundle, constants.R_OK);
await access(dmgPath, constants.R_OK);
const executableName = await plistValue("CFBundleExecutable");
const executable = join(appBundle, "Contents/MacOS", executableName);
const cli = join(appBundle, "Contents/Resources/runtime/cli/gptcodex-image");
const wrapper = join(appBundle, "Contents/Resources/image-cli");
for (const path of [executable, cli, wrapper]) await access(path, constants.X_OK);

const [identifier, version, minimumSystem, category] = await Promise.all([
  plistValue("CFBundleIdentifier"),
  plistValue("CFBundleShortVersionString"),
  plistValue("LSMinimumSystemVersion"),
  plistValue("LSApplicationCategoryType"),
]);
if (identifier !== "top.fangtangyuan.fhlstudio") throw new Error(`unexpected bundle identifier: ${identifier}`);
if (version !== "2.0.3") throw new Error(`unexpected version: ${version}`);
if (minimumSystem !== "13.0") throw new Error(`unexpected minimum macOS: ${minimumSystem}`);
if (category !== "public.app-category.graphics-design") throw new Error(`unexpected category: ${category}`);

const lipo = await run("lipo", ["-archs", executable]);
if (lipo.stdout.trim() !== "arm64") throw new Error(`application is not arm64-only: ${lipo.stdout.trim()}`);
const cliLipo = await run("lipo", ["-archs", cli]);
if (cliLipo.stdout.trim() !== "arm64") throw new Error(`CLI is not arm64-only: ${cliLipo.stdout.trim()}`);

await run("codesign", ["--verify", "--deep", "--strict", appBundle]);
const entitlementDump = await run("codesign", ["-d", "--entitlements", ":-", appBundle]);
const entitlementOutput = `${entitlementDump.stdout}\n${entitlementDump.stderr}`;
const plistStart = entitlementOutput.indexOf("<?xml");
const plistEnd = entitlementOutput.indexOf("</plist>");
if (plistStart < 0 || plistEnd < plistStart) throw new Error("signed application has no readable entitlements");
const signedEntitlements = entitlementOutput.slice(plistStart, plistEnd + "</plist>".length);
const normalizedEntitlements = await run(
  "plutil",
  ["-convert", "json", "-o", "-", "-"],
  { input: signedEntitlements },
);
const parsedEntitlements = JSON.parse(normalizedEntitlements.stdout);
if (parsedEntitlements["com.apple.security.cs.allow-unsigned-executable-memory"] !== true) {
  throw new Error("signed application does not permit the Wazero AVIF executable-memory fallback");
}
await run("hdiutil", ["verify", dmgPath]);

const checkRoot = await mkdtemp(join(tmpdir(), "fhl-cli-release-check-"));
try {
  const config = join(appBundle, "Contents/Resources/config/cli.env.example");
  const input = join(checkRoot, "input");
  const output = join(checkRoot, "output");
  const logs = join(checkRoot, "logs");
  const status = await run(cli, [
    "--status", "--json", "--no-input",
    "--config", config,
    "--input-dir", input,
    "--out-dir", output,
    "--raw-dir", logs,
  ]);
  const lines = status.stdout.trim().split(/\r?\n/).filter(Boolean);
  const parsed = JSON.parse(lines.at(-1));
  if (!/^v?2\.0\.3$/i.test(String(parsed.packageVersion || ""))) {
    throw new Error(`CLI version mismatch: ${parsed.packageVersion}`);
  }
  if (parsed.apiKeyConfigured !== false) throw new Error("release CLI unexpectedly contains an API Key");
} finally {
  await rm(checkRoot, { recursive: true, force: true });
}

const plist = await readFile(plistPath, "utf8");
if (!plist.includes("NSAllowsLocalNetworking")) throw new Error("Info.plist does not allow the local RunningHub bridge");

console.log(JSON.stringify({
  appBundle,
  dmgPath,
  architecture: "arm64",
  bundleIdentifier: identifier,
  version,
  minimumSystem,
  codesign: "ad-hoc hardened runtime verified",
  executableMemoryEntitlement: "verified",
  dmg: "verified",
  cliStatus: "verified",
}, null, 2));
