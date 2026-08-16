import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "product-version.json");
const mode = process.argv[2] ?? "--check";

if (!new Set(["--check", "--write"]).has(mode) || process.argv.length > 3) {
  throw new Error("usage: node scripts/sync-version-metadata.mjs [--check|--write]");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = String(manifest.version ?? "").trim();
const displayVersion = String(manifest.displayVersion ?? "").trim();
const windowsTag = String(manifest.windowsTag ?? "").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`product-version.json version must be semver core, got: ${version || "<empty>"}`);
}
if (displayVersion !== `V${version}`) {
  throw new Error(`displayVersion must equal V${version}, got: ${displayVersion || "<empty>"}`);
}
if (windowsTag !== `windows-v${version}-release`) {
  throw new Error(`windowsTag must equal windows-v${version}-release, got: ${windowsTag || "<empty>"}`);
}

const expectedExeBase = `FHL Studio 方汤圆版 ${displayVersion}`;
const updates = new Map();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function stage(relativePath, content) {
  updates.set(relativePath, content);
}

function updateJSON(relativePath, mutate) {
  const value = JSON.parse(read(relativePath));
  mutate(value);
  stage(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceOne(relativePath, pattern, replacement, label) {
  const source = updates.get(relativePath) ?? read(relativePath);
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${relativePath}: expected exactly one ${label}, found ${matches?.length ?? 0}`);
  }
  stage(relativePath, source.replace(pattern, replacement));
}

updateJSON("image-studio/wails.json", (value) => {
  value.outputfilename = expectedExeBase;
  value.info.productVersion = version;
});
updateJSON("image-studio/frontend/package.json", (value) => {
  value.version = version;
});
updateJSON("image-studio/frontend/package-lock.json", (value) => {
  value.version = version;
  if (!value.packages?.[""]) throw new Error("frontend package-lock root package is missing");
  value.packages[""].version = version;
});

replaceOne(
  "image-studio/main.go",
  /^\s*packageVersion\s*=\s*"[^"]+"$/m,
  `\tpackageVersion = "${version}"`,
  "desktop packageVersion",
);
replaceOne(
  "go-cli/cmd/gptcodex-image/main.go",
  /^var packageVersion\s*=\s*"[^"]+"$/m,
  `var packageVersion = "${displayVersion}"`,
  "CLI packageVersion",
);
replaceOne(
  "go-cli/pkg/client/types.go",
  /^\s*Version\s*=\s*"[^"]+"$/m,
  `\tVersion = "${version}"`,
  "client Version",
);
replaceOne(
  "scripts/start-desktop-e2e.cmd",
  /^set "EXE=.*"$/m,
  `set "EXE=%ROOT%\\image-studio\\build\\bin\\${expectedExeBase}.exe"`,
  "desktop E2E executable",
);

const requiredPaths = [
  "scripts/package-windows-portable.ps1",
  "scripts/prepare-release-source.ps1",
  "scripts/portable-windows-launcher.cmd",
  "scripts/portable-windows-launcher.ps1",
  "一键启动FHL Studio.cmd",
];
for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`missing active version-independent entrypoint: ${relativePath}`);
  }
}

const drift = [];
for (const [relativePath, expected] of updates) {
  const actual = read(relativePath);
  if (actual !== expected) drift.push(relativePath);
}

if (mode === "--write") {
  for (const relativePath of drift) {
    fs.writeFileSync(path.join(root, relativePath), updates.get(relativePath), "utf8");
    process.stdout.write(`[version] updated ${relativePath}\n`);
  }
  process.stdout.write(`[version] synchronized ${displayVersion} (${windowsTag})\n`);
} else if (drift.length > 0) {
  process.stderr.write(`[version] metadata drift for ${displayVersion}:\n`);
  for (const relativePath of drift) process.stderr.write(`- ${relativePath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`[version] metadata is synchronized: ${displayVersion} (${windowsTag})\n`);
}
