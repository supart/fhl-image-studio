import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";
import { createBrowserJobProxyPlugin } from "./dev/browserJobProxy";
import { localFHLConfigFromCLIEnv } from "./dev/localFHLConfigFallback";
import { createUIAuditProxyPlugin } from "./dev/uiAuditProxy";

const targetPlatform = (process.env.VITE_TARGET_PLATFORM ?? "").trim().toLowerCase();
const isAndroidWebViewTarget = targetPlatform === "android" || targetPlatform === "android-pad";
const fhlProxyPrefix = "/__image-studio-fhl";
const apimartProxyPrefix = "/__image-studio-apimart";
const apimartLegacyProxyPrefix = "/__image-studio-apimart-legacy";
const apimartImageProxyPrefix = "/__image-studio-apimart-image";
const projectFilesPrefix = "/__image-studio-files";
const localConfigPrefix = "/__image-studio-local-config";
const frontendDir = path.resolve(process.cwd());
const packageRootCandidate = path.resolve(frontendDir, "../../..");
const defaultRepoRoot = existsSync(path.join(packageRootCandidate, "image-cli.cmd"))
  ? packageRootCandidate
  : path.resolve(frontendDir, "../..");
const repoRoot = path.resolve(process.env.IMAGE_STUDIO_INTERNAL_ROOT || defaultRepoRoot);
const publicRoot = path.resolve(process.env.IMAGE_STUDIO_PUBLIC_ROOT || repoRoot);
const inputDir = path.join(publicRoot, "input");
const outputDir = path.join(publicRoot, "output");
const intermediateDir = path.join(publicRoot, "intermediate");
const projectThumbDir = path.join(outputDir, "thumbs");
const batchInputExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const logDir = path.join(outputDir, "log");
const readableLogDirs = Array.from(new Set([
  logDir,
  path.join(path.resolve(repoRoot, ".."), "output", "log"),
  path.join(path.resolve(frontendDir, "../../.."), "output", "log"),
].filter(Boolean)));
const configDir = path.join(repoRoot, "config");
const cliEnvLocalPath = path.join(configDir, "cli.env.local");
const localFHLAPIConfigPath = path.join(frontendDir, ".local", "fhl-api.local.json");
const serviceInstanceId = `vite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const storageNamespace = (process.env.IMAGE_STUDIO_STORAGE_NAMESPACE || "fhl-image-studio-desktop-dev")
  .trim()
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  || "fhl-image-studio-desktop-dev";
const devCanonicalHost = process.env.IMAGE_STUDIO_DEV_HOST?.trim() || "127.0.0.1";
const authorizedImageRoots = new Set<string>();
const localMediaAssets = new Map<string, {
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
}>();
const thumbnailRequests = new Map<string, Promise<void>>();
let activeThumbnailJobs = 0;
const thumbnailWaiters: Array<() => void> = [];

function manualChunks(id: string) {
  if (id.includes("/wailsjs/")) return "wails-runtime";
  if (id.includes("/src/platform/android/") || id.includes("/src/platform/desktop/")) return "platform-ui";
  if (id.includes("/node_modules/")) {
    if (id.includes("/react-konva/") || id.includes("/konva/")) return "canvas-vendor";
    if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-vendor";
    if (id.includes("/lucide-react/")) return "icon-vendor";
    return "vendor";
  }
  return undefined;
}

function sendJSON(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isBlockedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "0.0.0.0"
    || host === "::1"
    || host.startsWith("127.")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

async function readJSONBody(req: any, maxBytes = 90 * 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readRawBody(req: any, maxBytes = 90 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function copyProxyRequestHeaders(source: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source || {})) {
    const key = name.toLowerCase();
    if (!value || HOP_BY_HOP_HEADERS.has(key) || key === "host") continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function copyProxyResponseHeaders(source: Headers, res: any) {
  source.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });
}

function cleanBase64(value: string): string {
  const raw = String(value || "").trim();
  const comma = raw.indexOf(",");
  return (comma >= 0 ? raw.slice(comma + 1) : raw).replace(/\s+/g, "");
}

function imageExtFrom(data: Buffer, mimeType: string, suggestedName: string): string {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return ".png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.length >= 12 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return ".webp";
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes("jpeg") || lowerMime.includes("jpg")) return ".jpg";
  if (lowerMime.includes("webp")) return ".webp";
  if (lowerMime.includes("png")) return ".png";
  const ext = path.extname(suggestedName).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? (ext === ".jpeg" ? ".jpg" : ext) : ".png";
}

function readUInt32BE(data: Buffer, offset: number): number {
  if (offset + 4 > data.length) return 0;
  return data.readUInt32BE(offset);
}

function readUInt16BE(data: Buffer, offset: number): number {
  if (offset + 2 > data.length) return 0;
  return data.readUInt16BE(offset);
}

function readImageDimensions(data: Buffer): { width?: number; height?: number } {
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return {
      width: readUInt32BE(data, 16),
      height: readUInt32BE(data, 20),
    };
  }
  if (data.length >= 30 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = data.subarray(12, 16).toString("ascii");
    if (chunk === "VP8 ") {
      return {
        width: (data[26] | ((data[27] & 0x3f) << 8)) || undefined,
        height: (data[28] | ((data[29] & 0x3f) << 8)) || undefined,
      };
    }
    if (chunk === "VP8L" && data.length >= 25) {
      const bits = data.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X" && data.length >= 30) {
      return {
        width: 1 + data.readUIntLE(24, 3),
        height: 1 + data.readUIntLE(27, 3),
      };
    }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const blockLength = readUInt16BE(data, offset + 2);
      if (blockLength < 2 || offset + 2 + blockLength > data.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: readUInt16BE(data, offset + 5),
          width: readUInt16BE(data, offset + 7),
        };
      }
      offset += 2 + blockLength;
    }
  }
  return {};
}

function safeStem(name: string): string {
  const stem = path.basename(String(name || "image")).replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^\w.\-\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return safe || "image";
}

function safeSubdirPath(value: unknown): string {
  return String(value ?? "")
    .replace(/[<>:"|?*\u0000-\u001f]+/g, "-")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/\.+/g, "."))
    .join("/");
}

function sanitizeMaterialSyncSegment(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim() || fallback;
  const clean = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function materialSyncKindDir(kind: unknown): string {
  return String(kind || "").trim() === "referenceSet" ? "\u53c2\u8003\u56fe\u7ec4" : "\u6587\u4ef6\u5939";
}

function ensureMaterialSyncFileName(suggestedName: unknown, fallback: string): string {
  const fallbackName = sanitizeMaterialSyncSegment(path.basename(fallback || "image.png"), "image.png");
  let name = sanitizeMaterialSyncSegment(path.basename(String(suggestedName ?? "").trim() || fallbackName), fallbackName);
  if (!path.extname(name) && path.extname(fallbackName)) {
    name += path.extname(fallbackName);
  }
  return name;
}

async function uniqueTargetPath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(dir, index === 1 ? fileName : `${base}-${index}${ext}`);
    try {
      await fs.access(candidate);
    } catch (error: any) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error(`too many duplicate files named like ${fileName}`);
}

async function resolveProjectSaveDir(kind: "input" | "output", body: any): Promise<string> {
  const explicitDirectory = String(body?.directory || "").trim();
  if (explicitDirectory) {
    const abs = path.isAbsolute(explicitDirectory)
      ? path.resolve(explicitDirectory)
      : path.resolve(publicRoot, explicitDirectory);
    await fs.mkdir(abs, { recursive: true });
    authorizedImageRoots.add(normalizeContainmentPath(abs));
    return abs;
  }
  const root = kind === "input" ? inputDir : outputDir;
  const subdir = safeSubdirPath(body?.subdir);
  const dir = subdir ? path.join(root, subdir) : root;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function normalizeContainmentPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideDir(root: string, target: string): boolean {
  const normalizedRoot = normalizeContainmentPath(root);
  const normalizedTarget = normalizeContainmentPath(target);
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSeparator);
}

function assertProjectImagePath(filePath: string): string {
  const abs = path.resolve(String(filePath || ""));
  const roots = [inputDir, outputDir, intermediateDir, ...authorizedImageRoots];
  if (!roots.some((root) => isInsideDir(root, abs))) {
    throw new Error("path outside project image folders");
  }
  return abs;
}

async function withThumbnailSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeThumbnailJobs >= 2) {
    await new Promise<void>((resolve) => thumbnailWaiters.push(resolve));
  }
  activeThumbnailJobs += 1;
  try {
    return await work();
  } finally {
    activeThumbnailJobs -= 1;
    thumbnailWaiters.shift()?.();
  }
}

async function registerProjectMedia(filePath: string, preferredThumbPath = "") {
  const fullPath = assertProjectImagePath(filePath);
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) throw new Error("media path is not a file");
  const id = createHash("sha256")
    .update(`${fullPath}\0${stat.size}\0${Math.floor(stat.mtimeMs)}`)
    .digest("hex")
    .slice(0, 32);
  const requestedThumb = String(preferredThumbPath || "").trim();
  let thumbPath = requestedThumb ? assertProjectImagePath(requestedThumb) : path.join(projectThumbDir, `${id}.avif`);
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  const metadata = await sharp(fullPath).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  let previewWidth = width;
  let previewHeight = height;
  const longest = Math.max(width, height);
  if (longest > 384) {
    const scale = 384 / longest;
    previewWidth = Math.max(1, Math.round(width * scale));
    previewHeight = Math.max(1, Math.round(height * scale));
  }
  const existingThumb = await fs.stat(thumbPath).then((value) => value.isFile()).catch(() => false);
  if (!existingThumb) {
    const cacheKey = `${id}:${thumbPath}`;
    let request = thumbnailRequests.get(cacheKey);
    if (!request) {
      request = withThumbnailSlot(async () => {
        await fs.mkdir(path.dirname(thumbPath), { recursive: true });
        await sharp(fullPath)
          .rotate()
          .resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
          .avif({ quality: 46, effort: 4 })
          .toFile(thumbPath);
      }).finally(() => thumbnailRequests.delete(cacheKey));
      thumbnailRequests.set(cacheKey, request);
    }
    await request;
  }
  localMediaAssets.set(id, { fullPath, thumbPath, width, height, previewWidth, previewHeight });
  return {
    imageId: id,
    savedPath: fullPath,
    thumbPath,
    previewUrl: `${projectFilesPrefix}/media/thumb/${id}`,
    fullUrl: `${projectFilesPrefix}/media/full/${id}`,
    width,
    height,
    previewWidth,
    previewHeight,
  };
}

function mediaContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif": return "image/avif";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "image/png";
  }
}

function assertOutputSubdir(filePath: string): string {
  const abs = path.resolve(String(filePath || path.join(outputDir, "绱犳潗绠＄悊")));
  if (!isInsideDir(outputDir, abs)) {
    throw new Error("path outside output folder");
  }
  return abs;
}

function assertProjectTextPath(filePath: string): string {
  const abs = path.resolve(String(filePath || ""));
  if (!readableLogDirs.some((root) => isInsideDir(root, abs))) {
    throw new Error("path outside project log folder");
  }
  const ext = path.extname(abs).toLowerCase();
  if (![".txt", ".json", ".log"].includes(ext)) {
    throw new Error("unsupported text file type");
  }
  return abs;
}

async function listBatchInputImages(directory: string) {
  const root = path.resolve(String(directory || "").trim());
  const info = await fs.stat(root);
  if (!info.isDirectory()) throw new Error("not a directory");
  authorizedImageRoots.add(normalizeContainmentPath(root));
  const entries = await fs.readdir(root, { withFileTypes: true });
  const images = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!batchInputExtensions.has(ext)) continue;
    const filePath = path.join(root, entry.name);
    const data = await fs.readFile(filePath);
    const dims = readImageDimensions(data);
    const stat = await fs.stat(filePath);
    images.push({
      path: filePath,
      name: entry.name,
      size: stat.size,
      width: dims.width,
      height: dims.height,
    });
  }
  return { directory: root, images };
}

async function syncMaterialGroupToOutput(body: any) {
  const targetDir = path.join(
    outputDir,
    "绱犳潗绠＄悊",
    materialSyncKindDir(body?.groupKind),
    sanitizeMaterialSyncSegment(body?.groupName, "鏈懡鍚嶇礌鏉愮粍"),
  );
  await fs.mkdir(targetDir, { recursive: true });

  const files: Array<{ historyId: string; source: string; path: string }> = [];
  const missingItems: Array<{ historyId: string; path?: string; reason: string }> = [];
  const items = Array.isArray(body?.items) ? body.items : [];

  for (const item of items) {
    const historyId = String(item?.historyId || "").trim();
    const savedPath = String(item?.savedPath || "").trim();
    if (!savedPath) {
      missingItems.push({
        historyId,
        reason: String(item?.missingReason || "鍘嗗彶璁板綍娌℃湁淇濆瓨璺緞"),
      });
      continue;
    }

    let source = "";
    try {
      source = assertProjectImagePath(savedPath);
      const targetName = ensureMaterialSyncFileName(item?.suggestedName, path.basename(source));
      const targetPath = await uniqueTargetPath(targetDir, targetName);
      await fs.copyFile(source, targetPath);
      files.push({ historyId, source, path: targetPath });
    } catch (error: any) {
      missingItems.push({
        historyId,
        path: source || savedPath,
        reason: String(error?.message || error),
      });
    }
  }

  return {
    targetDir,
    synced: files.length,
    missing: missingItems.length,
    files,
    missingItems,
  };
}

async function openMaterialSyncDir(filePath: string) {
  const dir = assertOutputSubdir(filePath || path.join(outputDir, "绱犳潗绠＄悊"));
  await fs.mkdir(dir, { recursive: true });
  const command = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [dir], { detached: true, stdio: "ignore" });
  child.unref();
}

function chooseNativeDirectory(title: string): Promise<string> {
  if (process.platform !== "win32") return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:IMAGE_STUDIO_DIALOG_TITLE
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($dialog.SelectedPath)
}
`;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: {
          ...process.env,
          IMAGE_STUDIO_DIALOG_TITLE: title || "Choose directory",
        },
        windowsHide: false,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && stderr.trim()) {
        reject(new Error(stderr.trim()));
        return;
      }
      const selected = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop() || "";
      resolve(selected);
    });
  });
}

