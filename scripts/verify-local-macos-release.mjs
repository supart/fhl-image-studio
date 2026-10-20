#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultBundlePath = path.join(
  repositoryRoot,
  "image-studio",
  "build",
  "bin",
  "FHL Studio.app",
);
const productVersionPath = path.join(repositoryRoot, "product-version.json");
const wailsConfigPath = path.join(repositoryRoot, "image-studio", "wails.json");

const expectedBundleIdentifier = "top.fangtangyuan.fhlstudio";
const expectedReleaseVersion = "2.0.4";
const expectedMinimumSystemVersion = "13.0";
const expectedApplicationCategory = "public.app-category.graphics-design";
const expectedDesktopUIVariant = "windows-parity";
const expectedVisualBaseline = "macos-v2.0.3-windows-parity";
const requiredHeaderPromotionFileName = "顶部推广信息.txt";
const requiredHeaderPromotionMaxBytes = 16 * 1024;
const requiredJitEntitlement = "com.apple.security.cs.allow-unsigned-executable-memory";

function usage() {
  return `Usage: node scripts/verify-local-macos-release.mjs [options] [app-path]

Validate an already-built macOS application bundle. This command never builds,
signs, or modifies the application.

Options:
  --app <path>   Validate this .app instead of the repository default.
  --json         Emit one machine-readable JSON result.
  -h, --help     Show this help.

Environment:
  FHL_MACOS_APP_BUNDLE  Alternate app path (overridden by --app).

Relative app paths are resolved from the repository root. The default is:
  image-studio/build/bin/FHL Studio.app`;
}

function parseArguments(argv) {
  let appPath;
  let json = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "-h" || argument === "--help") {
      help = true;
    } else if (argument === "--app") {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("-")) {
        throw new Error("--app requires a path");
      }
      if (appPath !== undefined) {
        throw new Error("Specify the app bundle only once");
      }
      appPath = argv[index];
    } else if (argument.startsWith("--app=")) {
      if (appPath !== undefined) {
        throw new Error("Specify the app bundle only once");
      }
      appPath = argument.slice("--app=".length);
      if (appPath.length === 0) {
        throw new Error("--app requires a path");
      }
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (appPath === undefined) {
      appPath = argument;
    } else {
      throw new Error("Specify the app bundle only once");
    }
  }

  const environmentPath = process.env.FHL_MACOS_APP_BUNDLE?.trim();
  const selectedPath = appPath ?? environmentPath ?? defaultBundlePath;
  const source = appPath !== undefined
    ? "argument"
    : environmentPath
      ? "environment"
      : "default";

  return { appPath: selectedPath, help, json, source };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
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

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

async function readJson(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }
}

