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
const realAtob = globalThis.atob;
const realBtoa = globalThis.btoa;

function installBase64() {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
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

function installEnvironment() {
  globalThis.document = {
    body: { appendChild() {} },
    createElement(tag) {
      if (tag === "a") {
        return { href: "", download: "", click() {}, remove() {} };
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
        const canvas = {
          width: 0,
          height: 0,
          toBlob(callback) {
            callback(new Blob(["canvas"], { type: "image/png" }));
          },
        };
        const gl = {
          canvas,
          drawingBufferWidth: 1,
          drawingBufferHeight: 1,
          VERTEX_SHADER: 0x8b31,
          FRAGMENT_SHADER: 0x8b30,
          COMPILE_STATUS: 0x8b81,
          LINK_STATUS: 0x8b82,
          ARRAY_BUFFER: 0x8892,
          STATIC_DRAW: 0x88e4,
          FLOAT: 0x1406,
          TEXTURE0: 0x84c0,
          TEXTURE_2D: 0x0de1,
          CLAMP_TO_EDGE: 0x812f,
          LINEAR: 0x2601,
          TEXTURE_WRAP_S: 0x2802,
          TEXTURE_WRAP_T: 0x2803,
          TEXTURE_MIN_FILTER: 0x2801,
          TEXTURE_MAG_FILTER: 0x2800,
          RGBA: 0x1908,
          UNSIGNED_BYTE: 0x1401,
          UNPACK_FLIP_Y_WEBGL: 0x9240,
          TRIANGLE_STRIP: 0x0005,
          COLOR_BUFFER_BIT: 0x4000,
          createShader() { return {}; },
          shaderSource() {},
          compileShader() {},
          getShaderParameter() { return true; },
          getShaderInfoLog() { return ""; },
          deleteShader() {},
          createProgram() { return {}; },
          attachShader() {},
          linkProgram() {},
          getProgramParameter() { return true; },
          getProgramInfoLog() { return ""; },
          deleteProgram() {},
          viewport() {},
          clearColor() {},
          clear() {},
          useProgram() {},
          getAttribLocation(_program, name) { return name === "a_position" ? 0 : 1; },
          getUniformLocation() { return 0; },
          createBuffer() { return {}; },
          bindBuffer() {},
          bufferData() {},
          enableVertexAttribArray() {},
          vertexAttribPointer() {},
          createTexture() { return {}; },
          activeTexture() {},
          bindTexture() {},
          texParameteri() {},
          pixelStorei() {},
          texImage2D() {},
          uniform1i() {},
          drawArrays() {},
          flush() {},
          getExtension() { return { loseContext() {} }; },
          deleteBuffer() {},
          deleteTexture() {},
        };
        canvas.getContext = function getContext(kind) {
            if (kind === "webgl" || kind === "experimental-webgl") return gl;
            return {
              translate() {},
              rotate() {},
              drawImage() {},
              scale() {},
            };
          };
        return canvas;
      }
      return {};
    },
  };
  globalThis.window = {
    location: { href: "" },
    open() {
      return { closed: false };
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel)",
      platform: "Linux armv8l",
      userAgentData: { platform: "Android" },
    },
  });
  globalThis.URL = {
    ...URL,
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => {},
  };
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
    installStorage();
    installEnvironment();
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
    globalThis.atob = realAtob;
    globalThis.btoa = realBtoa;
    delete globalThis.__probeCalls;
  }
}

function loadRuntimeHost() {
  return import(`../src/platform/runtime/host.ts?runtime-host-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function loadVirtualHostStore() {
  return import(`../src/lib/virtualHostStore.ts?virtual-host-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("runtimeHost remote mode emits job lifecycle events", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/v1/responses")) {
        return new Response(
          'data: {"type":"response.created"}\n' +
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj","revised_prompt":"rev"}}\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");

    const seen = { progress: [], result: [], error: [] };
    const started = await runtimeHost.Generate({
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
      concurrencyLimit: 0,
    });

    const offProgress = runtimeHost.EventsOn(`progress:${started.jobId}`, (payload) => {
      seen.progress.push(payload);
    });
    const offResult = runtimeHost.EventsOn(`result:${started.jobId}`, (payload) => {
      seen.result.push(payload);
    });
    const offError = runtimeHost.EventsOn(`error:${started.jobId}`, (payload) => {
      seen.error.push(payload);
    });

    await new Promise((resolve) => setImmediate(resolve));
    offProgress();
    offResult();
    offError();

    assert.equal(seen.error.length, 0);
    assert.ok(seen.result.length >= 1);
    assert.equal(seen.result[0].imageB64, "YWJj");
    assert.equal(seen.result[0].revisedPrompt, "rev");
  });
});

