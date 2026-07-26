import assert from "node:assert/strict";
import test from "node:test";

const entry = await import("../src/components/panorama/panoramaStudioEntry.ts");

test("panorama studio builds a 2:1 generation size without changing prompt semantics", () => {
  assert.equal(entry.supportsPanoramaGenerateAspect({ apiMode: "responses" }), true);
  assert.equal(entry.buildPanoramaGenerateSize({
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
    currentResolution: "2k",
  }), "2048x1024");
  assert.equal(entry.buildPanoramaGenerateSize({
    apiMode: "apimart",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
    currentResolution: "4k",
  }), "2:1@4k");
  assert.equal(entry.buildPanoramaGenerateSize({
    apiMode: "runninghub",
    requestPolicy: "openai",
    imageModelID: "banana2",
    currentResolution: "1k",
  }), "2:1@1k");
});

test("panorama generation keeps 2:1 in manual aspect mode when switching to edit", () => {
  const automatic = {
    inputDir: "",
    outputMode: "source_dir",
    outputDir: "",
    concurrency: 1,
    retryOnFailure: false,
    autoAspectResolution: "1k",
    discoveredSources: [],
  };
  const manual = entry.preservePanoramaManualAspect(automatic);
  assert.notEqual(manual, automatic);
  assert.equal(manual.autoAspectResolution, "");
  assert.deepEqual(manual.discoveredSources, []);

  const alreadyManual = { ...automatic, autoAspectResolution: "" };
  assert.equal(entry.preservePanoramaManualAspect(alreadyManual), alreadyManual);
});

test("panorama studio lists only recent 2:1 history items", () => {
  const history = [
    { id: "pano-size", width: 2048, height: 1024, size: "auto" },
    { id: "square", width: 1024, height: 1024, size: "1024x1024" },
    { id: "pano-value", width: 0, height: 0, size: "2:1@1k" },
    { id: "portrait", width: 768, height: 1536, size: "1:2@1k" },
    { id: "forced", width: 1000, height: 1000, size: "1024x1024", panoramaProject: { sourceHistoryId: "forced", role: "source" } },
  ];
  assert.deepEqual(
    entry.recentPanoramaHistoryItems(history, 5).map((item) => item.id),
    ["pano-size", "pano-value", "forced"],
  );
  assert.deepEqual(
    entry.recentPanoramaHistoryItems(history, 1).map((item) => item.id),
    ["pano-size"],
  );
});
