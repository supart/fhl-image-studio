import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { BrowserJobManager } from "../dev/browserJobProxy.ts";

function task(index, apiProfileId = "api-1") {
  return {
    clientTaskId: `task-${index}`,
    runId: "run-397",
    workspaceId: "ws-397",
    mode: "edit",
    prompt: "test prompt",
    size: "1152x2048",
    quality: "medium",
    outputFormat: "png",
    seed: index,
    negativePrompt: "",
    sourceImagePaths: [`I:/inputs/${index}.png`],
    apiProfileId,
    continuousGenerateTest: true,
    continuousBatchIndex: index,
  };
}

function credential(apiProfileId = "api-1") {
  return {
    apiProfileId,
    apiProfileName: apiProfileId.toUpperCase(),
    apiKey: "test-key",
    baseURL: "https://example.invalid",
    apiMode: "images",
    requestPolicy: "openai",
    imagesNewAPICompat: true,
    textModelID: "",
    imageModelID: "test-image-model",
  };
}

test("submit-many registers independent jobs once, isolates failures, and is idempotent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "image-studio-submit-many-"));
  const outputDir = path.join(root, "output");
  const inputDir = path.join(root, "input");
  const cliPath = path.join(root, "fake-cli.exe");
  const registryPath = path.join(outputDir, "log", "browser-jobs.v1.json");
  let registryWrites = 0;

  try {
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(cliPath, "test", "utf8");
    const manager = new BrowserJobManager(
      root,
      outputDir,
      inputDir,
      cliPath,
      registryPath,
      {
        disableSpawning: true,
        onRegistryWrite: () => { registryWrites += 1; },
      },
    );
    await manager.init();

    const request = {
      runId: "wave-1",
      credentials: [credential()],
      tasks: Array.from({ length: 40 }, (_, index) => task(index)),
    };
    const registrationStartedAt = performance.now();
    const first = await manager.submitMany(request);
    const registrationElapsedMs = performance.now() - registrationStartedAt;

    assert.ok(registrationElapsedMs < 5_000);
    assert.equal(registryWrites, 1);
    assert.equal(first.results.length, 40);
    assert.ok(first.results.every((result) => result.ok && result.group?.batchCount === 1));
    assert.equal(new Set(first.results.map((result) => result.group?.groupId)).size, 40);
    assert.equal(new Set(first.results.map((result) => result.group?.slots[0]?.jobId)).size, 40);
    assert.deepEqual(
      first.results.map((result) => result.group?.clientTaskId),
      request.tasks.map((entry) => entry.clientTaskId),
    );

    const repeated = await manager.submitMany(request);
    assert.equal(registryWrites, 1);
    assert.deepEqual(
      repeated.results.map((result) => result.group?.groupId),
      first.results.map((result) => result.group?.groupId),
    );

    const partial = await manager.submitMany({
      runId: "wave-2",
      credentials: [credential()],
      tasks: [task(40), task(41, "missing-api")],
    });
    assert.equal(registryWrites, 2);
    assert.equal(partial.results[0].ok, true);
    assert.equal(partial.results[1].ok, false);
    assert.match(partial.results[1].error || "", /credential is missing/i);

    const targetJobId = first.results[0].group.slots[0].jobId;
    await manager.cancel([targetJobId]);
    const groups = manager.listWorkspace("ws-397", 100).groups;
    const target = groups.find((group) => group.clientTaskId === "task-0");
    const neighbor = groups.find((group) => group.clientTaskId === "task-1");
    assert.equal(target?.slots[0].status, "cancelled");
    assert.equal(neighbor?.slots[0].status, "queued");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
