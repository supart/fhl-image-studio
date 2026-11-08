import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { browserJobBackgroundCLIArgs } from "../dev/browserJobArgs.ts";

const proxySource = readFileSync(new URL("../dev/browserJobProxy.ts", import.meta.url), "utf8");

test("browser background jobs pass the frozen background mode to the V2.0.5 CLI", () => {
  assert.deepEqual(browserJobBackgroundCLIArgs("transparent"), ["--background-mode", "transparent"]);
  assert.deepEqual(browserJobBackgroundCLIArgs("standard"), ["--background-mode", "standard"]);
  assert.deepEqual(browserJobBackgroundCLIArgs("damaged"), ["--background-mode", "standard"]);

  assert.match(proxySource, /\.\.\.browserJobBackgroundCLIArgs\(payload\.imageBackgroundMode\)/);
  assert.match(
    proxySource,
    /IMAGE_STUDIO_BACKGROUND_MODE: payload\.imageBackgroundMode === "transparent" \? "transparent" : "standard"/,
  );
});
