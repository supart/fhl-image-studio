import assert from "node:assert/strict";
import test from "node:test";
import {
  FHL_EDIT_UPLOAD_MAX_LONG_SIDE,
  prepareFHLEditSourceDataURLForUpload,
  resolveSourceDataURLs,
} from "../src/platform/runtime/remote-kernel/common.ts";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realLocalStorage = globalThis.localStorage;
const realDocument = globalThis.document;
const realWindow = globalThis.window;
const realURL = globalThis.URL;
const realCreateObjectURL = globalThis.URL?.createObjectURL;
const realRevokeObjectURL = globalThis.URL?.revokeObjectURL;
const realAtob = globalThis.atob;
const realBtoa = globalThis.btoa;
const realCreateImageBitmap = globalThis.createImageBitmap;
const PROMPT_OPTIMIZE_BASE_INSTRUCTIONS = "Rewrite the user's image prompt into a clearer, more detailed prompt for image generation. Keep the meaning, preserve the requested subject, and only return the improved prompt text. Do not add explanations, labels, markdown, or quotes.";

function installBase64() {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

function installURLStubs() {
  const fakeURL = {
    ...URL,
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => {},
  };
  globalThis.URL = fakeURL;
}

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function installDocument() {
  globalThis.document = {
    body: {
      appendChild() {},
    },
    createElement(tag) {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          click() {},
          remove() {},
        };
      }
      if (tag === "input") {
        return {
          type: "",
          accept: "",
          style: {},
          files: [],
          addEventListener() {},
          click() {},
          remove() {},
        };
      }
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              translate() {},
              rotate() {},
              drawImage() {},
              scale() {},
            };
          },
          toBlob(callback) {
            callback(new Blob(["canvas"], { type: "image/png" }));
          },
        };
      }
      return {};
    },
  };
  globalThis.window = {
    open() {
      return { closed: false };
    },
    location: { href: "" },
  };
}

function installImmediateTimers() {
  globalThis.setTimeout = (fn, _ms, ...args) => {
    queueMicrotask(() => fn(...args));
    return 0;
  };
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
}

async function withPatchedGlobals(setup, run) {
  try {
    installBase64();
    installURLStubs();
    installStorage();
    installDocument();
    installImmediateTimers();
    await setup();
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    globalThis.localStorage = realLocalStorage;
    globalThis.document = realDocument;
    globalThis.window = realWindow;
    globalThis.URL = realURL;
    if (globalThis.URL && realCreateObjectURL) globalThis.URL.createObjectURL = realCreateObjectURL;
    if (globalThis.URL && realRevokeObjectURL) globalThis.URL.revokeObjectURL = realRevokeObjectURL;
    globalThis.atob = realAtob;
    globalThis.btoa = realBtoa;
    globalThis.createImageBitmap = realCreateImageBitmap;
  }
}

