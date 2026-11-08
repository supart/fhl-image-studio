import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImagesGenerationPayload,
  buildImagesRequestBody,
} from "../src/platform/runtime/remote-kernel/requestPayloads.ts";

function payload(overrides = {}) {
  return {
    apiKey: "offline-key",
    mode: "generate",
    prompt: "transparent logo",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "webp",
    imageBackgroundMode: "transparent",
    imagePaths: [],
    imagePath: "",
    maskB64: "",
    seed: 0,
    negativePrompt: "",
    baseURL: "https://offline.example",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2.5-flare",
    apiMode: "images",
    requestPolicy: "openai",
    noPromptRevision: true,
    partialImages: 0,
    ...overrides,
  };
}

test("Images generation sends transparent background and PNG only in transparent mode", () => {
  const transparent = buildImagesGenerationPayload(payload());
  assert.equal(transparent.background, "transparent");
  assert.equal(transparent.output_format, "png");
  assert.equal(transparent.prompt.match(/Output on a fully transparent background/g)?.length, 1);

  const standard = buildImagesGenerationPayload(payload({
    imageBackgroundMode: "standard",
    outputFormat: "webp",
  }));
  assert.equal(Object.hasOwn(standard, "background"), false);
  assert.equal(standard.output_format, "webp");
  assert.doesNotMatch(standard.prompt, /fully transparent background/);
});

test("Images edit repeats ordered image fields and sends transparent multipart fields", async () => {
  const sources = [
    "data:image/png;base64,AQID",
    "data:image/jpeg;base64,BAUG",
  ];
  const built = await buildImagesRequestBody({
    payload: payload({ mode: "edit" }),
  }, sources);
  assert.match(built.url, /\/v1\/images\/edits$/);
  assert.ok(built.body instanceof FormData);
  const form = built.body;
  const images = form.getAll("image");
  assert.equal(images.length, 2);
  assert.equal(images[0].name, "source-1.png");
  assert.equal(images[1].name, "source-2.jpg");
  assert.equal(form.getAll("image[]").length, 0);
  assert.equal(form.get("background"), "transparent");
  assert.equal(form.get("output_format"), "png");
  assert.equal(String(form.get("prompt")).match(/Output on a fully transparent background/g)?.length, 1);
});
