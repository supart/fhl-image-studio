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
const realFileReader = globalThis.FileReader;

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
    globalThis.FileReader = realFileReader;
    delete globalThis.__probeCalls;
  }
}

function loadRuntimeHost() {
  return import(`../src/platform/runtime/host.ts?runtime-host-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function loadHostBindings() {
  return import(`../src/platform/runtime/hostBindings.ts?host-bindings-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function loadVirtualHostStore() {
  return import(`../src/lib/virtualHostStore.ts?virtual-host-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("hostBindings ignores a legacy Service-only Wails binding", async () => {
  await withPatchedGlobals(async () => {
    globalThis.window.go = {
      backend: {
        Service: {
          Generate: async () => ({ jobId: "legacy-job" }),
        },
      },
    };
  }, async () => {
    const hostBindings = await loadHostBindings();
    assert.equal(hostBindings.getService(), null);
    assert.equal(hostBindings.hasServiceMethod("Generate"), false);
  });
});

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

test("runtimeHost ChooseBatchInputDir avoids unstable browser directory inputs", async () => {
  let attributeCalls = [];

  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5176/",
      origin: "http://127.0.0.1:5176",
      hostname: "127.0.0.1",
    };
    globalThis.window.showDirectoryPicker = undefined;

    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.error = null;
        this.onload = null;
        this.onerror = null;
      }

      readAsDataURL(file) {
        Promise.resolve(typeof file?.arrayBuffer === "function" ? file.arrayBuffer() : new Uint8Array())
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            this.result = `data:${file?.type || "image/png"};base64,${base64}`;
            this.onload?.();
          })
          .catch((error) => {
            this.error = error;
            this.onerror?.();
          });
      }
    };

    const pickedFile = {
      name: "batch-cat.png",
      type: "image/png",
      size: 4,
      async arrayBuffer() {
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
      },
    };

    const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag !== "input") return originalCreateElement(tag);
      const listeners = new Map();
      return {
        type: "",
        accept: "",
        multiple: false,
        style: {},
        files: [pickedFile],
        setAttribute(name, value) {
          attributeCalls.push([name, value]);
        },
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
        click() {
          queueMicrotask(() => listeners.get("change")?.());
        },
        remove() {},
      };
    };

    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/__image-studio-files/save-image")) {
        const body = JSON.parse(String(init?.body || "{}"));
        return new Response(JSON.stringify({
          path: `I:/preview/${body.subdir || "batch-inputs"}/batch-cat.png`,
          name: "batch-cat.png",
          size: 4,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.ChooseBatchInputDir();
    assert.equal(result.images.length, 1);
    assert.match(result.directory, /batch-inputs/i);
    assert.deepEqual(
      attributeCalls
        .map(([name]) => name)
        .filter((name) => name === "webkitdirectory" || name === "directory"),
      [],
    );
  });
});

test("runtimeHost OpenImagesDialog falls back when E2E native multi-select is unavailable", async () => {
  let serviceCalled = false;

  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:9230/",
      origin: "http://127.0.0.1:9230",
      hostname: "127.0.0.1",
    };
    globalThis.window.__IMAGE_STUDIO_E2E_BOOTSTRAP = { enabled: true, e2eOnly: true };
    globalThis.window.go = {
      backend: {
        DesktopAPI: {
          OpenImagesDialog: async () => {
            serviceCalled = true;
            return { files: [] };
          },
        },
      },
    };
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.error = null;
        this.onload = null;
        this.onerror = null;
      }

      readAsDataURL(file) {
        Promise.resolve(typeof file?.arrayBuffer === "function" ? file.arrayBuffer() : new Uint8Array())
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            this.result = `data:${file?.type || "image/png"};base64,${base64}`;
            this.onload?.();
          })
          .catch((error) => {
            this.error = error;
            this.onerror?.();
          });
      }
    };

    const pickedFiles = [
      {
        name: "batch-one.png",
        type: "image/png",
        size: 4,
        async arrayBuffer() {
          return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
        },
      },
      {
        name: "batch-two.jpg",
        type: "image/jpeg",
        size: 3,
        async arrayBuffer() {
          return Uint8Array.from([0xff, 0xd8, 0xff]);
        },
      },
    ];

    const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag !== "input") return originalCreateElement(tag);
      const listeners = new Map();
      return {
        type: "",
        accept: "",
        multiple: false,
        style: {},
        files: pickedFiles,
        setAttribute() {},
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
        click() {
          queueMicrotask(() => listeners.get("change")?.());
        },
        remove() {},
      };
    };

    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/__image-studio-files/save-image")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const name = String(body.name || "image.png");
        return new Response(JSON.stringify({
          path: `I:/preview/${body.subdir || "batch-inputs"}/${name}`,
          name,
          size: body.imageB64?.length || 1,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.OpenImagesDialog();
    assert.equal(serviceCalled, true);
    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].name, "batch-one.png");
    assert.equal(result.files[1].name, "batch-two.jpg");
  });
});

test("runtimeHost OpenImagesDialog keeps browser-selected files when project save fails", async () => {
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:9230/",
      origin: "http://127.0.0.1:9230",
      hostname: "127.0.0.1",
    };
    globalThis.window.__IMAGE_STUDIO_E2E_BOOTSTRAP = { enabled: false, e2eOnly: false };
    globalThis.window.go = {};
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.error = null;
        this.onload = null;
        this.onerror = null;
      }

      readAsDataURL(file) {
        Promise.resolve(typeof file?.arrayBuffer === "function" ? file.arrayBuffer() : new Uint8Array())
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            this.result = `data:${file?.type || "image/png"};base64,${base64}`;
            this.onload?.();
          })
          .catch((error) => {
            this.error = error;
            this.onerror?.();
          });
      }
    };

    const pickedFiles = [
      {
        name: "fallback-one.png",
        type: "image/png",
        size: 4,
        async arrayBuffer() {
          return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
        },
      },
      {
        name: "fallback-two.webp",
        type: "image/webp",
        size: 4,
        async arrayBuffer() {
          return Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
        },
      },
    ];

    const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag !== "input") return originalCreateElement(tag);
      const listeners = new Map();
      return {
        type: "",
        accept: "",
        multiple: false,
        style: {},
        files: pickedFiles,
        setAttribute() {},
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
        click() {
          queueMicrotask(() => listeners.get("change")?.());
        },
        remove() {},
      };
    };

    globalThis.fetch = async (url) => {
      if (String(url).includes("/__image-studio-files/save-image")) {
        throw new TypeError("Failed to fetch");
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.OpenImagesDialog();
    assert.equal(result.files.length, 2);
    assert.match(result.files[0].path, /^memory:\/\/image\//);
    assert.match(result.files[1].path, /^memory:\/\/image\//);
    assert.equal(result.files[0].name, "fallback-one.png");
    assert.equal(await runtimeHost.ReadImageAsBase64(result.files[0].path), "iVBORw==");
  });
});

test("runtimeHost OpenImagesDialog rejects volatile browser files in E2E-only mode", async () => {
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:9230/",
      origin: "http://127.0.0.1:9230",
      hostname: "127.0.0.1",
    };
    globalThis.window.__IMAGE_STUDIO_E2E_BOOTSTRAP = { enabled: true, e2eOnly: true };
    globalThis.window.go = {
      backend: {
        DesktopAPI: {
          OpenImagesDialog: async () => ({ files: [] }),
        },
      },
    };
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.error = null;
        this.onload = null;
        this.onerror = null;
      }

      readAsDataURL(file) {
        Promise.resolve(typeof file?.arrayBuffer === "function" ? file.arrayBuffer() : new Uint8Array())
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            this.result = `data:${file?.type || "image/png"};base64,${base64}`;
            this.onload?.();
          })
          .catch((error) => {
            this.error = error;
            this.onerror?.();
          });
      }
    };

    const pickedFiles = [{
      name: "fallback-one.png",
      type: "image/png",
      size: 4,
      async arrayBuffer() {
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
      },
    }];

    const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag !== "input") return originalCreateElement(tag);
      const listeners = new Map();
      return {
        type: "",
        accept: "",
        multiple: false,
        style: {},
        files: pickedFiles,
        setAttribute() {},
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
        click() {
          queueMicrotask(() => listeners.get("change")?.());
        },
        remove() {},
      };
    };

    globalThis.fetch = async (url) => {
      if (String(url).includes("/__image-studio-files/save-image")) {
        throw new TypeError("Failed to fetch");
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await assert.rejects(
      () => runtimeHost.OpenImagesDialog(),
      /fallback-one\.png/,
    );
  });
});

test("runtimeHost OpenImagesDialog keeps saved E2E files when one browser file fails", async () => {
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:9230/",
      origin: "http://127.0.0.1:9230",
      hostname: "127.0.0.1",
    };
    globalThis.window.__IMAGE_STUDIO_E2E_BOOTSTRAP = { enabled: true, e2eOnly: true };
    globalThis.window.go = {
      backend: {
        DesktopAPI: {
          OpenImagesDialog: async () => ({ files: [] }),
        },
      },
    };
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.result = null;
        this.error = null;
        this.onload = null;
        this.onerror = null;
      }

      readAsDataURL(file) {
        Promise.resolve(typeof file?.arrayBuffer === "function" ? file.arrayBuffer() : new Uint8Array())
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            this.result = `data:${file?.type || "image/png"};base64,${base64}`;
            this.onload?.();
          })
          .catch((error) => {
            this.error = error;
            this.onerror?.();
          });
      }
    };

    const pickedFiles = [
      {
        name: "saved-one.png",
        type: "image/png",
        size: 4,
        async arrayBuffer() {
          return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
        },
      },
      {
        name: "failed-two.png",
        type: "image/png",
        size: 4,
        async arrayBuffer() {
          return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
        },
      },
    ];

    const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag !== "input") return originalCreateElement(tag);
      const listeners = new Map();
      return {
        type: "",
        accept: "",
        multiple: false,
        style: {},
        files: pickedFiles,
        setAttribute() {},
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
        click() {
          queueMicrotask(() => listeners.get("change")?.());
        },
        remove() {},
      };
    };

    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/__image-studio-files/save-image")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const suggestedName = String(body.suggestedName || "image.png");
        if (suggestedName === "failed-two.png") {
          return new Response(JSON.stringify({ error: "disk write failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          path: `I:/preview/${body.subdir || "batch-inputs"}/${suggestedName}`,
          name: suggestedName,
          size: 4,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const result = await runtimeHost.OpenImagesDialog();
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].name, "saved-one.png");
    assert.match(result.files[0].path, /saved-one\.png$/);
  });
});

test("runtimeHost ChooseBatchOutputDir uses the local preview directory picker endpoint", async () => {
  let requestBody = null;

  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5176/",
      origin: "http://127.0.0.1:5176",
      hostname: "127.0.0.1",
    };
    globalThis.window.prompt = () => {
      throw new Error("manual path prompt should not be used");
    };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "/__image-studio-files/choose-directory");
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ path: "D:/FHL-Test/output/batch-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const chosen = await runtimeHost.ChooseBatchOutputDir();
    assert.equal(chosen, "D:/FHL-Test/output/batch-test");
    assert.deepEqual(requestBody, { title: "选择批处理输出目录" });
  });
});

test("runtimeHost ChooseOutputDir uses the local preview directory picker endpoint in browser mode", async () => {
  let requestBody = null;

  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5176/",
      origin: "http://127.0.0.1:5176",
      hostname: "127.0.0.1",
    };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "/__image-studio-files/choose-directory");
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ path: "D:/FHL-Test/output/manual-choice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    const chosen = await runtimeHost.ChooseOutputDir();
    assert.equal(chosen, "D:/FHL-Test/output/manual-choice");
    assert.deepEqual(requestBody, { title: "选择输出目录" });
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

test("vite config routes APIMart local preview through fetch middleware", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /const apimartLegacyProxyPrefix = "\/__image-studio-apimart-legacy"/);
  assert.match(source, /function apimartAPIProxyPlugin\(\): Plugin/);
  assert.match(source, /server\.middlewares\.use\(prefix/);
  assert.match(source, /const upstream = await fetch\(requestURL\.href, init\)/);
  assert.match(source, /mountAPIMartProxy\(server, apimartLegacyProxyPrefix, "https:\/\/api\.apib\.ai"\)/);
  assert.match(source, /mountAPIMartProxy\(server, apimartProxyPrefix, "https:\/\/api\.apimart\.ai"\)/);
  assert.ok(
    source.indexOf('mountAPIMartProxy(server, apimartLegacyProxyPrefix, "https://api.apib.ai")')
      < source.indexOf('mountAPIMartProxy(server, apimartProxyPrefix, "https://api.apimart.ai")'),
  );
});
test("runtimeHost probes APIMart balance through official and legacy preview proxies", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      hostname: "127.0.0.1",
    };
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, balance: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await runtimeHost.probeCurrentUpstream("https://api.apimart.ai/v1", "sk-official", "system", "", "apimart");
    await runtimeHost.probeCurrentUpstream("https://api.apib.ai/v1", "sk-legacy", "system", "", "apimart");
    assert.deepEqual(calls.map((call) => call.url), [
      "http://127.0.0.1:5173/__image-studio-apimart/v1/balance",
      "http://127.0.0.1:5173/__image-studio-apimart-legacy/v1/balance",
    ]);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-official");
    assert.equal(calls[1].init.headers.Authorization, "Bearer sk-legacy");
  });
});

test("runtimeHost falls back to APIMart legacy probe after transport failure", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      hostname: "127.0.0.1",
    };
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        throw new TypeError("connectex: A connection attempt failed");
      }
      return new Response(JSON.stringify({ success: true, balance: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await runtimeHost.probeCurrentUpstream("https://api.apimart.ai/v1", "sk-official", "system", "", "apimart");
    assert.deepEqual(calls.map((call) => call.url), [
      "http://127.0.0.1:5173/__image-studio-apimart/v1/balance",
      "http://127.0.0.1:5173/__image-studio-apimart-legacy/v1/balance",
    ]);
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-official");
    assert.equal(calls[1].init.headers.Authorization, "Bearer sk-official");
  });
});

test("runtimeHost falls back to APIMart legacy probe after probe timeout", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      hostname: "127.0.0.1",
    };
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        throw new DOMException("The operation timed out", "TimeoutError");
      }
      return new Response(JSON.stringify({ success: true, balance: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await runtimeHost.probeCurrentUpstream("https://api.apimart.ai/v1", "sk-official", "system", "", "apimart");
    assert.deepEqual(calls, [
      "http://127.0.0.1:5173/__image-studio-apimart/v1/balance",
      "http://127.0.0.1:5173/__image-studio-apimart-legacy/v1/balance",
    ]);
  });
});

test("runtimeHost reports APIMart balance probe authorization failures", async () => {
  await withPatchedGlobals(async () => {
    globalThis.window.location = {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      hostname: "127.0.0.1",
    };
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "http://127.0.0.1:5173/__image-studio-apimart/v1/balance");
      return new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const runtimeHost = await loadRuntimeHost();
    await assert.rejects(
      () => runtimeHost.probeCurrentUpstream("https://api.apimart.ai", "sk-bad", "system", "", "apimart"),
      /APIMart API Key/,
    );
  });
});

test("runtimeHost probes RunningHub bridge config and capabilities directly", async () => {
  const calls = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/config")) {
        return new Response(JSON.stringify({
          ok: true,
          config: { api_key_configured: true },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/api/runninghub-sizes")) {
        return new Response(JSON.stringify({
          ok: true,
          modes: {
            "text-to-image": { resolutions: ["1k", "2k", "4k"] },
            "image-to-image": { resolutions: ["1k", "2k", "4k"] },
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
    await runtimeHost.probeCurrentUpstream("http://127.0.0.1:8117", "", "system", "", "runninghub");
    assert.deepEqual(calls, [
      "http://127.0.0.1:8117/api/config",
      "http://127.0.0.1:8117/api/runninghub-sizes",
    ]);
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
        DesktopAPI: {
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
        DesktopAPI: {
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
        DesktopAPI: {
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
      { baseURL: "https://relay.example.com", apiKey: "sk-test", proxyMode: "system", proxyURL: "" },
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
        args: [{ baseURL: "https://relay.example.com", apiKey: "sk-android", proxyMode: "system", proxyURL: "" }],
      },
    ]);
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
