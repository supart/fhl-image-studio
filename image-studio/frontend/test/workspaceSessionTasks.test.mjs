import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compactWorkspaceSessionTasks, storedLocalEditRoundtrip } from "../src/state/workspaceSessionTasks.ts";

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
        localEditRoundtrip: {
          version: 1,
          kind: "planar",
          sourceHistoryId: "source-1",
          sourcePath: "I:/output/source.png",
          sourceWidth: 2048,
          sourceHeight: 1536,
          cropRect: { x: 10, y: 20, width: 640, height: 480 },
          editWidth: 1280,
          editHeight: 960,
        },
      },
      "task-old": task("task-old", "workspace-a"),
      "task-other": task("task-other", "workspace-b"),
    },
  );

  assert.deepEqual(Object.keys(compact), ["task-a"]);
  assert.equal(compact["task-a"].sourceImages, undefined);
  assert.deepEqual(compact["task-a"].sourceImagePaths, ["I:/input/source.png"]);
  assert.deepEqual(compact["task-a"].panoramaRoundtrip, panoramaRoundtrip);
  assert.equal(compact["task-a"].localEditRoundtrip.kind, "planar");
  assert.deepEqual(compact["task-a"].localEditRoundtrip.cropRect, { x: 10, y: 20, width: 640, height: 480 });
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

test("normalization restores compact planar task metadata without source images", () => {
  const compact = compactWorkspaceSessionTasks(
    [{ id: "workspace-local", batchTaskIds: ["task-local"] }],
    {
      "task-local": {
        ...task("task-local", "workspace-local", [{ path: "I:/input/crop.png", name: "crop.png", size: 0 }]),
        localEditRoundtrip: {
          version: 1,
          kind: "planar",
          sourceHistoryId: "source-local",
          sourceWidth: 1200,
          sourceHeight: 900,
          cropRect: { x: 30, y: 40, width: 500, height: 400 },
          editWidth: 1000,
          editHeight: 800,
        },
      },
    },
  );
  const parsed = JSON.parse(JSON.stringify(compact));
  const restoredRoundtrip = storedLocalEditRoundtrip(parsed["task-local"].localEditRoundtrip);

  assert.equal(parsed["task-local"].sourceImages, undefined);
  assert.equal(restoredRoundtrip.sourceHistoryId, "source-local");
  assert.deepEqual(restoredRoundtrip.cropRect, { x: 30, y: 40, width: 500, height: 400 });
});

test("workspace session serialization keeps panorama metadata while dropping image payloads", () => {
  assert.match(sharedStoreSource, /panoramaRoundtrip: source\.panoramaRoundtrip/);
  assert.match(sharedStoreSource, /panoramaProject: source\.panoramaProject/);
  assert.match(sharedStoreSource, /panoramaRoundtrip: raw\.panoramaRoundtrip/);
  assert.match(sharedStoreSource, /imageBlob: null/);
});
