import assert from "node:assert/strict";
import test from "node:test";

import {
  frozenReplayFromHistory,
  frozenReplayFromJobSlot,
  frozenReplayFromLastPayload,
} from "../src/state/frozenSubmissionReplay.ts";

const frozenMetadata = {
  apiProfileId: "fhl-slot-3",
  apiProfileName: "FHL3",
  fhlImagesPoolSlot: 3,
  provider: "fhl",
  imageModelID: "gpt-image-2.5-sunburst",
  imageModelValidatedAt: 1_796_000_000_123,
  imageModelCatalogBaseUrl: "https://www.fhl.mom",
  imageModelCatalogProvider: "fhl",
  imageModelAvailable: true,
  imageModelSupportsGenerations: true,
  imageModelSupportsEdits: true,
  imageModelSupportsTransparency: true,
  imageModelCatalogValidationId: "catalog-proof-slot-3",
};

test("history replay preserves the final prompt, transparent output and reference order", () => {
  const replay = frozenReplayFromHistory({
    id: "history-1",
    createdAt: 1,
    mode: "edit",
    prompt: "already augmented final prompt",
    size: "1536x1024",
    quality: "high",
    outputFormat: "png",
    imageBackgroundMode: "transparent",
    apiMode: "images",
    seed: 77,
    negativePrompt: "blur",
    styleTag: "photo",
    sourceImages: [
      { path: "C:\\input\\first.png", name: "first.png", size: 1 },
      { path: "C:\\input\\second.png", name: "second.png", size: 2 },
    ],
    ...frozenMetadata,
  });

  assert.ok(replay);
  assert.equal(replay.prompt, "already augmented final prompt");
  assert.equal(replay.imageBackgroundMode, "transparent");
  assert.equal(replay.outputFormat, "png");
  assert.equal(replay.imageModelID, "gpt-image-2.5-sunburst");
  assert.equal(replay.imageModelSupportsTransparency, true);
  assert.equal(replay.imageModelCatalogValidationId, "catalog-proof-slot-3");
  assert.deepEqual(replay.sources.map((source) => source.path), [
    "C:\\input\\first.png",
    "C:\\input\\second.png",
  ]);
});

test("job-slot replay uses the frozen slot identity and exact per-slot seed", () => {
  const group = {
    groupId: "group-1",
    workspaceId: "workspace-1",
    createdAt: 1,
    mode: "edit",
    apiMode: "responses",
    prompt: "frozen group prompt",
    batchCount: 4,
    size: "1024x1536",
    quality: "medium",
    outputFormat: "png",
    imageBackgroundMode: "transparent",
    negativePrompt: "noise",
    styleTag: "clean",
    seed: 100,
    sourceImagePaths: ["one.png", "two.png", "three.png"],
    slotIds: ["job-3"],
    slots: [],
    statusSummary: { queued: 0, running: 0, succeeded: 1, failed: 0, cancelled: 0, interrupted: 0 },
    ...frozenMetadata,
  };
  const slot = {
    jobId: "job-3",
    groupId: "group-1",
    workspaceId: "workspace-1",
    batchIndex: 2,
    status: "failed",
    createdAt: 1,
    updatedAt: 2,
    ...frozenMetadata,
  };
  const replay = frozenReplayFromJobSlot(group, slot);

  assert.ok(replay);
  assert.equal(replay.apiMode, "responses");
  assert.equal(replay.seed, 102);
  assert.equal(replay.prompt, "frozen group prompt");
  assert.equal(replay.imageModelSupportsGenerations, true);
  assert.equal(replay.imageModelCatalogValidationId, "catalog-proof-slot-3");
  assert.deepEqual(replay.sources.map((source) => source.path), ["one.png", "two.png", "three.png"]);
});

test("last-payload replay ignores later UI state and retains its sanitized snapshot", () => {
  const replay = frozenReplayFromLastPayload({
    apiKey: "",
    mode: "generate",
    requestedJobId: "",
    prompt: "frozen failed prompt",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageBackgroundMode: "transparent",
    imagePaths: [],
    imagePath: "",
    maskB64: "",
    seed: 9,
    negativePrompt: "",
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    proxyMode: "system",
    proxyURL: "",
    apiMode: "images",
    requestPolicy: "openai",
    imagesNewAPICompat: true,
    noPromptRevision: true,
    concurrencyLimit: 4,
    partialImages: 1,
    styleTag: "",
    ...frozenMetadata,
  });

  assert.ok(replay);
  assert.equal(replay.source, "last-payload");
  assert.equal(replay.prompt, "frozen failed prompt");
  assert.equal(replay.apiProfileId, "fhl-slot-3");
  assert.equal(replay.imageModelValidatedAt, frozenMetadata.imageModelValidatedAt);
  assert.equal(replay.imageModelSupportsEdits, true);
  assert.equal(replay.imageModelCatalogValidationId, "catalog-proof-slot-3");
});

test("job-slot replay rejects conflicting group capability or proof metadata", () => {
  const group = {
    groupId: "group-conflict",
    workspaceId: "workspace-1",
    createdAt: 1,
    mode: "generate",
    apiMode: "images",
    prompt: "conflict",
    batchCount: 1,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    slotIds: ["job-conflict"],
    slots: [],
    statusSummary: { queued: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0, interrupted: 0 },
    ...frozenMetadata,
  };
  const baseSlot = {
    jobId: "job-conflict",
    groupId: group.groupId,
    workspaceId: group.workspaceId,
    batchIndex: 0,
    status: "failed",
    createdAt: 1,
    updatedAt: 2,
    ...frozenMetadata,
  };
  assert.equal(frozenReplayFromJobSlot(group, {
    ...baseSlot,
    imageModelSupportsTransparency: false,
  }), null);
  assert.equal(frozenReplayFromJobSlot(group, {
    ...baseSlot,
    imageModelCatalogValidationId: "different-proof",
  }), null);
});

test("legacy replay retains viewable metadata but cannot invent capability proof", () => {
  const replay = frozenReplayFromHistory({
    id: "legacy-capabilities",
    createdAt: 1,
    mode: "generate",
    prompt: "legacy",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    apiMode: "images",
    ...Object.fromEntries(Object.entries(frozenMetadata).filter(([key]) => (
      !key.startsWith("imageModelSupports")
      && key !== "imageModelAvailable"
      && key !== "imageModelCatalogValidationId"
    ))),
  });
  assert.ok(replay);
  assert.equal(replay.imageModelAvailable, undefined);
  assert.equal(replay.imageModelCatalogValidationId, undefined);
});

test("legacy records without provider/model/profile metadata cannot masquerade as exact replay", () => {
  assert.equal(frozenReplayFromHistory({
    id: "legacy",
    createdAt: 1,
    mode: "generate",
    prompt: "legacy",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
  }), null);
});