function projectFilesPlugin(): Plugin {
  return {
    name: "image-studio-project-files",
    configureServer(server) {
      void fs.mkdir(inputDir, { recursive: true });
      void fs.mkdir(outputDir, { recursive: true });
      void fs.mkdir(intermediateDir, { recursive: true });
      void fs.mkdir(logDir, { recursive: true });
      void fs.mkdir(projectThumbDir, { recursive: true });
      server.middlewares.use(projectFilesPrefix, async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const mediaMatch = url.pathname.match(/^\/media\/(thumb|full)\/([a-f0-9]{32})$/);
          if ((req.method === "GET" || req.method === "HEAD") && mediaMatch) {
            const asset = localMediaAssets.get(mediaMatch[2]);
            const mediaPath = mediaMatch[1] === "thumb" ? asset?.thumbPath : asset?.fullPath;
            if (!asset || !mediaPath) {
              sendJSON(res, 404, { error: "media not registered" });
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", mediaContentType(mediaPath));
            res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(mediaPath).on("error", () => res.destroy()).pipe(res);
            return;
          }
          if (req.method !== "POST") {
            sendJSON(res, 405, { error: "method not allowed" });
            return;
          }
          if (url.pathname === "/save-image") {
            const body = await readJSONBody(req);
            const kind = body?.kind === "input" ? "input" : body?.kind === "output" ? "output" : "";
            if (!kind) throw new Error("kind must be input or output");
            const data = Buffer.from(cleanBase64(body?.imageB64), "base64");
            if (data.length === 0) throw new Error("image is empty");
            const dir = await resolveProjectSaveDir(kind, body);
            const ext = imageExtFrom(data, String(body?.mimeType || ""), String(body?.suggestedName || ""));
            const preserveName = body?.preserveName === true;
            const baseName = preserveName
              ? ensureMaterialSyncFileName(String(body?.suggestedName || ""), `image${ext}`)
              : (() => {
                  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
                  return `${stamp}-${safeStem(String(body?.suggestedName || "image"))}${ext}`;
                })();
            const fullPath = await uniqueTargetPath(dir, baseName);
            await fs.writeFile(fullPath, data);
            sendJSON(res, 200, { path: fullPath, name: path.basename(fullPath), size: data.length });
            return;
          }
          if (url.pathname === "/read-image") {
            const body = await readJSONBody(req, 1024 * 1024);
            const fullPath = assertProjectImagePath(String(body?.path || ""));
            const data = await fs.readFile(fullPath);
            sendJSON(res, 200, { imageB64: data.toString("base64") });
            return;
          }
          if (url.pathname === "/register-media") {
            const body = await readJSONBody(req, 1024 * 1024);
            sendJSON(res, 200, await registerProjectMedia(
              String(body?.savedPath || ""),
              String(body?.thumbPath || ""),
            ));
            return;
          }
          if (url.pathname === "/read-text") {
            const body = await readJSONBody(req, 1024 * 1024);
            const fullPath = assertProjectTextPath(String(body?.path || ""));
            const text = await fs.readFile(fullPath, "utf8");
            sendJSON(res, 200, { text });
            return;
          }
          if (url.pathname === "/choose-directory") {
            const body = await readJSONBody(req, 1024 * 1024);
            if (body?.probe === true) {
              sendJSON(res, 200, { ok: true });
              return;
            }
            const selected = await chooseNativeDirectory(String(body?.title || "Choose directory"));
            sendJSON(res, 200, { path: selected });
            return;
          }
          if (url.pathname === "/list-batch-input-images") {
            const body = await readJSONBody(req, 1024 * 1024);
            sendJSON(res, 200, await listBatchInputImages(String(body?.directory || "")));
            return;
          }
          if (url.pathname === "/build-batch-output-path") {
            const body = await readJSONBody(req, 1024 * 1024);
            const sourcePath = String(body?.sourcePath || "").trim();
            if (!sourcePath) throw new Error("sourcePath is required");
            const targetRoot = String(body?.outputDir || "").trim() || path.dirname(sourcePath);
            const dir = await resolveProjectSaveDir("output", { directory: targetRoot });
            const targetPath = await uniqueTargetPath(
              dir,
              `${String(body?.prefix || "processed-").trim() || "processed-"}${path.basename(sourcePath)}`,
            );
            sendJSON(res, 200, { path: targetPath });
            return;
          }
          if (url.pathname === "/sync-material-group") {
            const body = await readJSONBody(req);
            sendJSON(res, 200, await syncMaterialGroupToOutput(body));
            return;
          }
          if (url.pathname === "/open-material-sync-dir") {
            const body = await readJSONBody(req, 1024 * 1024);
            await openMaterialSyncDir(String(body?.path || ""));
            sendJSON(res, 200, { ok: true });
            return;
          }
          next();
        } catch (error: any) {
          sendJSON(res, 400, { error: String(error?.message || error) });
        }
      });
    },
  };
}

