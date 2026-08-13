import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historyRail = readFileSync(new URL("../src/components/history/HistoryRail.tsx", import.meta.url), "utf8");
const timelineModal = readFileSync(new URL("../src/components/history/HistoryTimelineModal.tsx", import.meta.url), "utf8");
const timelineItem = readFileSync(new URL("../src/components/history/TimelineHistoryItem.tsx", import.meta.url), "utf8");
const timelineGroup = readFileSync(new URL("../src/components/history/TimelinePromptStackGroup.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/_android-history.css", import.meta.url), "utf8");
const historyCss = readFileSync(new URL("../src/styles/_history.css", import.meta.url), "utf8");

test("Android history exposes a stable full timeline entry like desktop", () => {
  assert.match(historyRail, /GalleryVerticalEnd/);
  assert.match(historyRail, /className="android-history-hero-actions"[\s\S]*className="android-history-timeline-button"/);
  assert.match(historyRail, /className="android-history-timeline-button"[\s\S]*onClick=\{openHistoryTimeline\}/);
  assert.match(historyRail, />完整历史<\/span>/);
  assert.match(css, /\.android-history-hero-actions/);
  assert.match(css, /\.android-history-timeline-button/);
  assert.match(css, /data-target-platform="android-pad"[\s\S]*\.android-history-timeline-button/);
});

test("Android phone full timeline uses compact single-column content", () => {
  assert.match(timelineModal, /isAndroidPhone/);
  assert.match(timelineModal, /isAndroidPhone \? "grid grid-cols-1 gap-2"/);
  assert.match(timelineModal, /cardClassName=\{isAndroidPhone \? "android-history-timeline-card" : ""\}/);
  assert.match(timelineModal, /bodyClassName=\{isAndroidPhone \? "android-history-timeline-body" : ""\}/);
  assert.match(timelineModal, /android-history-timeline-content/);
  assert.match(timelineModal, /android-history-timeline-list/);
  assert.match(timelineItem, /const compact = isAndroidPhone/);
  assert.match(timelineItem, /compact \? "grid min-w-0 grid-cols-\[22px_minmax\(0,1fr\)\] gap-2"/);
  assert.match(timelineItem, /compact \? "grid min-w-0 grid-cols-1 gap-2\.5"/);
  assert.match(timelineGroup, /const compact = isAndroidPhone/);
  assert.match(timelineGroup, /timeline-prompt-stack-card \$\{compact \? "compact" : ""\}/);
  assert.match(historyCss, /\.timeline-prompt-stack-card\.compact \.timeline-prompt-stack-head/);
  assert.match(historyCss, /\.timeline-prompt-stack-card\.compact \.timeline-prompt-stack-main/);
  assert.match(historyCss, /\.android-history-timeline-body/);
  assert.match(historyCss, /\.android-history-timeline-card \.app-modal-body/);
  assert.match(historyCss, /overflow-x: hidden/);
});
