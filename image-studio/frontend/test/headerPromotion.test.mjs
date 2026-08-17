import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EMPTY_HEADER_PROMOTION_CONFIG,
  HEADER_PROMOTION_ENDPOINT,
  HEADER_PROMOTION_FIELD_LIMITS,
  HEADER_PROMOTION_MAX_BYTES,
  loadHeaderPromotionConfig,
  parseHeaderPromotionConfig,
} from "../src/lib/headerPromotion.ts";
import {
  HEADER_PROMOTION_FILE_NAME,
  resolveHeaderPromotionFileResponse,
} from "../dev/headerPromotionFile.ts";

const fullConfigText = [
  "群公告=公告内容",
  "群号=123456",
  "注册文案=点击注册",
  "注册链接=https://example.test/register?a=b=c",
].join("\r\n");

test("promotion parser accepts BOM, CRLF, comments, first equals and last duplicate", () => {
  assert.deepEqual(parseHeaderPromotionConfig([
    "\uFEFF# comment",
    "",
    "未知键=ignored",
    "非法行",
    "群公告=旧公告",
    "群公告=新公告",
    "群号=123456",
    "注册文案=点击注册",
    "注册链接=https://example.test/register?a=b=c",
  ].join("\r\n")), {
    announcement: "新公告",
    groupNumber: "123456",
    registrationText: "点击注册",
    registrationURL: "https://example.test/register?a=b=c",
  });
});

test("promotion parser keeps independent empty fields and rejects invalid registration URLs", () => {
  assert.deepEqual(parseHeaderPromotionConfig([
    "群公告=",
    "群号=789",
    "注册文案=点击注册",
    "注册链接=javascript:alert(1)",
  ].join("\n")), {
    announcement: "",
    groupNumber: "789",
    registrationText: "点击注册",
    registrationURL: "",
  });
  assert.deepEqual(parseHeaderPromotionConfig("# comments only\n\n"), EMPTY_HEADER_PROMOTION_CONFIG);
});

test("promotion parser hides oversized files and individual overlong fields", () => {
  assert.deepEqual(
    parseHeaderPromotionConfig("x".repeat(HEADER_PROMOTION_MAX_BYTES + 1)),
    EMPTY_HEADER_PROMOTION_CONFIG,
  );
  const parsed = parseHeaderPromotionConfig([
    `群公告=${"公".repeat(HEADER_PROMOTION_FIELD_LIMITS.announcement + 1)}`,
    "群号=123456",
    `注册文案=${"注".repeat(HEADER_PROMOTION_FIELD_LIMITS.registrationText + 1)}`,
    "注册链接=http://example.test/ok",
  ].join("\n"));
  assert.equal(parsed.announcement, "");
  assert.equal(parsed.groupNumber, "123456");
  assert.equal(parsed.registrationText, "");
  assert.equal(parsed.registrationURL, "http://example.test/ok");

  const otherFields = parseHeaderPromotionConfig([
    `群号=${"1".repeat(HEADER_PROMOTION_FIELD_LIMITS.groupNumber + 1)}`,
    "注册文案=点击注册",
    `注册链接=https://example.test/${"x".repeat(HEADER_PROMOTION_FIELD_LIMITS.registrationURL)}`,
  ].join("\n"));
  assert.equal(otherFields.groupNumber, "");
  assert.equal(otherFields.registrationURL, "");
});

test("promotion loader uses the fixed no-store endpoint and hides failures", async () => {
  let request;
  const loaded = await loadHeaderPromotionConfig(async (input, init) => {
    request = { input, init };
    return { ok: true, text: async () => fullConfigText };
  });
  assert.equal(request.input, HEADER_PROMOTION_ENDPOINT);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.cache, "no-store");
  assert.equal(loaded.groupNumber, "123456");

  assert.deepEqual(
    await loadHeaderPromotionConfig(async () => ({ ok: false, text: async () => "secret" })),
    EMPTY_HEADER_PROMOTION_CONFIG,
  );
  assert.deepEqual(
    await loadHeaderPromotionConfig(async () => { throw new Error("offline"); }),
    EMPTY_HEADER_PROMOTION_CONFIG,
  );
});

test("Vite file contract reads only the fixed public-root TXT", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fhl-header-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, HEADER_PROMOTION_FILE_NAME);

  assert.deepEqual(await resolveHeaderPromotionFileResponse(root, "GET"), {
    status: 204,
    body: Buffer.alloc(0),
  });
  await writeFile(file, fullConfigText, "utf8");
  const getResponse = await resolveHeaderPromotionFileResponse(root, "GET");
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.body.toString("utf8"), fullConfigText);
  assert.deepEqual(await resolveHeaderPromotionFileResponse(root, "HEAD"), {
    status: 200,
    body: Buffer.alloc(0),
  });
  assert.equal((await resolveHeaderPromotionFileResponse(root, "POST")).status, 405);

  await writeFile(file, Buffer.alloc(HEADER_PROMOTION_MAX_BYTES + 1, 1));
  assert.equal((await resolveHeaderPromotionFileResponse(root, "GET")).status, 413);
  await writeFile(file, "", "utf8");
  assert.deepEqual(await resolveHeaderPromotionFileResponse(root, "GET"), {
    status: 200,
    body: Buffer.alloc(0),
  });
});
