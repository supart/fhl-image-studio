import assert from "node:assert/strict";
import test from "node:test";

import {
  INVALID_TRANSPARENT_OUTPUT,
  validateTransparentPNGBase64,
} from "../src/platform/runtime/remote-kernel/transparentOutput.ts";

const VALID = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAPSURBVBhXY/jPAAL//wMACv4C/pDh5CgAAAAASUVORK5CYII=";
const OPAQUE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY+ASkfsPAAGkATy8Tqj3AAAAAElFTkSuQmCC";
const EMPTY = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY+ASkWMAAAClAD1GXS78AAAAAElFTkSuQmCC";
const RGB = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAVSURBVBhXY/j//39DQwMDEP///x8APuQI+ze0J3IAAAAASUVORK5CYII=";

const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;
let decodedFixture = "";

class TestOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      clearRect() {},
      drawImage() {},
      getImageData() {
        const alpha = decodedFixture === VALID
          ? [255, 0]
          : decodedFixture === EMPTY
            ? [0]
            : decodedFixture === RGB
              ? [255, 255, 255, 255]
              : [255];
        const data = new Uint8ClampedArray(alpha.length * 4);
        alpha.forEach((value, index) => { data[index * 4 + 3] = value; });
        return { data };
      },
    };
  }
}

test.before(() => {
  globalThis.OffscreenCanvas = TestOffscreenCanvas;
  globalThis.createImageBitmap = async (blob) => {
    decodedFixture = Buffer.from(await blob.arrayBuffer()).toString("base64");
    if (![VALID, OPAQUE, EMPTY, RGB].includes(decodedFixture)) throw new Error("decode failed");
    return {
      width: decodedFixture === VALID || decodedFixture === RGB ? 2 : 1,
      height: decodedFixture === RGB ? 2 : 1,
      close() {},
    };
  };
});

test.after(() => {
  globalThis.createImageBitmap = originalCreateImageBitmap;
  globalThis.OffscreenCanvas = originalOffscreenCanvas;
});

async function assertInvalid(imageB64, messagePattern) {
  await assert.rejects(
    validateTransparentPNGBase64(imageB64, "safe-diagnostic.json"),
    (error) => {
      assert.equal(error.errorCode, INVALID_TRANSPARENT_OUTPUT);
      assert.equal(error.rawPath, "safe-diagnostic.json");
      assert.match(error.message, messagePattern);
      return true;
    },
  );
}

test("transparent output accepts a decodable PNG with visible and transparent pixels", async () => {
  await validateTransparentPNGBase64(`data:image/png;base64,${VALID}`);
});

test("transparent output rejects opaque RGBA, empty-alpha and RGB PNG fixtures", async () => {
  await assertInvalid(OPAQUE, /不包含真实透明像素/);
  await assertInvalid(EMPTY, /全透明/);
  await assertInvalid(RGB, /不包含真实透明像素/);
});

test("transparent output rejects non-PNG and damaged PNG data with one stable code", async () => {
  await assertInvalid(Buffer.from("not-png").toString("base64"), /不是 PNG/);
  await assertInvalid(VALID.slice(0, 40), /解码失败|损坏/);
});
