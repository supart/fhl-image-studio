export const DEFAULT_TEXT_MODEL = "gpt-5.5";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_SIZE = "1024x1024";
export const DEFAULT_QUALITY = "auto";
export const DEFAULT_OUTPUT_FORMAT = "png";
export const DEFAULT_REQUEST_POLICY = "openai";
export const DEFAULT_PARTIAL_IMAGES = 1;
export const MAX_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 15_000;
export const STATUS_INTERVAL_MS = 10_000;
export const OPENAI_IMAGE_MIN_PIXELS = 655_360;
export const OPENAI_IMAGE_MAX_PIXELS = 8_294_400;
export const OPENAI_IMAGE_MAX_SIDE = 3_840;
export const OPENAI_IMAGE_ALIGNMENT = 16;
export const OPENAI_IMAGE_MAX_ASPECT = 3;
export const FHL_BASE_URL = "https://www.fhl.mom";

const NO_PROMPT_REVISION_INSTRUCTIONS = "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave.";
const SAFE_IMAGE_TOOL_INSTRUCTIONS = "Use the image_generation tool and return an image result, not a text-only answer. If the user's wording is ambiguous or may trigger a safety refusal, adapt it into a policy-compliant visual prompt while preserving the creative intent.";
const PROMPT_OPTIMIZE_BASE_INSTRUCTIONS = "Rewrite the user's image prompt into a clearer, more detailed prompt for image generation. Keep the meaning, preserve the requested subject, and only return the improved prompt text. Do not add explanations, labels, markdown, or quotes.";
const PROMPT_OPTIMIZE_REQUIRED_MODIFICATION_INSTRUCTIONS = " Apply the required modification direction before polishing the prompt. Treat it as a mandatory edit, not a style preference. Add, remove, replace, or reshape subjects, actions, positions, and relationships when requested. For added subjects or story elements, turn the relationship into concrete visual action instead of merely listing the new element. If it conflicts with the original prompt, the required modification direction wins. Preserve the original scene, style, lighting, composition, and intent wherever they do not conflict. Integrate the change into one coherent image prompt, and do not mention that a modification was requested.";
const PROMPT_REVERSE_INSTRUCTIONS = "Analyze the attached image and write a detailed Simplified Chinese text-to-image prompt that could recreate its visible subject, composition, style, lighting, colors, camera perspective, mood, and important visual details. The returned prompt must be in Simplified Chinese. Return only the prompt text. Do not mention that you are analyzing an image. Do not add explanations, labels, markdown, or quotes.";
const PROMPT_REVERSE_USER_TEXT = "Write a Simplified Chinese text-to-image prompt for the attached image.";

