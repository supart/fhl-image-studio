#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const manifestPath = path.join(repositoryRoot, "product-version.json");
const repositoryReadmePath = path.join(repositoryRoot, "README_MACOS.md");

function usage(version) {
  return `Usage: node scripts/verify-macos-release-assets.mjs [options]

Validate the complete macOS release asset set. The verifier checks SHA-256
entries, the clean source ZIP, DMG integrity and root allowlist, the mounted
application plist, Universal architectures, and its ad-hoc hardened signature.

Options:
  --assets-dir <path>  Directory containing release assets.
  --dmg <path>         DMG path override.
  --source <path>      Source ZIP path override.
  --checksums <path>   SHA256SUMS.txt path override.
  --json               Emit one machine-readable JSON result.
  -h, --help           Show this help.

Default assets directory: release-assets
Expected version: V${version}`;
}

function parseArguments(argv) {
  let assetsDirectory = path.join(repositoryRoot, "release-assets");
  let dmgPath;
  let sourcePath;
  let checksumsPath;
  let json = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "-h" || argument === "--help") {
      help = true;
    } else if (["--assets-dir", "--dmg", "--source", "--checksums"].includes(argument)) {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("-")) {
        throw new Error(`${argument} requires a path`);
      }
      if (argument === "--assets-dir") assetsDirectory = argv[index];
      if (argument === "--dmg") dmgPath = argv[index];
      if (argument === "--source") sourcePath = argv[index];
      if (argument === "--checksums") checksumsPath = argv[index];
    } else if (argument.startsWith("--assets-dir=")) {
      assetsDirectory = argument.slice("--assets-dir=".length);
    } else if (argument.startsWith("--dmg=")) {
      dmgPath = argument.slice("--dmg=".length);
    } else if (argument.startsWith("--source=")) {
      sourcePath = argument.slice("--source=".length);
    } else if (argument.startsWith("--checksums=")) {
      checksumsPath = argument.slice("--checksums=".length);
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  for (const [label, value] of [
    ["--assets-dir", assetsDirectory],
    ["--dmg", dmgPath],
    ["--source", sourcePath],
    ["--checksums", checksumsPath],
  ]) {
    if (value !== undefined && !String(value).trim()) throw new Error(`${label} requires a path`);
  }

  return { assetsDirectory, checksumsPath, dmgPath, help, json, sourcePath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const result = { code: code ?? 1, signal, stderr, stdout };
      if (code === 0 || options.allowFailure) {
        resolve(result);
        return;
      }
      const output = (stderr || stdout).trim();
      reject(new Error(
        `${commandLabel(command, args)} exited with ${code ?? signal ?? 1}`
          + (output ? `\n${output}` : ""),
      ));
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const version = String(manifest.version || "").trim();
  assert(/^\d+\.\d+\.\d+$/.test(version), `invalid product version: ${version || "<empty>"}`);
  assert(manifest.displayVersion === `V${version}`, "displayVersion must match version");
  return { manifest, version };
}

async function requireRegularFile(filePath, label, expectedName) {
  const resolvedPath = path.resolve(repositoryRoot, filePath);
  const stat = await lstat(resolvedPath).catch(() => null);
  assert(stat?.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file: ${resolvedPath}`);
  if (expectedName) assert(path.basename(resolvedPath) === expectedName, `${label} must be named ${expectedName}`);
  return resolvedPath;
}

async function validateChecksums(checksumsPath, expectedAssets) {
  const raw = await readFile(checksumsPath, "utf8");
  assert(raw.endsWith("\n"), "SHA256SUMS.txt must end with a newline");
  const lines = raw.trimEnd().split(/\r?\n/);
  assert(lines.length === expectedAssets.length, `SHA256SUMS.txt must contain exactly ${expectedAssets.length} entries`);

  const parsed = new Map();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
    assert(match, `invalid checksum line: ${line}`);
    assert(!parsed.has(match[2]), `duplicate checksum entry: ${match[2]}`);
    parsed.set(match[2], match[1]);
  }

  const sortedNames = [...parsed.keys()].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  assert(lines.every((line, index) => line.endsWith(`  ${sortedNames[index]}`)), "SHA256SUMS.txt entries must be byte-sorted by filename");

  const verified = {};
  for (const asset of expectedAssets) {
    const assetName = path.basename(asset);
    assert(parsed.has(assetName), `SHA256SUMS.txt is missing ${assetName}`);
    const actual = await sha256File(asset);
    assert(parsed.get(assetName) === actual, `SHA-256 mismatch for ${assetName}`);
    verified[assetName] = actual;
  }
  return verified;
}

function parseJsonOutput(output, label) {
  try {
    const parsed = JSON.parse(output.trim());
    assert(parsed.ok === true, `${label} did not report success`);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} returned invalid JSON: ${error.message}`);
    throw error;
  }
}

async function detachDiskImage(mountPoint) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const detached = await run("/usr/bin/hdiutil", ["detach", mountPoint, "-quiet"], { allowFailure: true });
    if (detached.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  const forced = await run("/usr/bin/hdiutil", ["detach", mountPoint, "-force", "-quiet"], { allowFailure: true });
  assert(forced.code === 0, `unable to detach mounted DMG at ${mountPoint}: ${(forced.stderr || forced.stdout).trim()}`);
}

