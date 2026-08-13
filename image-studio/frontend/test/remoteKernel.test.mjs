import assert from "node:assert/strict";
import test from "node:test";

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
  }
}

function loadRemoteKernel() {
  return import(`../src/platform/runtime/remoteKernel.ts?test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

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

test("runRemoteImageJob accepts partial-only Responses results like official app", async () => {
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
    const result = await kernel.runRemoteImageJob(
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
    );
    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].tools[0].partial_images, 1);
    assert.equal(capturedBodies[0].tools[0].size, "2048x2048");
    assert.equal(capturedBodies[0].tools[0].quality, "high");
    assert.ok(capturedBodies[0].instructions.includes("VERBATIM"));
    assert.equal(result.imageB64, "cGFydGlhbA==");
    assert.equal(result.revisedPrompt, "partial rev");
    assert.equal(result.sourceEvent, "partial");
    assert.equal(logs.some((line) => line.includes("disabling partial previews")), false);
    assert.equal(logs.some((line) => line.includes("Auto downgrade retry")), false);
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

test("runRemoteImageJob preserves Images API 9:16 size before sending", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('{"data":[{"b64_json":"img-data"}]}', {
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
          mode: "generate",
          prompt: "bird",
          size: "864x1536",
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
    assert.equal(captured.size, "864x1536");
  });
});

test("runRemoteImageJob sends APIMart aspect and resolution fields", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      if (href.endsWith("/v1/images/generations")) {
        captured = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: { image_url: "data:image/png;base64,YWJj" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected APIMart URL: ${href}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    const result = await kernel.runRemoteImageJob(
      {
        payload: {
          apiKey: "sk-test",
          mode: "generate",
          prompt: "cat",
          size: "9:16@4k",
          quality: "medium",
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
          requestPolicy: "openai",
          noPromptRevision: false,
        },
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.size, "9:16");
    assert.equal(captured.resolution, "4k");
    assert.equal(captured.official_fallback, false);
    assert.equal(result.imageB64, "YWJj");
  });
});

test("runRemoteImageJob preserves APIMart task_id on async task failure", async () => {
  const requested = [];
  const submittedTasks = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      requested.push({ url: href, method: init?.method || "GET" });
      if (href.endsWith("/v1/images/generations")) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ task_id: "task_abc" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.endsWith("/v1/tasks/task_abc?language=zh")) {
        assert.equal(init?.method, "GET");
        return new Response(JSON.stringify({ status: "failed", message: "quota exhausted" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected APIMart URL: ${href}`);
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    try {
      await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "sk-test",
            mode: "generate",
            prompt: "cat",
            size: "864x1536",
            quality: "medium",
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
            requestPolicy: "openai",
            noPromptRevision: false,
          },
        },
        {
          signal: new AbortController().signal,
          onAPIMartTaskSubmitted: (task) => submittedTasks.push(task),
        },
      );
      assert.fail("Expected APIMart task failure");
    } catch (error) {
      assert.equal(error.apimartTaskId, "task_abc");
      assert.equal(error.apimartTaskStatus, "failed");
      assert.match(error.message, /quota exhausted/);
    }
    assert.equal(requested.some((entry) => entry.url.includes("/v1/images/generations")), true);
    assert.equal(requested.some((entry) => entry.url.includes("/v1/tasks/task_abc?language=zh")), true);
    assert.equal(submittedTasks.length, 1);
    assert.equal(submittedTasks[0].taskId, "task_abc");
    assert.equal(submittedTasks[0].status, "submitted");
    assert.match(submittedTasks[0].rawPath ?? "", /^memory:\/\/text\/.*apimart-response-attempt1\.json$/);
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

test("runRemoteImageJob sends previewUrl-only multi sources to Images API edit", async () => {
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
          prompt: "change background",
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
        sourceImages: [
          { path: "/data/user/0/app/files/imports/a.png", name: "a.png", previewUrl: "data:image/png;base64,YWFh" },
          { path: "/data/user/0/app/files/imports/b.jpg", name: "b.jpg", previewUrl: "data:image/jpeg;base64,YmJi" },
        ],
      },
      { signal: new AbortController().signal },
    );
    assert.equal(captured.url, "https://upstream.example/v1/images/edits");
    assert.ok(captured.body instanceof FormData);
    const primary = captured.body.get("image");
    const rest = captured.body.getAll("image[]");
    assert.ok(primary instanceof Blob);
    assert.equal(primary.type, "image/png");
    assert.equal(rest.length, 1);
    assert.ok(rest[0] instanceof Blob);
    assert.equal(rest[0].type, "image/jpeg");
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
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response('{"output_text":"optimized prompt"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    const text = await kernel.optimizePromptRemote({
      apiKey: "key",
      prompt: "cat",
      mode: "generate",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
    }, new AbortController().signal);
    assert.equal(text, "optimized prompt");
  });
});

test("reversePromptRemote posts vision prompt payload and extracts response text", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('{"output_text":"反推后的提示词"}', {
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
      sourceImages: [
        { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
      ],
    }, new AbortController().signal);
    assert.equal(captured.stream, true);
    assert.equal(captured.input[0].content[0].type, "input_text");
    assert.equal(captured.input[0].content[1].type, "input_image");
    assert.equal(text, "反推后的提示词");
  });
});

test("reversePromptRemote ignores metadata-only Responses text such as codex.rate_limits", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "resp_test",
      type: "response.completed",
      response: {
        id: "resp_test",
        metadata: {
          "codex.rate_limits": "not a prompt",
        },
        output: [],
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      kernel.reversePromptRemote({
        apiKey: "key",
        baseURL: "https://upstream.example",
        textModelID: "gpt-5.5",
        imagePaths: [],
        imagePath: "",
        sourceImages: [
          { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
        ],
      }, new AbortController().signal),
      /没有返回可用的反推提示词/,
    );
  });
});

test("reversePromptRemote rejects empty image input", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called without images");
    };
  }, async () => {
    const kernel = await loadRemoteKernel();
    await assert.rejects(
      kernel.reversePromptRemote({
        apiKey: "key",
        baseURL: "https://upstream.example",
        textModelID: "gpt-5.5",
        imagePaths: [],
        imagePath: "",
        sourceImages: [],
      }, new AbortController().signal),
      /先选择一张图片/,
    );
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
