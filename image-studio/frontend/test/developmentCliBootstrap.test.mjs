import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureDevelopmentCli } from "../../../scripts/ensure-development-cli.mjs";

async function createSourceFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "fhl-development-cli-"));
  await mkdir(join(sourceRoot, "go-cli", "cmd", "gptcodex-image"), { recursive: true });
  await Promise.all([
    writeFile(
      join(sourceRoot, "product-version.json"),
      JSON.stringify({
        version: "2.0.4",
        displayVersion: "V2.0.4",
        windowsTag: "windows-v2.0.4-release",
      }),
    ),
    writeFile(join(sourceRoot, "go-cli", "go.mod"), "module example.test/fhl\n"),
    writeFile(join(sourceRoot, "go-cli", "cmd", "gptcodex-image", "main.go"), "package main\nfunc main() {}\n"),
  ]);
  return sourceRoot;
}

test("development CLI builds when missing, skips when current, and rebuilds after a source change", async () => {
  const sourceRoot = await createSourceFixture();
  const builds = [];
  const runBuild = async (request) => {
    builds.push(request);
    await mkdir(join(sourceRoot, "runtime", "cli"), { recursive: true });
    await writeFile(request.outputPath, `build ${builds.length}`);
  };
  try {
    const first = await ensureDevelopmentCli({ sourceRoot, runBuild, log: () => {} });
    assert.equal(first.built, true);
    assert.equal(builds.length, 1);
    assert.equal(builds[0].cwd, join(sourceRoot, "go-cli"));
    assert.deepEqual(builds[0].args, [
      "build",
      "-trimpath",
      "-ldflags",
      "-s -w -X github.com/yuanhua/image-gptcodex/cmd/gptcodex-image.packageVersion=V2.0.4 -X github.com/yuanhua/image-gptcodex/pkg/client.Version=2.0.4",
      "-o",
      join(sourceRoot, "runtime", "cli", "gptcodex-image.exe"),
      "./cmd/gptcodex-image",
    ]);

    const second = await ensureDevelopmentCli({ sourceRoot, runBuild, log: () => {} });
    assert.equal(second.built, false);
    assert.equal(builds.length, 1);

    await writeFile(
      join(sourceRoot, "go-cli", "cmd", "gptcodex-image", "main.go"),
      "package main\nfunc main() { println(\"changed\") }\n",
    );
    const third = await ensureDevelopmentCli({ sourceRoot, runBuild, log: () => {} });
    assert.equal(third.built, true);
    assert.equal(builds.length, 2);
    assert.equal(await readFile(third.outputPath, "utf8"), "build 2");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("development CLI does not write a current-build stamp when the Go build fails", async () => {
  const sourceRoot = await createSourceFixture();
  try {
    await assert.rejects(
      ensureDevelopmentCli({
        sourceRoot,
        runBuild: async () => {
          throw new Error("synthetic Go failure");
        },
        log: () => {},
      }),
      /synthetic Go failure/,
    );
    await assert.rejects(
      readFile(join(sourceRoot, "runtime", "cli", ".gptcodex-image.development.json"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});
