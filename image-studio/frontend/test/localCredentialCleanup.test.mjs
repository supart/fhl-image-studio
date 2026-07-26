import assert from "node:assert/strict";
import test from "node:test";

const realWindow = globalThis.window;
const realFetch = globalThis.fetch;
const cleanup = await import("../src/lib/localCredentialCleanup.ts");

test.afterEach(() => {
  globalThis.window = realWindow;
  globalThis.fetch = realFetch;
});

test("local secure wipe deletes the fixed API library files through the dev endpoint", async () => {
  globalThis.window = { location: { hostname: "127.0.0.1" } };
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200 };
  };

  assert.equal(await cleanup.clearLocalCredentialFiles(), true);
  assert.equal(captured.url, "/__image-studio-local-config/api-library");
  assert.equal(captured.options.method, "DELETE");
});

test("packaged desktop secure wipe uses the native credential-file deletion method", async () => {
  let nativeCalls = 0;
  let fetchCalls = 0;
  globalThis.window = {
    location: { hostname: "wails.localhost" },
    go: {
      backend: {
        DesktopAPI: {
          ClearLocalCredentialFiles: async () => { nativeCalls += 1; },
        },
      },
    },
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  assert.equal(await cleanup.clearLocalCredentialFiles(), true);
  assert.equal(nativeCalls, 1);
  assert.equal(fetchCalls, 0);
});

test("packaged non-local origins skip the development credential-file endpoint", async () => {
  globalThis.window = { location: { hostname: "wails.localhost" } };
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200 };
  };

  assert.equal(await cleanup.clearLocalCredentialFiles(), false);
  assert.equal(called, false);
});

test("local credential-file deletion cannot report success after an endpoint failure", async () => {
  globalThis.window = { location: { hostname: "localhost" } };
  globalThis.fetch = async () => ({ ok: false, status: 500 });

  await assert.rejects(
    cleanup.clearLocalCredentialFiles(),
    /清除本地 API 凭据文件失败 \(500\)/,
  );
});

test("the Vite development endpoint deletes and verifies both fixed credential files", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(source, /req\.method === "DELETE" && url\.pathname === "\/api-library"/);
  assert.match(source, /fs\.rm\(cliEnvLocalPath, \{ force: true \}\)/);
  assert.match(source, /fs\.rm\(localFHLAPIConfigPath, \{ force: true \}\)/);
  assert.match(source, /remaining\.some\(Boolean\)/);
});
