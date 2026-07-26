type RunningHubConfigResponse = {
  ok?: boolean;
  message?: string;
  config?: { api_key_configured?: boolean };
};

function runningHubConfigURL(baseURL: string): string {
  const normalized = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("RunningHub 桥接地址无效");
  }
  return `${normalized}/api/config`;
}

async function readConfigResponse(response: Response): Promise<RunningHubConfigResponse> {
  const raw = await response.text();
  let parsed: RunningHubConfigResponse | null = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(raw.trim() || `RunningHub 桥接返回无效数据 (${response.status})`);
  }
  if (!response.ok || parsed?.ok === false) {
    throw new Error(String(parsed?.message || `RunningHub 桥接清除失败 (${response.status})`));
  }
  return parsed || {};
}

export async function clearRunningHubCredential(baseURL: string, signal?: AbortSignal): Promise<void> {
  const url = runningHubConfigURL(baseURL);
  const clearResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: "" }),
    signal,
  });
  await readConfigResponse(clearResponse);

  const verifyResponse = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const verified = await readConfigResponse(verifyResponse);
  if (verified.config?.api_key_configured === true) {
    throw new Error("RunningHub 桥接仍报告 API Key 已配置");
  }
}
