const LOCAL_CREDENTIAL_CLEAR_ENDPOINT = "/__image-studio-local-config/api-library";

function isLocalPreviewHost(): boolean {
  if (typeof window === "undefined" || typeof window.location === "undefined") return false;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function clearLocalCredentialFiles(): Promise<boolean> {
  const nativeClear = typeof window !== "undefined"
    ? (window as Window & {
        go?: { backend?: { DesktopAPI?: { ClearLocalCredentialFiles?: () => Promise<void> } } };
      }).go?.backend?.DesktopAPI?.ClearLocalCredentialFiles
    : undefined;
  if (typeof nativeClear === "function") {
    await nativeClear();
    return true;
  }
  if (!isLocalPreviewHost() || typeof fetch === "undefined") return false;
  const response = await fetch(LOCAL_CREDENTIAL_CLEAR_ENDPOINT, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`清除本地 API 凭据文件失败 (${response.status})`);
  }
  return true;
}