async function validateMountedDmg(dmgPath) {
  await run("/usr/bin/hdiutil", ["verify", dmgPath]);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fhl-dmg-check-"));
  const mountPoint = path.join(temporaryDirectory, "volume");
  let attached = false;

  try {
    await run("/bin/mkdir", [mountPoint]);
    await run("/usr/bin/hdiutil", [
      "attach",
      dmgPath,
      "-readonly",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      mountPoint,
      "-quiet",
    ]);
    attached = true;

    const entries = await readdir(mountPoint);
    entries.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const expectedEntries = ["Applications", "FHL Studio.app", "README_MACOS.md"];
    assert(
      entries.length === expectedEntries.length && entries.every((entry, index) => entry === expectedEntries[index]),
      `DMG root must contain only ${expectedEntries.join(", ")}; got ${entries.join(", ") || "nothing"}`,
    );

    const applicationsPath = path.join(mountPoint, "Applications");
    const applicationsStat = await lstat(applicationsPath);
    assert(applicationsStat.isSymbolicLink(), "DMG Applications entry must be a symbolic link");
    assert(await readlink(applicationsPath) === "/Applications", "DMG Applications link must target /Applications");

    const readmePath = path.join(mountPoint, "README_MACOS.md");
    const readmeStat = await lstat(readmePath);
    assert(readmeStat.isFile() && !readmeStat.isSymbolicLink() && readmeStat.size > 0, "DMG README_MACOS.md must be a non-empty regular file");
    const [packagedReadme, repositoryReadme] = await Promise.all([
      readFile(readmePath),
      readFile(repositoryReadmePath),
    ]);
    assert(packagedReadme.equals(repositoryReadme), "DMG README_MACOS.md does not match the release source");

    const appPath = path.join(mountPoint, "FHL Studio.app");
    const appStat = await lstat(appPath);
    assert(appStat.isDirectory() && !appStat.isSymbolicLink(), "DMG FHL Studio.app must be a real app bundle");
    const appVerification = await run(process.execPath, [
      path.join(repositoryRoot, "scripts", "verify-local-macos-release.mjs"),
      "--json",
      "--app",
      appPath,
    ]);

    return {
      app: parseJsonOutput(appVerification.stdout, "mounted app verifier"),
      entries,
      readmeSha256: createHash("sha256").update(packagedReadme).digest("hex"),
    };
  } finally {
    if (attached) await detachDiskImage(mountPoint);
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function verify(options, version) {
  if (process.platform !== "darwin") throw new Error("macOS release asset verification must run on Darwin");

  const assetsDirectory = path.resolve(repositoryRoot, options.assetsDirectory);
  const assetsDirectoryStat = await lstat(assetsDirectory).catch(() => null);
  assert(assetsDirectoryStat?.isDirectory() && !assetsDirectoryStat.isSymbolicLink(), `assets directory must be a real directory: ${assetsDirectory}`);

  const dmgName = `FHL-Image-Studio-Desktop-V${version}-macOS-Universal.dmg`;
  const sourceName = `FHL-Image-Studio-Desktop-V${version}-Source.zip`;
  const dmgPath = await requireRegularFile(options.dmgPath ?? path.join(assetsDirectory, dmgName), "DMG", dmgName);
  const sourcePath = await requireRegularFile(options.sourcePath ?? path.join(assetsDirectory, sourceName), "source ZIP", sourceName);
  const checksumsPath = await requireRegularFile(options.checksumsPath ?? path.join(assetsDirectory, "SHA256SUMS.txt"), "checksums", "SHA256SUMS.txt");

  const checksums = await validateChecksums(checksumsPath, [dmgPath, sourcePath]);
  const sourceVerification = await run(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-release-source.mjs"),
    "--json",
    "--zip",
    sourcePath,
  ]);
  const dmgVerification = await validateMountedDmg(dmgPath);

  return {
    ok: true,
    assetsDirectory,
    checksums,
    checksumsPath,
    dmg: {
      path: dmgPath,
      sha256: checksums[dmgName],
      ...dmgVerification,
    },
    source: parseJsonOutput(sourceVerification.stdout, "source verifier"),
    version,
  };
}

function printHumanResult(result) {
  console.log("macOS release asset verification passed.");
  console.log(`Assets: ${result.assetsDirectory}`);
  console.log(`Version: ${result.version}`);
  console.log(`DMG SHA-256: ${result.dmg.sha256}`);
  console.log(`Source SHA-256: ${result.source.sha256}`);
  console.log(`DMG contents: ${result.dmg.entries.join(", ")}`);
  console.log(`Architectures: ${result.dmg.app.architectures.join(", ")}`);
  console.log(`Signing: ${result.dmg.app.signing.signature}, hardened runtime enabled`);
  console.log(`Checksums: ${result.checksumsPath}`);
}

let wantsJson = process.argv.includes("--json");

try {
  const { version } = await readManifest();
  const options = parseArguments(process.argv.slice(2));
  wantsJson = options.json;
  if (options.help) {
    console.log(usage(version));
  } else {
    const result = await verify(options, version);
    if (options.json) console.log(JSON.stringify(result));
    else printHumanResult(result);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`macOS release asset verification failed: ${message}`);
  process.exitCode = 1;
}