function localConfigPlugin(): Plugin {
  return {
    name: "image-studio-local-config",
    configureServer(server) {
      server.middlewares.use(localConfigPrefix, async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          if (req.method === "DELETE" && url.pathname === "/api-library") {
            await Promise.all([
              fs.rm(cliEnvLocalPath, { force: true }),
              fs.rm(localFHLAPIConfigPath, { force: true }),
            ]);
            const remaining = await Promise.all([
              fs.access(cliEnvLocalPath).then(() => true).catch(() => false),
              fs.access(localFHLAPIConfigPath).then(() => true).catch(() => false),
            ]);
            if (remaining.some(Boolean)) throw new Error("local API credential file still exists");
            res.setHeader("Cache-Control", "no-store");
            sendJSON(res, 200, { ok: true });
            return;
          }
          if (req.method === "POST" && url.pathname === "/cli-env") {
            const body = await readJSONBody(req, 256 * 1024);
            const previous = await readEnvFile(cliEnvLocalPath);
            const allowAPIKeyWrite = String(body?.storageNamespace || "") === storageNamespace;
            const nextAPIMode = oneOf(body?.apiMode, ["responses", "images", "apimart", "runninghub"], "images");
            const nextKey = allowAPIKeyWrite
              ? (nextAPIMode === "runninghub" ? "" : resolveCLIAPIKey(body, previous.IMAGE_STUDIO_API_KEY || ""))
              : "";
            const rendered = renderCLIEnv({
              apiKey: nextKey,
              baseURL: cleanEnvValue(body?.baseURL, nextAPIMode === "runninghub" ? "http://127.0.0.1:8117" : "https://www.fhl.mom"),
              apiMode: nextAPIMode,
              requestPolicy: oneOf(body?.requestPolicy, ["openai", "compat"], "openai"),
              imagesNewAPICompat: nextAPIMode === "images" && body?.imagesNewAPICompat === true,
              textModelID: cleanEnvValue(body?.textModelID, "gpt-5.5"),
              imageModelID: cleanEnvValue(body?.imageModelID, "gpt-image-2"),
              outputFormat: oneOf(body?.outputFormat, ["png", "jpeg", "webp"], "png"),
              quality: oneOf(body?.quality, ["auto", "high", "medium", "low"], "medium"),
              size: cleanCLIImageSize(body?.size, "1024x1024"),
              partialImages: cleanPartialImages(body?.partialImages, 1),
            });
            await fs.mkdir(configDir, { recursive: true });
            await fs.writeFile(cliEnvLocalPath, rendered, "utf8");
            res.setHeader("Cache-Control", "no-store");
            sendJSON(res, 200, {
              ok: true,
              path: path.relative(publicRoot, cliEnvLocalPath),
              apiKeyPresent: !!nextKey,
            });
            return;
          }
          if (req.method !== "GET" || url.pathname !== "/fhl-api") {
            next();
            return;
          }
          const raw = await fs.readFile(localFHLAPIConfigPath, "utf8").catch(() => "");
          if (!raw.trim()) {
            const fallback = localFHLConfigFromCLIEnv(await readEnvFile(cliEnvLocalPath));
            if (!fallback) {
              sendJSON(res, 404, { error: "local config not found" });
              return;
            }
            res.setHeader("Cache-Control", "no-store");
            sendJSON(res, 200, fallback);
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(raw);
        } catch {
          sendJSON(res, 404, { error: "local config not found" });
        }
      });
    },
  };
}

