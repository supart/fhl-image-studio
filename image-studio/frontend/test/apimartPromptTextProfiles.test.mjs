import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  APIMART_BASE_URL,
  FHL_BASE_URL,
} = await import("../src/lib/profiles.ts");
const {
  resolvePromptTextCapability,
  resolvePromptTextSelection,
} = await import("../src/lib/promptTextProfiles.ts");
const apimartAPISource = await readFile(new URL("../src/lib/apimartAPI.ts", import.meta.url), "utf8");
const fhlTextAPISource = await readFile(new URL("../src/lib/fhlTextAPI.ts", import.meta.url), "utf8");
const studioStoreSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");

function makeProfile(overrides = {}) {
  return {
    id: "profile-1",
    name: "Profile",
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "https://www.fhl.mom",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 4,
    imagesNewAPICompat: false,
    createdAt: 1,
    ...overrides,
  };
}

test("APIMart one-click config preserves an existing textModelID", () => {
  assert.match(apimartAPISource, /textModelID:\s*existing\.textModelID/);
  assert.doesNotMatch(
    apimartAPISource,
    /await store\.updateProfile\(existing\.id,[\s\S]*?textModelID:\s*""/,
  );
});

test("APIMart one-click config preserves an existing APIMart base URL", () => {
  assert.match(
    apimartAPISource,
    /await store\.updateProfile\(existing\.id,[\s\S]*?baseURL:\s*existing\.baseURL,/,
  );
  assert.match(
    apimartAPISource,
    /return store\.createProfile\(\{[\s\S]*?baseURL:\s*APIMART_BASE_URL,/,
  );
});

test("APIMart prompt text capability prefers its own text model", () => {
  const capability = resolvePromptTextCapability({
    apiMode: "apimart",
    apiKey: "sk-apimart",
    baseURL: APIMART_BASE_URL,
    textModelID: "gpt-5.2-pro",
    profiles: [makeProfile()],
  });

  assert.equal(capability.available, true);
  assert.equal(capability.provider, "apimart");
  assert.match(capability.label, /gpt-5\.2-pro/);
});

test("APIMart prompt text capability falls back to Responses when textModelID is blank", () => {
  const responses = makeProfile({ id: "responses-1", textModelID: "gpt-4o" });
  const capability = resolvePromptTextCapability({
    apiMode: "apimart",
    apiKey: "sk-apimart",
    baseURL: APIMART_BASE_URL,
    textModelID: "",
    profiles: [responses],
  });

  assert.equal(capability.available, true);
  assert.equal(capability.provider, "responses");
  assert.equal(capability.profile, responses);
  assert.match(capability.label, /gpt-4o/);
});

test("APIMart prompt text capability is unavailable without APIMart text model or Responses fallback", () => {
  const capability = resolvePromptTextCapability({
    apiMode: "apimart",
    apiKey: "sk-apimart",
    baseURL: APIMART_BASE_URL,
    textModelID: "",
    profiles: [
      makeProfile({ id: "images-1", apiMode: "images", baseURL: "https://example.test" }),
    ],
  });

  assert.equal(capability.available, false);
  assert.equal(capability.provider, "none");
  assert.match(capability.reason, /未配置可用文本模型/);
});

test("FHL Images prompt optimization uses an official FHL Responses profile, not the Images key", () => {
  const genericResponses = makeProfile({
    id: "generic-responses",
    baseURL: "https://generic.example.test",
    textModelID: "generic-text",
  });
  const fhlResponses = makeProfile({ id: "fhl-responses", baseURL: FHL_BASE_URL });
  const input = {
    apiMode: "images",
    apiKey: "sk-image-only",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    profiles: [genericResponses, fhlResponses],
  };

  const selection = resolvePromptTextSelection(input);
  const capability = resolvePromptTextCapability(input);

  assert.equal(selection?.source, "profile");
  assert.equal(selection?.profile, fhlResponses);
  assert.equal(capability.profile, fhlResponses);
  assert.match(capability.label, /FHL Responses/);
});

test("FHL Images key alone is not treated as a prompt text API", () => {
  const input = {
    apiMode: "images",
    apiKey: "sk-image-only",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    profiles: [],
  };

  assert.equal(resolvePromptTextSelection(input), null);
  const capability = resolvePromptTextCapability(input);
  assert.equal(capability.available, false);
  assert.match(capability.reason, /FHL Responses API Key/);
});

test("dedicated FHL text API takes global priority over APIMart and Responses profiles", () => {
  const responses = makeProfile({
    id: "generic-responses",
    baseURL: "https://generic.example.test",
    textModelID: "generic-text",
  });
  const input = {
    apiMode: "apimart",
    apiKey: "sk-apimart",
    baseURL: APIMART_BASE_URL,
    textModelID: "apimart-text",
    profiles: [responses],
    fhlTextAPIConfigured: true,
  };

  const selection = resolvePromptTextSelection(input);
  const capability = resolvePromptTextCapability(input);

  assert.equal(selection?.source, "fhl-text");
  assert.equal(selection?.baseURL, FHL_BASE_URL);
  assert.equal(selection?.textModelID, "gpt-5.5");
  assert.equal(selection?.profile, undefined);
  assert.equal(capability.provider, "fhl-text");
  assert.equal(capability.label, "FHL 文本 API：gpt-5.5");
});

test("dedicated FHL text API also takes priority while Images is active", () => {
  const selection = resolvePromptTextSelection({
    apiMode: "images",
    apiKey: "sk-image-only",
    baseURL: FHL_BASE_URL,
    textModelID: "",
    profiles: [],
    fhlTextAPIConfigured: true,
  });

  assert.equal(selection?.source, "fhl-text");
  assert.equal(selection?.provider, "fhl-text");
});

test("dedicated FHL text API takes priority while RunningHub is active", () => {
  const selection = resolvePromptTextSelection({
    apiMode: "runninghub",
    apiKey: "",
    baseURL: "",
    textModelID: "",
    profiles: [makeProfile({ id: "fallback-responses" })],
    fhlTextAPIConfigured: true,
  });

  assert.equal(selection?.source, "fhl-text");
  assert.equal(selection?.provider, "fhl-text");
  assert.equal(selection?.baseURL, FHL_BASE_URL);
  assert.equal(selection?.textModelID, "gpt-5.5");
});

test("prompt text runtime uses the same resolver as the capability UI", () => {
  assert.match(studioStoreSource, /resolvePromptTextSelection\(\{/);
  assert.match(studioStoreSource, /fhlTextAPIConfigured: !readRuntimePlatformState\(\)\.isAndroid/);
  assert.match(studioStoreSource, /GetStoredAPIKey\(FHL_TEXT_API_KEYRING_USER\)/);
  assert.match(studioStoreSource, /formatFHLTextAPIError\(error\)/);
  assert.match(fhlTextAPISource, /请求已到达 FHL，但当前文本 API Key 所属分组不支持文本模型/);
});
