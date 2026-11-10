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
    activeCredentialStatus: "unknown",
    pushToast() {},
  };
}

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

test("Android active profile credential reads cannot overwrite a newer selection", async () => {
  installAndroidRuntime();
  const pendingReads = [];
  globalThis.window.AndroidImageStudio = {
    invoke(requestId, method, payloadJson) {
      if (method === "GetStoredAPIKey") {
        pendingReads.push({ requestId, args: JSON.parse(payloadJson) });
        return;
      }
      queueMicrotask(() => window.__imageStudioNativeResolve?.(requestId, null));
    },
  };
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { createProfileActions } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const first = makeProfile("first");
    const second = makeProfile("second");
    let state = makeState([first, second], first.id);
    const actions = createProfileActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    });

    const firstSelection = actions.setActiveProfile(first.id);
    await waitFor(() => pendingReads.length === 1, "first credential read did not start");
    assert.equal(state.activeCredentialStatus, "checking");
    const secondSelection = actions.setActiveProfile(second.id);
    await waitFor(() => pendingReads.length === 2, "second credential read did not start");
    assert.equal(state.activeProfileId, second.id);
    assert.equal(state.activeCredentialStatus, "checking");

    window.__imageStudioNativeResolve?.(pendingReads[1].requestId, "credential-second");
    await secondSelection;
    assert.equal(state.apiKey, "credential-second");
    assert.equal(state.activeCredentialStatus, "present");

    window.__imageStudioNativeResolve?.(pendingReads[0].requestId, "credential-first");
    await firstSelection;
    assert.equal(state.activeProfileId, second.id);
    assert.equal(state.apiKey, "credential-second");
    assert.equal(state.activeCredentialStatus, "present");
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("Android bootstrap waits for same-profile credential mutations to settle", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const {
      currentCredentialMutationRevision,
      trackCredentialMutation,
      waitForCredentialMutations,
    } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    let finishWrite;
    const before = currentCredentialMutationRevision();
    const write = trackCredentialMutation(() => new Promise((resolve) => {
      finishWrite = resolve;
    }));
    const during = currentCredentialMutationRevision();
    let waitFinished = false;
    const waiting = waitForCredentialMutations().then(() => {
      waitFinished = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(during > before);
    assert.equal(waitFinished, false);

    finishWrite();
    await Promise.all([write, waiting]);
    assert.equal(waitFinished, true);
    assert.ok(currentCredentialMutationRevision() > during);
  } finally {
    await server.close();
    restoreRuntime();
  }
});

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