function versionsMatch(left, right) {
  const normalize = (value) => {
    assert(typeof value === "string" && /^\d+(?:\.\d+)*$/.test(value), `Invalid version: ${value}`);
    const components = value.split(".").map(Number);
    while (components.length > 1 && components.at(-1) === 0) {
      components.pop();
    }
    return components.join(".");
  };
  return normalize(left) === normalize(right);
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function resolveBundlePath(selectedPath, source) {
  assert(typeof selectedPath === "string" && selectedPath.trim().length > 0, "App path is empty");
  const requestedPath = path.resolve(repositoryRoot, selectedPath);
  assert(path.extname(requestedPath).toLowerCase() === ".app", `App path must end in .app: ${requestedPath}`);

  let bundleStat;
  try {
    bundleStat = await lstat(requestedPath);
  } catch (error) {
    throw new Error(`App bundle not found at ${requestedPath}: ${error.message}`);
  }
  assert(!bundleStat.isSymbolicLink(), `App bundle path must not be a symbolic link: ${requestedPath}`);
  assert(bundleStat.isDirectory(), `App bundle path is not a directory: ${requestedPath}`);

  const resolvedPath = await realpath(requestedPath);
  if (source === "default") {
    const resolvedRepositoryRoot = await realpath(repositoryRoot);
    assert(
      isWithin(resolvedRepositoryRoot, resolvedPath),
      `Default app bundle resolves outside the repository: ${resolvedPath}`,
    );
  }

  return { requestedPath, resolvedPath };
}

async function readPlistAsJson(plistPath, label, input) {
  const arguments_ = ["-convert", "json", "-o", "-", input === undefined ? plistPath : "-"];
  const converted = await run("/usr/bin/plutil", arguments_, { input });
  try {
    return JSON.parse(converted.stdout);
  } catch (error) {
    throw new Error(`${label} did not convert to JSON: ${error.message}`);
  }
}

async function validateBundleMetadata(appBundle, productVersion, wailsConfig) {
  const version = productVersion.version;
  const displayVersion = productVersion.displayVersion;
  const wailsVersion = wailsConfig.info?.productVersion;
  const productName = wailsConfig.info?.productName;
  const executableName = wailsConfig.outputfilename;

  assert(version === expectedReleaseVersion, `product-version.json must declare ${expectedReleaseVersion}; got ${version}`);
  assert(displayVersion === `V${version}`, `product-version.json displayVersion must be V${version}; got ${displayVersion}`);
  assert(wailsVersion === version, `wails.json productVersion ${wailsVersion} does not match ${version}`);
  assert(typeof productName === "string" && productName.length > 0, "wails.json info.productName is missing");
  assert(typeof executableName === "string" && executableName.length > 0, "wails.json outputfilename is missing");
  assert(path.basename(executableName) === executableName, `Unsafe wails.json outputfilename: ${executableName}`);

  const contentsDirectory = path.join(appBundle, "Contents");
  const macOSDirectory = path.join(contentsDirectory, "MacOS");
  const resourcesDirectory = path.join(contentsDirectory, "Resources");
  const plistPath = path.join(contentsDirectory, "Info.plist");

  for (const [label, directory] of [
    ["Contents", contentsDirectory],
    ["Contents/MacOS", macOSDirectory],
    ["Contents/Resources", resourcesDirectory],
  ]) {
    const directoryStat = await lstat(directory).catch(() => null);
    assert(directoryStat?.isDirectory(), `App bundle is missing ${label}: ${directory}`);
  }

  await run("/usr/bin/plutil", ["-lint", plistPath]);
  const plist = await readPlistAsJson(plistPath, "Info.plist");

  assert(plist.CFBundlePackageType === "APPL", `CFBundlePackageType must be APPL; got ${plist.CFBundlePackageType}`);
  assert(plist.CFBundleName === productName, `CFBundleName must be ${productName}; got ${plist.CFBundleName}`);
  assert(plist.CFBundleExecutable === executableName, `CFBundleExecutable must be ${executableName}; got ${plist.CFBundleExecutable}`);
  assert(plist.CFBundleIdentifier === expectedBundleIdentifier, `CFBundleIdentifier must be ${expectedBundleIdentifier}; got ${plist.CFBundleIdentifier}`);
  assert(plist.CFBundleShortVersionString === version, `CFBundleShortVersionString must be ${version}; got ${plist.CFBundleShortVersionString}`);
  assert(plist.CFBundleVersion === version, `CFBundleVersion must be ${version}; got ${plist.CFBundleVersion}`);
  assert(
    versionsMatch(plist.LSMinimumSystemVersion, expectedMinimumSystemVersion),
    `LSMinimumSystemVersion must be ${expectedMinimumSystemVersion}; got ${plist.LSMinimumSystemVersion}`,
  );
  assert(
    plist.LSApplicationCategoryType === expectedApplicationCategory,
    `LSApplicationCategoryType must be ${expectedApplicationCategory}; got ${plist.LSApplicationCategoryType}`,
  );
  assert(plist.NSHighResolutionCapable === true, "NSHighResolutionCapable must be the boolean true");
  assert(
    plist.NSAppTransportSecurity?.NSAllowsLocalNetworking === true,
    "NSAppTransportSecurity.NSAllowsLocalNetworking must be the boolean true",
  );
  assert(
    plist.FHLDesktopUIVariant === expectedDesktopUIVariant,
    `FHLDesktopUIVariant must be ${expectedDesktopUIVariant}; got ${plist.FHLDesktopUIVariant}`,
  );
  assert(
    plist.FHLVisualBaseline === expectedVisualBaseline,
    `FHLVisualBaseline must be ${expectedVisualBaseline}; got ${plist.FHLVisualBaseline}`,
  );

  const iconName = plist.CFBundleIconFile;
  assert(typeof iconName === "string" && iconName.length > 0, "CFBundleIconFile is missing");
  assert(path.basename(iconName) === iconName, `Unsafe CFBundleIconFile value: ${iconName}`);
  const iconFileName = path.extname(iconName) ? iconName : `${iconName}.icns`;
  const iconPath = path.join(resourcesDirectory, iconFileName);
  const iconStat = await lstat(iconPath).catch(() => null);
  assert(iconStat?.isFile(), `Bundle icon is missing: ${iconPath}`);

  const headerPromotionPath = path.join(resourcesDirectory, requiredHeaderPromotionFileName);
  const headerPromotionStat = await lstat(headerPromotionPath).catch(() => null);
  assert(headerPromotionStat?.isFile(), `Header promotion resource is missing: ${headerPromotionPath}`);
  assert(
    headerPromotionStat.size <= requiredHeaderPromotionMaxBytes,
    `Header promotion resource exceeds ${requiredHeaderPromotionMaxBytes} bytes: ${headerPromotionPath}`,
  );
  await access(headerPromotionPath, fsConstants.R_OK);

  const executablePath = path.join(macOSDirectory, plist.CFBundleExecutable);
  const executableStat = await lstat(executablePath).catch(() => null);
  assert(executableStat?.isFile(), `Main executable is missing: ${executablePath}`);
  await access(executablePath, fsConstants.X_OK);

  return {
    executablePath,
    expected: {
      bundleIdentifier: expectedBundleIdentifier,
      category: expectedApplicationCategory,
      executableName,
      minimumSystemVersion: expectedMinimumSystemVersion,
      productName,
      desktopUIVariant: expectedDesktopUIVariant,
      version,
      visualBaseline: expectedVisualBaseline,
    },
    headerPromotion: {
      fileName: requiredHeaderPromotionFileName,
      path: headerPromotionPath,
      size: headerPromotionStat.size,
    },
    iconPath,
    plist: {
      bundleIdentifier: plist.CFBundleIdentifier,
      bundleName: plist.CFBundleName,
      bundleVersion: plist.CFBundleVersion,
      category: plist.LSApplicationCategoryType,
      desktopUIVariant: plist.FHLDesktopUIVariant,
      executable: plist.CFBundleExecutable,
      highResolutionCapable: plist.NSHighResolutionCapable,
      iconFile: plist.CFBundleIconFile,
      localNetworkingAllowed: plist.NSAppTransportSecurity.NSAllowsLocalNetworking,
      minimumSystemVersion: plist.LSMinimumSystemVersion,
      shortVersion: plist.CFBundleShortVersionString,
      visualBaseline: plist.FHLVisualBaseline,
    },
  };
}

async function validateArchitectures(executablePath) {
  const lipo = await run("/usr/bin/lipo", ["-archs", executablePath]);
  const architectures = [...new Set(lipo.stdout.trim().split(/\s+/).filter(Boolean))].sort();
  const expectedArchitectures = ["arm64", "x86_64"];
  assert(
    architectures.length === expectedArchitectures.length
      && expectedArchitectures.every((architecture) => architectures.includes(architecture)),
    `Main executable architectures must be exactly ${expectedArchitectures.join(", ")}; got ${architectures.join(", ") || "none"}`,
  );
  return architectures;
}

function extractSigningField(output, field) {
  return output.match(new RegExp(`^${field}=(.+)$`, "m"))?.[1]?.trim();
}

async function validateSigning(appBundle) {
  const verification = await run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appBundle,
  ]);
  const details = await run("/usr/bin/codesign", [
    "-dvvv",
    "--xml",
    "--entitlements",
    "-",
    appBundle,
  ]);
  const detailOutput = `${details.stderr}\n${details.stdout}`;
  const identifier = extractSigningField(detailOutput, "Identifier");
  const signature = extractSigningField(detailOutput, "Signature");
  const flagsLine = detailOutput.match(/^CodeDirectory .+ flags=0x[0-9a-f]+\(([^)]*)\)/mi)?.[1] ?? "";
  const flags = flagsLine.split(",").map((flag) => flag.trim()).filter(Boolean);
  const hardenedRuntime = flags.includes("runtime") || /^Runtime Version=/m.test(detailOutput);
  const adHoc = signature === "adhoc" || flags.includes("adhoc");

  assert(identifier === expectedBundleIdentifier, `Signing identifier must be ${expectedBundleIdentifier}; got ${identifier}`);
  assert(adHoc, `Expected an ad-hoc signature; got ${signature ?? flagsLine ?? "unknown"}`);
  assert(hardenedRuntime, "Hardened runtime signing flag is missing");

  const entitlements = await readPlistAsJson("-", "Code signature entitlements", details.stdout);
  assert(
    entitlements[requiredJitEntitlement] === true,
    `${requiredJitEntitlement} entitlement must be the boolean true`,
  );

  return {
    adHoc,
    entitlementAllowUnsignedExecutableMemory: entitlements[requiredJitEntitlement],
    hardenedRuntime,
    identifier,
    signature: signature ?? "adhoc",
    verificationOutput: (verification.stderr || verification.stdout).trim(),
  };
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function buildBundleManifest(appBundle) {
  const entries = [];
  const counts = { directories: 0, files: 0, symbolicLinks: 0 };

  async function visit(directory, relativeDirectory = "") {
    const children = await readdir(directory);
    children.sort(compareUtf8);

    for (const name of children) {
      const absolutePath = path.join(directory, name);
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, name)
        : name;
      const stat = await lstat(absolutePath);

      if (stat.isDirectory()) {
        entries.push(["directory", relativePath]);
        counts.directories += 1;
        await visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        entries.push(["file", relativePath, await sha256File(absolutePath)]);
        counts.files += 1;
      } else if (stat.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        entries.push(["symlink", relativePath, sha256Text(target)]);
        counts.symbolicLinks += 1;
      } else {
        throw new Error(`Unsupported filesystem entry in app bundle: ${absolutePath}`);
      }
    }
  }

  await visit(appBundle);
  entries.sort((left, right) => compareUtf8(left[1], right[1]));
  const canonicalManifest = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

  return {
    counts,
    entryCount: entries.length,
    sha256: sha256Text(canonicalManifest),
  };
}

