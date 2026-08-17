import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_API_KEY_MAX_CLIPBOARD_BYTES,
  parseBulkAPIKeyLines,
} from "../src/lib/bulkAPIKeys.ts";

function makeKey(index, marker = "a") {
  return `sk-${marker.repeat(12)}${String(index).padStart(4, "0")}`;
}

function fingerprints(keys) {
  return keys.map((key) => `${key.length}:${key.charCodeAt(key.length - 1)}`);
}

test("bulk API parser keeps ten standard lines in order", () => {
  const keys = Array.from({ length: 10 }, (_, index) => makeKey(index + 1));
  const parsed = parseBulkAPIKeyLines(keys.join("\n"));
  assert.equal(parsed.inputTooLarge, false);
  assert.equal(parsed.validUniqueCount, 10);
  assert.deepEqual(fingerprints(parsed.keys), fingerprints(keys));
  assert.deepEqual(parsed.invalidLineNumbers, []);
  assert.equal(parsed.overflowCount, 0);
});

test("bulk API parser accepts BOM, CRLF, assignments, bearer, numbering and prose", () => {
  const keys = Array.from({ length: 6 }, (_, index) => makeKey(index + 1, String.fromCharCode(97 + index)));
  const parsed = parseBulkAPIKeyLines([
    `\uFEFF${keys[0]}`,
    `OPENAI_API_KEY=\"${keys[1]}\"`,
    `Bearer ${keys[2]}`,
    `1. ${keys[3]}`,
    `说明：${keys[4]}（测试）`,
    `'${keys[5]}'`,
  ].join("\r\n"));
  assert.deepEqual(fingerprints(parsed.keys), fingerprints(keys));
  assert.deepEqual(parsed.invalidLineNumbers, []);
});

test("bulk API parser reports empty, invalid and multi-token lines", () => {
  const first = makeKey(1);
  const parsed = parseBulkAPIKeyLines([
    first,
    "",
    "这行没有密钥",
    `${makeKey(2, "b")} / ${makeKey(3, "c")}`,
    "   ",
  ].join("\n"));
  assert.deepEqual(fingerprints(parsed.keys), fingerprints([first]));
  assert.deepEqual(parsed.invalidLineNumbers, [3, 4]);
  assert.equal(parsed.emptyLineCount, 2);
});

test("bulk API parser de-duplicates exact keys and preserves first occurrence", () => {
  const first = makeKey(1, "a");
  const second = makeKey(2, "b");
  const parsed = parseBulkAPIKeyLines([first, second, first].join("\n"));
  assert.deepEqual(fingerprints(parsed.keys), fingerprints([first, second]));
  assert.equal(parsed.duplicateCount, 1);
});

test("bulk API parser returns only the first ten unique keys", () => {
  const keys = Array.from({ length: 12 }, (_, index) => makeKey(index + 1, String.fromCharCode(97 + index)));
  const parsed = parseBulkAPIKeyLines(keys.join("\n"));
  assert.deepEqual(fingerprints(parsed.keys), fingerprints(keys.slice(0, 10)));
  assert.equal(parsed.validUniqueCount, 12);
  assert.equal(parsed.overflowCount, 2);
});

test("bulk API parser rejects all-invalid and oversized input", () => {
  const invalid = parseBulkAPIKeyLines("说明文字\nBearer not-a-key");
  assert.deepEqual(invalid.keys, []);
  assert.deepEqual(invalid.invalidLineNumbers, [1, 2]);

  const oversized = parseBulkAPIKeyLines("x".repeat(BULK_API_KEY_MAX_CLIPBOARD_BYTES + 1));
  assert.equal(oversized.inputTooLarge, true);
  assert.deepEqual(oversized.keys, []);
  assert.equal(oversized.inputBytes, BULK_API_KEY_MAX_CLIPBOARD_BYTES + 1);
});