function apimartAPIProxyPlugin(): Plugin {
  function mountAPIMartProxy(server: any, prefix: string, baseURL: string) {
    server.middlewares.use(prefix, async (req: any, res: any, next: any) => {
      try {
        const requestURL = new URL(req.url || "/", baseURL);
        if (!requestURL.pathname.startsWith("/v1/")) {
          next();
          return;
        }
        const method = String(req.method || "GET").toUpperCase();
        const hasBody = method !== "GET" && method !== "HEAD";
        const init: RequestInit = {
          method,
          headers: copyProxyRequestHeaders(req.headers),
          redirect: "manual",
        };
        if (hasBody) {
          (init as any).body = await readRawBody(req);
        }
        const upstream = await fetch(requestURL.href, init);
        const data = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        copyProxyResponseHeaders(upstream.headers, res);
        res.setHeader("Cache-Control", upstream.headers.get("cache-control") || "no-store");
        res.end(data);
      } catch (error: any) {
        sendJSON(res, 502, { error: String(error?.message || error) });
      }
    });
  }

  return {
    name: "image-studio-apimart-api-proxy",
    configureServer(server) {
      mountAPIMartProxy(server, apimartLegacyProxyPrefix, "https://api.apib.ai");
      mountAPIMartProxy(server, apimartProxyPrefix, "https://api.apimart.ai");
    },
  };
}