async function inspectGatekeeper(appBundle) {
  const result = await run("/usr/sbin/spctl", ["-a", "-vv", "--type", "execute", appBundle], {
    allowFailure: true,
  });
  return {
    accepted: result.code === 0,
    exitCode: result.code,
    output: (result.stderr || result.stdout).trim(),
    policy: "Informational only: ad-hoc local builds are not expected to satisfy Gatekeeper distribution trust.",
  };
}

async function verify(options) {
  const productVersion = await readJson(productVersionPath, "product-version.json");
  const wailsConfig = await readJson(wailsConfigPath, "wails.json");
  const bundlePaths = await resolveBundlePath(options.appPath, options.source);
  const metadata = await validateBundleMetadata(bundlePaths.resolvedPath, productVersion, wailsConfig);
  const architectures = await validateArchitectures(metadata.executablePath);
  const signing = await validateSigning(bundlePaths.resolvedPath);
  const executableSha256 = await sha256File(metadata.executablePath);
  const bundleManifest = await buildBundleManifest(bundlePaths.resolvedPath);
  const gatekeeper = await inspectGatekeeper(bundlePaths.resolvedPath);

  return {
    ok: true,
    appBundle: bundlePaths.resolvedPath,
    appPathSource: options.source,
    architectures,
    executable: metadata.executablePath,
    expected: metadata.expected,
    gatekeeper,
    headerPromotion: metadata.headerPromotion,
    hashes: {
      algorithm: "SHA-256",
      bundleContents: bundleManifest.sha256,
      bundleManifest: {
        ...bundleManifest,
        definition: "UTF-8 JSON-array lines sorted by POSIX relative-path bytes; directories record type/path, files record type/path/content SHA-256, symlinks record type/path/SHA-256 of the UTF-8 link target; final newline included.",
      },
      mainExecutable: executableSha256,
    },
    plist: metadata.plist,
    signing,
  };
}

