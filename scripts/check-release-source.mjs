#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const manifestPath = path.join(repositoryRoot, "product-version.json");

const maximumArchiveBytes = 512 * 1024 * 1024;
const maximumFileBytes = 64 * 1024 * 1024;
const maximumTextScanBytes = 20 * 1024 * 1024;

const textExtensions = new Set([
  "", ".bat", ".c", ".cc", ".cjs", ".cpp", ".css", ".env", ".example",
  ".go", ".h", ".hpp", ".html", ".java", ".js", ".json", ".jsonc",
  ".kt", ".kts", ".m", ".md", ".mjs", ".mm", ".plist", ".properties",
  ".ps1", ".py", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx",
  ".txt", ".xml", ".yaml", ".yml",
]);

const forbiddenFileNames = new Set([
  ".ds_store",
  "browser-jobs.v1.json",
  "cli.env.local",
  "fhl-api.local.json",
  "package-lock.json.md5",
  "package.json.md5",
  "thumbs.db",
]);

const forbiddenBinaryExtensions = new Set([
  ".7z", ".a", ".app", ".class", ".dmg", ".dll", ".dylib", ".elf",
  ".exe", ".gz", ".jar", ".msi", ".o", ".obj", ".pkg", ".rar",
  ".so", ".tar", ".tgz", ".wasm", ".xz", ".zip",
]);

const secretPatterns = [
  { label: "OpenAI-style API key", expression: /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{20,})/g, allowObviousFake: true },
  { label: "GitHub token", expression: /(?:^|[^A-Za-z0-9])(gh[pousr]_[A-Za-z0-9]{20,})/g, allowObviousFake: true },
  { label: "GitHub fine-grained token", expression: /(?:^|[^A-Za-z0-9])(github_pat_[A-Za-z0-9_]{20,})/g, allowObviousFake: true },
  { label: "Google API key", expression: /(?:^|[^A-Za-z0-9])(AIza[0-9A-Za-z_-]{30,})/g, allowObviousFake: true },
  { label: "AWS access key", expression: /(?:^|[^A-Za-z0-9])((?:AKIA|ASIA)[A-Z0-9]{16})/g, allowObviousFake: true },
  { label: "private key", expression: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g, allowObviousFake: false },
];

function usage(version) {
  return `Usage: node scripts/check-release-source.mjs [options]

Validate the macOS release source ZIP for forbidden local data, secrets,
compiled binaries, unsafe archive paths, and missing release files.

Options:
  --zip <path>  Source ZIP to validate.
  --json        Emit one machine-readable JSON result.
  -h, --help    Show this help.

Default ZIP: release-assets/FHL-Image-Studio-Desktop-V${version}-Source.zip`;
}