export function normalizeBaseURL(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

export function normalizeAPIMode(apiMode) {
  if (apiMode === "images") return "images";
  if (apiMode === "apimart") return "apimart";
  return "responses";
}

export function normalizeRequestPolicy(requestPolicy) {
  return requestPolicy === "compat" ? "compat" : DEFAULT_REQUEST_POLICY;
}

export function normalizeTextModel(modelID) {
  return String(modelID || "").trim() || DEFAULT_TEXT_MODEL;
}

export function normalizeImageModel(modelID) {
  return String(modelID || "").trim() || DEFAULT_IMAGE_MODEL;
}

export function normalizePromptText(prompt) {
  return String(prompt || "").trim();
}

export function normalizeNegativePrompt(negativePrompt) {
  return String(negativePrompt || "").trim();
}

export function normalizePartialImages(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PARTIAL_IMAGES;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_PARTIAL_IMAGES;
  return Math.max(0, Math.min(3, Math.floor(numeric)));
}

export function parseSizeValue(size) {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function formatSizeValue(width, height) {
  return `${Math.floor(width)}x${Math.floor(height)}`;
}

function roundAligned(value, mode = "nearest", alignment = OPENAI_IMAGE_ALIGNMENT) {
  const scaled = Number(value) / alignment;
  if (!Number.isFinite(scaled)) return 0;
  if (mode === "down") return Math.floor(scaled) * alignment;
  if (mode === "up") return Math.ceil(scaled) * alignment;
  return Math.round(scaled) * alignment;
}

function withMinPixelFloor(targetWidth, targetHeight) {
  const pixelCount = targetWidth * targetHeight;
  if (pixelCount >= OPENAI_IMAGE_MIN_PIXELS) {
    return { width: targetWidth, height: targetHeight };
  }
  const scale = Math.sqrt(OPENAI_IMAGE_MIN_PIXELS / Math.max(pixelCount, 1));
  return {
    width: targetWidth * scale,
    height: targetHeight * scale,
  };
}

function sizeCandidateSet(value, min, max, alignment = OPENAI_IMAGE_ALIGNMENT) {
  const clamped = Math.max(min, Math.min(max, Number(value)));
  return Array.from(new Set([
    roundAligned(clamped, "nearest", alignment),
    roundAligned(clamped, "down", alignment),
    roundAligned(clamped, "up", alignment),
  ].map((candidate) => Math.max(min, Math.min(max, candidate)))))
    .filter((candidate) => candidate >= min && candidate <= max)
    .sort((left, right) => Math.abs(left - clamped) - Math.abs(right - clamped) || right - left);
}

function sizeDistance(width, height, targetWidth, targetHeight) {
  return Math.abs(width - targetWidth) / Math.max(targetWidth, 1)
    + Math.abs(height - targetHeight) / Math.max(targetHeight, 1);
}

function sizeWithinLimits(width, height) {
  if (width < OPENAI_IMAGE_ALIGNMENT || height < OPENAI_IMAGE_ALIGNMENT) return false;
  if (width % OPENAI_IMAGE_ALIGNMENT !== 0 || height % OPENAI_IMAGE_ALIGNMENT !== 0) return false;
  if (width > OPENAI_IMAGE_MAX_SIDE || height > OPENAI_IMAGE_MAX_SIDE) return false;
  const pixels = width * height;
  if (pixels < OPENAI_IMAGE_MIN_PIXELS || pixels > OPENAI_IMAGE_MAX_PIXELS) return false;
  const aspect = width / height;
  return aspect <= OPENAI_IMAGE_MAX_ASPECT && aspect >= (1 / OPENAI_IMAGE_MAX_ASPECT);
}

export function normalizeOpenAIImageSize(size) {
  const parsed = typeof size === "string" ? parseSizeValue(size) : size;
  if (!parsed) return null;
  let targetWidth = parsed.width;
  let targetHeight = parsed.height;
  const aspect = Math.max(
    1 / OPENAI_IMAGE_MAX_ASPECT,
    Math.min(OPENAI_IMAGE_MAX_ASPECT, targetWidth / targetHeight),
  );

  if (targetWidth / targetHeight !== aspect) {
    if (targetWidth >= targetHeight) targetWidth = targetHeight * aspect;
    else targetHeight = targetWidth / aspect;
  }

  const maxSide = Math.max(targetWidth, targetHeight);
  if (maxSide > OPENAI_IMAGE_MAX_SIDE) {
    const scale = OPENAI_IMAGE_MAX_SIDE / maxSide;
    targetWidth *= scale;
    targetHeight *= scale;
  }

  const pixelCount = targetWidth * targetHeight;
  if (pixelCount > OPENAI_IMAGE_MAX_PIXELS) {
    const scale = Math.sqrt(OPENAI_IMAGE_MAX_PIXELS / pixelCount);
    targetWidth *= scale;
    targetHeight *= scale;
  }

  ({ width: targetWidth, height: targetHeight } = withMinPixelFloor(targetWidth, targetHeight));

  const postFloorMaxSide = Math.max(targetWidth, targetHeight);
  if (postFloorMaxSide > OPENAI_IMAGE_MAX_SIDE) {
    const scale = OPENAI_IMAGE_MAX_SIDE / postFloorMaxSide;
    targetWidth *= scale;
    targetHeight *= scale;
  }

  const minDimension = OPENAI_IMAGE_ALIGNMENT;
  const widthCandidates = sizeCandidateSet(targetWidth, minDimension, OPENAI_IMAGE_MAX_SIDE);
  const heightCandidates = sizeCandidateSet(targetHeight, minDimension, OPENAI_IMAGE_MAX_SIDE);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAspectDistance = Number.POSITIVE_INFINITY;
  let bestAreaDistance = Number.POSITIVE_INFINITY;

  for (const width of widthCandidates) {
    for (const height of heightCandidates) {
      if (!sizeWithinLimits(width, height)) continue;
      const distance = sizeDistance(width, height, targetWidth, targetHeight);
      const aspectDistance = Math.abs((width / height) - (targetWidth / targetHeight));
      const areaDistance = Math.abs((width * height) - (targetWidth * targetHeight)) / Math.max(targetWidth * targetHeight, 1);
      if (
        distance < bestDistance
        || (distance === bestDistance && aspectDistance < bestAspectDistance)
        || (distance === bestDistance && aspectDistance === bestAspectDistance && areaDistance < bestAreaDistance)
      ) {
        best = { width, height };
        bestDistance = distance;
        bestAspectDistance = aspectDistance;
        bestAreaDistance = areaDistance;
      }
    }
  }

  return best;
}

export function repairSizeForOpenAI(payload) {
  const currentSize = String(payload?.size || "").trim();
  const parsed = parseSizeValue(currentSize);
  if (!parsed) return null;
  const normalized = normalizeOpenAIImageSize(parsed);
  if (!normalized) return null;
  const nextSize = formatSizeValue(normalized.width, normalized.height);
  if (nextSize === currentSize) return null;
  return {
    ...payload,
    size: nextSize,
  };
}

export function extractInvalidSize(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const pattern = /Invalid size '(\d+x\d+)'\. Width and height must both be divisible by 16/i;
  const direct = text.match(pattern);
  if (direct) {
    return { original: direct[1], reason: "divisible_by_16" };
  }
  try {
    const data = JSON.parse(text);
    const message = String(data?.error?.message || data?.message || "");
    const nested = message.match(pattern);
    if (!nested) return null;
    return { original: nested[1], reason: "divisible_by_16" };
  } catch {
    return null;
  }
}

export function isCompatRequestPolicy(requestPolicy) {
  return normalizeRequestPolicy(requestPolicy) === "compat";
}

export function classifyImageModel(modelID) {
  const normalized = normalizeImageModel(modelID).toLowerCase();
  if (normalized.startsWith("dall-e-2")) return "dalle2";
  if (normalized.startsWith("dall-e-3")) return "dalle3";
  if (normalized.startsWith("gpt-image") || normalized.startsWith("chatgpt-image")) return "gpt-image";
  return "other";
}

export function supportsImagesResponseFormat(imageModelID, mode = "generate") {
  const family = classifyImageModel(imageModelID);
  if (mode === "edit") return family === "dalle2";
  return family === "dalle2" || family === "dalle3";
}

export function shouldSendExtendedImageParameters(requestPolicy) {
  return isCompatRequestPolicy(requestPolicy);
}

export function shouldUseImagesNewAPICompat(payload) {
  return payload?.imagesNewAPICompat === true;
}

export function fileNameFromPath(path) {
  if (!path) return "image.png";
  return String(path).split(/[\\/]/).pop() || "image.png";
}

export function dataURLFromBase64Image(b64, mimeType = "image/png") {
  const encoded = String(b64 || "").trim();
  if (!encoded) return "";
  return `data:${mimeType};base64,${encoded}`;
}

function isFHLBaseURLValue(raw) {
  const normalized = normalizeBaseURL(raw).toLowerCase();
  return normalized.replace(/\/v1$/, "") === FHL_BASE_URL;
}

export function buildResponsesInputContent(prompt, sourceDataURLs) {
  const content = [{ type: "input_text", text: normalizePromptText(prompt) }];
  for (const dataURL of sourceDataURLs) {
    content.push({ type: "input_image", image_url: dataURL });
  }
  return content;
}

export function buildBatchVariationInstruction(payload) {
  const batchIndex = Number(payload?.batchIndex);
  const batchCount = Number(payload?.batchCount);
  const variationKey = String(payload?.batchVariationKey || "").trim();
  const requestRunId = String(payload?.requestRunId || "").trim();
  if (!variationKey && !requestRunId && !Number.isFinite(batchIndex)) return "";
  const slotIndex = Number.isFinite(batchIndex) && batchIndex >= 0 ? Math.floor(batchIndex) : 0;
  const visibleBatchTotal = Math.max(
    Number.isFinite(batchCount) && batchCount > 0 ? Math.floor(batchCount) : 1,
    slotIndex + 1,
  );
  const key = variationKey || `${requestRunId || "run"}-${slotIndex + 1}`;
  return [
    `Request isolation: this is an independent generation task, image ${slotIndex + 1} of ${visibleBatchTotal}.`,
    `Internal run id: ${requestRunId || "none"}. Variation key: ${key}.`,
    "You must return a distinct non-duplicate final image for this task.",
    "Preserve the user's visible prompt and style, but vary composition, pose, object placement, lighting, camera angle, expression, texture, or fine details where appropriate.",
    "Do not render the run id, variation key, or this instruction as visible text.",
  ].join(" ");
}

export function promptWithBatchVariation(payload) {
  const prompt = normalizePromptText(payload?.prompt);
  const variation = buildBatchVariationInstruction(payload);
  return variation ? `${prompt}\n\n${variation}` : prompt;
}

export function buildResponsesImageTool(payload, sourceDataURLs, options = {}) {
  const rawSize = String(payload.size || "").trim();
  const parsedSize = rawSize && rawSize.toLowerCase() !== "auto" ? parseSizeValue(rawSize) : null;
  const repairedPayload = parsedSize ? repairSizeForOpenAI({ size: rawSize }) : null;
  const size = rawSize.toLowerCase() === "auto"
    ? "auto"
    : (parsedSize ? (repairedPayload?.size || rawSize) : DEFAULT_SIZE);
  const quality = payload.quality || DEFAULT_QUALITY;
  const outputFormat = payload.outputFormat || DEFAULT_OUTPUT_FORMAT;
  const negativePrompt = normalizeNegativePrompt(payload.negativePrompt);
  const compatExtensions = shouldSendExtendedImageParameters(payload.requestPolicy);
  const tool = {
    type: "image_generation",
    model: normalizeImageModel(payload.imageModelID),
    action: sourceDataURLs.length > 0 ? "edit" : "generate",
    size,
    quality,
    output_format: outputFormat,
    moderation: "low",
    partial_images: shouldDisablePartialImagesForFHLExactResponses(payload, size)
      ? 0
      : normalizePartialImages(payload.partialImages),
  };
  if (compatExtensions && payload.seed) tool.seed = payload.seed;
  if (compatExtensions && negativePrompt) tool.negative_prompt = negativePrompt;

  const maskMimeType = String(options.maskMimeType || "image/png").trim() || "image/png";
  if (payload.maskB64) {
    tool.input_image_mask = {
      image_url: dataURLFromBase64Image(payload.maskB64, maskMimeType),
    };
  }
  return tool;
}

export function shouldDisablePartialImagesForFHLExactResponses(payload, size) {
  const apiMode = String(payload?.apiMode || "responses").trim();
  if (apiMode && apiMode !== "responses") return false;
  if (!isFHLBaseURLValue(payload?.baseURL)) return false;
  if (!normalizeImageModel(payload?.imageModelID).toLowerCase().startsWith("gpt-image-2")) return false;
  const normalizedSize = String(size || payload?.size || "").trim().toLowerCase();
  return normalizedSize !== "" && normalizedSize !== "auto" && parseSizeValue(normalizedSize) !== null;
}

export function buildResponsesPayload(payload, sourceDataURLs, options = {}) {
  const tool = {
    ...buildResponsesImageTool(payload, sourceDataURLs, options),
  };
  const aspectSuffix = fhlExactResponsesAspectPromptSuffix(payload, tool.size);
  const prompt = aspectSuffix
    ? `${normalizePromptText(payload.prompt)}\n\n${aspectSuffix}`
    : normalizePromptText(payload.prompt);
  const content = [{ type: "input_text", text: prompt }];
  const variation = buildBatchVariationInstruction(payload);
  if (variation) {
    content.push({ type: "input_text", text: variation });
  }
  for (const dataURL of sourceDataURLs) {
    content.push({ type: "input_image", image_url: dataURL });
  }

  const request = {
    model: normalizeTextModel(payload.textModelID),
    input: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    reasoning: { effort: "xhigh" },
    store: false,
    stream: true,
  };
  let instructions = payload.noPromptRevision === false
    ? SAFE_IMAGE_TOOL_INSTRUCTIONS
    : NO_PROMPT_REVISION_INSTRUCTIONS;
  const aspectInstruction = fhlExactResponsesAspectInstruction(payload, tool.size);
  if (aspectInstruction) instructions += ` ${aspectInstruction}`;
  request.instructions = instructions;
  return request;
}

export function fhlExactResponsesAspectInstruction(payload, size) {
  if (!shouldDisablePartialImagesForFHLExactResponses(payload, size)) return "";
  const parsed = parseSizeValue(String(size || payload?.size || "").trim());
  if (!parsed) return "";
  const divisor = gcd(parsed.width, parsed.height);
  if (!divisor) return "";
  const aspect = `${parsed.width / divisor}:${parsed.height / divisor}`;
  const orientation = parsed.width === parsed.height
    ? "square"
    : parsed.width > parsed.height
      ? "landscape"
      : "portrait";
  return `The selected output aspect ratio is ${aspect} (${orientation}). The image_generation result MUST use a ${aspect} canvas and must not return any other aspect ratio.`;
}

export function fhlExactResponsesAspectPromptSuffix(payload, size) {
  if (!shouldDisablePartialImagesForFHLExactResponses(payload, size)) return "";
  const parsed = parseSizeValue(String(size || payload?.size || "").trim());
  if (!parsed) return "";
  const divisor = gcd(parsed.width, parsed.height);
  if (!divisor) return "";
  const aspect = `${parsed.width / divisor}:${parsed.height / divisor}`;
  if (parsed.width === parsed.height) {
    return `请严格按照 ${aspect} 正方形画幅生成最终图片，整张图片必须为 ${aspect} 比例。`;
  }
  if (parsed.height > parsed.width) {
    return `请严格按照 ${aspect} 竖版画幅生成最终图片，整张图片必须为 ${aspect} 竖向构图，不要正方形，不要横版。`;
  }
  return `请严格按照 ${aspect} 横版画幅生成最终图片，整张图片必须为 ${aspect} 横向构图，不要正方形，不要竖版。`;
}

function gcd(left, right) {
  let a = Math.abs(Math.trunc(Number(left) || 0));
  let b = Math.abs(Math.trunc(Number(right) || 0));
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function buildPromptOptimizePayload(input, sourceDataURLs) {
  let instruction = PROMPT_OPTIMIZE_BASE_INSTRUCTIONS;
  const guidance = normalizePromptText(input.optimizationGuidance);
  if (guidance) {
    instruction += PROMPT_OPTIMIZE_REQUIRED_MODIFICATION_INSTRUCTIONS;
  }
  if (String(input.mode || "").trim() === "edit") {
    instruction += " Treat any attached images as reference context and preserve edit intent.";
  }
  let text = `Original prompt:\n${normalizePromptText(input.prompt)}`;
  if (guidance) {
    text += `\n\nRequired modification direction:\n${guidance}`;
  }
  const content = [{ type: "input_text", text }];
  for (const dataURL of sourceDataURLs) {
    content.push({ type: "input_image", image_url: dataURL });
  }
  return {
    model: normalizeTextModel(input.textModelID),
    instructions: instruction,
    input: [{ role: "user", content }],
    reasoning: { effort: "low" },
    store: false,
  };
}

export function buildPromptReversePayload(input, sourceDataURLs) {
  const content = [{ type: "input_text", text: PROMPT_REVERSE_USER_TEXT }];
  for (const dataURL of sourceDataURLs) {
    content.push({ type: "input_image", image_url: dataURL });
  }
  return {
    model: normalizeTextModel(input.textModelID),
    instructions: PROMPT_REVERSE_INSTRUCTIONS,
    input: [{ role: "user", content }],
    reasoning: { effort: "low" },
    store: false,
  };
}

export function retryableMarkers() {
  return [
    "error code 524",
    "524: a timeout occurred",
    "error code 504",
    "gateway time-out",
    "rate_limit_exceeded",
    "upstream_error",
    "service temporarily unavailable",
    "origin_gateway_timeout",
    "no available account",
    "无可用账号",
    "请稍后重试",
  ];
}

export function isRetryableRaw(raw) {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  if (retryableMarkers().some((marker) => lower.includes(marker))) return true;
  try {
    const data = JSON.parse(text);
    if (data?.retryable === true) return true;
    if ([502, 503, 504, 524].includes(Number(data?.status))) return true;
    const err = data?.error;
    if (err && typeof err === "object") {
      const message = String(err.message || "").toLowerCase();
      const type = String(err.type || "").toLowerCase();
      if (message.includes("temporarily unavailable")) return true;
      if (type === "api_error" || type === "server_error") return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function describeAPIError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  const type = String(error?.type || "");

  switch (code.toLowerCase()) {
    case "moderation_blocked":
      return "🚫 上游内容审核拦截 · 生成被拒";
    case "content_policy_violation":
      return "🚫 上游内容政策拦截 (content_policy_violation)";
    case "rate_limit_exceeded":
      return `⏱ 上游限速 (rate_limit_exceeded)\n\n${message}`;
    case "insufficient_quota":
    case "billing_hard_limit_reached":
      return `💳 上游账户额度不足\n\n${message}`;
    case "model_not_found":
      return `🤷 上游找不到指定模型\n\n${message}`;
    default:
      break;
  }

  const parts = [];
  if (message) parts.push(message);
  const tail = [];
  if (code) tail.push(`code: ${code}`);
  if (type) tail.push(`type: ${type}`);
  if (tail.length > 0) parts.push(`(${tail.join(", ")})`);
  return parts.length > 0 ? `接口返回错误:${parts.join(" ")}` : "接口返回错误";
}

function describeNestedError(value, depth = 0) {
  if (!value || depth > 3) return "";
  if (typeof value === "object") {
    if (value.error && typeof value.error === "object") {
      const nested = typeof value.error.message === "string" ? describeNestedError(value.error.message, depth + 1) : "";
      return nested || describeAPIError(value.error);
    }
    if (value.response?.error && typeof value.response.error === "object") {
      const nested = typeof value.response.error.message === "string" ? describeNestedError(value.response.error.message, depth + 1) : "";
      return nested || describeAPIError(value.response.error);
    }
    if (typeof value.message === "string" && (value.code || value.type)) {
      const nested = describeNestedError(value.message, depth + 1);
      return nested || describeAPIError(value);
    }
    if (typeof value.message === "string") return describeNestedError(value.message, depth + 1);
    return "";
  }
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  try {
    return describeNestedError(JSON.parse(text), depth + 1);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return "";
    try {
      return describeNestedError(JSON.parse(match[0]), depth + 1);
    } catch {
      return "";
    }
  }
}

function pushTextFragment(out, value) {
  const text = String(value || "").trim();
  if (!text || text.length > 4096) return;
  out.push(text);
}

function collectResponseText(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const child of value) collectResponseText(child, out);
    return out;
  }
  if (typeof value !== "object") return out;
  if (value.type === "output_text" || value.type === "refusal") {
    pushTextFragment(out, value.text || value.content || value.refusal);
  }
  if (typeof value.output_text === "string") pushTextFragment(out, value.output_text);
  if (typeof value.message === "string") pushTextFragment(out, value.message);
  if (typeof value.refusal === "string") pushTextFragment(out, value.refusal);
  for (const [key, child] of Object.entries(value)) {
    if (key === "result" || key === "b64_json" || key === "partial_image_b64" || key === "image_url") continue;
    collectResponseText(child, out);
  }
  return out;
}

function describeTextOnlyResponse(fragments) {
  const unique = [...new Set(fragments.map((part) => part.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  const joined = unique.join(" ").replace(/\s+/g, " ").trim();
  if (!joined) return "";
  const preview = joined.length > 240 ? `${joined.slice(0, 240)}...` : joined;
  return `上游没有返回图片，只返回了文字：${preview}`;
}

export function describeProblem(raw) {
  const text = String(raw || "").trim();
  if (!text) return "接口返回为空。";
  const lower = text.toLowerCase();
  if (lower.includes("error code 524") || lower.includes("524: a timeout occurred")) {
    return "Cloudflare 524:源站在超时时间内没有返回有效响应。";
  }
  if (lower.includes("error code 504") || lower.includes("gateway time-out")) {
    return "Cloudflare 504:源站网关超时。";
  }

  try {
    const data = JSON.parse(text);
    const nestedError = describeNestedError(data);
    if (nestedError) return nestedError;
    if (data?.error && typeof data.error === "object") return describeAPIError(data.error);
    if (typeof data?.message === "string" && data.message.trim()) return `接口返回消息:${data.message.trim()}`;
    const textOnly = describeTextOnlyResponse(collectResponseText(data));
    if (textOnly) return textOnly;
    if (data?.status && [502, 503, 504, 524].includes(Number(data.status))) {
      return `接口返回 ${data.status}:上游服务超时。`;
    }
  } catch {
    // ignore
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    const payload = line.startsWith("data: ")
      ? line.slice(6).trim()
      : trimmedLine.startsWith("{")
        ? trimmedLine
        : "";
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      const nestedError = describeNestedError(event);
      if (nestedError) return nestedError;
      if (event?.error && typeof event.error === "object") return describeAPIError(event.error);
      if (event?.response?.error && typeof event.response.error === "object") return describeAPIError(event.response.error);
      const textOnly = describeTextOnlyResponse(collectResponseText(event));
      if (textOnly) return textOnly;
    } catch {
      // ignore
    }
  }
  return "接口已返回内容,但没有发现 image_generation_call.result。";
}
