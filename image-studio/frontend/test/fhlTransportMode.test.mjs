import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("global FHL transport mode is namespaced and exposed as two desktop controls", () => {
  const storeTypes = source("../src/state/studioStore.types.ts");
  const shared = source("../src/state/studioStore.shared.ts");
  const header = source("../src/components/layout/AppHeaderBrand.tsx");
  const toggle = source("../src/components/layout/FHLTransportToggle.tsx");

  assert.match(storeTypes, /export type FHLTransportMode = "images" \| "responses";/);
  assert.match(storeTypes, /fhlTransportMode: FHLTransportMode;/);
  assert.match(storeTypes, /setFHLTransportMode: \(mode: FHLTransportMode\) => void;/);

  assert.match(shared, /FHL_TRANSPORT_MODE_LS_KEY = storageKey\("gptcodex\.fhlTransportMode\.v1"\)/);
  assert.match(shared, /function loadStoredFHLTransportMode\(\): FHLTransportMode/);
  assert.match(shared, /localStorage\.getItem\(FHL_TRANSPORT_MODE_LS_KEY\) === "responses" \? "responses" : "images"/);
  assert.match(shared, /function persistFHLTransportMode\(mode: FHLTransportMode\): void/);
  assert.match(shared, /localStorage\.setItem\(FHL_TRANSPORT_MODE_LS_KEY, mode\)/);

  assert.match(header, /const fhlTransportMode = useStudioStore\(\(state\) => state\.fhlTransportMode\)/);
  assert.match(header, /const setFHLTransportMode = useStudioStore\(\(state\) => state\.setFHLTransportMode\)/);
  assert.match(header, /<FHLTransportToggle mode=\{fhlTransportMode\} onChange=\{setFHLTransportMode\} \/>/);
  assert.match(toggle, /data-audit-id=\{`fhl-transport-\$\{transport\}`\}/);
  assert.match(toggle, /FHL Images/);
  assert.match(toggle, /FHL Responses/);
  assert.match(toggle, /border border-\[color:var\(--accent\)\] bg-\[var\(--accent-soft\)\] text-zinc-950 shadow-sm ring-1 ring-\[color:var\(--accent\)\]\/20 dark:text-zinc-50/);
  assert.match(toggle, /aria-pressed=\{selected\}/);
});

test("global transport only classifies official Images or Responses profiles", async () => {
  const policy = await import(new URL("../src/lib/providerPolicy.ts", import.meta.url));

  for (const apiMode of ["images", "responses"]) {
    assert.equal(policy.isOfficialFHLProfile({ apiMode, baseURL: "https://www.fhl.mom/" }), true);
  }
  assert.equal(policy.isOfficialFHLProfile({ apiMode: "apimart", baseURL: "https://www.fhl.mom" }), false);
  assert.equal(policy.isOfficialFHLProfile({ apiMode: "images", baseURL: "https://example.invalid" }), false);
  assert.equal(
    policy.effectiveProviderMode({ apiMode: "images", baseURL: "https://www.fhl.mom" }, "images", "responses"),
    "responses",
  );
  assert.equal(
    policy.effectiveProviderMode({ apiMode: "apimart", baseURL: "https://api.apimart.ai" }, "apimart", "responses"),
    "apimart",
  );
});

test("official FHL profiles use the global transport at runtime without rewriting their slot metadata", async (t) => {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  });
  t.after(() => server.close());

  const profileActions = await server.ssrLoadModule("/src/state/studioStore.profiles.ts");
  const profiles = await server.ssrLoadModule("/src/lib/profiles.ts");
  const fhlSlot = {
    id: "fhl-slot-1",
    name: "FHL Images 1",
    apiMode: "images",
    requestPolicy: "openai",
    baseURL: profiles.FHL_BASE_URL,
    textModelID: "",
    imageModelID: profiles.FHL_IMAGE_MODEL_ID,
    concurrencyLimit: 4,
    continuousPoolEnabled: true,
    imagesNewAPICompat: true,
    fhlImagesPoolSlot: 1,
    fhlImagesPoolKeyHint: "sk-abc...1234",
    createdAt: 1,
  };
  const storedSlot = structuredClone(fhlSlot);

  assert.deepEqual(
    profileActions.activeProfileRuntimePatch(fhlSlot, "responses"),
    {
      apiMode: "responses",
      requestPolicy: "openai",
      baseURL: profiles.FHL_BASE_URL,
      textModelID: profiles.FHL_TEXT_MODEL_ID,
      imageModelID: profiles.FHL_IMAGE_MODEL_ID,
      imagesNewAPICompat: false,
    },
  );
  assert.deepEqual(fhlSlot, storedSlot);

  const imagesRuntime = profileActions.activeProfileRuntimePatch(fhlSlot, "images");
  assert.equal(imagesRuntime.apiMode, "images");
  assert.equal(imagesRuntime.textModelID, "");
  assert.equal(imagesRuntime.imagesNewAPICompat, true);

  const nonFHL = {
    ...fhlSlot,
    id: "apimart",
    apiMode: "apimart",
    requestPolicy: "compat",
    baseURL: "https://api.example.invalid",
    textModelID: "custom-text",
    imageModelID: "custom-image",
    imagesNewAPICompat: false,
  };
  assert.deepEqual(profileActions.activeProfileRuntimePatch(nonFHL, "responses"), {
    apiMode: "apimart",
    requestPolicy: "compat",
    baseURL: "https://api.example.invalid",
    textModelID: "custom-text",
    imageModelID: "custom-image",
    imagesNewAPICompat: false,
  });

  const profileSource = source("../src/state/studioStore.profiles.ts");
  assert.match(profileSource, /activeProfileRuntimePatch\(next, store\.getState\(\)\.fhlTransportMode\)/);
  assert.match(profileSource, /activeProfileRuntimePatch\(profile, before\.fhlTransportMode\)/);
});
