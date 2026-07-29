import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FHL_BASE_URL,
  FHL_TEXT_MODEL_ID,
  keyringUserFor,
} from "../src/lib/profiles.ts";
import {
  buildPSBridgeProfileInput,
  historyItemFromPSBridgeEvent,
  isPSBridgeRetryHost,
} from "../src/platform/runtime/psBridgeContracts.ts";
import { executePSBridgeRemoteDispatch } from "../src/platform/runtime/psBridgeRemoteExecutor.ts";
import { resolveSourceDataURLs } from "../src/platform/runtime/remote-kernel/common.ts";

const fakeProfileCredential = ["sk", "profile-state-secret"].join("-");
const psBridgeContractsSource = await readFile(
  new URL("../src/platform/runtime/psBridgeContracts.ts", import.meta.url),
  "utf8",
);

test("PS bridge retries Wails binding discovery on packaged and loopback development hosts", () => {
  for (const hostname of ["wails.localhost", "localhost", "127.0.0.1", "::1", "LOCALHOST"]) {
    assert.equal(isPSBridgeRetryHost(hostname), true, hostname);
  }
  for (const hostname of ["example.com", "fhl.mom", "", "127.0.0.2"]) {
    assert.equal(isPSBridgeRetryHost(hostname), false, hostname);
  }
});

function profileState(overrides = {}) {
  return {
    profiles: [{
      id: "profile-one",
      name: "Profile One",
      apiMode: "apimart",
      requestPolicy: "openai",
      baseURL: "https://api.example.test",
      textModelID: "text-test",
      imageModelID: "image-test",
      concurrencyLimit: 8,
      createdAt: 1,
    }],
    activeProfileId: "profile-one",
    apiMode: "apimart",
    baseURL: "https://api.example.test",
    textModelID: "text-test",
    imageModelID: "image-test",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    proxyMode: "system",
    proxyURL: "",
    apiKey: fakeProfileCredential,
    fhlTextAPIConfigured: false,
    ...overrides,
  };
}

function remoteDispatch(overrides = {}) {
  return {
    jobId: "ps-job-one",
    clientTaskId: "client-one",
    profileId: "profile-one",
    profileName: "Profile One",
    apiMode: "apimart",
    baseURL: "https://api.example.test",
    textModelID: "text-test",
    imageModelID: "image-test",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    proxyMode: "system",
    proxyURL: "",
    mode: "edit",
    prompt: "replace the selected area",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    seed: 12,
    negativePrompt: "",
    imagePaths: ["C:\\temp\\base.png", "C:\\temp\\reference.webp"],
    preparedBase: true,
    maskB64: "mask-that-remote-providers-cannot-use",
    ...overrides,
  };
}

test("PS bridge prompt profile selects dedicated FHL Text without exposing its key", () => {
  const input = buildPSBridgeProfileInput(profileState({
    fhlTextAPIConfigured: true,
  }));

  assert.ok(input);
  assert.equal(input.promptProfile.provider, "fhl-text");
  assert.match(input.promptProfile.label, /FHL/);
  assert.equal(input.promptProfile.baseURL, FHL_BASE_URL);
  assert.equal(input.promptProfile.credentialUser, keyringUserFor("fhl-text-assistant"));
  assert.equal(input.promptProfile.textModelID, FHL_TEXT_MODEL_ID);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);
});

test("PS bridge prompt profile selects the current Responses profile", () => {
  const responsesProfile = {
    ...profileState().profiles[0],
    id: "current-responses",
    name: "Current Responses",
    apiMode: "responses",
    baseURL: "https://responses-current.example.test",
    textModelID: "current-text-model",
  };
  const input = buildPSBridgeProfileInput(profileState({
    profiles: [responsesProfile],
    activeProfileId: responsesProfile.id,
    apiMode: "responses",
    baseURL: responsesProfile.baseURL,
    textModelID: responsesProfile.textModelID,
  }));

  assert.ok(input);
  assert.equal(input.promptProfile.provider, "current");
  assert.match(input.promptProfile.label, /Responses/);
  assert.equal(input.promptProfile.baseURL, responsesProfile.baseURL);
  assert.equal(input.promptProfile.credentialUser, keyringUserFor(responsesProfile.id));
  assert.equal(input.promptProfile.textModelID, responsesProfile.textModelID);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);
});