function apimartImageProxyPlugin(): Plugin {
  return {
    name: "image-studio-apimart-image-proxy",
    configureServer(server) {
      server.middlewares.use(apimartImageProxyPrefix, async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          if (req.method !== "GET" || url.pathname !== "/download") {
            next();
            return;
          }
          const target = String(url.searchParams.get("url") || "").trim();
          const parsed = new URL(target);
          if (!["http:", "https:"].includes(parsed.protocol) || isBlockedDownloadHost(parsed.hostname)) {
            sendJSON(res, 400, { error: "unsupported APIMart image URL" });
            return;
          }
          const upstream = await fetch(parsed.href, {
            headers: { Accept: "image/*,*/*;q=0.8" },
          });
          if (!upstream.ok) {
            sendJSON(res, 502, { error: `APIMart image download failed: ${upstream.status}` });
            return;
          }
          const data = Buffer.from(await upstream.arrayBuffer());
          if (data.length === 0 || data.length > 90 * 1024 * 1024) {
            sendJSON(res, 502, { error: "APIMart image download size is invalid" });
            return;
          }
          res.statusCode = 200;
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
          res.setHeader("Content-Length", String(data.length));
          res.end(data);
        } catch (error: any) {
          sendJSON(res, 400, { error: String(error?.message || error) });
        }
      });
    },
  };
}

