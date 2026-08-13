import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAllHistory,
  ensureAllHistoryLoaded,
  historyItemsAtOrAfter,
} from "../src/state/historyOperations.ts";
import { sanitizeHistoryForExport } from "../src/lib/security.ts";

function createTwoPageHarness() {
  const items = Array.from({ length: 200 }, (_, index) => ({
    id: `history-${200 - index}`,
    createdAt: 200 - index,
  }));
  const events = [];
  const state = {
    history: items.slice(0, 121),
    historyHasMore: true,
    historyCursorBeforeDayStart: 80,
    async loadMoreHistory() {
      events.push("load:79");
      state.history = [...state.history, ...items.slice(121)];
      state.historyHasMore = false;
      state.historyCursorBeforeDayStart = null;
    },
    async deleteHistoryItem(id) {
      events.push(`delete:${id}`);
      state.history = state.history.filter((item) => item.id !== id);
    },
  };
  return { events, getState: () => state };
}

test("loads 121 + 79 history records exactly once in newest-first order", async () => {
  const harness = createTwoPageHarness();

  await ensureAllHistoryLoaded(harness.getState);

  const history = harness.getState().history;
  assert.equal(history.length, 200);
  assert.equal(new Set(history.map((item) => item.id)).size, 200);
  assert.deepEqual(history.map((item) => item.createdAt), [...history].map((item) => item.createdAt).sort((a, b) => b - a));
  assert.deepEqual(harness.events, ["load:79"]);
});

test("stops on a stalled cursor and propagates page read failures", async () => {
  const stalledState = {
    history: [{ id: "history-1" }],
    historyHasMore: true,
    historyCursorBeforeDayStart: 100,
    async loadMoreHistory() {},
  };
  await assert.rejects(
    ensureAllHistoryLoaded(() => stalledState),
    /历史分页游标未推进/,
  );

  const failedState = {
    history: [{ id: "history-1" }],
    historyHasMore: true,
    historyCursorBeforeDayStart: 100,
    async loadMoreHistory() {
      throw new Error("page read failed");
    },
  };
  await assert.rejects(
    ensureAllHistoryLoaded(() => failedState),
    /page read failed/,
  );
});

test("3-day and 7-day cutoffs retain the boundary and every newer ID", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 10 * day;
  const history = [
    { id: "new", createdAt: now },
    { id: "three-day-boundary", createdAt: now - 3 * day },
    { id: "three-day-old", createdAt: now - 3 * day - 1 },
    { id: "seven-day-boundary", createdAt: now - 7 * day },
    { id: "seven-day-old", createdAt: now - 7 * day - 1 },
  ];

  const kept3 = historyItemsAtOrAfter(history, now - 3 * day);
  const kept7 = historyItemsAtOrAfter(history, now - 7 * day);

  assert.deepEqual(kept3.map((item) => item.id), ["new", "three-day-boundary"]);
  assert.deepEqual(
    kept7.map((item) => item.id),
    ["new", "three-day-boundary", "three-day-old", "seven-day-boundary"],
  );
  assert.deepEqual(new Set(kept7.map((item) => item.id)), new Set([
    "new",
    "three-day-boundary",
    "three-day-old",
    "seven-day-boundary",
  ]));
});

test("a 200-item export snapshot removes private paths and inline image payloads", () => {
  const items = Array.from({ length: 200 }, (_, index) => sanitizeHistoryForExport({
    id: `history-${index}`,
    createdAt: index,
    mode: "generate",
    prompt: `prompt-${index}`,
    savedPath: `C:\\private\\${index}.png`,
    rawPath: `C:\\private\\${index}.json`,
    fullUrl: `file:///private/${index}.png`,
    imageB64: "secret-inline-image",
    imageBlob: new Blob(["secret"]),
    previewBlob: new Blob(["preview"]),
    sourceImages: [{ id: "source", name: "source", path: "C:\\private\\source.png" }],
  }));
  const payload = { count: items.length, items };

  assert.equal(payload.count, 200);
  assert.equal(new Set(items.map((item) => item.id)).size, 200);
  for (const item of items) {
    assert.equal(item.savedPath, undefined);
    assert.equal(item.rawPath, undefined);
    assert.equal(item.fullUrl, undefined);
    assert.equal(item.imageB64, undefined);
    assert.equal(item.imageBlob, null);
    assert.equal(item.previewBlob, null);
    assert.equal(item.sourceImages, undefined);
    assert.equal(item.previewOnly, true);
  }
});

test("clear loads all pages before confirmation and deletes the full snapshot", async () => {
  const harness = createTwoPageHarness();

  const removed = await clearAllHistory(harness.getState, (count) => {
    harness.events.push(`confirm:${count}`);
    return true;
  });

  assert.equal(removed, 200);
  assert.equal(harness.getState().history.length, 0);
  assert.deepEqual(harness.events.slice(0, 2), ["load:79", "confirm:200"]);
  assert.equal(harness.events.filter((event) => event.startsWith("delete:")).length, 200);
});

test("clear never confirms or deletes after a stalled load", async () => {
  const events = [];
  const state = {
    history: [{ id: "history-1" }],
    historyHasMore: true,
    historyCursorBeforeDayStart: 100,
    async loadMoreHistory() {
      events.push("load");
    },
    async deleteHistoryItem(id) {
      events.push(`delete:${id}`);
    },
  };

  await assert.rejects(
    clearAllHistory(
      () => state,
      () => {
        events.push("confirm");
        return true;
      },
    ),
    /历史分页游标未推进/,
  );
  assert.deepEqual(events, ["load"]);
});

test("clear cancellation occurs after full pagination and deletes nothing", async () => {
  const harness = createTwoPageHarness();

  const removed = await clearAllHistory(harness.getState, (count) => {
    harness.events.push(`confirm:${count}`);
    return false;
  });

  assert.equal(removed, 0);
  assert.equal(harness.getState().history.length, 200);
  assert.deepEqual(harness.events, ["load:79", "confirm:200"]);
});
