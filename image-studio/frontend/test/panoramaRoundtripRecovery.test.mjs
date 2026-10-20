import assert from "node:assert/strict";
import test from "node:test";

const panorama = await import("../src/panorama/core.ts");
const recovery = await import("../src/state/panoramaRoundtripRecovery.ts");

function panoramaFixture() {
  const source = {
    id: "panorama-source",
    savedPath: "I:/output/panorama.png",
    width: 4096,
    height: 2048,
    size: "4096x2048",
    panoramaProject: {
      sourceHistoryId: "panorama-source",
      sourcePath: "I:/output/panorama.png",
      role: "source",
    },
  };
  const shot = {
    ...panorama.createDefaultPanoramaShot(source),
    id: "shot-frame",
    out_w: 1440,
    out_h: 1440,
  };
  const roundtrip = panorama.buildPanoramaRoundtripRef(source, shot);
  const shotItem = {
    id: "panorama-shot",
    savedPath: "I:/input/panorama-shot.png",
    width: 1440,
    height: 1440,
    prompt: "edit the shot",
    mode: "edit",
    size: "1440x1440",
    quality: "medium",
    createdAt: 1,
    panoramaRoundtrip: roundtrip,
    panoramaProject: panorama.buildPanoramaProjectRef(source, "shot", {
      shotHistoryId: "panorama-shot",
    }),
  };
  return { roundtrip, shotItem };
}

test("recovers panorama metadata for a persisted path-only workspace source", () => {
  const { roundtrip, shotItem } = panoramaFixture();
  const source = {
    path: "i:\\INPUT\\PANORAMA-SHOT.PNG",
    name: "panorama-shot.png",
    size: 0,
  };

  const recovered = recovery.recoverPanoramaSourceMetadata([source], [shotItem]);

  assert.notEqual(recovered[0], source);
  assert.deepEqual(recovered[0].panoramaRoundtrip, roundtrip);
  assert.equal(recovered[0].panoramaProject.role, "shot");
});

test("repairs an older edit result from its parent panorama shot path", () => {
  const { roundtrip, shotItem } = panoramaFixture();
  const result = {
    id: "edited-result",
    savedPath: "I:/output/edited.png",
    parentId: "I:\\input\\panorama-shot.png",
    prompt: "edited panorama shot",
    mode: "edit",
    size: "1440x1440",
    quality: "medium",
    createdAt: 2,
  };

  const recovered = recovery.recoverPanoramaItemMetadata(result, [result, shotItem]);

  assert.deepEqual(recovered.panoramaRoundtrip, roundtrip);
  assert.equal(recovered.panoramaProject.role, "edited-shot");
  assert.equal(recovered.panoramaProject.shotHistoryId, shotItem.id);
  assert.equal(recovered.panoramaProject.editedShotHistoryId, result.id);
  assert.equal(recovered.sourceImages[0].path, shotItem.savedPath);
});

test("repairs a restored result from its compact task source paths", () => {
  const { roundtrip, shotItem } = panoramaFixture();
  const result = {
    id: "browser-result",
    savedPath: "I:/output/browser-result.png",
    prompt: "restored result",
    mode: "edit",
    size: "1440x1440",
    quality: "medium",
    createdAt: 2,
  };
  const task = {
    historyItemId: result.id,
    sourceImagePaths: [shotItem.savedPath],
  };

  const recovered = recovery.recoverPanoramaItemMetadataFromTask(
    result,
    task,
    [result, shotItem],
  );

  assert.deepEqual(recovered.panoramaRoundtrip, roundtrip);
  assert.equal(recovered.sourceImages[0].path, shotItem.savedPath);
});

