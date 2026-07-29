import assert from "node:assert/strict";
import test from "node:test";

import { localFHLConfigFromCLIEnv } from "../dev/localFHLConfigFallback.ts";

test("local FHL config falls back to the current CLI Images profile", () => {
  const config = localFHLConfigFromCLIEnv({
    IMAGE_STUDIO_API_KEY: "runtime-secret",
    IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://www.fhl.mom",
    IMAGE_STUDIO_API_MODE: "images",
    IMAGE_STUDIO_REQUEST_POLICY: "openai",
    IMAGE_STUDIO_TEXT_MODEL: "gpt-5.5",
    IMAGE_STUDIO_IMAGE_MODEL: "gpt-image-2",
  });

  assert.deepEqual(config, {
    apiKey: "runtime-secret",
    baseURL: "https://www.fhl.mom",
    apiMode: "images",
    requestPolicy: "openai",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
  });
});

test("local FHL config fallback rejects missing keys and non-FHL CLI modes", () => {
  assert.equal(localFHLConfigFromCLIEnv({ IMAGE_STUDIO_API_MODE: "images" }), null);
  assert.equal(localFHLConfigFromCLIEnv({
    IMAGE_STUDIO_API_KEY: "runtime-secret",
    IMAGE_STUDIO_API_MODE: "apimart",
  }), null);
  assert.equal(localFHLConfigFromCLIEnv({
    IMAGE_STUDIO_API_KEY: "runtime-secret",
    IMAGE_STUDIO_API_MODE: "runninghub",
  }), null);
});
