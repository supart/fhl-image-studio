import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fixtureURL = new URL("../../../shared/kernel/testdata/generation-request-contracts.json", import.meta.url);
const requestModelURL = new URL("../../../shared/kernel/requestModel.js", import.meta.url);

test("shared generation request fixtures match the JavaScript kernel contract", async () => {
  const fixture = JSON.parse(await readFile(fixtureURL, "utf8"));
  const kernel = await import(requestModelURL.href);
  assert.equal(fixture.schemaVersion, 1);

  for (const entry of fixture.cases) {
    const { request, expected } = entry;
    assert.equal(kernel.normalizeRequestPolicy(request.requestPolicy), expected.normalizedRequestPolicy, entry.id);
    assert.equal(kernel.shouldSendExtendedImageParameters(request.requestPolicy), expected.extendedParameters, entry.id);
    if (request.apiMode !== "responses") continue;

    const payload = kernel.buildResponsesPayload(request, []);
    const instructions = String(payload.instructions || "");
    assert.equal(instructions.includes("VERBATIM"), expected.instructionMode === "verbatim", entry.id);
    assert.equal("seed" in payload.tools[0], expected.extendedParameters, entry.id);
    assert.equal("negative_prompt" in payload.tools[0], expected.extendedParameters, entry.id);
  }
});