function parseArguments(argv, version) {
  let zipPath;
  let json = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "-h" || argument === "--help") {
      help = true;
    } else if (argument === "--zip") {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("-")) {
        throw new Error("--zip requires a path");
      }
      zipPath = argv[index];
    } else if (argument.startsWith("--zip=")) {
      zipPath = argument.slice("--zip=".length);
      if (!zipPath) throw new Error("--zip requires a path");
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (zipPath === undefined) {
      zipPath = argument;
    } else {
      throw new Error("specify the source ZIP only once");
    }
  }

  return {
    help,
    json,
    zipPath: zipPath ?? path.join(
      repositoryRoot,
      "release-assets",
      `FHL-Image-Studio-Desktop-V${version}-Source.zip`,
    ),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
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
      if (code === 0) {
        resolve({ stdout, stderr });
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

async function readManifest() {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const version = String(manifest.version || "").trim();
  assert(/^\d+\.\d+\.\d+$/.test(version), `invalid product version: ${version || "<empty>"}`);
  assert(manifest.displayVersion === `V${version}`, "displayVersion must match version");
  return { manifest, version };
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

function validateArchiveEntries(rawList, expectedRoot) {
  const entries = rawList.split(/\r?\n/).filter(Boolean);
  assert(entries.length > 0, "source ZIP is empty");
  const seen = new Set();

  for (const entry of entries) {
    assert(!entry.includes("\\"), `ZIP entry uses a backslash: ${entry}`);
    assert(!entry.startsWith("/"), `ZIP entry is absolute: ${entry}`);
    assert(!entry.includes("\0"), `ZIP entry contains NUL: ${entry}`);
    const components = entry.split("/").filter((component) => component.length > 0);
    assert(components.length > 0, `invalid empty ZIP entry: ${entry}`);
    assert(components[0] === expectedRoot, `ZIP entry is outside ${expectedRoot}/: ${entry}`);
    assert(!components.some((component) => component === "." || component === ".."), `unsafe ZIP entry: ${entry}`);
    assert(!seen.has(entry), `duplicate ZIP entry: ${entry}`);
    seen.add(entry);
  }

  return entries;
}

function forbiddenReason(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const baseName = path.posix.basename(normalized);
  const lowerBaseName = baseName.toLowerCase();
  const extension = path.posix.extname(lowerBaseName);

  if (forbiddenFileNames.has(lowerBaseName)) return "forbidden local or generated file";
  if (lowerBaseName.endsWith(".local") || lowerBaseName.endsWith(".local.json") || lowerBaseName === ".env.local") {
    return "local configuration file";
  }
  if (/^session-.*\.(?:jsonl|md)$/i.test(baseName)) return "local session transcript";
  if (forbiddenBinaryExtensions.has(extension)) return `compiled or archived binary extension ${extension}`;
  if (/(^|\/)[^/]+\.app(?:\/|$)/i.test(normalized)) return "compiled application bundle";
  if (/(^|\/)(?:\.git|node_modules|dist|test-results|playwright-report|coverage|config\/webview|\.local|ui-audit|\.gocache|\.gomodcache|\.gopath|\.npm-cache|\.sandbox-home|\.wails)(?:\/|$)/i.test(normalized)) {
    return "forbidden generated or private directory";
  }
  if (/(^|\/)image-studio\/build\/(?:bin|darwin\/build|windows\/build)(?:\/|$)/i.test(normalized)) {
    return "compiled application output";
  }
  const userDirectoryMatch = normalized.match(/^(?:input|output|intermediate)\/(.+)$/i);
  if (userDirectoryMatch && path.posix.basename(userDirectoryMatch[1]) !== ".gitkeep") {
    return "user-generated input or output";
  }
  if (/\.(?:log|prof|test|tmp)$/i.test(lowerBaseName)) return "generated runtime file";
  return null;
}

function binaryMagicReason(buffer) {
  const hex = buffer.subarray(0, 8).toString("hex");
  const firstFour = hex.slice(0, 8);
  if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return "ELF executable";
  if (buffer.subarray(0, 2).toString("ascii") === "MZ") return "PE executable";
  if (new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]).has(firstFour)) {
    return "Mach-O or universal executable";
  }
  if (buffer.subarray(0, 8).toString("ascii") === "!<arch>\n") return "static library archive";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) return "WebAssembly binary";
  if (buffer.subarray(0, 16).toString("ascii") === "SQLite format 3\0") return "SQLite user database";
  if (buffer.subarray(0, 8).toString("ascii") === "bplist00") return "binary property list";
  if (hex.startsWith("504b0304") || hex.startsWith("504b0506") || hex.startsWith("504b0708")) return "nested ZIP archive";
  if (hex.startsWith("1f8b") || hex.startsWith("425a68") || hex.startsWith("fd377a585a00") || hex.startsWith("377abcaf271c")) {
    return "compressed archive";
  }
  return null;
}

function isObviouslyFakeSecret(token) {
  const lower = token.toLowerCase();
  if (/(?:^|[-_])(test|fake|dummy|example|placeholder|redacted|sample)(?:[-_]|$)/.test(lower)) {
    return true;
  }
  const payload = lower.replace(/^(?:sk-|gh[pousr]_|github_pat_|aiza|akia|asia)/, "");
  return /^(?:x+|0+|1+|a+|z+)$/.test(payload);
}

async function walkSourceTree(rootDirectory) {
  const files = [];
  let totalBytes = 0;

  async function visit(directory, relativeDirectory = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));

    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, child.name)
        : child.name;
      const stat = await lstat(absolutePath);
      assert(!stat.isSymbolicLink(), `source ZIP contains a symbolic link: ${relativePath}`);

      if (stat.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      assert(stat.isFile(), `source ZIP contains an unsupported entry: ${relativePath}`);
      assert(stat.size <= maximumFileBytes, `source file exceeds ${maximumFileBytes} bytes: ${relativePath}`);
      totalBytes += stat.size;
      assert(totalBytes <= maximumArchiveBytes, `expanded source exceeds ${maximumArchiveBytes} bytes`);
      files.push({ absolutePath, relativePath, size: stat.size });
    }
  }

  await visit(rootDirectory);
  return { files, totalBytes };
}

async function validateFile(file) {
  const forbidden = forbiddenReason(file.relativePath);
  assert(!forbidden, `${forbidden}: ${file.relativePath}`);

  const contents = await readFile(file.absolutePath);
  const magicReason = binaryMagicReason(contents.subarray(0, 16));
  assert(!magicReason, `${magicReason} is not allowed in the source ZIP: ${file.relativePath}`);

  const extension = path.posix.extname(file.relativePath).toLowerCase();
  if (file.size <= maximumTextScanBytes && textExtensions.has(extension)) {
    const text = contents.toString("utf8");
    for (const pattern of secretPatterns) {
      pattern.expression.lastIndex = 0;
      for (const match of text.matchAll(pattern.expression)) {
        const token = match[1] ?? match[0];
        if (pattern.allowObviousFake && isObviouslyFakeSecret(token)) continue;
        throw new Error(`${pattern.label} found in source file: ${file.relativePath}`);
      }
    }
  }
}