test("keeps a completed pasted panorama in its terminal state", () => {
  const { shotItem } = panoramaFixture();
  const pasted = {
    id: "pasted-panorama",
    savedPath: "I:/output/pasted-panorama.png",
    parentId: shotItem.savedPath,
    prompt: "completed panorama",
    mode: "edit",
    size: "4096x2048",
    quality: "medium",
    createdAt: 3,
    panoramaProject: {
      sourceHistoryId: "panorama-source",
      sourcePath: "I:/output/panorama.png",
      role: "pasted-panorama",
      shotHistoryId: shotItem.id,
      editedShotHistoryId: "edited-result",
    },
  };
  const task = {
    historyItemId: pasted.id,
    sourceImagePaths: [shotItem.savedPath],
  };

  assert.equal(recovery.recoverPanoramaItemMetadata(pasted, [pasted, shotItem]), pasted);
  assert.equal(recovery.recoverPanoramaItemMetadataFromTask(pasted, task, [pasted, shotItem]), pasted);
  assert.equal(panorama.hasPanoramaRoundtripRef(pasted), false);
  assert.deepEqual(
    recovery.panoramaSourcePathsForMetadataRecovery([pasted, shotItem], { task }, []),
    [],
  );
  assert.deepEqual(recovery.panoramaHistoryIdsForMetadataRecovery([pasted]), []);
});

test("requests persisted source metadata only for loaded results and active workspace sources", () => {
  const result = {
    id: "browser-result",
    prompt: "restored result",
    mode: "edit",
    size: "1440x1440",
    quality: "medium",
    createdAt: 2,
  };
  const paths = recovery.panoramaSourcePathsForMetadataRecovery(
    [result],
    {
      "task-visible": {
        historyItemId: result.id,
        sourceImagePaths: ["I:/input/visible-shot.png"],
      },
      "task-unloaded": {
        historyItemId: "not-loaded",
        sourceImagePaths: ["I:/input/unloaded.png"],
      },
    },
    [{ path: "I:/input/current-shot.png", name: "current-shot.png", size: 0 }],
  );

  assert.deepEqual(paths.sort(), [
    "I:/input/current-shot.png",
    "I:/input/visible-shot.png",
  ]);
});

test("requests a missing panorama shot by its surviving project history id", () => {
  const ids = recovery.panoramaHistoryIdsForMetadataRecovery([
    {
      id: "edited-result",
      prompt: "edited result",
      mode: "edit",
      size: "1440x1440",
      quality: "medium",
      createdAt: 2,
      panoramaProject: {
        sourceHistoryId: "panorama-source",
        shotHistoryId: "panorama-shot",
        role: "edited-shot",
      },
    },
  ]);

  assert.deepEqual(ids, ["panorama-shot"]);
});

test("bulk repair returns only changed history records for persistence", () => {
  const { shotItem } = panoramaFixture();
  const result = {
    id: "edited-result",
    parentId: shotItem.savedPath,
    prompt: "edited panorama shot",
    mode: "edit",
    size: "1440x1440",
    quality: "medium",
    createdAt: 2,
  };
  const unrelated = {
    id: "normal-result",
    parentId: "I:/input/normal.png",
    prompt: "normal edit",
    mode: "edit",
    size: "1024x1024",
    quality: "medium",
    createdAt: 3,
  };

  const repaired = recovery.recoverPanoramaHistoryMetadata([unrelated, result, shotItem]);

  assert.deepEqual(repaired.repaired.map((item) => item.id), [result.id]);
  assert.equal(repaired.items[0], unrelated);
  assert.equal(repaired.items[2], shotItem);
});

function planarFixture() {
  const roundtrip = {
    version: 1,
    kind: "planar",
    sourceHistoryId: "planar-source",
    sourcePath: "I:/output/source.png",
    sourceWidth: 2048,
    sourceHeight: 1536,
    cropRect: { x: 120, y: 80, width: 800, height: 600 },
    editWidth: 1600,
    editHeight: 1200,
  };
  const crop = {
    id: "planar-crop",
    savedPath: "I:/output/crop.png",
    prompt: "crop",
    mode: "edit",
    size: "1600x1200",
    quality: "medium",
    createdAt: 1,
    localEditRoundtrip: roundtrip,
  };
  return { roundtrip, crop };
}

