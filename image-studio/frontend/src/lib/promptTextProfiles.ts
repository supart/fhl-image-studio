import type { APIMode, UpstreamProfile } from "../types/domain";
import { isOfficialFHLProfile } from "./providerPolicy.ts";
import { FHL_BASE_URL, FHL_TEXT_MODEL_ID } from "./profiles.ts";

export type PromptTextProvider = "fhl-text" | "apimart" | "responses" | "current" | "none";

export interface PromptTextCapability {
  available: boolean;
  provider: PromptTextProvider;
  label: string;
  reason: string;
  profile?: UpstreamProfile;
}

export interface PromptTextCapabilityInput {
  apiMode: APIMode;
  apiKey: string;
  baseURL: string;
  textModelID: string;
  profiles: UpstreamProfile[];
  fhlTextAPIConfigured?: boolean;
}

export interface PromptTextSelection {
  source: "fhl-text" | "current" | "profile";
  provider: Exclude<PromptTextProvider, "none">;
  baseURL: string;
  textModelID: string;
  profile?: UpstreamProfile;
}

const UNAVAILABLE_TEXT_MODEL_REASON = "未配置可用文本模型；APIMart 可填写文本模型 ID，或借用 Responses/FHL 配置";

function clean(value: string | undefined): string {
  return String(value || "").trim();
}

function textModelLabel(modelID: string): string {
  return clean(modelID) || "默认文本模型";
}

function firstResponsesProfile(profiles: UpstreamProfile[]): UpstreamProfile | undefined {
  const responsesProfiles = profiles.filter(
    (profile) => profile.apiMode === "responses" && clean(profile.baseURL),
  );
  return responsesProfiles.find((profile) => isOfficialFHLProfile(profile)) ?? responsesProfiles[0];
}

export function resolvePromptTextSelection(input: PromptTextCapabilityInput): PromptTextSelection | null {
  if (input.fhlTextAPIConfigured) {
    return {
      source: "fhl-text",
      provider: "fhl-text",
      baseURL: FHL_BASE_URL,
      textModelID: FHL_TEXT_MODEL_ID,
    };
  }

  const apiKey = clean(input.apiKey);
  const baseURL = clean(input.baseURL);
  const textModelID = clean(input.textModelID);
  const fallbackResponses = firstResponsesProfile(input.profiles);
  const fallbackSelection = fallbackResponses
    ? {
        source: "profile" as const,
        provider: "responses" as const,
        baseURL: clean(fallbackResponses.baseURL),
        textModelID: clean(fallbackResponses.textModelID),
        profile: fallbackResponses,
      }
    : null;

  if (input.apiMode === "runninghub") return fallbackSelection;

  if (input.apiMode === "apimart") {
    if (apiKey && baseURL && textModelID) {
      return { source: "current", provider: "apimart", baseURL, textModelID };
    }
    return fallbackSelection;
  }

  if (input.apiMode === "responses" && apiKey && baseURL) {
    return { source: "current", provider: "current", baseURL, textModelID };
  }

  if (fallbackSelection) return fallbackSelection;
  return null;
}

function responsesCapability(profile: UpstreamProfile): PromptTextCapability {
  const providerLabel = isOfficialFHLProfile(profile) ? "FHL Responses" : "Responses";
  return {
    available: true,
    provider: "responses",
    label: `借用 ${providerLabel} 文本配置：${textModelLabel(profile.textModelID)}`,
    reason: "",
    profile,
  };
}

export function resolvePromptTextCapability(input: PromptTextCapabilityInput): PromptTextCapability {
  const selection = resolvePromptTextSelection(input);

  if (selection?.source === "fhl-text") {
    return {
      available: true,
      provider: "fhl-text",
      label: `FHL 文本 API：${FHL_TEXT_MODEL_ID}`,
      reason: "",
    };
  }

  if (input.apiMode === "runninghub") {
    if (selection?.profile) return responsesCapability(selection.profile);
    return {
      available: false,
      provider: "none",
      label: "未配置可用文本模型",
      reason: "RunningHub 当前只负责图像生成；提示词优化和反推会借用 Responses/FHL 文本配置。",
    };
  }

  if (input.apiMode === "apimart") {
    if (selection?.source === "current") {
      return {
        available: true,
        provider: "apimart",
        label: `APIMart 文本模型：${selection.textModelID}`,
        reason: "",
      };
    }
    if (selection?.profile) return responsesCapability(selection.profile);
    return {
      available: false,
      provider: "none",
      label: "未配置可用文本模型",
      reason: UNAVAILABLE_TEXT_MODEL_REASON,
    };
  }

  if (input.apiMode === "responses" && selection?.source === "current") {
    const providerLabel = isOfficialFHLProfile({ apiMode: input.apiMode, baseURL: selection.baseURL })
      ? "FHL Responses"
      : "Responses";
    return {
      available: true,
      provider: "current",
      label: `${providerLabel} 文本模型：${textModelLabel(selection.textModelID)}`,
      reason: "",
    };
  }

  if (selection?.profile) return responsesCapability(selection.profile);

  return {
    available: false,
    provider: "none",
    label: "未配置可用文本模型",
    reason: input.apiMode === "images"
      ? "当前为 Images 生图配置；AI 优化需要单独配置支持文本模型的 FHL Responses API Key。"
      : UNAVAILABLE_TEXT_MODEL_REASON,
  };
}