function printHumanResult(result) {
  console.log("macOS application verification passed.");
  console.log(`App: ${result.appBundle}`);
  console.log(`Executable: ${result.executable}`);
  console.log(`Architectures: ${result.architectures.join(", ")}`);
  console.log(`Bundle ID: ${result.plist.bundleIdentifier}`);
  console.log(`Version: ${result.plist.shortVersion}`);
  console.log(`Minimum macOS: ${result.plist.minimumSystemVersion}`);
  console.log(`Desktop UI variant: ${result.plist.desktopUIVariant}`);
  console.log(`Visual baseline: ${result.plist.visualBaseline}`);
  console.log(`Header promotion: ${result.headerPromotion.path} (${result.headerPromotion.size} bytes)`);
  console.log(`Signing: ${result.signing.signature}, hardened runtime enabled`);
  console.log(`Executable SHA-256: ${result.hashes.mainExecutable}`);
  console.log(`Bundle contents SHA-256: ${result.hashes.bundleContents}`);
  const gatekeeperState = result.gatekeeper.accepted ? "accepted" : "not accepted (expected for ad-hoc builds)";
  console.log(`Gatekeeper: ${gatekeeperState}`);
  if (result.gatekeeper.output) {
    console.log(result.gatekeeper.output);
  }
}

const wantsJson = process.argv.slice(2).includes("--json");

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    const result = await verify(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanResult(result);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(`macOS application verification failed: ${message}`);
  }
  process.exitCode = 1;
}
