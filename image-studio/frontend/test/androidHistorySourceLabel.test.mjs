import assert from "node:assert/strict";
import test from "node:test";

const { historySourceLabel } = await import("../src/platform/android/history/historySourceLabel.ts");

test("Android history source labels use the frozen task transport without guessing legacy records", () => {
  assert.equal(
    historySourceLabel({ apiMode: "images", fhlImagesPoolSlot: 3, apiLabel: "FHL3" }),
    "FHL3 · Images API",
  );
  assert.equal(
    historySourceLabel({ apiMode: "responses", fhlImagesPoolSlot: 7, apiLabel: "FHL7" }),
    "FHL7 · Responses API",
  );
  assert.equal(
    historySourceLabel({ apiMode: "responses", fhlImagesPoolSlot: 0, apiLabel: "FHL" }),
    "FHL",
  );
  assert.equal(historySourceLabel({ apiLabel: "FHL9" }), "FHL9");
  assert.equal(historySourceLabel({}), "FHL");
});
