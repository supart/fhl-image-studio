import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPSBridgeProfileInput,
  historyItemFromPSBridgeEvent,
} from "../src/platform/runtime/psBridgeContracts.ts";
import { executePSBridgeRemoteDispatch } from "../src/platform/runtime/psBridgeRemoteExecutor.ts";

const fakeProfileCredential = ["sk", "profile-state-secret"].join("-");

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
    maskB64: "mask-that-remote-providers-cannot-use",
    ...overrides,
  };
}

test("PS bridge profile sync never includes the API key", () => {
  const input = buildPSBridgeProfileInput(profileState());
  assert.ok(input);
  assert.equal(input.credentialUser, "profile:default:profile-one");
  assert.equal(input.concurrencyLimit, 1);
  const encoded = JSON.stringify(input);
  assert.equal(encoded.includes(fakeProfileCredential), false);
  assert.equal(encoded.includes("apiKey"), false);

  const runningHub = buildPSBridgeProfileInput(profileState({
    apiMode: "runninghub",
    baseURL: "http://127.0.0.1:8117",
  }));
  assert.equal(runningHub.credentialUser, "");
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
