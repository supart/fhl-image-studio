import { Check, ClipboardPaste, Eye, EyeOff, Minus, Plug, Plus, Save } from "lucide-react";
import type { ReactNode } from "react";
import { isAPIMartAsyncProfile } from "../../../lib/apimartAPI";
import { FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT, normalizeFHLImagesPoolSlot } from "../../../lib/profiles";
import { fhlTransportLabel, isOfficialFHLProfile } from "../../../lib/providerPolicy";
import { useStudioStore } from "../../../state/studioStore";
import type { UpstreamProfile } from "../../../types/domain";
import {
  ANDROID_API_MODE_OPTIONS,
  ANDROID_REQUEST_POLICY_OPTIONS,
} from "./useAndroidUpstreamConfig";

export function AndroidUpstreamProfileForm({
  activeProfileId,
  baseURLError,
  canSave,
  draft,
  draftKey,
  isTestingKey,
  onChangeDraftKey,
  onPatchDraft,
  onSave,
  onSaveAndSetActive,
  onSaveAndTest,
  onPasteKey,
  onSetActive,
  savedKeyLoaded,
  savedKeyPresent,
  saving,
  showKey,
  onToggleShowKey,
}: {
  activeProfileId: string;
  baseURLError: string | null;
  canSave: boolean;
  draft: UpstreamProfile;
  draftKey: string;
  isTestingKey: boolean;
  onChangeDraftKey: (value: string) => void;
  onPatchDraft: (patch: Partial<UpstreamProfile>) => void;
  onSave: () => void | Promise<void>;
  onSaveAndSetActive: () => void | Promise<void>;
  onSaveAndTest: () => void | Promise<void>;
  onPasteKey: () => void | Promise<void>;
  onSetActive: () => void | Promise<void>;
  savedKeyLoaded: boolean;
  savedKeyPresent: boolean;
  saving: boolean;
  showKey: boolean;
  onToggleShowKey: () => void;
}) {
  const isActive = draft.id === activeProfileId;
  const busy = saving || isTestingKey;
  const apimartPreset = isAPIMartAsyncProfile(draft);
  const runningHubPreset = draft.apiMode === "runninghub";
  const supportsRequestPolicy = !apimartPreset && !runningHubPreset;
  const fhlTransportMode = useStudioStore((state) => state.fhlTransportMode);
  const officialFHLProfile = isOfficialFHLProfile(draft);
  const fhlImagesPoolSlot = officialFHLProfile
    ? normalizeFHLImagesPoolSlot(draft.fhlImagesPoolSlot)
    : undefined;
  const fixedFHLTextProfile = officialFHLProfile
    && draft.apiMode === "responses"
    && fhlImagesPoolSlot === undefined;
  const displayAPIMode = fixedFHLTextProfile
    ? "responses"
    : officialFHLProfile
      ? fhlTransportMode
      : draft.apiMode;
  const phoneSafeConcurrency = Math.min(2, Math.max(1, Math.floor(Number(draft.concurrencyLimit) || 1)));

  return (
    <section className="android-upstream-form" aria-label="编辑上游配置">
      <div className="android-upstream-section-head">
        <span>编辑</span>
        {isActive ? (
          <strong>当前启用</strong>
        ) : fixedFHLTextProfile ? (
          <strong>文本专用</strong>
        ) : (
          <button type="button" onClick={onSetActive}>设为当前</button>
        )}
      </div>

      {apimartPreset ? (
        <p className="android-upstream-save-hint">
          当前是 APIMart 异步推荐参数预设。保存后会提交异步任务，并通过 task_id 查询结果。
        </p>
      ) : null}

      {runningHubPreset ? (
        <p className="android-upstream-save-hint">
          RunningHub 通过本机 8117 桥接调用；安卓模拟器请使用 <code className="font-mono-token">http://10.0.2.2:8117</code>。
        </p>
      ) : null}

      <AndroidField label="名称" required>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => onPatchDraft({ name: event.target.value })}
          className="focus-ring android-upstream-input"
          spellCheck={false}
        />
      </AndroidField>

      {officialFHLProfile ? (
        <AndroidField label="API 形态">
          <div className="android-upstream-unified-mode-hint" data-fhl-profile-mode={fixedFHLTextProfile ? "text" : "pool"}>
            <strong>{fixedFHLTextProfile ? "Responses API" : fhlTransportLabel(fhlTransportMode)}</strong>
            <small>{fixedFHLTextProfile ? "固定 Responses 文本能力" : "由顶部 API 形态统一控制；只影响 FHL 新生图任务"}</small>
          </div>
        </AndroidField>
      ) : (
        <AndroidField label="API 形态">
          <div className="android-upstream-option-grid two">
            {ANDROID_API_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={draft.apiMode === option.id ? "active" : ""}
                onClick={() => onPatchDraft({ apiMode: option.id })}
              >
                <strong>{option.title}</strong>
                <small>{option.meta}</small>
              </button>
            ))}
          </div>
        </AndroidField>
      )}

      {supportsRequestPolicy ? (
        <AndroidField label="参数策略">
          <div className="android-upstream-option-grid two">
            {ANDROID_REQUEST_POLICY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={draft.requestPolicy === option.id ? "active" : ""}
                onClick={() => onPatchDraft({ requestPolicy: option.id })}
              >
                <strong>{option.title}</strong>
                <small>{option.meta}</small>
              </button>
            ))}
          </div>
        </AndroidField>
      ) : null}

      <AndroidField
        label="上游 BASE_URL"
        required
        hint={runningHubPreset
          ? "填写 RunningHub 桥接地址。模拟器访问电脑本机服务要用 10.0.2.2。"
          : "填写站点根地址，应用会按 API 形态自动拼接 /v1 路径。"}
      >
        <input
          type="text"
          value={draft.baseURL}
          onChange={(event) => onPatchDraft({ baseURL: event.target.value })}
          placeholder={runningHubPreset ? "http://10.0.2.2:8117" : "https://your-relay.example.com"}
          className="focus-ring android-upstream-input font-mono-token"
          spellCheck={false}
        />
        {baseURLError ? <p className="android-upstream-error">{baseURLError}</p> : null}
      </AndroidField>

      {runningHubPreset ? (
        <AndroidField label="API Key" hint="RH Key 保存在 8117 桥接模块里，安卓端不写入本地密钥。">
          <div className="android-upstream-save-hint">无需在 App 内填写 API Key。</div>
        </AndroidField>
      ) : (
        <AndroidField label="API Key" required hint="密钥写入系统凭据存储，不进入 localStorage。">
          <div className="android-upstream-secret">
            <input
              type={showKey ? "text" : "password"}
              data-fhl-api-key-input="true"
              data-upstream-api-key-input="true"
              value={draftKey}
              onChange={(event) => onChangeDraftKey(event.target.value)}
              placeholder={savedKeyLoaded ? "sk-..." : "正在加载..."}
              autoComplete="new-password"
              className="focus-ring android-upstream-input font-mono-token"
              spellCheck={false}
            />
            <button type="button" onClick={() => void onPasteKey()} title="粘贴 API Key" aria-label="粘贴 API Key">
              <ClipboardPaste className="h-4 w-4" />
            </button>
            <button type="button" onClick={onToggleShowKey} title={showKey ? "隐藏密钥" : "显示密钥"}>
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {savedKeyPresent && !draftKey.trim() ? (
            <div className="android-upstream-save-hint">已保存密钥；输入框保持为空，输入新值才会覆盖。</div>
          ) : null}
        </AndroidField>
      )}

      {displayAPIMode === "responses" ? (
        <AndroidField label="文本模型 ID">
          <input
            type="text"
            value={draft.textModelID}
            onChange={(event) => onPatchDraft({ textModelID: event.target.value })}
            placeholder="留空 = 默认 gpt-5.5"
            className="focus-ring android-upstream-input font-mono-token"
            spellCheck={false}
          />
        </AndroidField>
      ) : null}

      <AndroidField
        label="图像模型 ID"
        hint={runningHubPreset ? "RunningHub 这里填桥接模型键，建议 banana2 或 image_g2。" : undefined}
      >
        <input
          type="text"
          value={draft.imageModelID}
          onChange={(event) => onPatchDraft({ imageModelID: event.target.value })}
          placeholder={runningHubPreset ? "banana2 或 image_g2" : "留空 = 默认 gpt-image-2"}
          className="focus-ring android-upstream-input font-mono-token"
          spellCheck={false}
        />
      </AndroidField>

      {fhlImagesPoolSlot !== undefined ? (
        <AndroidField label="并发容量" hint="FHL Images 池由原生调度器统一排队，不能在单个配置中修改。">
          <div className="android-upstream-save-hint">
            FHL{fhlImagesPoolSlot} · 每槽 {FHL_IMAGES_POOL_SLOT_CONCURRENCY_LIMIT} · 总容量 40
          </div>
        </AndroidField>
      ) : (
        <AndroidField
          label="并发数量限制"
          hint="Android 非池化 API 默认 1，最多 2。"
        >
        <div className="android-upstream-stepper">
          <button
            type="button"
            onClick={() => onPatchDraft({ concurrencyLimit: Math.max(1, phoneSafeConcurrency - 1) })}
            title="减少"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            value={phoneSafeConcurrency}
            min={1}
            max={2}
            step={1}
            placeholder="默认"
            onChange={(event) => onPatchDraft({ concurrencyLimit: Math.min(2, Math.max(1, Math.floor(Number(event.target.value) || 1))) })}
            className="focus-ring android-upstream-input font-mono-token"
          />
          <button
            type="button"
            onClick={() => onPatchDraft({ concurrencyLimit: Math.min(2, phoneSafeConcurrency + 1) })}
            title="增加"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        </AndroidField>
      )}

      <div className="android-upstream-actions">
        <button type="button" onClick={() => void onSave()} disabled={!canSave || busy}>
          <Save className="h-4 w-4" />
          {saving ? "保存中..." : "保存"}
        </button>
        {!fixedFHLTextProfile ? (
          <button type="button" onClick={() => void onSaveAndSetActive()} disabled={!canSave || busy}>
            <Check className="h-4 w-4" />
            保存并启用
          </button>
        ) : null}
        <button type="button" className="primary" onClick={() => void onSaveAndTest()} disabled={!canSave || busy}>
          <Plug className={`h-4 w-4 ${isTestingKey ? "animate-spin" : ""}`} />
          {isTestingKey ? "测试中..." : runningHubPreset ? "保存并检查桥接" : "保存并测试"}
        </button>
      </div>

      {!canSave ? (
        <p className="android-upstream-save-hint">
          {runningHubPreset ? "请填写名称和 BASE_URL 后保存。" : "请填写名称、BASE_URL 和 API Key 后保存。已保存密钥无需重复输入。"}
        </p>
      ) : null}
    </section>
  );
}

function AndroidField({
  children,
  hint,
  label,
  required,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="android-upstream-field">
      <span className="android-upstream-label">
        {label}
        {required ? <em>*</em> : null}
      </span>
      {children}
      {hint ? <span className="android-upstream-hint">{hint}</span> : null}
    </div>
  );
}
