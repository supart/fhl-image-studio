import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_BROWSER_JOB_GROUPS,
  retainBrowserJobGroups,
} from "../src/platform/runtime/browserJobContracts.ts";

function makeGroup(index, status) {
  const jobId = `job-${index}`;
  const groupId = `group-${index}`;
  const slot = {
    jobId,
    groupId,
    workspaceId: "ws-40",
    batchIndex: 0,
    status,
    createdAt: index,
    updatedAt: index,
  };
  return {
    groupId,
    workspaceId: "ws-40",
    createdAt: index,
    mode: "edit",
    apiMode: "images",
    prompt: "prompt",
    batchCount: 1,
    size: "1152x2048",
    quality: "medium",
    outputFormat: "png",
    slotIds: [jobId],
    slots: [slot],
    statusSummary: {
      queued: status === "queued" ? 1 : 0,
      running: status === "running" ? 1 : 0,
      succeeded: status === "succeeded" ? 1 : 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    },
  };
}

test("browser job retention keeps all 40 active groups plus 500 settled groups", () => {
  const settled = Array.from({ length: 520 }, (_, index) => makeGroup(index + 1, "succeeded"));
  const active = Array.from({ length: 40 }, (_, index) => makeGroup(index + 1001, "running"));

  const retained = retainBrowserJobGroups([...settled, ...active], MAX_BROWSER_JOB_GROUPS);

  assert.equal(retained.filter((group) => group.slots[0].status === "running").length, 40);
  assert.equal(retained.filter((group) => group.slots[0].status === "succeeded").length, 500);
  assert.equal(retained.length, 540);
});

test("browser transport uses one workspace SSE and serialized registry writes", async () => {
  const proxySource = await readFile(new URL("../dev/browserJobProxy.ts", import.meta.url), "utf8");
  const storeSource = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");

  assert.match(proxySource, /private readonly workspaceSubscribers = new Map/);
  assert.match(proxySource, /subscribeWorkspace\(workspaceId: string/);
  assert.match(proxySource, /manager\.subscribeWorkspace\(workspaceId, req, res\)/);
  assert.match(proxySource, /private persistChain: Promise<void> = Promise\.resolve\(\)/);
  assert.match(proxySource, /async submitMany\(request: BrowserJobSubmitManyRequest\)/);
  assert.match(proxySource, /this\.registerGroups\(registrations\.map/);
  assert.match(proxySource, /if \(registrations\.length > 0\) await this\.persist\(\)/);
  assert.match(proxySource, /this\.findGroupByClientTaskId\(clientTaskId\)/);
  assert.match(proxySource, /retainBrowserJobGroups\(this\.registry\.groups, MAX_BROWSER_JOB_GROUPS\)/);
  assert.match(storeSource, /submitBrowserJobGroups\(request\)/);
  assert.match(storeSource, /subscribeToBrowserWorkspace\(workspaceId/);
  assert.match(storeSource, /const browserWorkspaceSubscriptions = new Map/);
});
