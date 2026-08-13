type SecureCryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackIDCounter = 0;

function readSecureCryptoSource(): SecureCryptoSource | null {
  try {
    if (typeof crypto !== "undefined" && crypto) {
      return crypto as unknown as SecureCryptoSource;
    }
  } catch {
    // The caller decides whether an insecure fallback is acceptable.
  }
  return null;
}

function fallbackID(prefix: string): string {
  fallbackIDCounter = (fallbackIDCounter + 1) >>> 0;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIDCounter.toString(36)}`;
}

export function secureRandomUUID(source?: SecureCryptoSource | null): string | null {
  const candidate = source === undefined ? readSecureCryptoSource() : source;
  if (!candidate) return null;
  try {
    if (typeof candidate.randomUUID === "function") {
      const value = String(candidate.randomUUID() || "").trim();
      if (value) return value;
    }
  } catch {
    // Fall through to getRandomValues for older WebViews.
  }
  if (typeof candidate.getRandomValues !== "function") return null;
  try {
    const bytes = new Uint8Array(16);
    candidate.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

export function requireSecureRandomUUID(purpose = "付费请求", source?: SecureCryptoSource | null): string {
  const value = secureRandomUUID(source);
  if (value) return value;
  throw new Error(`${purpose}需要安全随机源，请重启 App 后重试。`);
}

export function bestEffortUUID(fallbackPrefix = "id"): string {
  return secureRandomUUID() ?? fallbackID(fallbackPrefix);
}

export function runtimeID(prefix: string): string {
  const value = secureRandomUUID();
  return value ? `${prefix}-${value}` : fallbackID(prefix);
}

export function secureRuntimeID(prefix: string, purpose = "付费请求"): string {
  return `${prefix}-${requireSecureRandomUUID(purpose)}`;
}

type BlobWithModernReaders = Blob & {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

export function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const modernReader = (blob as BlobWithModernReaders).arrayBuffer;
  if (typeof modernReader === "function") return modernReader.call(blob);
  if (typeof FileReader === "undefined") {
    return Promise.reject(new Error("当前 WebView 不支持读取所选文件，请更新系统 WebView 后重试。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("读取所选文件失败。"));
    };
    reader.onerror = () => reject(reader.error || new Error("读取所选文件失败。"));
    reader.onabort = () => reject(new Error("读取所选文件已取消。"));
    reader.readAsArrayBuffer(blob);
  });
}

export function readBlobAsText(blob: Blob): Promise<string> {
  const modernReader = (blob as BlobWithModernReaders).text;
  if (typeof modernReader === "function") return modernReader.call(blob);
  if (typeof FileReader === "undefined") {
    return Promise.reject(new Error("当前 WebView 不支持读取所选文件，请更新系统 WebView 后重试。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("读取所选文件失败。"));
    };
    reader.onerror = () => reject(reader.error || new Error("读取所选文件失败。"));
    reader.onabort = () => reject(new Error("读取所选文件已取消。"));
    reader.readAsText(blob);
  });
}

export type RuntimeTimeoutHandle = ReturnType<typeof setTimeout>;
export type RuntimeIntervalHandle = ReturnType<typeof setInterval>;

export function runtimeSetTimeout(callback: () => void, delayMs: number): RuntimeTimeoutHandle {
  return setTimeout(callback, delayMs);
}

export function runtimeClearTimeout(handle: RuntimeTimeoutHandle): void {
  clearTimeout(handle);
}

export function runtimeSetInterval(callback: () => void, delayMs: number): RuntimeIntervalHandle {
  return setInterval(callback, delayMs);
}

export function runtimeClearInterval(handle: RuntimeIntervalHandle): void {
  clearInterval(handle);
}
