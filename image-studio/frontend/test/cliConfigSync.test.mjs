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

  assert.equal(await sync.syncCLIConfig({ apiKey: "test-key", size: "1536x1024" }), true);
  assert.equal(captured.url, "/__image-studio-local-config/cli-env");
  assert.equal(captured.options.method, "POST");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.storageNamespace, "default");
  delete body.storageNamespace;
  assert.deepEqual(body, {
    apiKey: "test-key",
    clearAPIKey: false,
    baseURL: "https://www.fhl.mom",
    apiMode: "responses",
    requestPolicy: "openai",
    imagesNewAPICompat: false,
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    outputFormat: "png",
    quality: "medium",
    size: "1536x1024",
    partialImages: 1,
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
