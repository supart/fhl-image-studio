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
