import assert from "node:assert/strict";
import test from "node:test";

const caps = await import("../src/components/panel/sizeCapabilities.ts");

test("FHL aspect presets expose the supported ratio list in order", () => {
  assert.deepEqual(
    caps.ASPECT_PRESETS.map((item) => item.value),
    ["auto", "1:1", "3:2", "2:3", "16:9", "9:16", "2:1", "1:2", "7:4", "4:7"],
  );
});

test("APIMart aspect presets expose the full APIMart ratio list", () => {
  assert.deepEqual(
    caps.aspectPresetsForAPIMode("apimart").map((item) => item.value),
    ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"],
  );
});

test("gpt-image paths expose explicit 2K/4K resolution presets", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  });
  assert.ok(values.includes("2k"));
  assert.ok(values.includes("4k"));
  assert.equal(
    caps.buildSizeSelection("16:9", "4k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "3840x2160",
  );
});

test("non-gpt-image openai-standard paths stay on base resolution presets", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "custom-relay-image",
  });
  assert.ok(!values.includes("2k"));
  assert.ok(!values.includes("4k"));
  assert.equal(caps.normalizeSizeSelection("3840x2160", {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "custom-relay-image",
  }), "1536x864");
});

test("compat mode can keep large resolution presets available for compatible relays", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "compat",
    imageModelID: "relay-image-model",
  });
  assert.ok(values.includes("2k"));
  assert.ok(values.includes("4k"));
});

test("APIMart always exposes 1K/2K/4K resolution presets", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "apimart",
    requestPolicy: "openai",
    imageModelID: "custom-relay-image",
  });
  assert.deepEqual(values, ["auto", "1k", "2k", "4k"]);
});

test("FHL aspect ratios map to concrete pixel sizes", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  const expected = [
    ["1:1", "1k", "1024x1024"],
    ["1:1", "2k", "2048x2048"],
    ["1:1", "4k", "2880x2880"],
    ["3:2", "1k", "1536x1024"],
    ["3:2", "2k", "2048x1360"],
    ["3:2", "4k", "3520x2352"],
    ["2:3", "1k", "1024x1536"],
    ["2:3", "2k", "1360x2048"],
    ["2:3", "4k", "2352x3520"],
    ["16:9", "1k", "1536x864"],
    ["16:9", "2k", "2048x1152"],
    ["16:9", "4k", "3840x2160"],
    ["9:16", "1k", "864x1536"],
    ["9:16", "2k", "1152x2048"],
    ["9:16", "4k", "2160x3840"],
    ["2:1", "1k", "1536x768"],
    ["2:1", "2k", "2048x1024"],
    ["2:1", "4k", "3840x1920"],
    ["1:2", "1k", "768x1536"],
    ["1:2", "2k", "1024x2048"],
    ["1:2", "4k", "1920x3840"],
    ["7:4", "1k", "1664x944"],
    ["7:4", "2k", "2208x1264"],
    ["7:4", "4k", "3808x2176"],
    ["4:7", "1k", "944x1664"],
    ["4:7", "2k", "1264x2208"],
    ["4:7", "4k", "2176x3808"],
  ];
  for (const [aspect, resolution, size] of expected) {
    assert.equal(
      caps.buildSizeSelection(aspect, resolution, input),
      size,
      `${aspect}/${resolution}`,
    );
    assert.equal(caps.deriveAspectPreset(size), aspect, `${size} aspect`);
    assert.equal(caps.deriveResolutionPreset(size), resolution, `${size} resolution`);
  }
});

test("APIMart size selections keep aspect and resolution instead of pixel size", () => {
  const input = {
    apiMode: "apimart",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.buildSizeSelection("9:16", "1k", input), "9:16@1k");
  assert.equal(caps.buildSizeSelection("9:16", "2k", input), "9:16@2k");
  assert.equal(caps.buildSizeSelection("9:16", "4k", input), "9:16@4k");
  assert.equal(caps.buildSizeSelection("21:9", "4k", input), "21:9@4k");
  assert.equal(caps.buildSizeSelection("9:21", "4k", input), "9:21@4k");
  assert.equal(caps.deriveAspectPreset("9:16@4k"), "9:16");
  assert.equal(caps.deriveResolutionPreset("9:16@4k"), "4k");
});

test("legacy pixel sizes normalize into the current FHL visible ratios", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.normalizeSizeSelection("3840x2880", input), "3520x2352");
  assert.equal(caps.normalizeSizeSelection("2880x3840", input), "2352x3520");
  assert.equal(caps.normalizeSizeSelection("3840x1280", input), "3808x2176");
  assert.equal(caps.normalizeSizeSelection("1280x3840", input), "2176x3808");
});

test("ratio stays independent from resolution preset", () => {
  assert.equal(
    caps.buildSizeSelection("1:1", "2k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2048x2048",
  );
  assert.equal(
    caps.buildSizeSelection("9:16", "4k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2160x3840",
  );
});

test("explicit aspect selection can leave Auto size", () => {
  assert.equal(
    caps.buildAspectSizeSelection("9:16", "auto", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "864x1536",
  );
});

test("explicit resolution selection can leave Auto size", () => {
  assert.equal(
    caps.buildResolutionSizeSelection("auto", "2k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2048x2048",
  );
  assert.equal(
    caps.buildResolutionSizeSelection("auto", "2k", {
      apiMode: "apimart",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "9:16@2k",
  );
});

test("explicit Auto selections keep upstream-determined size", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.buildAspectSizeSelection("auto", "2k", input), "auto");
  assert.equal(caps.buildResolutionSizeSelection("16:9", "auto", input), "auto");
});

test("FHL Images keep desktop-aligned 1K pixel sizes", () => {
  const input = {
    apiMode: "images",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.normalizeSizeSelection("1536x864", input), "1536x864");
  assert.equal(caps.normalizeSizeSelection("1536x1024", input), "1536x1024");
  assert.equal(caps.normalizeSizeSelection("864x1536", input), "864x1536");
});