async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function cleanEnvValue(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.replace(/[\r\n]/g, "").trim() || fallback;
}

function oneOf(value: unknown, allowed: string[], fallback: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return allowed.includes(raw) ? raw : fallback;
}

function resolveCLIAPIKey(body: any, previous: string): string {
  if (body?.clearAPIKey === true) return "";
  const raw = String(body?.apiKey ?? "").trim().replace(/[\r\n]/g, "");
  return raw || previous;
}

function cleanCLIImageSize(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "auto") return "auto";
  if (/^\d{2,5}x\d{2,5}$/.test(raw)) return raw;
  if (/^\d+:\d+(?:@(1k|2k|4k))?$/.test(raw)) return raw;
  return fallback;
}

function cleanPartialImages(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, Math.trunc(n)));
}

function renderCLIEnv(input: {
  apiKey: string;
  baseURL: string;
  apiMode: string;
  requestPolicy: string;
  imagesNewAPICompat: boolean;
  textModelID: string;
  imageModelID: string;
  outputFormat: string;
  quality: string;
  size: string;
  partialImages: number;
}): string {
  return [
    "# Auto-generated by FHL Studio UI.",
    "# This file is private. Do not commit or share it.",
    "",
    `IMAGE_STUDIO_API_KEY=${input.apiKey}`,
    `IMAGE_STUDIO_UPSTREAM_BASE_URL=${input.baseURL}`,
    `IMAGE_STUDIO_API_MODE=${input.apiMode}`,
    `IMAGE_STUDIO_REQUEST_POLICY=${input.requestPolicy}`,
    `IMAGE_STUDIO_IMAGES_NEWAPI_COMPAT=${input.imagesNewAPICompat ? "1" : "0"}`,
    `IMAGE_STUDIO_TEXT_MODEL=${input.textModelID}`,
    `IMAGE_STUDIO_IMAGE_MODEL=${input.imageModelID}`,
    `IMAGE_STUDIO_OUTPUT_FORMAT=${input.outputFormat}`,
    `IMAGE_STUDIO_QUALITY=${input.quality}`,
    `IMAGE_STUDIO_SIZE=${input.size}`,
    `IMAGE_STUDIO_PARTIAL_IMAGES=${input.partialImages}`,
    "IMAGE_STUDIO_INPUT_DIR=.\\input",
    "IMAGE_STUDIO_OUTPUT_DIR=.\\output",
    "IMAGE_STUDIO_RAW_DIR=.\\output\\log",
    "",
  ].join("\n");
}

