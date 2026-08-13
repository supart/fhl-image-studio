import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";
import { createBrowserJobProxyPlugin } from "./dev/browserJobProxy";
import { createUIAuditProxyPlugin } from "./dev/uiAuditProxy";

const targetPlatform = (process.env.VITE_TARGET_PLATFORM ?? "").trim().toLowerCase();
const isAndroidWebViewTarget = targetPlatform === "android" || targetPlatform === "android-pad";
const fhlProxyPrefix = "/__image-studio-fhl";
const projectFilesPrefix = "/__image-studio-files";
const localConfigPrefix = "/__image-studio-local-config";
const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(process.env.IMAGE_STUDIO_INTERNAL_ROOT || path.resolve(frontendDir, "../.."));
const publicRoot = path.resolve(process.env.IMAGE_STUDIO_PUBLIC_ROOT || repoRoot);
const inputDir = path.join(publicRoot, "input");
const outputDir = path.join(publicRoot, "output");
const configDir = path.join(repoRoot, "config");
const cliEnvLocalPath = path.join(configDir, "cli.env.local");
const localFHLAPIConfigPath = path.join(frontendDir, ".local", "fhl-api.local.json");

function cleanBuildIdentityPart(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

const androidBuildVersion = cleanBuildIdentityPart(process.env.IMAGE_STUDIO_ANDROID_VERSION_NAME, "V2.0.3");
const androidGitCommit = cleanBuildIdentityPart(process.env.IMAGE_STUDIO_GIT_COMMIT, "unknown-commit");
const androidBuildId = cleanBuildIdentityPart(process.env.IMAGE_STUDIO_BUILD_ID, "local");
const serviceInstanceId = isAndroidWebViewTarget
  ? `android-${androidBuildVersion}-${androidGitCommit}-${androidBuildId}`
  : `vite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const storageNamespace = (process.env.IMAGE_STUDIO_STORAGE_NAMESPACE || "fhl-image-studio-v2.0.1-dev-clean-20260605-3")
  .trim()
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  || "fhl-image-studio-v2.0.1-dev-clean-20260605-3";

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

function safeStem(name: string): string {
  const stem = path.basename(String(name || "image")).replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^\w.\-\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return safe || "image";
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
  if (![inputDir, outputDir].some((root) => isInsideDir(root, abs))) {
    throw new Error("path outside project input/output folders");
  }
  return abs;
}

function projectFilesPlugin(): Plugin {
  return {
    name: "image-studio-project-files",
    configureServer(server) {
      void fs.mkdir(inputDir, { recursive: true });
      void fs.mkdir(outputDir, { recursive: true });
      server.middlewares.use(projectFilesPrefix, async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
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
            const dir = kind === "input" ? inputDir : outputDir;
            await fs.mkdir(dir, { recursive: true });
            const ext = imageExtFrom(data, String(body?.mimeType || ""), String(body?.suggestedName || ""));
            const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
            const filename = `${stamp}-${safeStem(String(body?.suggestedName || "image"))}${ext}`;
            const fullPath = path.join(dir, filename);
            await fs.writeFile(fullPath, data);
            sendJSON(res, 200, { path: fullPath, name: filename, size: data.length });
            return;
          }
          if (url.pathname === "/read-image") {
            const body = await readJSONBody(req, 1024 * 1024);
            const fullPath = assertProjectImagePath(String(body?.path || ""));
            const data = await fs.readFile(fullPath);
            sendJSON(res, 200, { imageB64: data.toString("base64") });
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
          if (req.method === "POST" && url.pathname === "/cli-env") {
            const body = await readJSONBody(req, 256 * 1024);
            const previous = await readEnvFile(cliEnvLocalPath);
            const allowAPIKeyWrite = String(body?.storageNamespace || "") === storageNamespace;
            const nextKey = allowAPIKeyWrite
              ? resolveCLIAPIKey(body, previous.IMAGE_STUDIO_API_KEY || "")
              : "";
            const rendered = renderCLIEnv({
              apiKey: nextKey,
              baseURL: cleanEnvValue(body?.baseURL, "https://www.fhl.mom"),
              apiMode: oneOf(body?.apiMode, ["responses", "images"], "responses"),
              requestPolicy: oneOf(body?.requestPolicy, ["openai", "compat"], "openai"),
              imagesNewAPICompat: body?.imagesNewAPICompat === true,
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
            sendJSON(res, 404, { error: "local config not found" });
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
    ...(isAndroidWebViewTarget ? { target: "chrome69" } : {}),
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
  },
  plugins: [
    projectFilesPlugin(),
    localConfigPlugin(),
    createBrowserJobProxyPlugin({ repoRoot, outputDir, inputDir }),
    createUIAuditProxyPlugin({ projectRoot: publicRoot, outputDir }),
    react(),
    tailwindcss(),
  ],
});