test("runtimeHost emits APIMart task submission before final result", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/images/generations")) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({
          task_id: "task_host",
          data: {
            image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");

    const seen = { tasks: [], result: [], error: [] };
    const started = await runtimeHost.Generate({
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
      noPromptRevision: false,
      concurrencyLimit: 0,
    });

    const offTask = runtimeHost.EventsOn(`apimart-task:${started.jobId}`, (payload) => {
      seen.tasks.push(payload);
    });
    const offResult = runtimeHost.EventsOn(`result:${started.jobId}`, (payload) => {
      seen.result.push(payload);
    });
    const offError = runtimeHost.EventsOn(`error:${started.jobId}`, (payload) => {
      seen.error.push(payload);
    });

    await new Promise((resolve) => setImmediate(resolve));
    offTask();
    offResult();
    offError();

    assert.equal(seen.error.length, 0);
    assert.equal(seen.tasks.length, 1);
    assert.equal(seen.tasks[0].taskId, "task_host");
    assert.equal(seen.tasks[0].status, "submitted");
    assert.ok(seen.result.length >= 1);
    assert.equal(seen.result[0].apimartTaskId, "task_host");
  });
});

test("runtimeHost remote mode forwards partial image previews", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/v1/responses")) {
        return new Response(
          'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA==","revised_prompt":"partial rev"}\n' +
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"final rev"}}\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");

    const started = await runtimeHost.Generate({
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
      concurrencyLimit: 0,
      partialImages: 1,
    });

    const seen = { preview: [], result: [] };
    const offPreview = runtimeHost.EventsOn(`preview:${started.jobId}`, (payload) => {
      seen.preview.push(payload);
    });
    const offResult = runtimeHost.EventsOn(`result:${started.jobId}`, (payload) => {
      seen.result.push(payload);
    });

    await new Promise((resolve) => setImmediate(resolve));
    offPreview();
    offResult();

    assert.equal(seen.preview.length, 1);
    assert.equal(seen.preview[0].imageB64, "cGFydGlhbA==");
    assert.equal(seen.preview[0].partialImageIndex, 0);
    assert.equal(seen.preview[0].mode, "generate");
    assert.equal(seen.preview[0].prompt, "cat");
    assert.equal(seen.result[0].imageB64, "ZmluYWw=");
  });
});

test("runtimeHost remote images mode forwards partial image previews", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/v1/images/generations")) {
        return new Response(
          'data: {"type":"image_generation.partial_image","partial_image_index":1,"b64_json":"aW1hZ2VzLXBhcnRpYWw="}\n' +
          'data: {"type":"image_generation.completed","b64_json":"aW1hZ2VzLWZpbmFs"}\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");

    const started = await runtimeHost.Generate({
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
      textModelID: "",
      imageModelID: "gpt-image-2",
      apiMode: "images",
      requestPolicy: "openai",
      noPromptRevision: false,
      concurrencyLimit: 0,
      partialImages: 1,
    });

    const seen = { preview: [], result: [] };
    const offPreview = runtimeHost.EventsOn(`preview:${started.jobId}`, (payload) => {
      seen.preview.push(payload);
    });
    const offResult = runtimeHost.EventsOn(`result:${started.jobId}`, (payload) => {
      seen.result.push(payload);
    });

    await new Promise((resolve) => setImmediate(resolve));
    offPreview();
    offResult();

    assert.equal(seen.preview.length, 1);
    assert.equal(seen.preview[0].imageB64, "aW1hZ2VzLXBhcnRpYWw=");
    assert.equal(seen.preview[0].partialImageIndex, 1);
    assert.equal(seen.preview[0].mode, "generate");
    assert.equal(seen.result[0].imageB64, "aW1hZ2VzLWZpbmFs");
  });
});