test("Android applies one exact image model to all FHL slots in one state update", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const {
      applyFHLPoolImageModelSelection,
      invalidateFHLPoolImageModelValidation,
    } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const first = makeProfile("slot-1", {
      baseURL: "https://www.fhl.mom",
      fhlImagesPoolSlot: 1,
      fhlImagesPoolKeyHint: "sk-one...1111",
    });
    const second = makeProfile("slot-2", {
      baseURL: "https://www.fhl.mom/v1",
      provider: "fhl-secondary",
      fhlImagesPoolSlot: 2,
      continuousPoolEnabled: false,
      fhlImagesPoolKeyHint: "sk-two...2222",
      imageModelValidatedAt: 6000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom/v1",
      imageModelCatalogProvider: "fhl-secondary",
    });
    const unrelated = makeProfile("custom", { baseURL: "https://other.invalid" });
    let state = makeState([first, second, unrelated], first.id);
    let stateUpdates = 0;
    const adapter = {
      getState: () => state,
      setState: (patch) => {
        stateUpdates += 1;
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    };

    assert.equal(applyFHLPoolImageModelSelection(adapter, {
      imageModelID: "gpt-image-2.5-flare",
      imageModelValidatedAt: 7000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
      validatedProfileId: first.id,
    }), 2);
    assert.equal(stateUpdates, 1);
    assert.equal(state.imageModelID, "gpt-image-2.5-flare");
    assert.deepEqual(state.profiles.slice(0, 2).map((profile) => profile.imageModelID), [
      "gpt-image-2.5-flare",
      "gpt-image-2.5-flare",
    ]);
    assert.equal(state.profiles[1].baseURL, second.baseURL);
    assert.equal(state.profiles[1].continuousPoolEnabled, false);
    assert.equal(state.profiles[1].fhlImagesPoolKeyHint, second.fhlImagesPoolKeyHint);
    assert.equal(state.profiles[1].provider, second.provider);
    assert.equal(state.profiles[0].imageModelValidatedAt, 7000);
    assert.equal(state.profiles[0].imageModelCatalogValidationId, undefined);
    assert.equal(state.profiles[1].imageModelValidatedAt, undefined);
    assert.equal(state.profiles[1].imageModelCatalogBaseUrl, undefined);
    assert.equal(state.profiles[1].imageModelCatalogProvider, undefined);
    assert.equal(state.profiles[2].imageModelID, unrelated.imageModelID);

    assert.equal(applyFHLPoolImageModelSelection(adapter, {
      imageModelID: "gpt-image-2.5-flare",
      imageModelValidatedAt: 8000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom/v1",
      imageModelCatalogProvider: "fhl-secondary",
      validatedProfileId: second.id,
    }), 2);
    assert.equal(stateUpdates, 2);
    assert.equal(state.profiles[0].imageModelValidatedAt, 7000);
    assert.equal(state.profiles[0].imageModelCatalogProvider, "fhl");
    assert.equal(state.profiles[1].imageModelValidatedAt, 8000);
    assert.equal(state.profiles[1].imageModelCatalogProvider, "fhl-secondary");

    assert.equal(invalidateFHLPoolImageModelValidation(adapter), 2);
    assert.equal(stateUpdates, 3);
    assert.equal(state.profiles[0].imageModelID, "gpt-image-2.5-flare");
    assert.equal(state.profiles[0].imageModelValidatedAt, undefined);
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("Android atomically applies one validated catalog snapshot to enabled pool targets", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { commitValidatedFHLPoolImageModelSelection } = await server.ssrLoadModule(
      "/src/state/studioStore.profiles.ts",
    );
    const {
      IMAGE_MODEL_CATALOG_LS_KEY,
      normalizeImageModelCatalog,
    } = await server.ssrLoadModule("/src/lib/fhlImageModels.ts");
    const first = makeProfile("slot-1", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 1,
      continuousPoolEnabled: true,
      fhlImagesPoolKeyHint: "sk-one...1111",
    });
    const second = makeProfile("slot-2", {
      baseURL: "https://www.fhl.mom/v1",
      provider: "fhl",
      fhlImagesPoolSlot: 2,
      continuousPoolEnabled: true,
      // Keystore is authoritative; a missing legacy hint must not reject it.
      fhlImagesPoolKeyHint: undefined,
    });
    const disabled = makeProfile("slot-3", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 3,
      continuousPoolEnabled: false,
      imageModelValidatedAt: 6000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
    });
    const empty = makeProfile("slot-4", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 4,
      continuousPoolEnabled: true,
      imageModelValidatedAt: 6500,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
    });
    const unrelated = makeProfile("custom", { baseURL: "https://other.invalid" });
    let state = makeState([first, second, disabled, empty, unrelated], first.id);
    let stateUpdates = 0;
    let catalogWrites = 0;
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    globalThis.localStorage.setItem = (key, value) => {
      if (key === IMAGE_MODEL_CATALOG_LS_KEY) catalogWrites += 1;
      return originalSetItem(key, value);
    };
    const adapter = {
      getState: () => state,
      setState: (patch) => {
        stateUpdates += 1;
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    };

    const catalog = normalizeImageModelCatalog(
      [{ id: "gpt-image-2.5-sunburst" }],
      "https://www.fhl.mom/v1",
      "fhl",
      7000,
    );
    assert.equal(commitValidatedFHLPoolImageModelSelection(adapter, {
      catalog,
      imageModelID: "gpt-image-2.5-sunburst",
      imageModelCatalogValidationId: "batch-test-7000",
      targetProfileIds: [first.id, second.id],
    }), 2);
    assert.equal(catalogWrites, 1);
    assert.equal(
      JSON.parse(globalThis.localStorage.getItem(IMAGE_MODEL_CATALOG_LS_KEY)).fetchedAt,
      7000,
    );
    assert.equal(stateUpdates, 1);
    assert.equal(state.imageModelID, "gpt-image-2.5-sunburst");
    assert.deepEqual(state.profiles.slice(0, 4).map((profile) => profile.imageModelID), [
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-sunburst",
      disabled.imageModelID,
      empty.imageModelID,
    ]);
    for (const profile of state.profiles.slice(0, 2)) {
      assert.equal(profile.imageModelValidatedAt, 7000);
      assert.equal(profile.imageModelCatalogBaseUrl, "https://www.fhl.mom");
      assert.equal(profile.imageModelCatalogProvider, "fhl");
      assert.equal(profile.imageModelCatalogValidationId, "batch-test-7000");
    }
    for (const profile of state.profiles.slice(2, 4)) {
      assert.equal(profile.imageModelValidatedAt, undefined);
      assert.equal(profile.imageModelCatalogBaseUrl, undefined);
      assert.equal(profile.imageModelCatalogProvider, undefined);
    }
    assert.equal(state.profiles[2].continuousPoolEnabled, false);
    assert.equal(state.profiles[4].imageModelID, unrelated.imageModelID);
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("Android unified pool validation rejects invalid targets before persistence or state change", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { commitValidatedFHLPoolImageModelSelection } = await server.ssrLoadModule(
      "/src/state/studioStore.profiles.ts",
    );
    const {
      IMAGE_MODEL_CATALOG_LS_KEY,
      normalizeImageModelCatalog,
    } = await server.ssrLoadModule("/src/lib/fhlImageModels.ts");
    const first = makeProfile("slot-1", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 1,
      continuousPoolEnabled: true,
    });
    const otherProvider = makeProfile("slot-2", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl-secondary",
      fhlImagesPoolSlot: 2,
      continuousPoolEnabled: true,
    });
    const disabled = makeProfile("slot-3", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 3,
      continuousPoolEnabled: false,
    });
    let state = makeState([first, otherProvider, disabled], first.id);
    const before = JSON.stringify(state);
    let stateUpdates = 0;
    let persistenceWrites = 0;
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    globalThis.localStorage.setItem = (...args) => {
      persistenceWrites += 1;
      return originalSetItem(...args);
    };
    const adapter = {
      getState: () => state,
      setState: (patch) => {
        stateUpdates += 1;
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    };
    const catalog = normalizeImageModelCatalog(
      [{ id: "gpt-image-2.5-flare" }],
      "https://www.fhl.mom",
      "fhl",
      7000,
    );
    const selection = {
      catalog,
      imageModelID: "gpt-image-2.5-flare",
      imageModelCatalogValidationId: "batch-test-7000",
    };

    assert.throws(
      () => commitValidatedFHLPoolImageModelSelection(adapter, {
        ...selection,
        imageModelCatalogValidationId: "",
        targetProfileIds: [first.id],
      }),
      /缺少原生目录验证证明/,
    );

    assert.throws(
      () => commitValidatedFHLPoolImageModelSelection(adapter, {
        ...selection,
        targetProfileIds: [first.id, otherProvider.id],
      }),
      /同一 Base URL 和 provider/,
    );
    assert.throws(
      () => commitValidatedFHLPoolImageModelSelection(adapter, {
        ...selection,
        targetProfileIds: [disabled.id],
      }),
      /未启用/,
    );
    assert.throws(
      () => commitValidatedFHLPoolImageModelSelection(adapter, {
        ...selection,
        targetProfileIds: [first.id, first.id],
      }),
      /重复项/,
    );
    assert.equal(stateUpdates, 0);
    assert.equal(persistenceWrites, 0);
    assert.equal(JSON.stringify(state), before);

    let catalogWriteAttempts = 0;
    const countingSetItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (key, value) => {
      if (key === IMAGE_MODEL_CATALOG_LS_KEY) {
        catalogWriteAttempts += 1;
        throw new Error("quota exceeded");
      }
      return countingSetItem(key, value);
    };
    assert.throws(
      () => commitValidatedFHLPoolImageModelSelection(adapter, {
        ...selection,
        targetProfileIds: [first.id],
      }),
      /目录保存失败，原配置未改变/,
    );
    assert.equal(catalogWriteAttempts, 1);
    assert.equal(stateUpdates, 0);
    assert.equal(persistenceWrites, 0);
    assert.equal(JSON.stringify(state), before);
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("ordinary profile changes cannot carry forward or manufacture model validation", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { createProfileActions } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const validated = makeProfile("validated", {
      baseURL: "https://www.fhl.mom",
      imageModelID: "gpt-image-2.5-flare",
      imageModelValidatedAt: 7000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
      provider: "fhl",
      fhlImagesPoolSlot: 1,
      imageModelAvailable: true,
      imageModelSupportsGenerations: true,
      imageModelSupportsEdits: true,
      imageModelSupportsTransparency: true,
      imageModelCatalogValidationId: "batch-provider-old",
    });
    let state = makeState([validated], validated.id);
    const actions = createProfileActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    });

    await actions.updateProfile(validated.id, {
      provider: "fhl-alternate",
      imageModelValidatedAt: 9000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl-alternate",
      imageModelAvailable: true,
      imageModelSupportsGenerations: true,
      imageModelSupportsEdits: true,
      imageModelSupportsTransparency: true,
      imageModelCatalogValidationId: "forged-batch-proof",
    });
    const updated = state.profiles[0];
    assert.equal(updated.provider, "fhl-alternate");
    assert.equal(updated.imageModelID, "gpt-image-2.5-flare");
    assert.equal(updated.imageModelValidatedAt, undefined);
    assert.equal(updated.imageModelCatalogBaseUrl, undefined);
    assert.equal(updated.imageModelCatalogProvider, undefined);
    assert.equal(updated.imageModelAvailable, undefined);
    assert.equal(updated.imageModelSupportsGenerations, undefined);
    assert.equal(updated.imageModelSupportsEdits, undefined);
    assert.equal(updated.imageModelSupportsTransparency, undefined);
    assert.equal(updated.imageModelCatalogValidationId, undefined);
  } finally {
    await server.close();
    restoreRuntime();
  }
});

