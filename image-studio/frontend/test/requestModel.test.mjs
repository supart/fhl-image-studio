import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PARTIAL_IMAGES,
  buildBatchVariationInstruction,
  buildPromptOptimizePayload,
  buildResponsesPayload,
  buildPromptReversePayload,
  describeProblem,
  isRetryableRaw,
  normalizePartialImages,
  promptWithBatchVariation,
  repairSizeForOpenAI,
} from "../../../shared/kernel/requestModel.js";

test("Responses payload defaults partial_images to streaming preview count", () => {
  const payload = buildResponsesPayload({
    prompt: "cat",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
  }, []);
  assert.equal(payload.tools[0].partial_images, DEFAULT_PARTIAL_IMAGES);
});

test("FHL exact-size gpt-image-2 Responses disables partial previews for stable final ratio", () => {
  const payload = buildResponsesPayload({
    prompt: "portrait ratio test",
    size: "864x1536",
    quality: "medium",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
    apiMode: "responses",
    baseURL: "https://www.fhl.mom",
  }, []);
  assert.equal(payload.tools[0].partial_images, 0);
  assert.match(payload.instructions, /9:16/);
  assert.match(payload.instructions, /MUST use/);
  assert.match(payload.input[0].content[0].text, /竖版/);
  assert.match(payload.input[0].content[0].text, /9:16/);
});

test("FHL exact-size gpt-image-2 Responses adds Chinese aspect suffix by orientation", () => {
  const cases = [
    { size: "1024x1024", aspect: "1:1", copy: /正方形/ },
    { size: "1536x864", aspect: "16:9", copy: /横版/ },
    { size: "864x1536", aspect: "9:16", copy: /竖版/ },
    { size: "2048x1024", aspect: "2:1", copy: /横版/ },
    { size: "1024x2048", aspect: "1:2", copy: /竖版/ },
  ];
  for (const item of cases) {
    const payload = buildResponsesPayload({
      prompt: "ratio matrix test",
      size: item.size,
      quality: "medium",
      outputFormat: "png",
      imageModelID: "gpt-image-2",
      textModelID: "gpt-5.5",
      requestPolicy: "openai",
      apiMode: "responses",
      baseURL: "https://www.fhl.mom/v1",
    }, []);
    const text = payload.input[0].content[0].text;
    assert.equal(payload.tools[0].partial_images, 0);
    assert.match(payload.instructions, new RegExp(item.aspect));
    assert.match(text, new RegExp(item.aspect));
    assert.match(text, item.copy);
  }
});

test("normalizePartialImages clamps OpenAI range", () => {
  assert.equal(normalizePartialImages(undefined), DEFAULT_PARTIAL_IMAGES);
  assert.equal(normalizePartialImages(0), 0);
  assert.equal(normalizePartialImages(-1), DEFAULT_PARTIAL_IMAGES);
  assert.equal(normalizePartialImages(2.8), 2);
  assert.equal(normalizePartialImages(9), 3);
});

test("repairSizeForOpenAI aligns GPT Image 2 pixel sizes", () => {
  assert.deepEqual(repairSizeForOpenAI({ size: "1793x1025" }), { size: "1792x1024" });
  assert.deepEqual(repairSizeForOpenAI({ size: "4096x4096" }), { size: "2880x2880" });
  assert.equal(repairSizeForOpenAI({ size: "2160x3840" }), null);
  assert.equal(repairSizeForOpenAI({ size: "auto" }), null);
});

test("Responses payload preserves the requested image tool size", () => {
  const payload = buildResponsesPayload({
    prompt: "cat",
    size: "864x1536",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
  }, []);
  assert.equal(payload.tools[0].size, "864x1536");
});

test("Responses payload can allow safe prompt adaptation", () => {
  const strictPayload = buildResponsesPayload({
    prompt: "cat",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
    noPromptRevision: true,
  }, []);
  const adaptivePayload = buildResponsesPayload({
    prompt: "cat",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
    noPromptRevision: false,
  }, []);
  assert.ok(strictPayload.instructions.includes("VERBATIM"));
  assert.ok(adaptivePayload.instructions.includes("policy-compliant visual prompt"));
});

test("batch variation is added to Responses and plain prompt payloads", () => {
  const variationInput = {
    prompt: "cat",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
    noPromptRevision: true,
    requestRunId: "run-abc",
    batchVariationKey: "run-abc-1",
    batchIndex: 0,
    batchCount: 3,
  };
  const instruction = buildBatchVariationInstruction(variationInput);
  assert.match(instruction, /independent generation task/);
  assert.match(instruction, /distinct non-duplicate final image/);
  assert.match(instruction, /run-abc-1/);

  const responsesPayload = buildResponsesPayload(variationInput, []);
  assert.equal(responsesPayload.input[0].content[0].text, "cat");
  assert.match(responsesPayload.input[0].content[1].text, /Request isolation/);
  assert.match(responsesPayload.input[0].content[1].text, /run-abc-1/);

  const prompt = promptWithBatchVariation(variationInput);
  assert.match(prompt, /^cat\n\nRequest isolation:/);
  assert.match(prompt, /Do not render the run id/);
});

