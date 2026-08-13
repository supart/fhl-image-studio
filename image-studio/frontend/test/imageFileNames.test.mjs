import assert from "node:assert/strict";
import test from "node:test";

const names = await import("../src/lib/imageFileNames.ts");

test("image file names use local timestamp and prompt snippet", () => {
  assert.equal(
    names.suggestImageFileName({
      prompt: "牛马正在办公室上班。",
      createdAt: new Date(2026, 5, 6, 11, 22, 33),
      outputFormat: "png",
    }),
    "20260606-112233-牛马正在办公室上班.png",
  );
});

test("image file names sanitize unsafe characters and fall back for empty prompt", () => {
  assert.equal(
    names.suggestImageFileName({
      prompt: "a/b\\c:*?\"<>| d",
      createdAt: new Date(2026, 5, 6, 1, 2, 3),
      outputFormat: "jpeg",
    }),
    "20260606-010203-abc-d.jpg",
  );
  assert.equal(names.promptSnippetForFileName(" /\\:*?\"<>| "), "未命名");
});
