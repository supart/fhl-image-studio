import assert from "node:assert/strict";
import test from "node:test";

const uiAuditClient = await import(`../src/platform/runtime/uiAuditClient.ts?ui-audit-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);

test("truncateAuditText trims whitespace and caps long values", () => {
  assert.equal(uiAuditClient.truncateAuditText("  hello   world  ", 32), "hello world");
  assert.equal(uiAuditClient.truncateAuditText("abcdefghijklmnopqrstuvwxyz", 10), "abcdefghi...");
});

test("sanitizeAuditPath keeps project input and output paths but hides external absolute paths", () => {
  assert.equal(
    uiAuditClient.sanitizeAuditPath("X:\\synthetic-workspace\\FHL-Image-Studio-CLI-V2.0.0\\input\\ref.png"),
    "input\\ref.png",
  );
  assert.equal(
    uiAuditClient.sanitizeAuditPath("X:\\synthetic-workspace\\FHL-Image-Studio-CLI-V2.0.0\\output\\foo\\bar.png"),
    "output\\foo\\bar.png",
  );
  assert.equal(
    uiAuditClient.sanitizeAuditPath("C:\\Users\\someone\\Desktop\\secret\\image.png"),
    "image.png",
  );
  assert.equal(uiAuditClient.sanitizeAuditPath("memory://image/asset-1"), "memory://image/asset-1");
});

test("classifyAuditSourceKind identifies memory, input, output, absolute, and relative paths", () => {
  assert.equal(uiAuditClient.classifyAuditSourceKind("memory://image/foo"), "memory");
  assert.equal(uiAuditClient.classifyAuditSourceKind("input\\ref.png"), "input-root");
  assert.equal(uiAuditClient.classifyAuditSourceKind("output\\render.png"), "output-root");
  assert.equal(uiAuditClient.classifyAuditSourceKind("C:\\temp\\render.png"), "external-absolute");
  assert.equal(uiAuditClient.classifyAuditSourceKind("refs\\render.png"), "relative");
});
