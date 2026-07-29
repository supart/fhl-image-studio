import { createServer } from "node:http";

const port = Number(process.env.PORTABLE_QUEUE_MOCK_PORT || 41745);
const delayMs = Math.max(0, Number(process.env.PORTABLE_QUEUE_MOCK_DELAY_MS || 1500));
const origin = `http://127.0.0.1:${port}`;
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2gZQAAAAASUVORK5CYII=";

let requestCount = 0;
let activeRequests = 0;
let peakActiveRequests = 0;

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function delay() {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", origin);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { ok: true, requestCount, activeRequests, peakActiveRequests, delayMs });
    return;
  }
  if (request.method === "POST" && url.pathname === "/reset") {
    requestCount = 0;
    activeRequests = 0;
    peakActiveRequests = 0;
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    json(response, 200, { data: [{ id: "gpt-image-2" }] });
    return;
  }
  if (
    request.method === "POST"
    && (url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits")
  ) {
    requestCount += 1;
    activeRequests += 1;
    peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
    try {
      await delay();
      json(response, 200, {
        data: [{ b64_json: pngBase64, revised_prompt: `portable queue mock ${requestCount}` }],
      });
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
    }
    return;
  }
  json(response, 404, { error: { message: `mock route not found: ${request.method} ${url.pathname}` } });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ origin, delayMs }) + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
