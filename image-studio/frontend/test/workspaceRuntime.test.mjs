import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultBatchProcessConfig,
  normalizeBatchProcessConfig,
  patchWorkspaceRuntime,
  workspaceRunningCount,
} from "../src/state/workspaceRuntime.ts";

function makeWorkspace(id, prompt) {
  return {
    id,
    name: id,
    promptPrefix: "fixed prefix",
    prompt,
    optimizationGuidance: "加一只老鹰",
    negativePrompt: "low quality",
    mode: "edit",
    size: "1536x1024",
    quality: "high",
    outputFormat: "webp",
    seed: 42,
    batchCount: 4,
    styleTag: "anime",
    sources: [{ path: "input/a.png", name: "a.png", size: 100 }],
    currentImageId: "img-1",
    batchResultIds: ["img-1", "img-2"],
    batchTaskIds: [],
    resultGridOpen: true,
    historyGalleryOpen: true,
    historyGallerySinglePreviewId: "img-1",
    runningJobIds: [],
    jobsTotal: 4,
    jobsCompleted: 2,
    progress: { stage: "running", elapsed: 1, bytes: 2 },
    streamPreview: { jobId: "job-1", updatedAt: 1 },
    streamPreviews: { "job-1": { jobId: "job-1", updatedAt: 1 } },
    lastLogLine: "working",
    errorMessage: "old error",
    errorRawPath: "output/log/raw.json",
    lastPayload: { prompt },
  };
}

test("patchWorkspaceRuntime can reset the active workspace draft without touching other workspaces", () => {
  const first = makeWorkspace("ws-1", "dirty prompt");
  const second = makeWorkspace("ws-2", "keep me");
  const reset = patchWorkspaceRuntime([first, second], "ws-1", {
    promptPrefix: "",
    prompt: "",
    optimizationGuidance: "",
    negativePrompt: "",
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    seed: 0,
    batchCount: 1,
    styleTag: "",
    sources: [],
    currentImageId: null,
    batchResultIds: [],
    batchTaskIds: [],
    resultGridOpen: false,
    historyGalleryOpen: false,
    historyGallerySinglePreviewId: null,
    jobsTotal: 0,
    jobsCompleted: 0,
    progress: null,
    streamPreview: null,
    streamPreviews: {},
    lastLogLine: "",
    errorMessage: null,
    errorRawPath: null,
    lastPayload: null,
  });

  assert.equal(reset[0].promptPrefix, "");
  assert.equal(reset[0].prompt, "");
  assert.equal(reset[0].optimizationGuidance, "");
  assert.equal(reset[0].negativePrompt, "");
  assert.equal(reset[0].mode, "generate");
  assert.equal(reset[0].size, "1024x1024");
  assert.equal(reset[0].quality, "medium");
  assert.equal(reset[0].outputFormat, "png");
  assert.equal(reset[0].seed, 0);
  assert.equal(reset[0].batchCount, 1);
  assert.equal(reset[0].styleTag, "");
  assert.deepEqual(reset[0].sources, []);
  assert.equal(reset[0].currentImageId, null);
  assert.deepEqual(reset[0].batchResultIds, []);
  assert.deepEqual(reset[0].batchTaskIds, []);
  assert.equal(reset[0].resultGridOpen, false);
  assert.equal(reset[0].historyGalleryOpen, false);
  assert.equal(reset[0].historyGallerySinglePreviewId, null);
  assert.equal(reset[0].jobsTotal, 0);
  assert.equal(reset[0].jobsCompleted, 0);
  assert.equal(reset[0].progress, null);
  assert.equal(reset[0].streamPreview, null);
  assert.deepEqual(reset[0].streamPreviews, {});
  assert.equal(reset[0].lastLogLine, "");
  assert.equal(reset[0].errorMessage, null);
  assert.equal(reset[0].errorRawPath, null);
  assert.equal(reset[0].lastPayload, null);
  assert.deepEqual(reset[1], second);
});

test("batch process defaults to auto aspect and preserves explicit manual size mode", () => {
  assert.equal(defaultBatchProcessConfig().autoAspectResolution, "1k");
  assert.equal(defaultBatchProcessConfig().batchSourceSlotIndex, 0);
  assert.equal(normalizeBatchProcessConfig({}).autoAspectResolution, "1k");
  assert.equal(normalizeBatchProcessConfig({}).batchSourceSlotIndex, 0);
  assert.equal(normalizeBatchProcessConfig({ autoAspectResolution: "4k" }).autoAspectResolution, "4k");
  assert.equal(normalizeBatchProcessConfig({ autoAspectResolution: "" }).autoAspectResolution, "");
  assert.equal(normalizeBatchProcessConfig({ batchSourceSlotIndex: 3.8 }).batchSourceSlotIndex, 3);
});

test("profile-scoped running capacity spans Images and Responses tasks", () => {
  const state = {
    runningJobMeta: {
      "images-job": { workspaceId: "ws-1", apiMode: "images", apiProfileId: "fhl-slot-one" },
      "responses-job": { workspaceId: "ws-2", apiMode: "responses", apiProfileId: "fhl-slot-one" },
      "other-responses-job": { workspaceId: "ws-2", apiMode: "responses", apiProfileId: "other-profile" },
    },
  };

  assert.equal(workspaceRunningCount(state, "responses", "fhl-slot-one"), 2);
  assert.equal(workspaceRunningCount(state, "responses"), 2);
});
