import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compactWorkspaceSessionTasks } from "../src/state/workspaceSessionTasks.ts";

const sharedStoreSource = await readFile(
  new URL("../src/state/studioStore.shared.ts", import.meta.url),
  "utf8",
);

function task(id, workspaceId, sourceImages) {
  return {
    id,
    workspaceId,
    slotIndex: 0,
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    mode: "edit",
    apiMode: "images",
    prompt: "test",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    sourceImagePaths: ["I:/input/source.png"],
    sourceImages,
  };
}

test("workspace session only persists referenced tasks without repeated source payloads", () => {
  const panoramaRoundtrip = {
    sourceHistoryId: "panorama-source",
    sourcePath: "I:/output/panorama.png",
    roundtripState: { kind: "ty360_roundtrip_state" },
  };
  const compact = compactWorkspaceSessionTasks(
    [{ id: "workspace-a", batchTaskIds: ["task-a"] }],
    {
      "task-a": {
        ...task("task-a", "workspace-a", [{
          path: "I:/input/source.png",
          name: "source.png",
          size: 1,
          imageB64: "large-repeated-payload",
        }]),
        panoramaRoundtrip,
      },
      "task-old": task("task-old", "workspace-a"),
      "task-other": task("task-other", "workspace-b"),
    },
  );

  assert.deepEqual(Object.keys(compact), ["task-a"]);
  assert.equal(compact["task-a"].sourceImages, undefined);
  assert.deepEqual(compact["task-a"].sourceImagePaths, ["I:/input/source.png"]);
  assert.deepEqual(compact["task-a"].panoramaRoundtrip, panoramaRoundtrip);
});

test("400 compact task records survive a workspace-session JSON round trip", () => {
  const taskIds = Array.from({ length: 400 }, (_, index) => `task-${index + 1}`);
  const tasksById = Object.fromEntries(taskIds.map((id, index) => [
    id,
    {
      ...task(id, "workspace-large", [{
        path: `I:/input/source-${index + 1}.png`,
        name: `source-${index + 1}.png`,
        size: 128 * 1024,
        imageB64: "x".repeat(128 * 1024),
      }]),
      slotIndex: index,
      status: index < 40 ? "running" : "queued",
      apiProfileId: `fhl-images-${(index % 10) + 1}`,
      savedPath: index === 399 ? "I:/output/final.png" : undefined,
    },
  ]));

  const compact = compactWorkspaceSessionTasks(
    [{ id: "workspace-large", batchTaskIds: taskIds }],
    tasksById,
  );
  const serialized = JSON.stringify(compact);
  const restored = JSON.parse(serialized);

  assert.equal(Object.keys(restored).length, 400);
  assert.equal(restored["task-1"].status, "running");
  assert.equal(restored["task-41"].status, "queued");
  assert.equal(restored["task-400"].savedPath, "I:/output/final.png");
  assert.equal(Object.values(restored).some((entry) => "sourceImages" in entry), false);
  assert.ok(serialized.length < 1_000_000, `compact session was ${serialized.length} bytes`);
});

test("workspace session serialization keeps panorama metadata while dropping image payloads", () => {
  assert.match(sharedStoreSource, /panoramaRoundtrip: source\.panoramaRoundtrip/);
  assert.match(sharedStoreSource, /panoramaProject: source\.panoramaProject/);
  assert.match(sharedStoreSource, /panoramaRoundtrip: raw\.panoramaRoundtrip/);
  assert.match(sharedStoreSource, /imageBlob: null/);
});
