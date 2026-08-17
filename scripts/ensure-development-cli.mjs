import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");
const stampName = ".gptcodex-image.development.json";

async function collectGoFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectGoFiles(entryPath, output);
    } else if (entry.isFile() && entry.name.endsWith(".go")) {
      output.push(entryPath);
    }
  }
}

async function sourceDigest(sourceRoot) {
  const goCliRoot = path.join(sourceRoot, "go-cli");
  const inputs = [path.join(sourceRoot, "product-version.json"), path.join(goCliRoot, "go.mod")];
  const goSumPath = path.join(goCliRoot, "go.sum");
  try {
    if ((await stat(goSumPath)).isFile()) inputs.push(goSumPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await collectGoFiles(goCliRoot, inputs);
  inputs.sort((left, right) => left.localeCompare(right));

  const digest = createHash("sha256");
  for (const inputPath of inputs) {
    digest.update(path.relative(sourceRoot, inputPath).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(await readFile(inputPath));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function readCurrentStamp(stampPath) {
  try {
    return JSON.parse(await readFile(stampPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function runGoBuild({ command, args, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`go build exited with code ${code ?? 1}`));
    });
  });
}

export async function ensureDevelopmentCli(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? defaultSourceRoot);
  const runBuild = options.runBuild ?? runGoBuild;
  const log = options.log ?? console.log;
  const manifestPath = path.join(sourceRoot, "product-version.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.displayVersion !== `V${manifest.version}`) {
    throw new Error(`invalid displayVersion in ${manifestPath}`);
  }

  const goCliRoot = path.join(sourceRoot, "go-cli");
  const outputDir = path.join(sourceRoot, "runtime", "cli");
  const outputPath = path.join(outputDir, "gptcodex-image.exe");
  const stampPath = path.join(outputDir, stampName);
  const digest = await sourceDigest(sourceRoot);
  const stamp = await readCurrentStamp(stampPath);
  if (
    (await isFile(outputPath)) &&
    stamp?.version === manifest.version &&
    stamp?.displayVersion === manifest.displayVersion &&
    stamp?.sourceDigest === digest
  ) {
    log(`[FHL Studio] Development CLI is current: ${manifest.displayVersion}`);
    return { built: false, outputPath };
  }

  await mkdir(outputDir, { recursive: true });
  const ldflags = [
    "-s -w",
    `-X github.com/yuanhua/image-gptcodex/cmd/gptcodex-image.packageVersion=${manifest.displayVersion}`,
    `-X github.com/yuanhua/image-gptcodex/pkg/client.Version=${manifest.version}`,
  ].join(" ");
  const args = [
    "build",
    "-trimpath",
    "-ldflags",
    ldflags,
    "-o",
    outputPath,
    "./cmd/gptcodex-image",
  ];
  log(`[FHL Studio] Building development CLI for ${manifest.displayVersion}...`);
  await runBuild({
    command: process.env.IMAGE_STUDIO_GO_EXE?.trim() || "go",
    args,
    cwd: goCliRoot,
    outputPath,
  });
  if (!(await isFile(outputPath))) {
    throw new Error(`go build completed without creating ${outputPath}`);
  }
  await writeFile(
    stampPath,
    `${JSON.stringify({ version: manifest.version, displayVersion: manifest.displayVersion, sourceDigest: digest }, null, 2)}\n`,
    "utf8",
  );
  log(`[FHL Studio] Development CLI ready: ${outputPath}`);
  return { built: true, outputPath };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await ensureDevelopmentCli();
  } catch (error) {
    console.error(`[FHL Studio] Development CLI preparation failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