test("PS bridge prompt profile falls back from Images to a Responses profile", () => {
  const imageProfile = {
    ...profileState().profiles[0],
    id: "active-images",
    name: "Active Images",
    apiMode: "images",
    baseURL: "https://images.example.test",
    textModelID: "",
  };
  const fallbackProfile = {
    ...profileState().profiles[0],
    id: "fallback-responses",
    name: "Fallback Responses",
    apiMode: "responses",
    baseURL: "https://responses-fallback.example.test",
    textModelID: "fallback-text-model",
  };
  const input = buildPSBridgeProfileInput(profileState({
    profiles: [imageProfile, fallbackProfile],
    activeProfileId: imageProfile.id,
    apiMode: "images",
    baseURL: imageProfile.baseURL,
    textModelID: "",
  }));

  assert.ok(input);
  assert.equal(input.promptProfile.provider, "responses");
  assert.match(input.promptProfile.label, /Responses/);
  assert.equal(input.promptProfile.baseURL, fallbackProfile.baseURL);
  assert.equal(input.promptProfile.credentialUser, keyringUserFor(fallbackProfile.id));
  assert.equal(input.promptProfile.textModelID, fallbackProfile.textModelID);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);
});

test("PS bridge omits prompt profile when no text provider is available", () => {
  const imageProfile = {
    ...profileState().profiles[0],
    id: "images-only",
    name: "Images Only",
    apiMode: "images",
    baseURL: "https://images-only.example.test",
    textModelID: "",
  };
  const input = buildPSBridgeProfileInput(profileState({
    profiles: [imageProfile],
    activeProfileId: imageProfile.id,
    apiMode: "images",
    baseURL: imageProfile.baseURL,
    textModelID: "",
  }));

  assert.ok(input);
  assert.equal(input.promptProfile, undefined);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes("promptProfile"), false);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);
});

test("PS bridge public prompt profile contract exposes only readiness and label", () => {
  const publicProfileBody = psBridgeContractsSource.match(
    /export type PSBridgeProfilePublic = \{([\s\S]*?)\n\};/,
  )?.[1];
  assert.ok(publicProfileBody);

  const publicFields = [...publicProfileBody.matchAll(/^\s+(\w+)\??:/gm)]
    .map((match) => match[1]);
  assert.deepEqual(
    publicFields.filter((field) => field.startsWith("prompt")),
    ["promptOptimizationReady", "promptProviderLabel"],
  );
  assert.equal(publicFields.includes("baseURL"), false);
  assert.equal(publicFields.includes("credentialUser"), false);
  assert.equal(publicFields.includes("apiKey"), false);
  assert.equal(publicFields.includes("key"), false);
});

test("PS bridge generation profile sync never includes the API key", () => {
  const input = buildPSBridgeProfileInput(profileState());
  assert.ok(input);
  assert.equal(input.credentialUser, "profile:default:profile-one");
  assert.equal(input.concurrencyLimit, 1);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);
  assert.equal(input.promptProfile.credentialUser, "profile:default:profile-one");
  assert.equal(input.promptProfile.textModelID, "text-test");

  const runningHub = buildPSBridgeProfileInput(profileState({
    apiMode: "runninghub",
    baseURL: "http://127.0.0.1:8117",
  }));
  assert.equal(runningHub.credentialUser, "");
});

test("PS bridge image capabilities mirror provider size behavior without private routing fields", () => {
  const apimart = buildPSBridgeProfileInput(profileState());
  assert.deepEqual(apimart.imageCapabilities.resolutionPresets, ["1k", "2k", "4k"]);
  assert.equal(apimart.imageCapabilities.aspectPresets.includes("21:9"), true);
  assert.equal(apimart.imageCapabilities.qualityControl, false);
  assert.equal(apimart.imageCapabilities.sizeEncoding, "ratio-resolution");

  const responsesProfile = {
    ...profileState().profiles[0],
    apiMode: "responses",
    imageModelID: "gpt-image-2",
  };
  const responses = buildPSBridgeProfileInput(profileState({
    profiles: [responsesProfile],
    apiMode: "responses",
    imageModelID: "gpt-image-2",
  }));
  assert.equal(responses.imageCapabilities.qualityControl, true);
  assert.equal(responses.imageCapabilities.sizeEncoding, "pixels");
  assert.equal(responses.imageCapabilities.aspectPresets.includes("7:4"), true);

  const runningHub = buildPSBridgeProfileInput(profileState({
    apiMode: "runninghub",
    baseURL: "http://127.0.0.1:8117",
  }));
  assert.equal(runningHub.imageCapabilities.qualityControl, false);
  assert.equal(runningHub.imageCapabilities.aspectPresets.includes("5:4"), false);
  assert.equal(runningHub.imageCapabilities.aspectPresets.includes("21:9"), true);
});