test("runtimeHost Android transforms persist GPU-backed results to host files", async () => {
  await withPatchedGlobals(async () => {
    globalThis.createImageBitmap = async () => ({
      width: 4,
      height: 2,
      close() {},
    });
    const calls = [];
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        calls.push({ method, args });
        queueMicrotask(() => {
          switch (method) {
            case "ReadImageAsBase64":
              window.__imageStudioNativeResolve?.(requestId, "YWJj");
              break;
            case "ImportImageFromB64":
              window.__imageStudioNativeResolve?.(requestId, { path: "/sdcard/imports/gpu-rotated.png", imageB64: args[0] });
              break;
            default:
              window.__imageStudioNativeReject?.(requestId, `unsupported ${method}`);
          }
        });
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.RotateImage("/sdcard/imports/source.png", 90);
    assert.equal(result.path, "/sdcard/imports/gpu-rotated.png");
    assert.equal(result.acceleration, "gpu-webgl");
  });
});

test("runtimeHost Android SaveImagePathAs uses native path save", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        calls.push({ method, args });
        queueMicrotask(() => {
          if (method === "SaveImagePathAs") {
            window.__imageStudioNativeResolve?.(requestId, "content://media/external/images/media/42");
            return;
          }
          window.__imageStudioNativeReject?.(requestId, `unexpected ${method}`);
        });
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const saved = await runtimeHost.SaveImagePathAs("/data/user/0/app/files/full.png", "result.png");
    assert.equal(saved, "content://media/external/images/media/42");
    assert.deepEqual(calls, [
      {
        method: "SaveImagePathAs",
        args: ["/data/user/0/app/files/full.png", "result.png"],
      },
    ]);
  });
});

test("virtualHostStore prunes old in-memory images", async () => {
  await withPatchedGlobals(async () => {}, async () => {
    const virtualHostStore = await loadVirtualHostStore();
    const payload = Buffer.alloc(1024, 1).toString("base64");
    for (let i = 0; i < 32; i++) {
      virtualHostStore.registerVirtualImage({
        imageB64: payload,
        suggestedName: `asset-${i}.png`,
      });
    }
    const stats = virtualHostStore.getVirtualHostMemoryStats();
    assert.equal(stats.imageCount, 24);
    assert.ok(stats.imageBytes <= 24 * 1024);
  });
});

test("runtimeHost windows fallback uses persisted GPU-backed transform when desktop native backend is unavailable", async () => {
  await withPatchedGlobals(async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        userAgentData: { platform: "Windows" },
      },
    });
    globalThis.createImageBitmap = async () => ({
      width: 5,
      height: 3,
      close() {},
    });
    globalThis.window.go = {
      backend: {
        Service: {
          ReadImageAsBase64: async () => "YWJj",
          ImportImageFromB64: async (_b64, _name) => ({ path: "C:/imports/flipped.png", imageB64: "YWJj" }),
        },
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.FlipImage("C:/images/source.png", true);
    assert.equal(result.path, "C:/imports/flipped.png");
    assert.equal(result.acceleration, "gpu-webgl");
  });
});

test("runtimeHost linux fallback uses persisted GPU-backed transform when desktop native backend is unavailable", async () => {
  await withPatchedGlobals(async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        platform: "Linux x86_64",
        userAgentData: { platform: "Linux" },
      },
    });
    globalThis.createImageBitmap = async () => ({
      width: 6,
      height: 4,
      close() {},
    });
    globalThis.window.go = {
      backend: {
        Service: {
          ReadImageAsBase64: async () => "YWJj",
          ImportImageFromB64: async (_b64, _name) => ({ path: "/tmp/imports/cropped.png", imageB64: "YWJj" }),
        },
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.CropImage("/tmp/images/source.png", 1, 1, 3, 2);
    assert.equal(result.path, "/tmp/imports/cropped.png");
    assert.equal(result.acceleration, "gpu-webgl");
  });
});

test("runtimeHost remote cancel aborts pending remote jobs", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return new Response("", { status: 499 });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");

    const started = await runtimeHost.Generate({
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
      concurrencyLimit: 0,
    });

    await runtimeHost.Cancel(started.jobId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof started.jobId, "string");
  });
});

