import assert from "node:assert/strict";
import test from "node:test";

const realFetch = globalThis.fetch;
const cleanup = await import("../src/lib/runningHubCredentialCleanup.ts");

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("RunningHub secure wipe writes an empty key and verifies it is gone", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "POST") return jsonResponse({ ok: true, config: { api_key_configured: false } });
    return jsonResponse({ ok: true, config: { api_key_configured: false } });
  };

  await cleanup.clearRunningHubCredential("http://127.0.0.1:8117/");

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "http://127.0.0.1:8117/api/config");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { api_key: "" });
  assert.equal(requests[1].options.method, "GET");
});

test("RunningHub secure wipe fails if verification still reports a configured key", async () => {
  globalThis.fetch = async (_url, options) => (
    options.method === "POST"
      ? jsonResponse({ ok: true, config: { api_key_configured: false } })
      : jsonResponse({ ok: true, config: { api_key_configured: true } })
  );

  await assert.rejects(
    cleanup.clearRunningHubCredential("http://127.0.0.1:8117"),
    /仍报告 API Key 已配置/,
  );
});

test("RunningHub secure wipe surfaces bridge failures", async () => {
  globalThis.fetch = async () => jsonResponse({ ok: false, message: "bridge rejected" }, 500);

  await assert.rejects(
    cleanup.clearRunningHubCredential("http://127.0.0.1:8117"),
    /bridge rejected/,
  );
});