test("FHL exact-size constraints survive image-to-image batch variation", () => {
  const payload = buildResponsesPayload({
    prompt: "edit the scene",
    size: "1536x768",
    quality: "medium",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
    apiMode: "responses",
    baseURL: "https://www.fhl.mom",
    requestRunId: "run-edit",
    batchVariationKey: "run-edit-2",
    batchIndex: 1,
    batchCount: 3,
  }, ["data:image/png;base64,AAAA"]);

  assert.equal(payload.tools[0].action, "edit");
  assert.equal(payload.tools[0].size, "1536x768");
  assert.equal(payload.tools[0].partial_images, 0);
  assert.match(payload.input[0].content[0].text, /2:1/);
  assert.match(payload.input[0].content[0].text, /横版/);
  assert.match(payload.input[0].content[1].text, /Request isolation/);
  assert.match(payload.input[0].content[1].text, /run-edit-2/);
  assert.equal(payload.input[0].content[2].type, "input_image");
});

test("Reverse prompt payload uses input_text and input_image with Chinese-only instructions", () => {
  const payload = buildPromptReversePayload({
    textModelID: "gpt-5.5",
  }, ["data:image/png;base64,AAAA"]);
  assert.equal(payload.model, "gpt-5.5");
  assert.equal(payload.reasoning.effort, "low");
  assert.equal(payload.store, false);
  assert.equal(payload.input[0].content[0].type, "input_text");
  assert.equal(payload.input[0].content[1].type, "input_image");
  assert.match(payload.instructions, /Simplified Chinese/);
  assert.match(payload.input[0].content[0].text, /Simplified Chinese text-to-image prompt/);
});

test("Prompt optimize payload can apply required modification guidance", () => {
  const basePayload = buildPromptOptimizePayload({
    prompt: "a girl sitting under a tree",
    textModelID: "gpt-5.5",
    mode: "generate",
  }, []);
  assert.doesNotMatch(basePayload.instructions, /required modification direction before polishing/);
  assert.doesNotMatch(basePayload.input[0].content[0].text, /Required modification direction/);

  const guidedPayload = buildPromptOptimizePayload({
    prompt: "a girl sitting under a tree",
    optimizationGuidance: "去掉帽子，天空加一只老鹰",
    textModelID: "gpt-5.5",
    mode: "edit",
  }, ["data:image/png;base64,AAAA"]);
  assert.equal(guidedPayload.model, "gpt-5.5");
  assert.equal(guidedPayload.reasoning.effort, "low");
  assert.equal(guidedPayload.store, false);
  assert.match(guidedPayload.instructions, /required modification direction before polishing/);
  assert.match(guidedPayload.instructions, /required modification direction wins/);
  assert.match(guidedPayload.instructions, /attached images as reference context/);
  assert.match(guidedPayload.input[0].content[0].text, /Original prompt:\na girl sitting under a tree/);
  assert.match(guidedPayload.input[0].content[0].text, /Required modification direction:\n去掉帽子，天空加一只老鹰/);
  assert.equal(guidedPayload.input[0].content[1].type, "input_image");
});

test("describeProblem surfaces text-only upstream responses", () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"I cannot help with that request."}',
    'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Please use a safer prompt."}]}]}}',
  ].join("\n");
  const message = describeProblem(raw);
  assert.match(message, /上游没有返回图片/);
  assert.match(message, /Please use a safer prompt/);
});

test("describeProblem unwraps nested upstream error messages", () => {
  const nested = JSON.stringify({
    error: {
      code: null,
      message: JSON.stringify({
        error: {
          code: "rate_limit_exceeded",
          message: "Rate limit reached for gpt-image-2-codex",
        },
        type: "error",
      }),
      type: "invalid_request_error",
    },
  });
  const raw = [
    'data: {"type":"response.image_generation_call.generating"}',
    nested,
    'data: {"type":"response.failed","response":{"error":{"code":"upstream_error","message":"Upstream request failed"}}}',
  ].join("\n");
  const message = describeProblem(raw);
  assert.match(message, /rate_limit_exceeded/);
  assert.match(message, /Rate limit reached/);
});

test("isRetryableRaw treats nested upstream rate limit as retryable", () => {
  const raw = [
    'data: {"type":"response.image_generation_call.generating"}',
    '{"error":{"message":"{\\"error\\":{\\"code\\":\\"rate_limit_exceeded\\",\\"message\\":\\"Rate limit reached\\"}}","type":"invalid_request_error"}}',
  ].join("\n");
  assert.equal(isRetryableRaw(raw), true);
});