test("runtimeHost probes upstream through Wails backend", async () => {
  await withPatchedGlobals(async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)",
        platform: "MacIntel",
        userAgentData: { platform: "macOS" },
      },
    });
    const calls = [];
    globalThis.window.go = {
      backend: {
        Service: {
          Generate: async () => ({ jobId: "job" }),
          Edit: async () => ({ jobId: "job" }),
          ProbeUpstream: async (payload) => {
            calls.push(payload);
            return { modelCount: 1 };
          },
        },
      },
    };
    globalThis.window.runtime = {
      EventsOnMultiple: () => () => {},
      EventsOff: () => {},
    };
    globalThis.__probeCalls = calls;
    globalThis.fetch = async () => {
      throw new Error("probe should not use browser fetch");
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await runtimeHost.probeCurrentUpstream("https://relay.example.com", "sk-test");
    assert.deepEqual(globalThis.__probeCalls, [
      { baseURL: "https://relay.example.com", apiKey: "sk-test", apiMode: "responses", proxyMode: "system", proxyURL: "" },
    ]);
  });
});

test("runtimeHost probes upstream through Android backend", async () => {
  await withPatchedGlobals(async () => {
    const calls = [];
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        calls.push({ method, args: JSON.parse(payloadJson) });
        queueMicrotask(() => {
          if (method === "ProbeUpstream") {
            window.__imageStudioNativeResolve?.(requestId, { modelCount: 2 });
            return;
          }
          window.__imageStudioNativeReject?.(requestId, `unsupported ${method}`);
        });
      },
    };
    globalThis.__probeCalls = calls;
    globalThis.fetch = async () => {
      throw new Error("probe should not use browser fetch");
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await runtimeHost.probeCurrentUpstream("https://relay.example.com", "sk-android");
    assert.deepEqual(globalThis.__probeCalls, [
      {
        method: "ProbeUpstream",
        args: [{ baseURL: "https://relay.example.com", apiKey: "sk-android", apiMode: "responses", proxyMode: "system", proxyURL: "" }],
      },
    ]);
  });
});

test("runtimeHost reverse prompt uses remote kernel when desktop service is unavailable", async () => {
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/responses")) {
        const body = JSON.parse(init.body);
        assert.equal(body.input[0].content[0].type, "input_text");
        assert.equal(body.input[0].content[1].type, "input_image");
        return new Response('{"output_text":"反推后的主提示词"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");
    const text = await runtimeHost.ReversePrompt({
      apiKey: "key",
      baseURL: "https://upstream.example",
      textModelID: "gpt-5.5",
      imagePaths: [],
      imagePath: "",
      sourceImages: [
        { imageB64: "iVBORw0KGgpzb3VyY2U=", name: "source.png", mimeType: "image/png" },
      ],
    });
    assert.equal(text, "反推后的主提示词");
  });
});