test("re-enabling a disabled FHL slot requires fresh model validation", async () => {
  installAndroidRuntime();
  const server = await createServer({
    root: frontendRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { createProfileActions } = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
    const disabled = makeProfile("disabled", {
      baseURL: "https://www.fhl.mom",
      provider: "fhl",
      fhlImagesPoolSlot: 1,
      continuousPoolEnabled: false,
      imageModelID: "gpt-image-2.5-flare",
      imageModelValidatedAt: 7000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
      imageModelAvailable: true,
      imageModelSupportsGenerations: true,
      imageModelSupportsEdits: true,
      imageModelSupportsTransparency: true,
      imageModelCatalogValidationId: "batch-disabled-old",
    });
    let state = makeState([disabled], disabled.id);
    const actions = createProfileActions({
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    });

    // Supplying a stale validation tuple in the same update must not bypass
    // the re-enable gate.
    await actions.updateProfile(disabled.id, {
      continuousPoolEnabled: true,
      imageModelValidatedAt: 8000,
      imageModelCatalogBaseUrl: "https://www.fhl.mom",
      imageModelCatalogProvider: "fhl",
    });
    const updated = state.profiles[0];
    assert.equal(updated.continuousPoolEnabled, true);
    assert.equal(updated.imageModelValidatedAt, undefined);
    assert.equal(updated.imageModelCatalogBaseUrl, undefined);
    assert.equal(updated.imageModelCatalogProvider, undefined);
    assert.equal(updated.imageModelAvailable, undefined);
    assert.equal(updated.imageModelSupportsGenerations, undefined);
    assert.equal(updated.imageModelSupportsEdits, undefined);
    assert.equal(updated.imageModelSupportsTransparency, undefined);
    assert.equal(updated.imageModelCatalogValidationId, undefined);
  } finally {
    await server.close();
    restoreRuntime();
  }
});