test("PS bridge history preserves source crop metadata without image buffers", () => {
  const item = historyItemFromPSBridgeEvent({
    jobId: "ps-history-one",
    clientTaskId: "client-history-one",
    createdAt: 100,
    mode: "edit",
    prompt: "change color",
    size: "1536x1024",
    quality: "high",
    outputFormat: "png",
    seed: 5,
    negativePrompt: "noise",
    profileId: "profile-one",
    profileName: "Profile One",
    apiMode: "images",
    sources: [{
      order: 0,
      sourceKind: "target",
      displayName: "Layer 1",
      documentId: "doc-1",
      layerId: "layer-1",
      originalWidth: 4000,
      originalHeight: 3000,
      uploadWidth: 640,
      uploadHeight: 480,
      trimMode: "alpha",
    }],
    result: {
      imageId: "asset-one",
      savedPath: "C:\\output\\result.png",
      previewUrl: "/media/thumb/asset-one",
      fullUrl: "/media/full/asset-one",
      width: 1536,
      height: 1024,
    },
  });
  assert.equal(item.id, "ps-bridge:ps-history-one");
  assert.equal(item.savedPath, "C:\\output\\result.png");
  assert.equal(item.psBridge.sources[0].uploadWidth, 640);
  assert.equal(item.imageB64, undefined);
  assert.equal(item.imageBlob, undefined);
});

test("remote PS dispatch reads sources in order, strips unsupported mask, and reports completion", async () => {
  const calls = [];
  let requestSnapshot = null;
  let completion = null;
  let failure = null;
  await executePSBridgeRemoteDispatch(remoteDispatch(), new AbortController().signal, {
    readImage: async (path) => {
      calls.push(path);
      return path.endsWith(".webp") ? "d2VicA==" : "cG5n";
    },
    readCredential: async (user) => {
      assert.equal(user, "profile:default:profile-one");
      return "sk-runtime-only-secret";
    },
    runRemote: async (request) => {
      requestSnapshot = {
        payload: { ...request.payload },
        sources: request.sourceImages.map((source) => ({ ...source })),
      };
      return {
        imageB64: "cmVzdWx0",
        revisedPrompt: "revised",
        sourceEvent: "test.complete",
        rawPath: "C:\\logs\\raw.txt",
        prompt: request.payload.prompt,
        mode: request.payload.mode,
      };
    },
    update: async () => undefined,
    complete: async (input) => { completion = input; },
    fail: async (input) => { failure = input; },
  });

  assert.deepEqual(calls, ["C:\\temp\\base.png", "C:\\temp\\reference.webp"]);
  assert.equal(requestSnapshot.payload.apiKey, "sk-runtime-only-secret");
  assert.equal(requestSnapshot.payload.maskB64, "");
  assert.equal(requestSnapshot.payload.concurrencyLimit, 1);
  assert.equal(requestSnapshot.sources.length, 2);
  assert.equal(requestSnapshot.sources[0].mimeType, "image/png");
  assert.equal(requestSnapshot.sources[1].mimeType, "image/webp");
  assert.equal(requestSnapshot.sources[0].preparedBase, true);
  assert.equal(requestSnapshot.sources[1].preparedBase, false);
  assert.equal(completion.imageB64, "cmVzdWx0");
  assert.equal(completion.rawPath, "C:\\logs\\raw.txt");
  assert.equal(JSON.stringify(completion).includes("sk-runtime-only-secret"), false);
  assert.equal(failure, null);
});

test("remote PS dispatch reports a missing APIMart credential without starting a request", async () => {
  let ran = false;
  let failure = null;
  await executePSBridgeRemoteDispatch(remoteDispatch(), new AbortController().signal, {
    readImage: async () => "cG5n",
    readCredential: async () => "",
    runRemote: async () => {
      ran = true;
      throw new Error("unexpected");
    },
    update: async () => undefined,
    complete: async () => undefined,
    fail: async (input) => { failure = input; },
  });
  assert.equal(ran, false);
  assert.match(failure.message, /no stored credential/i);
});

test("prepared remote base bypasses upload recompression while references keep it", async () => {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const largePayload = Buffer.alloc(600 * 1024, 7).toString("base64");
  globalThis.createImageBitmap = async () => ({ width: 2400, height: 1200, close() {} });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "",
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        fillRect() {},
        drawImage() {},
      }),
      toBlob: (callback) => callback(new Blob(["compressed-reference"], { type: "image/jpeg" })),
    }),
  };
  try {
    const resolved = await resolveSourceDataURLs([
      { name: "base.png", mimeType: "image/png", imageB64: largePayload, preparedBase: true },
      { name: "reference.png", mimeType: "image/png", imageB64: largePayload },
    ], { imagePaths: [] });
    assert.equal(resolved[0], `data:image/png;base64,${largePayload}`);
    assert.match(resolved[1], /^data:image\/jpeg;base64,/);
    assert.notEqual(resolved[1], resolved[0]);
  } finally {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});
