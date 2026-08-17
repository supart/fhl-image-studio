import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceRoot = new URL("../../..", import.meta.url);

test("active product metadata matches the canonical version manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("product-version.json", sourceRoot), "utf8"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.displayVersion, `V${manifest.version}`);
  assert.equal(manifest.windowsTag, `windows-v${manifest.version}-release`);

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["scripts/sync-version-metadata.mjs", "--check"],
    { cwd: sourceRoot },
  );
  assert.equal(stderr, "");
  assert.match(stdout, new RegExp(`metadata is synchronized: ${manifest.displayVersion.replaceAll(".", "\\.")}`));
});

test("every frontend production build gates compilation on version metadata", async () => {
  const harnessRoot = await mkdtemp(join(tmpdir(), "fhl-version-build-gate-"));
  const frontendRoot = join(harnessRoot, "image-studio", "frontend");
  const platformScript = join(frontendRoot, "scripts", "platform-vite.mjs");
  const logPath = join(harnessRoot, "calls.log");
  try {
    await Promise.all([
      mkdir(join(harnessRoot, "scripts"), { recursive: true }),
      mkdir(join(frontendRoot, "scripts"), { recursive: true }),
      mkdir(join(frontendRoot, "node_modules", "typescript", "bin"), { recursive: true }),
      mkdir(join(frontendRoot, "node_modules", "vite", "bin"), { recursive: true }),
    ]);
    await copyFile(
      fileURLToPath(new URL("image-studio/frontend/scripts/platform-vite.mjs", sourceRoot)),
      platformScript,
    );
    await writeFile(
      join(harnessRoot, "scripts", "sync-version-metadata.mjs"),
      'import { appendFileSync } from "node:fs";\n' +
        'appendFileSync(process.env.GATE_LOG, "version\\n");\n' +
        'if (process.env.FAIL_VERSION === "1") process.exit(17);\n',
    );
    for (const [relativePath, label] of [
      [join("typescript", "bin", "tsc"), "tsc"],
      [join("vite", "bin", "vite.js"), "vite"],
    ]) {
      await writeFile(
        join(frontendRoot, "node_modules", relativePath),
        `const { appendFileSync } = require("node:fs");\nappendFileSync(process.env.GATE_LOG, "${label}\\n");\n`,
      );
    }

    const env = { ...process.env, GATE_LOG: logPath };
    await execFileAsync(process.execPath, [platformScript, "build", "windows"], { env });
    assert.equal(await readFile(logPath, "utf8"), "version\ntsc\nvite\n");

    await writeFile(logPath, "");
    await assert.rejects(
      execFileAsync(process.execPath, [platformScript, "build", "windows"], {
        env: { ...env, FAIL_VERSION: "1" },
      }),
      /sync-version-metadata\.mjs exited with code 17/,
    );
    assert.equal(await readFile(logPath, "utf8"), "version\n");
  } finally {
    await rm(harnessRoot, { recursive: true, force: true });
  }
});

test("Windows browser development prepares the local CLI before Vite", async () => {
  const harnessRoot = await mkdtemp(join(tmpdir(), "fhl-windows-dev-cli-gate-"));
  const frontendRoot = join(harnessRoot, "image-studio", "frontend");
  const platformScript = join(frontendRoot, "scripts", "platform-vite.mjs");
  const logPath = join(harnessRoot, "calls.log");
  try {
    await Promise.all([
      mkdir(join(harnessRoot, "scripts"), { recursive: true }),
      mkdir(join(frontendRoot, "scripts"), { recursive: true }),
      mkdir(join(frontendRoot, "node_modules", "vite", "bin"), { recursive: true }),
    ]);
    await copyFile(
      fileURLToPath(new URL("image-studio/frontend/scripts/platform-vite.mjs", sourceRoot)),
      platformScript,
    );
    for (const [name, label, failureCode] of [
      ["sync-version-metadata.mjs", "version", 0],
      ["ensure-development-cli.mjs", "cli", 19],
    ]) {
      await writeFile(
        join(harnessRoot, "scripts", name),
        'import { appendFileSync } from "node:fs";\n' +
          `appendFileSync(process.env.GATE_LOG, "${label}\\n");\n` +
          (failureCode ? `if (process.env.FAIL_DEV_CLI === "1") process.exit(${failureCode});\n` : ""),
      );
    }
    await writeFile(
      join(frontendRoot, "node_modules", "vite", "bin", "vite.js"),
      'const { appendFileSync } = require("node:fs");\nappendFileSync(process.env.GATE_LOG, "vite\\n");\n',
    );

    const env = { ...process.env, GATE_LOG: logPath };
    await execFileAsync(process.execPath, [platformScript, "dev", "windows"], { env });
    assert.equal(await readFile(logPath, "utf8"), "version\ncli\nvite\n");

    await writeFile(logPath, "");
    await assert.rejects(
      execFileAsync(process.execPath, [platformScript, "dev", "windows"], {
        env: { ...env, FAIL_DEV_CLI: "1" },
      }),
      /ensure-development-cli\.mjs exited with code 19/,
    );
    assert.equal(await readFile(logPath, "utf8"), "version\ncli\n");
  } finally {
    await rm(harnessRoot, { recursive: true, force: true });
  }
});
