import { Eye, EyeOff, HelpCircle, Info, Plug } from "lucide-react";
import type { CSSProperties } from "react";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../../types/domain";
import { requestPolicyLabel } from "../../lib/profiles";
import { usePlatform } from "../../platform/context";

export function UpstreamProfileEditor({
  draft,
  draftKey,
  showKey,
  savedKeyLoaded,
  baseURLError,
  apiKeyError,
  canSave,
  isTestingKey,
  usesAppleUI,
  onOpenFAQ,
  onPatchDraft,
  onChangeDraftKey,
  onToggleShowKey,
  onTest,
  onClose,
  onSaveAndClose,
}: {
  draft: UpstreamProfile;
  draftKey: string;
  showKey: boolean;
  savedKeyLoaded: boolean;
  baseURLError: string | null;
  apiKeyError: string | null;
  canSave: boolean;
  isTestingKey: boolean;
  usesAppleUI: boolean;
  onOpenFAQ: () => void;
  onPatchDraft: (patch: Partial<UpstreamProfile>) => void;
  onChangeDraftKey: (value: string) => void;
  onToggleShowKey: () => void;
  onTest: () => void | Promise<void>;
  onClose: () => void;
  onSaveAndClose: () => void | Promise<void>;
}) {
  const { isAndroidPhone, usesFluentUI } = usePlatform();

  return (
    <div className={`upstream-profile-editor flex min-w-0 flex-col ${isAndroidPhone ? "gap-3" : "gap-3.5"}`}>
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onOpenFAQ}
          className={`inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <HelpCircle className="h-3.5 w-3.5" /> 接口说明
        </button>
      </div>

      <Field label="名称">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onPatchDraft({ name: e.target.value })}
          spellCheck={false}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
      </Field>

      <Field label="API 形态">
        <div className={`grid gap-2 ${isAndroidPhone ? "grid-cols-1" : "grid-cols-2"}`}>
          {([
            { id: "responses" as APIMode, title: "Responses API", sub: "SSE 保活(CF 超时推荐)" },
            { id: "images" as APIMode, title: "Images API", sub: "标准 generations / edits" },
          ]).map((option) => {
            const active = draft.apiMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPatchDraft({ apiMode: option.id })}
                className={`upstream-option-card platform-card flex flex-col items-start gap-0.5 border p-2.5 text-left transition-colors ${
                  active
                    ? "active border-[color:var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-black/[0.08] text-zinc-700 hover:border-[color:var(--accent)]/30 dark:border-white/[0.06] dark:text-zinc-300"
                } ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}
              >
                <span className="upstream-option-title min-w-0 text-[12px] font-semibold">{option.title}</span>
                <span className={`upstream-option-sub min-w-0 text-[10px] ${active ? "text-[var(--accent)]/80" : "text-zinc-500"}`}>{option.sub}</span>
              </button>
            );
          })}
        </div>
        <Hint>
          {draft.apiMode === "responses"
            ? "需要 key 绑定到「拥有 gpt-5.5 模型的分组」。SSE 保活可防 Cloudflare 524。"
            : "使用标准 Images API,key 用 image-2 / image API 分组,兼容性最广。"}
        </Hint>
      </Field>

      <Field label="参数策略">
        <div className="grid gap-2">
          {([
            { id: "openai" as RequestPolicy, title: requestPolicyLabel("openai"), sub: "默认。只发送 OpenAI 官方公开字段。" },
            { id: "compat" as RequestPolicy, title: requestPolicyLabel("compat"), sub: "兼容部分 relay 扩展字段，例如 seed / negative_prompt。" },
          ]).map((option) => {
            const active = draft.requestPolicy === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPatchDraft({ requestPolicy: option.id })}
                className={`upstream-option-card platform-card flex flex-col items-start gap-0.5 border p-2.5 text-left transition-colors ${
                  active
                    ? "active border-[color:var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-black/[0.08] text-zinc-700 hover:border-[color:var(--accent)]/30 dark:border-white/[0.06] dark:text-zinc-300"
                } ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}
              >
                <span className="upstream-option-title min-w-0 text-[12px] font-semibold">{option.title}</span>
                <span className={`upstream-option-sub min-w-0 text-[10px] ${active ? "text-[var(--accent)]/80" : "text-zinc-500"}`}>{option.sub}</span>
              </button>
            );
          })}
        </div>
        <Hint>
          `OpenAI 标准` 更适合直连 OpenAI 或严格兼容实现。`兼容中转扩展` 会额外发送一些 relay 常见扩展字段。
        </Hint>
      </Field>

      <Field label={<>上游 BASE_URL <Req /></>}>
        <input
          type="text"
          value={draft.baseURL}
          placeholder="https://your-relay.example.com"
          onChange={(e) => onPatchDraft({ baseURL: e.target.value })}
          spellCheck={false}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
        {baseURLError ? <Hint>{baseURLError}</Hint> : null}
        <Hint>
          只填中转站的站点根地址。应用会按当前 API 形态自动拼接 <code className="font-mono-token">/v1/responses</code>(Responses)或 <code className="font-mono-token">/v1/images/generations</code> / <code className="font-mono-token">/v1/images/edits</code>(Images),<strong>不要</strong>把这些路径手动贴进来。
        </Hint>
      </Field>

      <Field label={<>API Key <Req /></>}>
        <div className="relative min-w-0">
          <input
            key={`${draft.id}:api-key-entry:${savedKeyLoaded ? "ready" : "loading"}`}
            type="text"
            value={draftKey}
            placeholder={savedKeyLoaded ? "sk-..." : "(加载中...)"}
            onChange={(e) => onChangeDraftKey(e.target.value)}
            spellCheck={false}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            name={`fhl-api-key-manual-entry-${draft.id}`}
            data-lpignore="true"
            data-1p-ignore="true"
            data-fhl-api-key-input="true"
            style={{ WebkitTextSecurity: showKey ? "none" : "disc" } as CSSProperties & { WebkitTextSecurity: string }}
            className={`focus-ring w-full min-w-0 border bg-[var(--surface)] py-2 pl-3 pr-10 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${
              apiKeyError
                ? "border-red-400 text-red-700 dark:border-red-500 dark:text-red-200"
                : "border-black/[0.08] dark:border-white/[0.08]"
            } ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
          <button
            type="button"
            onClick={onToggleShowKey}
            title={showKey ? "隐藏" : "显示"}
            className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        {apiKeyError ? <Hint>{apiKeyError}</Hint> : null}
        <Hint>API Key 保存到系统凭据存储(Keychain / Credential Manager / Secret Service),不在 localStorage 中明文存放。</Hint>
      </Field>

      {draft.apiMode === "responses" ? (
        <Field label="文本模型 ID">
          <input
            type="text"
            value={draft.textModelID}
            placeholder="留空=默认 gpt-5.5"
            onChange={(e) => onPatchDraft({ textModelID: e.target.value })}
            spellCheck={false}
            className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
        </Field>
      ) : null}

      <Field label="图像模型 ID">
        <input
          type="text"
          value={draft.imageModelID}
          placeholder="留空=默认 gpt-image-2"
          onChange={(e) => onPatchDraft({ imageModelID: e.target.value })}
          spellCheck={false}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
      </Field>

      <Field label="并发数量限制">
        <input
          type="number"
          value={draft.concurrencyLimit || ""}
          placeholder="留空=不限制"
          min={0}
          step={1}
          onChange={(e) => onPatchDraft({ concurrencyLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
        <Hint>0/留空 = 不限制。填正整数后,此 profile 跨所有标签页最多同时运行这么多任务。</Hint>
      </Field>

      <button
        type="button"
        onClick={() => void onTest()}
        disabled={!canSave || isTestingKey}
        className={`platform-action-btn w-full inline-flex items-center justify-center gap-2 border border-black/[0.08] px-3 py-2 text-sm text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
      >
        <Plug className={`h-3.5 w-3.5 ${isTestingKey ? "animate-spin" : ""}`} />
        {isTestingKey ? "测试中..." : "保存并测试连接"}
      </button>

      <div className={`flex gap-2 pt-1 ${isAndroidPhone ? "sticky bottom-0 -mx-4 mt-1 border-t border-black/[0.06] bg-white/92 px-4 pb-4 pt-3 dark:border-white/[0.04] dark:bg-zinc-900/92" : "justify-end"}`}>
        <button
          type="button"
          onClick={onClose}
          className={`platform-action-btn border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${isAndroidPhone ? "flex-1 rounded-full" : usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          关闭
        </button>
        <button
          type="button"
          onClick={() => void onSaveAndClose()}
          disabled={!canSave}
          className={`liquid-primary-button bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800 ${isAndroidPhone ? "flex-[1.2] rounded-full" : usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          保存
        </button>
      </div>

      {!canSave ? <p className="min-w-0 break-words text-[11px] text-zinc-500 [overflow-wrap:anywhere]">BASE_URL 和 API Key 必须填齐才能保存。</p> : null}

      {draft.apiMode === "images" ? (
        <Field label="NewAPI 兼容模式">
          <label className={`flex items-start gap-2 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-[12px] text-zinc-700 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <input
              type="checkbox"
              checked={draft.imagesNewAPICompat === true}
              onChange={(e) => onPatchDraft({ imagesNewAPICompat: e.target.checked })}
              className="mt-0.5"
            />
            <span className="min-w-0 leading-5">
              NewAPI 兼容：发送 response_format=b64_json，并关闭 stream / partial_images。
            </span>
          </label>
        </Field>
      ) : null}

      {draft.apiMode === "images" ? (
        <div className={`${usesAppleUI ? "liquid-glass-panel" : ""} flex items-start gap-2 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">Images API 路径走标准 <code className="font-mono-token">/v1/images/generations</code> + <code className="font-mono-token">/v1/images/edits</code>,无 SSE 保活,长推理 CF 524 风险更高,但兼容性最广。</span>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="upstream-field min-w-0">
      <label className="mb-1.5 block min-w-0 break-words text-xs text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 min-w-0 break-words text-[11px] leading-relaxed text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-500">{children}</p>
  );
}

function Req() {
  return <span className="text-red-500">*</span>;
}