test("recovers planar metadata by normalized exact path and task precedence", () => {
  const { roundtrip, crop } = planarFixture();
  const result = {
    id: "planar-result",
    savedPath: "I:/output/result.png",
    parentId: "i:\\OUTPUT\\CROP.PNG",
    prompt: "edited crop",
    mode: "edit",
    size: "1600x1200",
    quality: "medium",
    createdAt: 2,
  };
  const taskRoundtrip = { ...roundtrip, cropRect: { ...roundtrip.cropRect, x: 400 } };
  const fromPath = recovery.recoverRoundtripItemMetadataFromTask(result, null, [result, crop]);
  const fromTask = recovery.recoverRoundtripItemMetadataFromTask(result, { localEditRoundtrip: taskRoundtrip }, [result, crop]);

  assert.deepEqual(fromPath.localEditRoundtrip, roundtrip);
  assert.deepEqual(fromTask.localEditRoundtrip, taskRoundtrip);
});

test("prefers result nested planar metadata over task metadata", () => {
  const { roundtrip, crop } = planarFixture();
  const nested = { ...roundtrip, cropRect: { ...roundtrip.cropRect, y: 240 } };
  const taskRoundtrip = { ...roundtrip, cropRect: { ...roundtrip.cropRect, y: 360 } };
  const result = {
    id: "planar-result",
    prompt: "edited crop",
    mode: "edit",
    size: "1600x1200",
    quality: "medium",
    createdAt: 2,
    sourceImages: [{ path: crop.savedPath, name: "crop.png", size: 0, localEditRoundtrip: nested }],
  };

  const recovered = recovery.recoverRoundtripItemMetadataFromTask(
    result,
    { localEditRoundtrip: taskRoundtrip },
    [result, crop],
  );
  assert.deepEqual(recovered.localEditRoundtrip, nested);
});

test("does not guess planar metadata from a matching filename or dimensions", () => {
  const { crop } = planarFixture();
  const result = {
    id: "planar-result",
    savedPath: "I:/other/result.png",
    parentId: "D:/different/crop.png",
    prompt: crop.prompt,
    mode: "edit",
    size: crop.size,
    quality: "medium",
    width: 1600,
    height: 1200,
    createdAt: 2,
  };

  assert.equal(recovery.recoverRoundtripItemMetadataFromTask(result, null, [result, crop]), result);
});

test("matches planar history ids exactly instead of case folding them", () => {
  const { crop } = planarFixture();
  const result = {
    id: "planar-result",
    parentId: crop.id.toUpperCase(),
    prompt: "edited crop",
    mode: "edit",
    size: "1600x1200",
    quality: "medium",
    createdAt: 2,
  };

  assert.equal(recovery.recoverRoundtripItemMetadataFromTask(result, null, [result, crop]), result);
});

test("keeps planar pasteback results terminal even when a task points to the crop", () => {
  const { crop } = planarFixture();
  const pasted = {
    id: "pasted-planar",
    parentId: crop.savedPath,
    prompt: "(局部贴回)done",
    mode: "edit",
    size: "2048x1536",
    quality: "medium",
    createdAt: 3,
    localEditPastebackState: "pasted",
  };

  assert.equal(
    recovery.recoverRoundtripItemMetadataFromTask(pasted, { sourceImagePaths: [crop.savedPath] }, [pasted, crop]),
    pasted,
  );
});

test("bulk planar recovery stays linked by exact task result id across reordered workspaces", () => {
  const { roundtrip } = planarFixture();
  const otherRoundtrip = {
    ...roundtrip,
    sourceHistoryId: "other-source",
    sourcePath: "I:/output/other-source.png",
    cropRect: { ...roundtrip.cropRect, x: 620 },
  };
  const first = { id: "result-a", savedPath: "I:/output/a.png", prompt: "a", mode: "edit", size: "1600x1200", quality: "medium", createdAt: 2 };
  const second = { id: "result-b", savedPath: "I:/output/b.png", prompt: "b", mode: "edit", size: "1600x1200", quality: "medium", createdAt: 3 };
  const repaired = recovery.recoverRoundtripHistoryMetadata(
    [second, first],
    {
      "task-a": { workspaceId: "workspace-a", historyItemId: first.id, savedPath: first.savedPath, localEditRoundtrip: roundtrip },
      "task-b": { workspaceId: "workspace-b", historyItemId: second.id, savedPath: second.savedPath, localEditRoundtrip: otherRoundtrip },
    },
  );

  assert.equal(repaired.items[0].localEditRoundtrip.sourceHistoryId, "other-source");
  assert.equal(repaired.items[1].localEditRoundtrip.sourceHistoryId, "planar-source");
});