async function validateSourceZip(zipPath, version) {
  const resolvedZip = path.resolve(repositoryRoot, zipPath);
  const zipStat = await lstat(resolvedZip).catch(() => null);
  assert(zipStat?.isFile() && !zipStat.isSymbolicLink(), `source ZIP must be a regular file: ${resolvedZip}`);
  const expectedAssetName = `FHL-Image-Studio-Desktop-V${version}-Source.zip`;
  assert(path.basename(resolvedZip) === expectedAssetName, `source ZIP must be named ${expectedAssetName}`);

  const expectedRoot = expectedAssetName.slice(0, -4);
  const listed = await run("/usr/bin/unzip", ["-Z1", resolvedZip]);
  const entries = validateArchiveEntries(listed.stdout, expectedRoot);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fhl-source-check-"));

  try {
    // macOS ships an old Info-ZIP build that can corrupt UTF-8 Chinese names.
    // ditto preserves the archive names while the entry list above still gates
    // absolute paths and traversal before extraction.
    await run("/usr/bin/ditto", ["-x", "-k", "--noqtn", resolvedZip, temporaryDirectory]);
    const sourceRoot = path.join(temporaryDirectory, expectedRoot);
    const sourceRootStat = await lstat(sourceRoot).catch(() => null);
    assert(sourceRootStat?.isDirectory() && !sourceRootStat.isSymbolicLink(), `missing source root: ${expectedRoot}/`);
    const resolvedTemporaryDirectory = await realpath(temporaryDirectory);
    const resolvedSourceRoot = await realpath(sourceRoot);
    assert(resolvedSourceRoot.startsWith(`${resolvedTemporaryDirectory}${path.sep}`), "source root escaped extraction directory");

    const { files, totalBytes } = await walkSourceTree(sourceRoot);
    assert(files.length > 0, "source ZIP contains no files");
    for (const file of files) await validateFile(file);

    const requiredFiles = [
      "LICENSE",
      "README.md",
      "README_MACOS.md",
      `RELEASE_NOTES_MACOS_V${version}.md`,
      "product-version.json",
      "config/cli.env.example",
      "scripts/package-macos-release.sh",
      "scripts/package-release-source.sh",
      "scripts/check-release-source.mjs",
      "scripts/create-release-checksums.sh",
      "scripts/verify-macos-release-assets.mjs",
    ];
    const fileNames = new Set(files.map((file) => file.relativePath));
    for (const requiredFile of requiredFiles) {
      assert(fileNames.has(requiredFile), `source ZIP is missing required file: ${requiredFile}`);
    }

    const archivedManifest = JSON.parse(await readFile(path.join(sourceRoot, "product-version.json"), "utf8"));
    assert(archivedManifest.version === version, `archived product version must be ${version}`);
    assert(archivedManifest.displayVersion === `V${version}`, "archived displayVersion is inconsistent");

    const envExample = await readFile(path.join(sourceRoot, "config", "cli.env.example"), "utf8");
    const apiKeyLine = envExample.match(/^IMAGE_STUDIO_API_KEY=(.*)$/m);
    assert(apiKeyLine, "config/cli.env.example must declare IMAGE_STUDIO_API_KEY");
    assert(apiKeyLine[1].trim() === "", "config/cli.env.example must not contain an API key");

    return {
      ok: true,
      archiveEntries: entries.length,
      expandedBytes: totalBytes,
      files: files.length,
      rootDirectory: expectedRoot,
      sha256: await sha256File(resolvedZip),
      version,
      zipPath: resolvedZip,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function printHumanResult(result) {
  console.log("macOS release source verification passed.");
  console.log(`ZIP: ${result.zipPath}`);
  console.log(`Root: ${result.rootDirectory}/`);
  console.log(`Version: ${result.version}`);
  console.log(`Files: ${result.files}`);
  console.log(`Expanded bytes: ${result.expandedBytes}`);
  console.log(`SHA-256: ${result.sha256}`);
}

let wantsJson = process.argv.includes("--json");

try {
  const { version } = await readManifest();
  const options = parseArguments(process.argv.slice(2), version);
  wantsJson = options.json;
  if (options.help) {
    console.log(usage(version));
  } else {
    const result = await validateSourceZip(options.zipPath, version);
    if (options.json) console.log(JSON.stringify(result));
    else printHumanResult(result);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`macOS release source verification failed: ${message}`);
  process.exitCode = 1;
}