function loadRemoteKernel() {
  return import(`../src/platform/runtime/remoteKernel.ts?test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function fhlEditPayload(apiMode = "images") {
  return {
    apiKey: "key",
    mode: "edit",
    prompt: "safe edit",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    imagePaths: [],
    imagePath: "",
    maskB64: "",
    seed: 0,
    negativePrompt: "",
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    apiMode,
    requestPolicy: "openai",
    noPromptRevision: false,
  };
}

function installFHLEditResizeCanvas(copyText = "fhl-jpeg-copy") {
  let canvas = null;
  globalThis.document.createElement = (tag) => {
    if (tag !== "canvas") return {};
    canvas = {
      width: 0,
      height: 0,
      getContext() {
        return {
          fillStyle: "",
          fillRect() {},
          drawImage() {},
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "",
        };
      },
      toBlob(callback, mimeType) {
        callback(new Blob([copyText], { type: mimeType }));
      },
    };
    return canvas;
  };
  return () => canvas;
}

test("FHL edit upload guard keeps an 8192px reference unchanged", async () => {
  let closed = false;
  const original = "data:image/jpeg;base64," + Buffer.from("safe-reference").toString("base64");
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({
      width: FHL_EDIT_UPLOAD_MAX_LONG_SIDE,
      height: 4096,
      close() { closed = true; },
    });
  }, async () => {
    const prepared = await prepareFHLEditSourceDataURLForUpload(original);
    assert.equal(prepared.dataURL, original);
    assert.equal(prepared.resized, false);
    assert.equal(prepared.uploadWidth, 8192);
    assert.equal(prepared.uploadHeight, 4096);
    assert.equal(closed, true);
  });
});

test("FHL edit upload guard creates an aspect-preserving JPEG copy above 8192px", async () => {
  let closed = false;
  let readCanvas = null;
  const original = "data:image/png;base64," + Buffer.from("oversized-reference").toString("base64");
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({
      width: 12000,
      height: 6000,
      close() { closed = true; },
    });
    readCanvas = installFHLEditResizeCanvas();
  }, async () => {
    const prepared = await prepareFHLEditSourceDataURLForUpload(original);
    assert.equal(prepared.resized, true);
    assert.equal(prepared.originalWidth, 12000);
    assert.equal(prepared.originalHeight, 6000);
    assert.equal(prepared.uploadWidth, 8192);
    assert.equal(prepared.uploadHeight, 4096);
    assert.equal(readCanvas().width, 8192);
    assert.equal(readCanvas().height, 4096);
    assert.match(prepared.dataURL, /^data:image\/jpeg;base64,/);
    assert.equal(Buffer.from(prepared.dataURL.split(",")[1], "base64").toString(), "fhl-jpeg-copy");
    assert.equal(original.endsWith(Buffer.from("oversized-reference").toString("base64")), true);
    assert.equal(closed, true);
  });
});

test("FHL browser upload guard does not change Android native or other provider sources", async () => {
  const original = "data:image/png;base64," + Buffer.from("provider-source").toString("base64");
  let decoded = 0;
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => {
      decoded += 1;
      return { width: 12000, height: 6000, close() {} };
    };
  }, async () => {
    const otherProvider = await resolveSourceDataURLs([
      { imageB64: Buffer.from("provider-source").toString("base64"), mimeType: "image/png", preparedBase: true },
    ], { ...fhlEditPayload("images"), baseURL: "https://api.apimart.ai" });
    assert.deepEqual(otherProvider, [original]);
    assert.equal(decoded, 0);

    globalThis.window.AndroidImageStudio = { invoke() {} };
    const android = await resolveSourceDataURLs([
      { imageB64: Buffer.from("provider-source").toString("base64"), mimeType: "image/png", preparedBase: true },
    ], fhlEditPayload("images"));
    assert.deepEqual(android, [original]);
    assert.equal(decoded, 0);
  });
});

test("FHL Images edit resizes preparedBase sources and reports the upload copy", async () => {
  let capturedFile = null;
  const logs = [];
  const progress = [];
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({ width: 12000, height: 6000, close() {} });
    installFHLEditResizeCanvas("images-copy");
    globalThis.fetch = async (_url, init) => {
      capturedFile = init.body.get("image");
      return new Response('{"data":[{"b64_json":"aW1hZ2U="}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await kernel.runRemoteImageJob({
      payload: fhlEditPayload("images"),
      sourceImages: [{ imageB64: Buffer.from("source").toString("base64"), mimeType: "image/png", preparedBase: true }],
    }, {
      signal: new AbortController().signal,
      onLog: (line) => logs.push(line),
      onProgress: (stage) => progress.push(stage),
    });
    assert.ok(capturedFile instanceof Blob);
    assert.equal(capturedFile.type, "image/jpeg");
    assert.equal(await capturedFile.text(), "images-copy");
    assert.ok(logs.some((line) => line.includes("12000x6000 -> 8192x4096")));
    assert.ok(progress.some((stage) => stage.includes("已生成 8192px 上传副本")));
  });
});

test("FHL Responses edit uses the same upload dimension guard", async () => {
  let capturedBody = null;
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({ width: 10000, height: 5000, close() {} });
    installFHLEditResizeCanvas("responses-copy");
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"cmVzdWx0"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await kernel.runRemoteImageJob({
      payload: fhlEditPayload("responses"),
      sourceImages: [{ imageB64: Buffer.from("source").toString("base64"), mimeType: "image/png" }],
    }, { signal: new AbortController().signal });
    const imageURL = capturedBody.input[0].content.find((item) => item.type === "input_image").image_url;
    assert.match(imageURL, /^data:image\/jpeg;base64,/);
    assert.equal(Buffer.from(imageURL.split(",")[1], "base64").toString(), "responses-copy");
  });
});

test("FHL edit decode failure stops before the upstream request", async () => {
  let fetchCalled = false;
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => { throw new Error("decode failed"); };
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      kernel.runRemoteImageJob({
        payload: fhlEditPayload("images"),
        sourceImages: [{ imageB64: Buffer.from("broken").toString("base64"), mimeType: "image/png" }],
      }, { signal: new AbortController().signal }),
      /参考图解码失败.*上传前停止请求/,
    );
    assert.equal(fetchCalled, false);
  });
});

test("FHL image validation 400 explains non-dimension causes without another resize retry", async () => {
  let calls = 0;
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({ width: 7999, height: 5333, close() {} });
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{"error":{"message":"Bad request to upstream: Invalid image file or mode for image 1, please"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      kernel.runRemoteImageJob({
        payload: fhlEditPayload("images"),
        sourceImages: [{ imageB64: Buffer.from("safe-size").toString("base64"), mimeType: "image/jpeg" }],
      }, { signal: new AbortController().signal }),
      /已限制在 8192px 以内.*格式、透明通道、模型或 Images 编辑兼容性/,
    );
    assert.equal(calls, 1);
  });
});

test("runRemoteImageJob retries retryable responses and returns parsed SSE image", async () => {
  let calls = 0;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("<html>Error code 524 | 524: A timeout occurred</html>", {
          status: 524,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj","revised_prompt":"rev"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(calls, 2);
    assert.equal(result.imageB64, "YWJj");
    assert.equal(result.revisedPrompt, "rev");
    assert.equal(result.sourceEvent, "final");
    assert.ok(result.rawPath?.startsWith("memory://text/"));
  });
});

test("runRemoteImageJob staggers repeated upstream concurrency limit retries", async () => {
  let calls = 0;
  const logs = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 6) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Concurrency limit exceeded for user, please retry later",
            type: "invalid_request_error",
          },
        }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"ZmFsbGJhY2s=","revised_prompt":"ok"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "pressure prompt",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          noPromptRevision: true,
        },
      },
      {
        signal: new AbortController().signal,
        onLog: (line) => logs.push(line),
      },
    );
    assert.equal(calls, 6);
    assert.equal(result.imageB64, "ZmFsbGJhY2s=");
    assert.equal(logs.some((line) => line.includes("staggered retry")), true);
  });
});

test("runRemoteImageJob parses Responses final image from completed SSE event", async () => {
  let capturedBody = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"image_generation_call","status":"completed","result":"Y29tcGxldGVk","revised_prompt":"completed rev"}]}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "edit",
          prompt: "edit room",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          requestPolicy: "openai",
          noPromptRevision: true,
        },
        sourceImages: [
          { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
        ],
      },
      { signal: new AbortController().signal },
    );
    assert.equal(capturedBody.tools[0].action, "edit");
    assert.equal(capturedBody.input[0].content[1].type, "input_image");
    assert.equal(result.imageB64, "Y29tcGxldGVk");
    assert.equal(result.revisedPrompt, "completed rev");
    assert.equal(result.sourceEvent, "final");
  });
});

test("runRemoteImageJob emits Responses API partial image previews", async () => {
  let capturedBody = null;
  const partials = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        'data: {"type":"response.image_generation_call.partial_image","partial_image_index":1,"partial_image_b64":"cGFydGlhbA==","revised_prompt":"partial rev"}\n' +
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"final rev"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          requestPolicy: "openai",
          noPromptRevision: true,
          partialImages: 2,
        },
      },
      {
        signal: new AbortController().signal,
        onPartialImage: (partial) => partials.push(partial),
      },
    );
    assert.equal(capturedBody.tools[0].partial_images, 2);
    assert.equal(result.imageB64, "ZmluYWw=");
    assert.deepEqual(partials, [
      {
        imageB64: "cGFydGlhbA==",
        revisedPrompt: "partial rev",
        partialImageIndex: 1,
        sourceEvent: "responses_partial",
      },
    ]);
  });
});

test("runRemoteImageJob routes RunningHub text-to-image through bridge task polling", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", body: init.body });
      if (String(url).endsWith("/api/generate")) {
        return new Response(JSON.stringify({
          ok: true,
          task: { id: "rh-task-1", status: "queued" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).includes("/api/task?id=rh-task-1")) {
        return new Response(JSON.stringify({
          ok: true,
          task: {
            id: "rh-task-1",
            status: "succeeded",
            images: [{ url: "https://cdn.example/runninghub-result.png" }],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).startsWith("http://127.0.0.1:8117/api/image?url=")) {
        return new Response(Buffer.from("runninghub-result"), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "",
          mode: "generate",
          prompt: "panorama room",
          size: "9:16@4k",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "http://127.0.0.1:8117",
          textModelID: "",
          imageModelID: "banana2",
          apiMode: "runninghub",
          requestPolicy: "openai",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );

    assert.equal(result.sourceEvent, "runninghub_async");
    assert.equal(result.imageB64, Buffer.from("runninghub-result").toString("base64"));

    const submitCall = calls.find((call) => call.url.endsWith("/api/generate"));
    assert.ok(submitCall);
    assert.deepEqual(JSON.parse(submitCall.body), {
      model: "banana2",
      mode: "text-to-image",
      prompt: "panorama room",
      aspect_ratio: "9:16",
      resolution: "4k",
    });
  });
});

test("runRemoteImageJob routes RunningHub image-to-image through upload then bridge polling", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", body: init.body });
      if (String(url).endsWith("/api/upload")) {
        return new Response(JSON.stringify({
          ok: true,
          upload: { imageUrl: "https://cdn.example/source-upload.png" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/api/generate")) {
        return new Response(JSON.stringify({
          ok: true,
          task: { id: "rh-task-2", status: "queued" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).includes("/api/task?id=rh-task-2")) {
        return new Response(JSON.stringify({
          ok: true,
          task: {
            id: "rh-task-2",
            status: "succeeded",
            images: [{ url: "https://cdn.example/edit-result.png" }],
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).startsWith("http://127.0.0.1:8117/api/image?url=")) {
        return new Response(Buffer.from("runninghub-edit"), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "",
          mode: "edit",
          prompt: "edit the room lighting",
          size: "9:16@2k",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "http://127.0.0.1:8117",
          textModelID: "",
          imageModelID: "image_g2",
          apiMode: "runninghub",
          requestPolicy: "openai",
          noPromptRevision: true,
        },
        sourceImages: [
          { imageB64: "c291cmNlLWltYWdl", name: "source.png", mimeType: "image/png" },
        ],
      },
      { signal: new AbortController().signal },
    );

    assert.equal(result.sourceEvent, "runninghub_async");
    assert.equal(result.imageB64, Buffer.from("runninghub-edit").toString("base64"));

    const uploadCall = calls.find((call) => call.url.endsWith("/api/upload"));
    assert.ok(uploadCall);
    assert.equal(uploadCall.body instanceof FormData, true);

    const submitCall = calls.find((call) => call.url.endsWith("/api/generate"));
    assert.ok(submitCall);
    assert.deepEqual(JSON.parse(submitCall.body), {
      model: "image_g2",
      mode: "image-to-image",
      prompt: "edit the room lighting",
      aspect_ratio: "9:16",
      resolution: "2k",
      image_urls: ["https://cdn.example/source-upload.png"],
    });
  });
});

test("runRemoteImageJob rejects Responses final images that repeat a partial preview", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"c2FtZQ==","revised_prompt":"partial rev"}\n' +
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"c2FtZQ==","revised_prompt":"final rev"}}\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "cat",
            size: "1024x1024",
            quality: "low",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://upstream.example",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "responses",
            requestPolicy: "openai",
            noPromptRevision: true,
            partialImages: 1,
          },
        },
        { signal: new AbortController().signal },
      ),
      /最终图与中间预览帧一致/
    );
  });
});

test("runRemoteImageJob rejects partial-only Responses results instead of saving preview frames", async () => {
  const capturedBodies = [];
  const logs = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBodies.push(JSON.parse(init.body));
      return new Response(
        'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA==","revised_prompt":"partial rev"}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "cat",
            size: "2048x2048",
            quality: "high",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://upstream.example",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "responses",
            requestPolicy: "openai",
            noPromptRevision: true,
            partialImages: 1,
          },
        },
        {
          signal: new AbortController().signal,
          onLog: (line) => logs.push(line),
        },
      ),
      /image_generation_call result/
    );
    assert.equal(capturedBodies.length, 3);
    assert.equal(capturedBodies[0].tools[0].partial_images, 1);
    assert.equal(capturedBodies[0].tools[0].size, "2048x2048");
    assert.equal(capturedBodies[0].tools[0].quality, "high");
    assert.ok(capturedBodies[0].instructions.includes("VERBATIM"));
    assert.equal(capturedBodies[1].tools[0].partial_images, 0);
    assert.equal(capturedBodies[2].tools[0].partial_images, 0);
    assert.equal(capturedBodies[2].tools[0].size, "2048x2048");
    assert.equal(capturedBodies[2].tools[0].quality, "medium");
    assert.equal(logs.some((line) => line.includes("disabling partial previews")), true);
    assert.equal(logs.some((line) => line.includes("Auto retry") && line.includes("2048x2048")), true);
  });
});

test("runRemoteImageJob keeps gpt-image-2 9:16 size on retries", async () => {
  const capturedBodies = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBodies.push(JSON.parse(init.body));
      throw new TypeError("Failed to fetch");
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "portrait",
            size: "2160x3840",
            quality: "high",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://upstream.example",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "responses",
            requestPolicy: "openai",
            noPromptRevision: true,
            partialImages: 1,
          },
        },
        { signal: new AbortController().signal },
      ),
    );
    assert.equal(capturedBodies.length, 3);
    assert.equal(capturedBodies[2].tools[0].size, "2160x3840");
    assert.equal(capturedBodies[2].tools[0].quality, "medium");
  });
});

test("runRemoteImageJob rejects partial-only Images API streams instead of saving preview frames", async () => {
  const partials = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "bird",
            size: "1024x1024",
            quality: "medium",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://upstream.example",
            textModelID: "",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            noPromptRevision: false,
            partialImages: 1,
          },
        },
        {
          signal: new AbortController().signal,
          onPartialImage: (partial) => partials.push(partial),
        },
      ),
      /没有返回可用图片/
    );
    assert.equal(partials.length, 3);
    assert.equal(partials[0].sourceEvent, "images_partial");
  });
});

test("runRemoteImageJob parses Images API JSON mode", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        contentType: init.headers["Content-Type"] || init.headers["content-type"] || null,
        body: JSON.parse(init.body),
      };
      return new Response('{"data":[{"b64_json":"img-data","revised_prompt":"img-rev"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "bird",
          size: "1024x1024",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: false,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.url, "https://upstream.example/v1/images/generations");
    assert.equal(captured.body.prompt, "bird");
    assert.equal(result.imageB64, "img-data");
    assert.equal(result.revisedPrompt, "img-rev");
    assert.equal(result.sourceEvent, "images_api");
  });
});

test("runRemoteImageJob preserves FHL gpt-image-2 large sizes on Images API", async () => {
  const cases = [
    { input: "2160x3840" },
    { input: "1152x2048" },
    { input: "2048x1152" },
  ];
  const captured = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured.push({
        url: String(url),
        body: JSON.parse(init.body),
      });
      return new Response('{"data":[{"b64_json":"cm91dGU0aw==","revised_prompt":"ok"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    for (const item of cases) {
      const result = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "tower",
            size: item.input,
            quality: "high",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://www.fhl.mom",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            noPromptRevision: true,
            partialImages: 1,
          },
        },
        {
          signal: new AbortController().signal,
        },
      );
      assert.equal(result.imageB64, "cm91dGU0aw==");
      assert.equal(result.sourceEvent, "images_api");
    }
    assert.equal(captured.length, cases.length);
    for (let i = 0; i < cases.length; i += 1) {
      assert.equal(captured[i].url, "https://www.fhl.mom/v1/images/generations");
      assert.equal(captured[i].body.size, cases[i].input);
    }
  });
});

test("runRemoteImageJob keeps FHL gpt-image-2 exact sizes on Images API", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        body: JSON.parse(init.body),
      };
      return new Response('{"data":[{"b64_json":"d2lkZQ==","revised_prompt":"ok"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cinematic panorama",
          size: "1664x944",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://www.fhl.mom",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.url, "https://www.fhl.mom/v1/images/generations");
    assert.equal(captured.body.size, "1664x944");
    assert.equal(result.imageB64, "d2lkZQ==");
  });
});

test("runRemoteImageJob keeps Android-safe FHL 1K sizes on Images API", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        body: JSON.parse(init.body),
      };
      return new Response('{"data":[{"b64_json":"c2FmZQ==","revised_prompt":"ok"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "portrait",
          size: "864x1536",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://www.fhl.mom",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: true,
          partialImages: 1,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.url, "https://www.fhl.mom/v1/images/generations");
    assert.equal(captured.body.size, "864x1536");
    assert.equal(result.imageB64, "c2FmZQ==");
    assert.equal(result.sourceEvent, "images_api");
  });
});

test("runRemoteImageJob emits Images API stream partial image previews", async () => {
  let captured = null;
  const partials = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        body: JSON.parse(init.body),
      };
      return new Response(
        'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}\n' +
        'data: {"type":"image_generation.completed","b64_json":"ZmluYWw="}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "bird",
          size: "1024x1024",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: false,
          partialImages: 3,
        },
      },
      {
        signal: new AbortController().signal,
        onPartialImage: (partial) => partials.push(partial),
      },
    );
    assert.equal(captured.url, "https://upstream.example/v1/images/generations");
    assert.equal(captured.body.stream, true);
    assert.equal(captured.body.partial_images, 3);
    assert.equal(result.imageB64, "ZmluYWw=");
    assert.equal(result.sourceEvent, "images_api");
    assert.deepEqual(partials, [
      {
        imageB64: "cGFydGlhbA==",
        partialImageIndex: 0,
        sourceEvent: "images_partial",
      },
    ]);
  });
});

test("runRemoteImageJob rejects Images API final images that repeat a partial preview", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"c2FtZQ=="}\n' +
      'data: {"type":"image_generation.completed","b64_json":"c2FtZQ=="}\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "generate",
            prompt: "bird",
            size: "1024x1024",
            quality: "medium",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://upstream.example",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            noPromptRevision: true,
            partialImages: 1,
          },
        },
        { signal: new AbortController().signal },
      ),
      /最终图与中间预览帧一致/
    );
  });
});

test("runRemoteImageJob sends Responses API mask as input_image_mask data URL", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj","revised_prompt":"rev"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "edit",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "iVBORw0KGgp0ZXN0",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          requestPolicy: "openai",
          noPromptRevision: false,
        },
        sourceImages: [
          { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
        ],
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.tools[0].input_image_mask.image_url, "data:image/png;base64,iVBORw0KGgp0ZXN0");
    assert.equal(captured.tools[0].action, "edit");
  });
});

test("runRemoteImageJob sends Images API edit mask with image MIME type", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        body: init.body,
      };
      return new Response('{"data":[{"b64_json":"img-data","revised_prompt":"img-rev"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "edit",
          prompt: "bird",
          size: "1024x1024",
          quality: "medium",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "iVBORw0KGgpmYWtl",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: false,
        },
        sourceImages: [
          { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
        ],
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.url, "https://upstream.example/v1/images/edits");
    assert.ok(captured.body instanceof FormData);
    const mask = captured.body.get("mask");
    assert.ok(mask instanceof Blob);
    assert.equal(mask.type, "image/png");
  });
});

test("runRemoteImageJob omits relay-only fields by default and includes them in compat mode", async () => {
  const capturedBodies = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBodies.push(JSON.parse(init.body));
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj","revised_prompt":"rev"}}\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 123,
          negativePrompt: "avoid blur",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          requestPolicy: "openai",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 123,
          negativePrompt: "avoid blur",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          requestPolicy: "compat",
          noPromptRevision: false,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(capturedBodies[0].tools[0].seed, undefined);
    assert.equal(capturedBodies[0].tools[0].negative_prompt, undefined);
    assert.ok(capturedBodies[0].instructions.includes("VERBATIM"));
    assert.equal(capturedBodies[1].tools[0].seed, 123);
    assert.equal(capturedBodies[1].tools[0].negative_prompt, "avoid blur");
    assert.ok(capturedBodies[1].instructions.includes("policy-compliant visual prompt"));
  });
});

test("optimizePromptRemote extracts output_text", async () => {
  let capturedBody = null;
  let capturedAccept = "";
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      capturedAccept = init.headers.Accept || init.headers.accept || "";
      return new Response('{"output_text":"optimized prompt"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const largeImageB64 = Buffer.alloc(3 * 1024 * 1024, 1).toString("base64");
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      optimizationGuidance: "more cinematic lighting",
      mode: "generate",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt");
    assert.equal(capturedBody.stream, true);
    assert.match(capturedAccept, /text\/event-stream/);
    assert.match(capturedBody.instructions, /required modification direction/);
    assert.match(capturedBody.instructions, /mandatory edit/);
    assert.match(capturedBody.input[0].content[0].text, /Required modification direction:\nmore cinematic lighting/);
  });
});

test("optimizePromptRemote keeps base instructions when guidance is blank", async () => {
  let capturedBody = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response('{"output_text":"optimized prompt"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      optimizationGuidance: "",
      mode: "generate",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt");
    assert.equal(capturedBody.instructions, PROMPT_OPTIMIZE_BASE_INSTRUCTIONS);
    assert.equal(capturedBody.input[0].content[0].text, "Original prompt:\ncat");
  });
});

test("optimizePromptRemote extracts streamed output text", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response([
      'data: {"type":"response.output_text.delta","delta":"optimized "}',
      'data: {"type":"response.output_text.delta","delta":"prompt"}',
      "data: [DONE]",
    ].join("\n"), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      optimizationGuidance: "more cinematic lighting",
      mode: "generate",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt");
  });
});

test("optimizePromptRemote extracts chat-completion compatible text", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [
        { message: { role: "assistant", content: "optimized prompt from compat upstream" } },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      optimizationGuidance: "more cinematic lighting",
      mode: "generate",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt from compat upstream");
  });
});

test("optimizePromptRemote compresses browser fallback source images", async () => {
  let capturedBody = null;
  const largeImageB64 = Buffer.alloc(3 * 1024 * 1024, 1).toString("base64");
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({
      width: 2400,
      height: 1200,
      close() {},
    });
    globalThis.document.createElement = (tag) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              fillStyle: "",
              fillRect() {},
              drawImage() {},
              imageSmoothingEnabled: false,
              imageSmoothingQuality: "",
            };
          },
          toBlob(callback, mimeType) {
            callback(new Blob(["compressed"], { type: mimeType }));
          },
        };
      }
      return {};
    };
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output_text: "optimized prompt" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      optimizationGuidance: "",
      mode: "edit",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [{ name: "cat.png", imageB64: largeImageB64, mimeType: "image/png" }],
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt");
    assert.equal(capturedBody.input[0].content[1].type, "input_image");
    assert.match(capturedBody.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
  });
});

test("reversePromptRemote sends image and extracts output_text", async () => {
  let capturedBody = null;
  let capturedAccept = "";
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      capturedAccept = init.headers.Accept || init.headers.accept || "";
      return new Response('{"output_text":"a detailed generated prompt"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.reversePromptRemote({
      apiKey: "key",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [{ name: "cat.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
    }, new AbortController().signal);
    assert.equal(text, "a detailed generated prompt");
    assert.equal(capturedBody.stream, true);
    assert.match(capturedAccept, /text\/event-stream/);
    assert.match(capturedAccept, /application\/json/);
    assert.match(capturedBody.instructions, /Simplified Chinese text-to-image prompt/);
    assert.match(capturedBody.instructions, /must be in Simplified Chinese/);
    assert.equal(capturedBody.input[0].content[1].type, "input_image");
    assert.equal(capturedBody.input[0].content[1].image_url, "data:image/png;base64,iVBORw0KGgo=");
  });
});

test("reversePromptRemote extracts streamed output_text delta", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response([
      'data: {"type":"response.output_text.delta","delta":"A calm cat"}',
      'data: {"type":"response.output_text.delta","delta":" beside a window"}',
      "data: [DONE]",
    ].join("\n"), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.reversePromptRemote({
      apiKey: "key",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [{ name: "cat.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
    }, new AbortController().signal);
    assert.equal(text, "A calm cat beside a window");
  });
});

test("reversePromptRemote extracts nested Responses message text", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "resp_test",
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: { value: "structured reverse prompt" },
            },
          ],
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.reversePromptRemote({
      apiKey: "key",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [{ name: "cat.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
    }, new AbortController().signal);
    assert.equal(text, "structured reverse prompt");
  });
});

test("reversePromptRemote extracts untyped nested Responses content text", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "resp_test",
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              text: "untyped reverse prompt",
            },
          ],
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.reversePromptRemote({
      apiKey: "key",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [{ name: "cat.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
    }, new AbortController().signal);
    assert.equal(text, "untyped reverse prompt");
  });
});

test("reversePromptRemote surfaces upstream text when no prompt is returned", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        message: "stream_read_error",
        code: "stream_read_error",
        type: "upstream_error",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.reversePromptRemote({
        apiKey: "key",
        baseURL: "https://upstream.example",
        textModelID: "gpt-5.5",
        imagePaths: [],
        imagePath: "",
        sourceImages: [{ name: "cat.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
      }, new AbortController().signal),
      /stream_read_error/,
    );
  });
});

test("reversePromptRemote rejects when no image is available", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called");
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.reversePromptRemote({
        apiKey: "key",
        baseURL: "https://upstream.example",
        textModelID: "gpt-5.5",
        imagePaths: [],
        imagePath: "",
      }, new AbortController().signal),
      /请先导入一张反推图片/
    );
  });
});

test("runRemoteImageJob submits and polls APIMart async text-to-image", async () => {
  const requests = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/v1/images/generations")) {
        return new Response(JSON.stringify({ data: { task_id: "task_apimart_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/v1/tasks/task_apimart_1?language=zh")) {
        return new Response(JSON.stringify({
          status: "succeeded",
          output: { image_url: "data:image/png;base64,YXBpbWFydA==" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1536x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apib.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "YXBpbWFydA==");
    assert.equal(result.sourceEvent, "apimart_async");
    const submit = requests.find((request) => request.url.endsWith("/v1/images/generations"));
    assert.ok(submit);
    assert.equal(submit.url, "https://api.apib.ai/v1/images/generations");
    assert.equal(submit.init.headers.Authorization, "Bearer key");
    const body = JSON.parse(submit.init.body);
    assert.equal(body.model, "gpt-image-2");
    assert.equal(body.prompt, "cat");
    assert.equal(body.size, "3:2");
    assert.equal(body.resolution, "1k");
    assert.equal(body.official_fallback, false);
    assert.deepEqual(body.image_urls, []);
    assert.ok(requests.some((request) => request.url.endsWith("/v1/tasks/task_apimart_1?language=zh")));
  });
});

test("runRemoteImageJob sends legacy APIMart base through local preview legacy proxy", async () => {
  let submitURL = "";
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5173",
    };
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/images/generations")) {
        submitURL = String(url);
        assert.equal(init.headers.Authorization, "Bearer key");
        return new Response(JSON.stringify({ data: { image_url: "data:image/png;base64,bGVnYWN5" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "legacy",
          size: "1:1@1k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apib.ai/v1",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "bGVnYWN5");
    assert.equal(submitURL, "http://127.0.0.1:5173/__image-studio-apimart-legacy/v1/images/generations");
  });
});
test("runRemoteImageJob sends APIMart documented ratio size separately from resolution", async () => {
  let submitBody = null;
  let submitURL = "";
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/images/generations")) {
        submitURL = String(url);
        submitBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          data: { image_url: "data:image/png;base64,cmF0aW8=" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "portrait",
          size: "9:16@2k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai/v1",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "cmF0aW8=");
    assert.equal(submitURL, "https://api.apimart.ai/v1/images/generations");
    assert.equal(submitBody.size, "9:16");
    assert.equal(submitBody.resolution, "2k");
  });
});

test("runRemoteImageJob falls back to legacy APIMart base after official transport failure", async () => {
  const requests = [];
  const logs = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      requests.push({ url: textURL, init });
      if (textURL === "https://api.apimart.ai/v1/images/generations") {
        throw new Error('Post "https://api.apimart.ai/v1/images/generations": dial tcp 157.240.10.36:443: connectex: host has failed to respond');
      }
      if (textURL === "https://api.apib.ai/v1/images/generations") {
        return new Response(JSON.stringify({
          data: { image_url: "data:image/png;base64,bGVnYWN5LWZhbGxiYWNr" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "fallback",
          size: "9:16@1k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      {
        signal: new AbortController().signal,
        onLog: (line) => logs.push(line),
      },
    );
    assert.equal(result.imageB64, "bGVnYWN5LWZhbGxiYWNr");
    assert.equal(result.sourceEvent, "apimart_async");
    assert.deepEqual(requests.map((request) => request.url), [
      "https://api.apimart.ai/v1/images/generations",
      "https://api.apib.ai/v1/images/generations",
    ]);
    assert.equal(logs.some((line) => line.includes("备用域名")), true);
  });
});

test("runRemoteImageJob falls back to legacy APIMart base after official proxy 5xx response", async () => {
  const requests = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      requests.push({ url: textURL, init });
      if (textURL === "https://api.apimart.ai/v1/images/generations") {
        return new Response('Post "https://api.apimart.ai/v1/images/generations": dial tcp 199.59.149.234:443: connectex: connection attempt failed', {
          status: 502,
          headers: { "content-type": "text/plain" },
        });
      }
      if (textURL === "https://api.apib.ai/v1/images/generations") {
        return new Response(JSON.stringify({
          data: { image_url: "data:image/png;base64,cHJveHktZmFsbGJhY2s=" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "proxy fallback",
          size: "9:16@1k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "cHJveHktZmFsbGJhY2s=");
    assert.equal(result.sourceEvent, "apimart_async");
    assert.deepEqual(requests.map((request) => request.url), [
      "https://api.apimart.ai/v1/images/generations",
      "https://api.apib.ai/v1/images/generations",
    ]);
  });
});

test("runRemoteImageJob accepts APIMart documented task-unified ids", async () => {
  const requests = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      requests.push({ url: textURL, init });
      if (textURL.endsWith("/v1/images/generations")) {
        return new Response(JSON.stringify({
          code: 200,
          data: [{ status: "submitted", task_id: "task-unified-1757156493-imcg5zqt" }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/tasks/task-unified-1757156493-imcg5zqt?language=zh")) {
        return new Response(JSON.stringify({
          code: 200,
          data: {
            id: "task-unified-1757156493-imcg5zqt",
            status: "completed",
            result: {
              images: [{ url: ["data:image/png;base64,dW5pZmllZA=="] }],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "doc task id",
          size: "1:1@1k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai/v1",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "dW5pZmllZA==");
    assert.ok(requests.some((request) => request.url === "https://api.apimart.ai/v1/tasks/task-unified-1757156493-imcg5zqt?language=zh"));
  });
});

test("runRemoteImageJob downloads APIMart official result URLs through local proxy", async () => {
  const requests = [];
  const controller = new AbortController();
  let taskPollSignal = null;
  let imageDownloadSignal = null;
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5173",
    };
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      requests.push({ url: textURL, init });
      if (textURL.endsWith("/v1/images/generations")) {
        return new Response(JSON.stringify({
          code: 0,
          data: [{ task_id: "task_apimart_doc" }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/tasks/task_apimart_doc?language=zh")) {
        taskPollSignal = init.signal;
        return new Response(JSON.stringify({
          code: 0,
          data: {
            status: "completed",
            result: {
              images: [
                {
                  url: ["https://cdn.apimart.example/generated.png"],
                },
              ],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.startsWith("http://127.0.0.1:5173/__image-studio-apimart-image/download?")) {
        imageDownloadSignal = init.signal;
        assert.equal(new realURL(textURL).searchParams.get("url"), "https://cdn.apimart.example/generated.png");
        return new Response(new Blob(["proxied-image"], { type: "image/png" }), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
      },
      { signal: controller.signal },
    );
    assert.equal(result.imageB64, Buffer.from("proxied-image").toString("base64"));
    assert.ok(taskPollSignal);
    assert.ok(imageDownloadSignal);
    assert.notEqual(taskPollSignal, controller.signal);
    assert.notEqual(imageDownloadSignal, controller.signal);
    assert.ok(requests.some((request) => request.url.includes("/__image-studio-apimart-image/download?")));
    assert.equal(requests.some((request) => request.url === "https://cdn.apimart.example/generated.png"), false);
  });
});

test("runRemoteImageJob uploads source images before APIMart async image-to-image", async () => {
  const submitBodies = [];
  const progressLines = [];
  let uploadSeen = false;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      if (textURL.endsWith("/v1/uploads/images")) {
        uploadSeen = true;
        assert.equal(init.headers.Authorization, "Bearer key");
        assert.ok(init.body instanceof FormData);
        const file = init.body.get("file");
        assert.ok(file instanceof Blob);
        return new Response(JSON.stringify({ data: { image_url: "https://cdn.example/source.png" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/images/generations")) {
        const body = JSON.parse(init.body);
        submitBodies.push(body);
        return new Response(JSON.stringify({ task_id: "task_apimart_edit" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/tasks/task_apimart_edit?language=zh")) {
        return new Response(JSON.stringify({ data: { status: "done", images: [{ url: "data:image/png;base64,ZWRpdA==" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
      const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "edit",
          prompt: "make it cinematic",
          size: "2160x3840",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
        sourceImages: [{ name: "source.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
      },
      {
        signal: new AbortController().signal,
        onProgress: (stage) => progressLines.push(stage),
      },
    );
    assert.equal(result.imageB64, "ZWRpdA==");
    assert.equal(uploadSeen, true);
    assert.equal(submitBodies.length, 1);
    assert.ok(progressLines.some((line) => line.includes("APIMart") && line.includes("读取参考图")));
    assert.ok(progressLines.some((line) => line.includes("APIMart") && line.includes("1/1")));
    assert.ok(progressLines.some((line) => line.includes("APIMart") && line.includes("提交异步任务")));
    assert.deepEqual(submitBodies[0].image_urls, ["https://cdn.example/source.png"]);
    assert.equal(submitBodies[0].size, "9:16");
    assert.equal(submitBodies[0].resolution, "4k");
  });
});

test("runRemoteImageJob reports APIMart upload failure before task submission", async () => {
  const progressLines = [];
  const requests = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      requests.push(textURL);
      if (textURL.endsWith("/v1/uploads/images")) {
        return new Response(JSON.stringify({ error: { message: "gateway timeout" } }), {
          status: 524,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      () => kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "key",
            mode: "edit",
            prompt: "make it cinematic",
            size: "2160x3840",
            quality: "low",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://api.apimart.ai",
            textModelID: "",
            imageModelID: "gpt-image-2",
            apiMode: "apimart",
            noPromptRevision: true,
          },
          sourceImages: [{ name: "source.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
        },
        {
          signal: new AbortController().signal,
          onProgress: (stage) => progressLines.push(stage),
        },
      ),
      /尚未提交 APIMart 生图任务|APIMart 后台不会看到任务/
    );
    assert.ok(progressLines.some((line) => line.includes("APIMart 准备上传")));
    assert.ok(progressLines.some((line) => line.includes("APIMart 上传参考图 1/1")));
    assert.equal(requests.some((request) => request.endsWith("/v1/images/generations")), false);
  });
});

test("runRemoteImageJob retries APIMart source upload with compressed JPEG after server error", async () => {
  const uploadFiles = [];
  const submitBodies = [];
  const logs = [];
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({
      width: 2400,
      height: 1200,
      close() {},
    });
    globalThis.document.createElement = (tag) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              fillStyle: "",
              fillRect() {},
              drawImage() {},
              imageSmoothingEnabled: false,
              imageSmoothingQuality: "",
            };
          },
          toBlob(callback, mimeType) {
            callback(new Blob(["compressed"], { type: mimeType }));
          },
        };
      }
      return {};
    };
    globalThis.fetch = async (url, init = {}) => {
      const textURL = String(url);
      if (textURL.endsWith("/v1/uploads/images")) {
        const file = init.body.get("file");
        uploadFiles.push(file);
        assert.ok(file instanceof Blob);
        if (uploadFiles.length === 1) {
          return new Response(JSON.stringify({ error: { message: "failed to upload image", type: "server_error" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        assert.equal(file.type, "image/jpeg");
        assert.equal(file.name, "source-1.jpg");
        assert.equal(await file.text(), "compressed");
        return new Response(JSON.stringify({ url: "https://upload.apimart.ai/f/image/retry-source.jpg" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/images/generations")) {
        const body = JSON.parse(init.body);
        submitBodies.push(body);
        return new Response(JSON.stringify({ data: [{ status: "submitted", task_id: "task_apimart_retry_upload" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (textURL.endsWith("/v1/tasks/task_apimart_retry_upload?language=zh")) {
        return new Response(JSON.stringify({ data: { status: "completed", result: { images: [{ url: ["data:image/png;base64,cmV0cnk="] }] } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected APIMart request ${url}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "edit",
          prompt: "make it cinematic",
          size: "16:9@1k",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://api.apimart.ai",
          textModelID: "",
          imageModelID: "gpt-image-2",
          apiMode: "apimart",
          noPromptRevision: true,
        },
        sourceImages: [{ name: "source.png", imageB64: "iVBORw0KGgo=", mimeType: "image/png" }],
      },
      {
        signal: new AbortController().signal,
        onLog: (line) => logs.push(line),
      },
    );
    assert.equal(result.imageB64, "cmV0cnk=");
    assert.equal(uploadFiles.length, 2);
    assert.equal(submitBodies.length, 1);
    assert.deepEqual(submitBodies[0].image_urls, ["https://upload.apimart.ai/f/image/retry-source.jpg"]);
    assert.equal(logs.some((line) => line.includes("重试上传成功") || line.includes("retry upload succeeded")), true);
  });
});
test("Android shell remote kernel can use native HTTP bridge to bypass browser fetch", async () => {
  const partials = [];
  const progressEvents = [];
  await withPatchedGlobals(async () => {
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        queueMicrotask(() => {
          if (method === "HttpRequestText") {
            const payload = args[0];
            if (payload.url.endsWith("/v1/responses")) {
              assert.equal(payload.streamLines, true);
              window.__imageStudioNativeProgress?.(payload.requestKey, {
                line: 'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
              });
              window.__imageStudioNativeResolve?.(requestId, {
                status: 200,
                body: 'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}\n' +
                  'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YW5kcm9pZA==","revised_prompt":"native bridge"}}\n',
                contentType: "text/event-stream",
              });
              return;
            }
          }
          if (method === "CancelHttpRequest") {
            window.__imageStudioNativeResolve?.(requestId, null);
            return;
          }
          window.__imageStudioNativeReject?.(requestId, `unsupported ${method}`);
        });
      },
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel)",
        platform: "Linux armv8l",
        userAgentData: { platform: "Android" },
      },
    });
    globalThis.fetch = async () => {
      throw new Error("browser fetch should not be used in Android native HTTP mode");
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "cat",
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "responses",
          noPromptRevision: false,
        },
      },
      {
        signal: new AbortController().signal,
        onPartialImage: (partial) => partials.push(partial),
        onProgress: (...args) => progressEvents.push(args),
      },
    );
    assert.equal(result.imageB64, "YW5kcm9pZA==");
    assert.equal(result.revisedPrompt, "native bridge");
    assert.equal(partials.length, 1);
    assert.equal(partials[0].imageB64, "cGFydGlhbA==");
    assert.equal(partials[0].partialImageIndex, 0);
    assert.ok(progressEvents.length > 0);
  });
});

test("runRemoteImageJob repairs Images API sizes before submit", async () => {
  let capturedBody = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        '{"data":[{"b64_json":"c2l6ZQ==","revised_prompt":"ok"}]}',
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "key",
          mode: "generate",
          prompt: "repair",
          size: "1793x1025",
          quality: "low",
          outputFormat: "png",
          imagePaths: [],
          imagePath: "",
          maskB64: "",
          seed: 0,
          negativePrompt: "",
          baseURL: "https://upstream.example",
          textModelID: "gpt-5.5",
          imageModelID: "gpt-image-2",
          apiMode: "images",
          requestPolicy: "openai",
          noPromptRevision: true,
          partialImages: 1,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(result.imageB64, "c2l6ZQ==");
    assert.equal(capturedBody.size, "1792x1024");
  });
});

test("buildImagesRequestBody repairs outgoing Images API sizes", async () => {
  const payloads = await import(`../src/platform/runtime/remote-kernel/requestPayloads.ts?test=${Date.now()}`);
  const result = await payloads.buildImagesRequestBody(
    {
      payload: {
        apiKey: "key",
        mode: "generate",
        prompt: "repair",
        size: "1793x1025",
        quality: "low",
        outputFormat: "png",
        imagePaths: [],
        imagePath: "",
        maskB64: "",
        seed: 0,
        negativePrompt: "",
        baseURL: "https://upstream.example/v1/",
        textModelID: "gpt-5.5",
        imageModelID: "gpt-image-2",
        apiMode: "images",
        requestPolicy: "openai",
        noPromptRevision: true,
        partialImages: 1,
      },
    },
    [],
  );
  assert.equal(result.url, "https://upstream.example/v1/images/generations");
  const body = JSON.parse(result.body);
  assert.equal(body.size, "1792x1024");
});
