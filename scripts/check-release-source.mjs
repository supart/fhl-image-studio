import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || process.cwd());
const forbiddenDirNames = new Set([".git", ".build-tools", ".gocache", ".gomodcache", ".gopath", "node_modules", "test-results"]);
const forbiddenFileNames = new Set(["cli.env.local", "fhl-api.local.json", "browser-jobs.v1.json", ".DS_Store"]);
const forbiddenExtensions = new Set([".app", ".dll", ".dmg", ".exe", ".msi", ".msix", ".so"]);
const textExtensions = new Set([".bat", ".cjs", ".cmd", ".css", ".env", ".example", ".go", ".html", ".js", ".json", ".jsonc", ".md", ".mjs", ".plist", ".ps1", ".sh", ".svg", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
const secretPatterns = [
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
  /(^|[^A-Za-z0-9])sess-[A-Za-z0-9_-]{20,}/,
  /(^|[^A-Za-z0-9])ghp_[A-Za-z0-9_]{20,}/,
  /(^|[^A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/,
];
const requiredPaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "LICENSE",
  "NOTICE.md",
  "COMPLIANCE.md",
  "README.md",
  "README_MACOS.md",
  "SKILL.md",
  "image-cli",
  "安装CodexSkill.command",
  "go-cli/go.mod",
  "image-studio/go.mod",
  "image-studio/go.sum",
  "image-studio/backend/service.go",
  "image-studio/build/darwin/entitlements.plist",
  "image-studio/build/darwin/Info.plist",
  "image-studio/frontend/package-lock.json",
  "image-studio/frontend/src/app/App.tsx",
  "scripts/package-local-macos-app.sh",
  "shared/kernel/requestModel.js",
];
const issues = [];

function normalized(path) {
  return relative(root, path).split(sep).join("/");
}

function isGeneratedBuildPath(rel) {
  return rel.includes("/frontend/dist/") || rel.includes("/build/bin/") || rel === "image-studio/frontend/dist" || rel === "image-studio/build/bin";
}

function isReleaseDataPath(rel) {
  const parts = rel.split("/");
  return ["input", "output", "intermediate"].includes(parts[0]) || rel.startsWith("runtime/cli/");
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = normalized(path);
    if (entry.isDirectory()) {
      if (forbiddenDirNames.has(entry.name) || isGeneratedBuildPath(rel) || entry.name === "release-assets") {
        issues.push(`FORBIDDEN_DIR: ${rel}`);
        continue;
      }
      await walk(path);
      continue;
    }
    if (!entry.isFile()) continue;
    if (forbiddenFileNames.has(entry.name) || /\.local(?:\.json)?$/i.test(entry.name) || /\.(?:log|tmp)$/i.test(entry.name)) {
      issues.push(`FORBIDDEN_FILE: ${rel}`);
    }
    const extension = extname(entry.name).toLowerCase();
    if (forbiddenExtensions.has(extension)) issues.push(`FORBIDDEN_BINARY: ${rel}`);
    if (isReleaseDataPath(rel) && entry.name !== ".gitkeep") issues.push(`USER_DATA_FILE: ${rel}`);

    const info = await stat(path);
    if (textExtensions.has(extension) && info.size <= 20 * 1024 * 1024) {
      const text = await readFile(path, "utf8");
      if (secretPatterns.some((pattern) => pattern.test(text))) issues.push(`SECRET_PATTERN: ${rel}`);
      if (basename(path) === "cli.env.example" && /^IMAGE_STUDIO_API_KEY=\S+/m.test(text)) {
        issues.push(`EXAMPLE_API_KEY_NOT_EMPTY: ${rel}`);
      }
    } else if (info.size >= 4) {
      const data = await readFile(path);
      const magic = data.subarray(0, 4).toString("hex");
      if (["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"].includes(magic) || data.subarray(0, 2).toString("ascii") === "MZ") {
        issues.push(`EXECUTABLE_MAGIC: ${rel}`);
      }
    }
  }
}

await walk(root);
for (const required of requiredPaths) {
  try {
    const info = await stat(join(root, required));
    if (!info.isFile()) issues.push(`MISSING_SOURCE: ${required}`);
  } catch {
    issues.push(`MISSING_SOURCE: ${required}`);
  }
}

if (issues.length > 0) {
  console.error(`[FHL source safety] ${issues.length} issue(s)`);
  for (const issue of issues) console.error(issue);
  process.exit(1);
}
console.log(`[FHL source safety] OK: ${root}`);
