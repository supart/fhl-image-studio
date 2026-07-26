import assert from "node:assert/strict";
import test from "node:test";

const realWindow = globalThis.window;
const realFetch = globalThis.fetch;

const sync = await import("../src/lib/cliConfigSync.ts");

function installWindow(hostname) {
  globalThis.window = { location: { hostname } };
}

test.afterEach(() => {
  globalThis.window = realWindow;
  globalThis.fetch = realFetch;
});

test("syncCLIConfig posts full FHL defaults to local endpoint", async () => {
  installWindow("127.0.0.1");
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };

  assert.equal(await sync.syncCLIConfig({ apiKey: "test-key" }), true);
  assert.equal(captured.url, "/__image-studio-local-config/cli-env");
  assert.equal(captured.options.method, "POST");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.storageNamespace, "default");
  delete body.storageNamespace;
  assert.deepEqual(body, {
    apiKey: "test-key",
    clearAPIKey: false,
    baseURL: "https://www.fhl.mom",
    apiMode: "images",
    requestPolicy: "openai",
    imagesNewAPICompat: true,
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    outputFormat: "png",
    quality: "medium",
    size: "1024x1024",
    partialImages: 1,
  });
});

test("syncCLIConfig forwards APIMart profile fields", async () => {
  installWindow("localhost");
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };

  await sync.syncCLIConfig({
    apiKey: "sk-apimart",
    baseURL: "https://api.apib.ai",
    apiMode: "apimart",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    textModelID: "gpt-4o-mini",
    imageModelID: "gpt-image-2",
    outputFormat: "webp",
    quality: "high",
    size: "9:16@2k",
    partialImages: 0,
  });

  const body = JSON.parse(captured.options.body);
  delete body.storageNamespace;
  assert.deepEqual(body, {
    apiKey: "sk-apimart",
    clearAPIKey: false,
    baseURL: "https://api.apib.ai",
    apiMode: "apimart",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    textModelID: "gpt-4o-mini",
    imageModelID: "gpt-image-2",
    outputFormat: "webp",
    quality: "high",
    size: "9:16@2k",
    partialImages: 0,
  });
});

test("syncCLIConfig only runs on local preview hosts", async () => {
  installWindow("example.com");
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true };
  };

  assert.equal(await sync.syncCLIConfig(), false);
  assert.equal(called, false);
});

test("syncCLIConfig uses the native Wails bridge outside localhost", async () => {
  let captured = null;
  let fetchCalls = 0;
  globalThis.window = {
    location: { hostname: "wails.localhost" },
    go: {
      backend: {
        DesktopAPI: {
          SyncCLIConfig: async (payload) => { captured = payload; },
        },
      },
    },
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true };
  };

  assert.equal(await sync.syncCLIConfig({ apiKey: "native-test-key", size: "1:1@2k" }), true);
  assert.equal(captured.apiKey, "native-test-key");
  assert.equal(captured.size, "1:1@2k");
  assert.equal(fetchCalls, 0);
});

test("syncCLIConfig forwards RunningHub bridge profile without API key", async () => {
  installWindow("127.0.0.1");
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };

  assert.equal(await sync.syncCLIConfig({
    apiMode: "runninghub",
    baseURL: "http://127.0.0.1:8117",
    apiKey: "should-not-be-written",
    imageModelID: "banana2",
    size: "16:9@1k",
  }), true);
  assert.equal(captured.url, "/__image-studio-local-config/cli-env");
  const body = JSON.parse(captured.options.body);
  delete body.storageNamespace;
  assert.deepEqual(body, {
    apiKey: "",
    clearAPIKey: false,
    baseURL: "http://127.0.0.1:8117",
    apiMode: "runninghub",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    textModelID: "gpt-5.5",
    imageModelID: "banana2",
    outputFormat: "png",
    quality: "medium",
    size: "16:9@1k",
    partialImages: 1,
  });
});