test("runtimeHost can use Android invoke host capabilities directly", async () => {
  await withPatchedGlobals(async () => {
    const state = {
      apiKey: "",
      outputDir: "/sdcard/ImageStudio",
      imported: { path: "/sdcard/imports/source.png", imageB64: "YWJj" },
      selected: { path: "/sdcard/imports/picked.png", size: 3, imageB64: "YWJj" },
    };
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        queueMicrotask(() => {
          switch (method) {
            case "GetStoredAPIKey":
              window.__imageStudioNativeResolve?.(requestId, state.apiKey);
              break;
            case "SetStoredAPIKey":
              state.apiKey = args[1];
              window.__imageStudioNativeResolve?.(requestId, null);
              break;
            case "DeleteStoredAPIKey":
              state.apiKey = "";
              window.__imageStudioNativeResolve?.(requestId, null);
              break;
            case "GetOutputDir":
              window.__imageStudioNativeResolve?.(requestId, state.outputDir);
              break;
            case "SetOutputDir":
              state.outputDir = args[0];
              window.__imageStudioNativeResolve?.(requestId, null);
              break;
            case "ChooseOutputDir":
              window.__imageStudioNativeResolve?.(requestId, state.outputDir);
              break;
            case "OpenImageDialog":
              window.__imageStudioNativeResolve?.(requestId, state.selected);
              break;
            case "ImportImageFromB64":
              window.__imageStudioNativeResolve?.(requestId, state.imported);
              break;
            case "ReadImageAsBase64":
              window.__imageStudioNativeResolve?.(requestId, "YWJj");
              break;
            case "ImportHistoryFromFile":
              window.__imageStudioNativeResolve?.(requestId, '{"items":[]}');
              break;
            case "OpenFile":
            case "OpenOutputDir":
            case "OpenExternalURL":
              window.__imageStudioNativeResolve?.(requestId, null);
              break;
            default:
              window.__imageStudioNativeReject?.(requestId, `unsupported ${method}`);
          }
        });
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("auto");

    assert.equal(runtimeHost.detectHostKind(), "android-shell");
    assert.equal(runtimeHost.getHostCapabilities().nativeFileDialogs, true);
    assert.equal(runtimeHost.getHostCapabilities().nativeHistoryFileIO, true);
    assert.equal(runtimeHost.getHostCapabilities().imageTransformAcceleration, "gpu-webgl");

    await runtimeHost.SetStoredAPIKey("profile:a", "sk-android");
    assert.equal(await runtimeHost.GetStoredAPIKey("profile:a"), "sk-android");
    await runtimeHost.DeleteStoredAPIKey("profile:a");
    assert.equal(await runtimeHost.GetStoredAPIKey("profile:a"), "");

    await runtimeHost.SetOutputDir("/sdcard/NewDir");
    assert.equal(await runtimeHost.GetOutputDir(), "/sdcard/NewDir");
    assert.equal(await runtimeHost.ChooseOutputDir(), "/sdcard/NewDir");

    const picked = await runtimeHost.OpenImageDialog();
    assert.equal(picked.path, "/sdcard/imports/picked.png");
    assert.equal(picked.imageB64, "YWJj");

    const imported = await runtimeHost.ImportImageFromB64("YWJj", "source.png");
    assert.equal(imported.path, "/sdcard/imports/source.png");
    assert.equal(await runtimeHost.ReadImageAsBase64(imported.path), "YWJj");
    assert.equal(await runtimeHost.ImportHistoryFromFile(), '{"items":[]}');
  });
});

test("runtimeHost Android Generate and Edit create distinct submission IDs", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.document.addEventListener = () => {};
    globalThis.window.addEventListener = () => {};
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        calls.push({ method, args });
        queueMicrotask(() => {
          if (method !== "SubmitAndroidJobs") {
            window.__imageStudioNativeReject?.(requestId, `unexpected ${method}`);
            return;
          }
          const payload = args[0];
          const index = calls.length;
          window.__imageStudioNativeResolve?.(requestId, {
            groupId: `group-${index}`,
            jobIds: [`job-${index}`],
            group: {},
          });
        });
      },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("auto");
    const options = {
      apiKey: "test-key",
      mode: "generate",
      prompt: "test prompt",
      size: "1024x1024",
      quality: "low",
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
    };

    assert.deepEqual(await runtimeHost.Generate(options), { jobId: "job-1" });
    assert.deepEqual(await runtimeHost.Edit({
      ...options,
      mode: "edit",
      imagePath: "/sdcard/imports/source.png",
      imagePaths: ["/sdcard/imports/source.png"],
    }), { jobId: "job-2" });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(({ method }) => method), ["SubmitAndroidJobs", "SubmitAndroidJobs"]);
    const generatePayload = calls[0].args[0];
    const editPayload = calls[1].args[0];
    assert.match(generatePayload.clientSubmissionId, /^submission-/);
    assert.match(editPayload.clientSubmissionId, /^submission-/);
    assert.notEqual(generatePayload.clientSubmissionId, editPayload.clientSubmissionId);
    assert.equal(generatePayload.mode, "generate");
    assert.equal(editPayload.mode, "edit");
    assert.equal(generatePayload.batchCount, 1);
    assert.equal(editPayload.batchCount, 1);
  });
});

