import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const realWindow = globalThis.window;
const realDocument = globalThis.document;
const realNavigator = globalThis.navigator;
const realLocalStorage = globalThis.localStorage;
const frontendRoot = fileURLToPath(new URL("..", import.meta.url));

function installAndroidRuntime() {
  const values = new Map();
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    location: { hostname: "localhost", search: "" },
    addEventListener() {},
    removeEventListener() {},
    visualViewport: {
      addEventListener() {},
      removeEventListener() {},
    },
  };
  globalThis.document = {
    documentElement: {
      dataset: {},
      style: { setProperty() {} },
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      userAgentData: { platform: "Android" },
    },
  });
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function restoreRuntime() {
  globalThis.window = realWindow;
  globalThis.document = realDocument;
  globalThis.localStorage = realLocalStorage;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: realNavigator,
  });
}

function makeProfile(id, patch = {}) {
  return {
    id,
    name: id,
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: "https://example.invalid",
    textModelID: "",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 1,
    imagesNewAPICompat: false,
    createdAt: 1,
    ...patch,
  };
}

function makeState(profiles, activeProfileId) {
  return {
    profiles,
    activeProfileId,
    fhlTransportMode: "images",
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: "https://example.invalid",
    textModelID: "",
    imageModelID: "gpt-image-2",
    imagesNewAPICompat: false,
    apiKey: "",
    pushToast() {},
  };
}

test("Android profile actions never leave a text-only FHL profile active", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { createProfileActions } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const generation = makeProfile("generation");
    const text = makeProfile("text", {
      apiMode: "responses",
      baseURL: "https://www.fhl.mom",
      imageModelID: "",
      textModelID: "gpt-5.5",
    });
    let state = makeState([generation, text], generation.id);
    const actions = createProfileActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    });

    await actions.setActiveProfile(text.id);
    assert.equal(state.activeProfileId, generation.id);

    await actions.updateProfile(generation.id, {
      apiMode: "responses",
      baseURL: "https://www.fhl.mom",
      imageModelID: "",
      textModelID: "gpt-5.5",
    });
    assert.equal(state.activeProfileId, "");
    assert.equal(state.apiMode, "images");
    assert.equal(state.baseURL, "");
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("Android selects another generation profile when the active profile becomes text-only", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { createProfileActions } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const edited = makeProfile("edited");
    const fallback = makeProfile("fallback", { baseURL: "https://fallback.invalid" });
    let state = makeState([edited, fallback], edited.id);
    const actions = createProfileActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    });

    await actions.updateProfile(edited.id, {
      apiMode: "responses",
      baseURL: "https://www.fhl.mom/v1",
      imageModelID: "",
      textModelID: "gpt-5.5",
    });
    assert.equal(state.activeProfileId, fallback.id);
    assert.equal(state.baseURL, fallback.baseURL);
    assert.equal(state.profiles.find((profile) => profile.id === edited.id)?.apiMode, "responses");
  } finally {
    await server.close();
    restoreRuntime();
  }
});
