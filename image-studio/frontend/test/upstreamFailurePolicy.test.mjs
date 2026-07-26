import assert from "node:assert/strict";
import test from "node:test";

async function loadCommon() {
  return import(`../src/platform/runtime/remote-kernel/common.ts?test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("transient upstream classifier includes Cloudflare and busy failures", async () => {
  const { isTransientGenerationFailureText } = await loadCommon();
  assert.equal(isTransientGenerationFailureText("上游返回 HTTP 524: Cloudflare timeout"), true);
  assert.equal(isTransientGenerationFailureText("HTTP 502 bad gateway"), true);
  assert.equal(isTransientGenerationFailureText("HTTP 503 service unavailable"), true);
  assert.equal(isTransientGenerationFailureText("HTTP 504 gateway timeout"), true);
  assert.equal(isTransientGenerationFailureText("HTTP 429 too many requests"), true);
  assert.equal(isTransientGenerationFailureText("FHL 账号池暂时繁忙，请稍后重试"), true);
  assert.equal(isTransientGenerationFailureText("No available compatible accounts"), true);
  assert.equal(isTransientGenerationFailureText("最终图缺失"), true);
});

test("transient upstream classifier excludes configuration failures", async () => {
  const { isConfigurationFailureText, isTransientGenerationFailureText } = await loadCommon();
  assert.equal(isConfigurationFailureText("HTTP 401 unauthorized invalid API key"), true);
  assert.equal(isConfigurationFailureText("HTTP 403 forbidden permission denied"), true);
  assert.equal(isConfigurationFailureText("余额不足，请充值"), true);
  assert.equal(isConfigurationFailureText("Image generation is not enabled for this group"), true);
  assert.equal(isConfigurationFailureText("model_not_found"), true);
  assert.equal(isConfigurationFailureText("参数错误 validation failed"), true);
  assert.equal(isConfigurationFailureText("用户取消任务"), true);
  assert.equal(isTransientGenerationFailureText("HTTP 401 unauthorized invalid API key"), false);
  assert.equal(isTransientGenerationFailureText("余额不足，请充值"), false);
  assert.equal(isTransientGenerationFailureText("Image generation is not enabled for this group"), false);
  assert.equal(isTransientGenerationFailureText("content_policy_error: request rejected by safety system"), false);
});
