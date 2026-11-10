import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fixtureURL = new URL("../../../shared/kernel/testdata/generation-request-contracts.json", import.meta.url);
const requestModelURL = new URL("../../../shared/kernel/requestModel.js", import.meta.url);
const requestPayloadsURL = new URL("../src/platform/runtime/remote-kernel/requestPayloads.ts", import.meta.url);
const apimartURL = new URL("../src/platform/runtime/remote-kernel/apimart.ts", import.meta.url);
const runningHubURL = new URL("../src/platform/runtime/remote-kernel/runninghub.ts", import.meta.url);
const commonURL = new URL("../src/platform/runtime/remote-kernel/common.ts", import.meta.url);

function completePayload(request) {
  return {
    apiKey: "fixture-token-not-a-key",
    imagePaths: [],
    imagePath: "",
    maskB64: "",
    ...request,
  };
}

test("shared generation request fixtures match the JavaScript kernel contract", async () => {
  const fixture = JSON.parse(await readFile(fixtureURL, "utf8"));
  const kernel = await import(requestModelURL.href);
  const requestPayloads = await import(requestPayloadsURL.href);
  const apimart = await import(apimartURL.href);
  const runningHub = await import(runningHubURL.href);
  const common = await import(commonURL.href);
  assert.equal(fixture.schemaVersion, 2);

  for (const entry of fixture.cases) {
    const { request, expected } = entry;
    assert.equal(kernel.normalizeRequestPolicy(request.requestPolicy), expected.normalizedRequestPolicy, entry.id);
    assert.equal(kernel.shouldSendExtendedImageParameters(request.requestPolicy), expected.extendedParameters, entry.id);
    let actualURL;
    let actualBody;
    if (request.apiMode === "responses") {
      actualURL = `${common.normalizeBaseURL(request.baseURL)}/v1/responses`;
      actualBody = kernel.buildResponsesPayload(request, []);
      const instructions = String(actualBody.instructions || "");
      assert.equal(instructions.includes("VERBATIM"), expected.instructionMode === "verbatim", entry.id);
    } else if (request.apiMode === "images") {
      const built = await requestPayloads.buildImagesRequestBody({ payload: completePayload(request) }, []);
      actualURL = built.url;
      actualBody = JSON.parse(String(built.body));
    } else if (request.apiMode === "apimart") {
      actualURL = apimart.apimartEndpoint(request.baseURL, expected.wire.endpointPath);
      actualBody = apimart.buildAPIMartSubmitPayload(completePayload(request), request.uploadedImageURLs);
    } else if (request.apiMode === "runninghub") {
      actualURL = runningHub.runningHubEndpoint(request.baseURL, expected.wire.endpointPath);
      actualBody = runningHub.buildRunningHubSubmitPayload(completePayload(request), request.uploadedImageURLs);
    } else {
      assert.fail(`${entry.id}: unsupported apiMode ${request.apiMode}`);
    }
    assert.equal(expected.wire.bodyType, "json", entry.id);
    assert.equal(actualURL, expected.wire.url, entry.id);
    assert.deepEqual(actualBody, expected.wire.body, entry.id);
  }
});

test("future GPT Image 2.x models keep transparent output in both request routes", async () => {
  const requestPayloads = await import(requestPayloadsURL.href);
  const request = completePayload({
    apiMode: "images",
    baseURL: "https://www.fhl.mom",
    prompt: "transparent product cutout",
    imageModelID: "gpt-image-2.6-sunburst",
    outputFormat: "jpeg",
    backgroundMode: "transparent",
    requestPolicy: "openai",
  });
  const imagesBody = requestPayloads.buildImagesGenerationPayload(request);
  assert.equal(imagesBody.background, "transparent");
  assert.equal(imagesBody.output_format, "png");
  assert.equal(imagesBody.response_format, "b64_json");

  const responsesBody = requestPayloads.buildResponsesPayload(request, []);
  const tool = responsesBody.tools[0];
  assert.equal(tool.background, "transparent");
  assert.equal(tool.output_format, "png");
});

test("opaque-only and unknown models cannot emit transparent request parameters", async () => {
  const requestPayloads = await import(requestPayloadsURL.href);
  for (const imageModelID of ["gpt-image-2", "gpt-image-20", "custom-image-model"]) {
    const request = completePayload({
      apiMode: "images",
      baseURL: "https://www.fhl.mom",
      prompt: "opaque fallback",
      imageModelID,
      outputFormat: "jpeg",
      backgroundMode: "transparent",
      requestPolicy: "openai",
    });
    const imagesBody = requestPayloads.buildImagesGenerationPayload(request);
    assert.equal(imagesBody.background, undefined, imageModelID);
    assert.equal(imagesBody.output_format, "jpeg", imageModelID);

    const responsesBody = requestPayloads.buildResponsesPayload(request, []);
    const tool = responsesBody.tools[0];
    assert.equal(tool.background, undefined, imageModelID);
    assert.equal(tool.output_format, "jpeg", imageModelID);
  }
});
