import assert from "node:assert/strict";
import test from "node:test";

const canonical = await import("../src/app/dev/canonicalDevOrigin.ts");

test("localhost development URLs move to the canonical 127 origin", () => {
  assert.equal(
    canonical.canonicalDevURL("http://localhost:5173/workbench?mode=batch#results", "127.0.0.1"),
    "http://127.0.0.1:5173/workbench?mode=batch#results",
  );
});

test("the canonical origin and non-loopback hosts are left unchanged", () => {
  assert.equal(canonical.canonicalDevURL("http://127.0.0.1:5173/", "127.0.0.1"), null);
  assert.equal(canonical.canonicalDevURL("https://image-studio.example/", "127.0.0.1"), null);
});

test("IPv6 loopback can be selected as the explicit canonical host", () => {
  assert.equal(
    canonical.canonicalDevURL("http://localhost:5173/", "::1"),
    "http://[::1]:5173/",
  );
});

test("redirect uses location.replace and preserves the full URL", () => {
  const calls = [];
  const location = {
    href: "http://localhost:5173/?view=config#images",
    replace(value) { calls.push(value); },
  };

  assert.equal(canonical.redirectToCanonicalDevOrigin(location, "127.0.0.1"), true);
  assert.deepEqual(calls, ["http://127.0.0.1:5173/?view=config#images"]);
});