// https://vitejs.dev/config/
export default defineConfig({
  base: isAndroidWebViewTarget ? "./" : "/",
  server: {
    proxy: {
      [fhlProxyPrefix]: {
        target: "https://www.fhl.mom",
        changeOrigin: true,
        secure: true,
        rewrite: (requestPath) => requestPath.replace(new RegExp(`^${fhlProxyPrefix}`), ""),
      },

    },
  },
  build: {
    ...(isAndroidWebViewTarget ? { target: "chrome70" } : {}),
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  define: {
    "import.meta.env.PACKAGE_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.IMAGE_STUDIO_SERVICE_INSTANCE_ID": JSON.stringify(serviceInstanceId),
    "import.meta.env.IMAGE_STUDIO_STORAGE_NAMESPACE": JSON.stringify(storageNamespace),
    "import.meta.env.IMAGE_STUDIO_DEV_CANONICAL_HOST": JSON.stringify(devCanonicalHost),
  },
  plugins: [
    projectFilesPlugin(),
    localConfigPlugin(),
    apimartAPIProxyPlugin(),
    apimartImageProxyPlugin(),
    createBrowserJobProxyPlugin({ repoRoot, outputDir, inputDir }),
    createUIAuditProxyPlugin({ projectRoot: publicRoot, outputDir }),
    react(),
    tailwindcss(),
  ],
});