test("runtimeHost packaged Android Generate and Edit fail closed without the native job bridge", async () => {
  let fetchCount = 0;
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "https://appassets.androidplatform.net/assets/index.html",
      hostname: "appassets.androidplatform.net",
      origin: "https://appassets.androidplatform.net",
      search: "",
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error("remote kernel must not run in packaged Android without the job bridge");
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("auto");
    const options = {
      apiKey: "test-key",
      mode: "generate",
      prompt: "test prompt",
      size: "1024x1024",
      quality: "low",
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
    };

    await assert.rejects(
      runtimeHost.Generate(options),
      /Android 后台 Bridge 不可用，请重启 App/,
    );
    await assert.rejects(
      runtimeHost.Edit({
        ...options,
        mode: "edit",
        imagePath: "/sdcard/imports/source.png",
        imagePaths: ["/sdcard/imports/source.png"],
      }),
      /Android 后台 Bridge 不可用，请重启 App/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetchCount, 0);
  });
});

test("runtimeHost packaged Android credentials fail closed without touching browser storage", async () => {
  let storageCalls = 0;
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "https://appassets.androidplatform.net/assets/index.html",
      hostname: "appassets.androidplatform.net",
      origin: "https://appassets.androidplatform.net",
      search: "",
    };
    globalThis.localStorage = {
      getItem() { storageCalls += 1; return "plaintext-test-credential"; },
      setItem() { storageCalls += 1; },
      removeItem() { storageCalls += 1; },
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await assert.rejects(
      runtimeHost.GetStoredAPIKey("profile:test"),
      /Android 凭据 Bridge 不可用，请重启 App/,
    );
    await assert.rejects(
      runtimeHost.SetStoredAPIKey("profile:test", "plaintext-test-credential"),
      /Android 凭据 Bridge 不可用，请重启 App/,
    );
    await assert.rejects(
      runtimeHost.DeleteStoredAPIKey("profile:test"),
      /Android 凭据 Bridge 不可用，请重启 App/,
    );
    assert.equal(storageCalls, 0);
  });
});

test("runtimeHost localhost preview keeps the remote generation fallback", async () => {
  let upstreamFetchCount = 0;
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5173",
      search: "",
    };
    globalThis.fetch = async (url) => {
      if (String(url) === "https://upstream.example/v1/responses") {
        upstreamFetchCount += 1;
        return new Response(
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"YWJj"}}\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (String(url) === "/__image-studio-files/save-image") {
        return new Response(JSON.stringify({ path: "/project/output.png" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    runtimeHost.setKernelRuntimeMode("remote");
    const started = await runtimeHost.Generate({
      apiKey: "test-key",
      mode: "generate",
      prompt: "test prompt",
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
      concurrencyLimit: 0,
    });

    assert.match(started.jobId, /^job-/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstreamFetchCount, 1);
  });
});

test("runtimeHost Android invoke hooks coexist with shim-installed global callbacks", async () => {
  await withPatchedGlobals(async () => {
    const shimSeen = [];
    globalThis.window.__imageStudioNativeResolve = (requestId, payload) => {
      shimSeen.push({ kind: "resolve", requestId, payload });
    };
    globalThis.window.__imageStudioNativeReject = (requestId, message) => {
      shimSeen.push({ kind: "reject", requestId, message });
    };
    globalThis.window.AndroidImageStudio = {
      invoke(requestId, method, payloadJson) {
        const args = JSON.parse(payloadJson);
        queueMicrotask(() => {
          if (method === "GetStoredAPIKey") {
            window.__imageStudioNativeResolve?.(requestId, `echo:${args[0]}`);
            return;
          }
          if (method === "SetStoredAPIKey") {
            window.__imageStudioNativeResolve?.(requestId, null);
            window.__imageStudioNativeResolve?.("shim-owned-request", { method, payloadJson });
            return;
          }
          window.__imageStudioNativeResolve?.(requestId, null);
        });
      },
    };
    globalThis.__shimSeen = shimSeen;
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const value = await runtimeHost.GetStoredAPIKey("profile:android");
    assert.equal(value, "echo:profile:android");
    await runtimeHost.SetStoredAPIKey("profile:android", "sk-value");
    assert.deepEqual(globalThis.__shimSeen, [
      {
        kind: "resolve",
        requestId: "shim-owned-request",
        payload: {
          method: "SetStoredAPIKey",
          payloadJson: JSON.stringify(["profile:android", "sk-value"]),
        },
      },
    ]);
  });
});
