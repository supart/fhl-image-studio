import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kernel = await import("../src/platform/runtime/remote-kernel/index.ts");

const oldAtob = globalThis.atob;
const oldFetch = globalThis.fetch;

test("APIMart background query only polls an existing task", async () => {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push({ url: String(url), method: init?.method || "GET" });
    assert.match(String(url), /\/v1\/tasks\/task_abc\?language=zh$/);
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({
      status: "completed",
      data: {
        image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAE",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await kernel.queryAPIMartTaskRemote({
      apiKey: "sk-test",
      baseURL: "https://api.apimart.ai",
      taskId: "task_abc",
      prompt: "cat",
      mode: "generate",
      size: "864x1536",
      quality: "medium",
      outputFormat: "png",
      imageModelID: "gpt-image-2",
    }, new AbortController().signal);

    assert.equal(result.taskId, "task_abc");
    assert.equal(result.status, "completed");
    assert.match(result.imageB64 ?? "", /^iVBORw0KGgo/);
    assert.equal(requested.some((entry) => entry.url.includes("/v1/images/generations")), false);
  } finally {
    if (oldAtob === undefined) {
      delete globalThis.atob;
    } else {
      globalThis.atob = oldAtob;
    }
    if (oldFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = oldFetch;
    }
  }
});

test("Android APIMart recovery is wired to store and short UI button", () => {
  const types = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");
  const storeTypes = readFileSync(new URL("../src/state/studioStore.types.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const workspaceRuntime = readFileSync(new URL("../src/state/workspaceRuntime.ts", import.meta.url), "utf8");
  const phone = readFileSync(new URL("../src/platform/android/AndroidPhoneComposePanel.tsx", import.meta.url), "utf8");
  const pad = readFileSync(new URL("../src/platform/android/AndroidPadComposePanel.tsx", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/components/canvas/BatchResultGrid.tsx", import.meta.url), "utf8");
  const androidCanvas = readFileSync(new URL("../src/platform/android/canvas/AndroidCanvasStage.tsx", import.meta.url), "utf8");
  const canvasCss = readFileSync(new URL("../src/styles/_canvas.css", import.meta.url), "utf8");

  assert.match(types, /interface APIMartRecoveryTask/);
  assert.match(types, /apimartRecoveryTasks\?: APIMartRecoveryTask\[\]/);
  assert.match(host, /export function QueryAPIMartTask/);
  assert.match(host, /queryAPIMartTaskRemote/);
  assert.match(storeTypes, /apimartRecoveryTask: APIMartRecoveryTask \| null/);
  assert.match(storeTypes, /apimartRecoveryTasks: APIMartRecoveryTask\[\]/);
  assert.match(storeTypes, /queryAPIMartRecoveryTask: \(taskId\?: string\) => Promise<void>/);
  assert.match(store, /wailsQueryAPIMartTask/);
  assert.match(store, /apimartRecoveryTask: null/);
  assert.match(store, /apimartRecoveryTasks: \[\]/);
  assert.match(store, /upsertAPIMartRecoveryTask/);
  assert.match(store, /EventsOn\(`apimart-task:\$\{jobId\}`/);
  assert.match(store, /offAPIMartTask/);
  assert.match(store, /apimartTaskId: task\.taskId/);
  assert.match(store, /当前不是 APIMart 配置，不会用 FHL Key 查询 APIMart/);
  assert.match(workspaceRuntime, /apimartRecoveryTasks/);
  assert.match(phone, /查后台/);
  assert.match(phone, /继续查询 APIMart 后台任务，不重新生成，不重新扣费/);
  assert.match(pad, /查后台/);
  assert.match(pad, /查看日志/);
  assert.match(pad, /queryAPIMartRecoveryTask\(\)/);
  assert.match(phone, /const showAPIMartRecovery = apiMode === "apimart" && !!apimartRecoveryTask\?\.taskId;/);
  assert.match(pad, /const showAPIMartRecovery = apiMode === "apimart" && !!apimartRecoveryTask\?\.taskId;/);
  assert.match(grid, /batch-grid-apimart-query/);
  assert.match(grid, /onApplyJobSlotParams/);
  assert.match(grid, /onRegenerateJobSlot/);
  assert.match(grid, /batch-grid-apply-params/);
  assert.match(grid, /batch-grid-regenerate-slot/);
  assert.match(grid, /batch-grid-failed-actions/);
  assert.match(grid, /apiLabel\?: string/);
  assert.match(grid, /batch-grid-api-label/);
  assert.match(grid, /查后台/);
  assert.match(androidCanvas, /apimartRecoveryByBatchIndex/);
  assert.match(androidCanvas, /jobGroupsByWorkspace/);
  assert.match(androidCanvas, /jobEntryByBatchIndex/);
  assert.match(androidCanvas, /runningMetaByBatchIndex/);
  assert.match(androidCanvas, /apiLabelForBatchIndex/);
  assert.match(androidCanvas, /batchApiShortLabel/);
  assert.match(androidCanvas, /recoveryTask\s*\?\s*"APIMart"/);
  assert.match(grid, /apiLabelForGridSlot/);
  assert.match(androidCanvas, /onApplyJobSlotParams=\{applyJobSlotParams\}/);
  assert.match(androidCanvas, /onRegenerateJobSlot=\{\(group, slot\) => \{ void regenerateJobSlot\(group, slot\); \}\}/);
  assert.match(androidCanvas, /queryAPIMartRecoveryTask\(taskId\)/);
  assert.match(canvasCss, /\.batch-grid-failed-actions/);
  assert.match(canvasCss, /\.batch-grid-api-label/);
  assert.match(canvasCss, /\.batch-grid-apply-params/);
  assert.match(canvasCss, /\.batch-grid-regenerate-slot/);
});

test("Android native APIMart probe falls back from official IPv6-prone host to legacy host", () => {
  const bridge = readFileSync(new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidImageStudioBridge.kt", import.meta.url), "utf8");
  assert.match(bridge, /apimartOfficialBaseUrl = "https:\/\/api\.apimart\.ai"/);
  assert.match(bridge, /apimartLegacyBaseUrl = "https:\/\/api\.apib\.ai"/);
  assert.match(bridge, /apimartProbeBaseUrlCandidates\(baseUrl, apiMode\)/);
  assert.match(bridge, /return listOf\(apimartOfficialBaseUrl, apimartLegacyBaseUrl\)/);
  assert.match(bridge, /isAPIMartNetworkFallbackError\(error\)/);
  assert.match(bridge, /connectTimeoutForUrl\(url, 20_000\)/);
  assert.match(bridge, /connectTimeoutForUrl\(url, 30_000\)/);
});
