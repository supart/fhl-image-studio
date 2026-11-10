import {
  gptImage2Minor,
  imageModelCatalogEntry,
  imageModelIsValidated,
  isSupportedFHLImageModelID,
  type StoredImageModelCatalog,
} from "../../lib/fhlImageModels.ts";
import { isOfficialFHLProfile } from "../../lib/providerPolicy.ts";
import type { APIMode, UpstreamProfile } from "../../types/domain.ts";

export type AndroidTransparentEligibility = {
  enabled: boolean;
  reason: string;
};

export function resolveAndroidTransparentEligibility({
  activeProfile,
  apiMode,
  baseURL,
  catalog,
  imageModelID,
}: {
  activeProfile: UpstreamProfile | null | undefined;
  apiMode: APIMode;
  baseURL: string;
  catalog: StoredImageModelCatalog | null;
  imageModelID: string;
}): AndroidTransparentEligibility {
  if (apiMode === "apimart") {
    return { enabled: false, reason: "APIMart 当前不支持原生透明 PNG。" };
  }
  if (apiMode === "runninghub") {
    return { enabled: false, reason: "RunningHub 当前不支持原生透明 PNG。" };
  }
  if (apiMode !== "images" && apiMode !== "responses") {
    return { enabled: false, reason: "当前 API 路由不支持透明输出。" };
  }
  if (!activeProfile || !isOfficialFHLProfile(activeProfile, { apiMode, baseURL })) {
    return { enabled: false, reason: "透明 PNG 仅支持已验证的 FHL Images 或 Responses 配置。" };
  }
  if (activeProfile.imageModelID !== imageModelID) {
    return { enabled: false, reason: "当前模型与已保存的 Profile 不一致，请重新选择并验证。" };
  }
  if (!catalog) {
    return { enabled: false, reason: "请先打开 FHL API 10 槽模型面板完成验证并保存统一模型。" };
  }
  const model = imageModelCatalogEntry(catalog, imageModelID);
  if (!model) {
    return { enabled: false, reason: "当前 provider 的模型目录未提供所选模型。" };
  }
  if (!model.available || !model.supportsGenerations || !isSupportedFHLImageModelID(imageModelID)) {
    return {
      enabled: false,
      reason: model.disabledReason || "当前模型不可调用，请重新选择共同可用模型。",
    };
  }
  if (
    activeProfile.imageModelAvailable !== true
    || activeProfile.imageModelSupportsGenerations !== model.supportsGenerations
    || activeProfile.imageModelSupportsEdits !== model.supportsEdits
    || activeProfile.imageModelSupportsTransparency !== model.supportsTransparency
    || !activeProfile.imageModelCatalogValidationId?.trim()
  ) {
    return { enabled: false, reason: "当前模型缺少匹配的能力证明，请重新验证并保存统一模型。" };
  }
  if (!imageModelIsValidated(activeProfile, catalog)) {
    return { enabled: false, reason: "请先打开 FHL API 10 槽模型面板完成验证并保存统一模型。" };
  }
  const minor = gptImage2Minor(imageModelID);
  if (minor === 0) {
    return { enabled: false, reason: "gpt-image-2 保持 V2.0 稳定流程，不启用原生透明 Alpha。" };
  }
  if (minor === null || minor < 5) {
    return { enabled: false, reason: "当前模型版本不支持原生透明 PNG。" };
  }
  if (!model.supportsTransparency) {
    return { enabled: false, reason: "Provider 明确禁止当前模型的透明输出。" };
  }
  return { enabled: true, reason: "原生 Alpha 输出，格式将锁定为 PNG。" };
}
