import assert from "node:assert/strict";
import test from "node:test";

import {
  submitBrowserJobGroups,
  subscribeToBrowserJob,
  subscribeToBrowserWorkspace,
} from "../src/platform/runtime/browserJobClient.ts";

test("browser batch submission uses one submit-many request", async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = "";
  let requestedBody = null;
  try {
    globalThis.fetch = async (url, init) => {
      requestedURL = String(url);
      requestedBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ runId: "wave-1", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const response = await submitBrowserJobGroups({
      runId: "wave-1",
      credentials: [],
      tasks: [],
    });

    assert.equal(requestedURL, "/__image-studio-jobs/submit-many");
    assert.equal(requestedBody.runId, "wave-1");
    assert.equal(response.runId, "wave-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser job subscriptions notify when an SSE stream ends without a terminal event", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  try {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"snapshot","slot":{"jobId":"job-1"},"group":{"groupId":"group-1","workspaceId":"ws-1","createdAt":1,"mode":"generate","apiMode":"responses","prompt":"prompt","batchCount":1,"size":"864x1536","quality":"medium","outputFormat":"png","slotIds":["job-1"],"slots":[{"jobId":"job-1","groupId":"group-1","workspaceId":"ws-1","batchIndex":0,"status":"running","createdAt":1,"updatedAt":2}]}}\n\n',
        ));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const events = [];
    await new Promise((resolve) => {
      subscribeToBrowserJob("job-1", (event) => {
        events.push(event);
      }, undefined, () => {
        resolve(undefined);
      });
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "snapshot");
    assert.equal(events[0].slot.jobId, "job-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser workspace subscriptions multiplex job events over one workspace stream", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let requestedURL = "";

  try {
    globalThis.fetch = async (url) => {
      requestedURL = String(url);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"type":"terminal","slot":{"jobId":"job-2","groupId":"group-2","workspaceId":"ws-40","batchIndex":0,"status":"succeeded","createdAt":1,"updatedAt":2},"group":{"groupId":"group-2","workspaceId":"ws-40","createdAt":1,"mode":"generate","apiMode":"images","prompt":"prompt","batchCount":1,"size":"864x1536","quality":"medium","outputFormat":"png","slotIds":["job-2"],"slots":[{"jobId":"job-2","groupId":"group-2","workspaceId":"ws-40","batchIndex":0,"status":"succeeded","createdAt":1,"updatedAt":2}]}}\n\n',
          ));
          controller.close();
        },
      }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const events = [];
    await new Promise((resolve) => {
      subscribeToBrowserWorkspace("ws-40", (event) => {
        events.push(event);
      }, undefined, () => resolve(undefined));
    });

    assert.equal(new URL(requestedURL).searchParams.get("workspaceId"), "ws-40");
    assert.equal(new URL(requestedURL).searchParams.has("jobId"), false);
    assert.deepEqual(events.map((event) => event.slot.jobId), ["job-2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
