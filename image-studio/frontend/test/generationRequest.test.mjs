import assert from "node:assert/strict";
import test from "node:test";

test("generation requests map explicitly across Wails and remote hosts", async () => {
  const contract = await import(new URL("../src/platform/runtime/generationRequest.ts", import.meta.url));

  const input = {
    apiKey: "fixture-only",
    apiProfileId: "profile-fixture-1",
    mode: "generate",
    prompt: "fixture prompt",
    size: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    imagePaths: ["fixture.png"],
    imagePath: "fixture.png",
    maskB64: "",
    seed: 7,
    negativePrompt: "",
    baseURL: "https://example.invalid",
    textModelID: "fixture-text",
    imageModelID: "fixture-image",
    proxyMode: "none",
    proxyURL: "",
    apiMode: "images",
    requestPolicy: "compat",
    imagesNewAPICompat: true,
    noPromptRevision: true,
    concurrencyLimit: 1,
    partialImages: 0,
    requestedJobId: "job-fixture-1",
    sourceImages: [{ path: "fixture.png", name: "fixture.png" }],
    unknownField: "must-not-pass-through",
  };

  const edit = contract.generationRequestForMode(input, "edit");
  assert.equal(edit.mode, "edit");
  assert.equal(edit.apiProfileId, "profile-fixture-1");
  assert.equal("unknownField" in edit, false);

  const wails = contract.toWailsGenerationRequest(edit);
  assert.equal(wails.apiProfileId, "profile-fixture-1");
  assert.equal("sourceImages" in wails, false);
  assert.equal("unknownField" in wails, false);

  const remote = contract.toRemoteGenerationPayload(edit);
  assert.equal(remote.apiProfileId, "profile-fixture-1");
  assert.equal(remote.requestPolicy, "compat");
  assert.equal("requestedJobId" in remote, false);
  assert.equal("sourceImages" in remote, false);
  assert.equal("unknownField" in remote, false);
});
