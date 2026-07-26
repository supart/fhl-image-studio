import { Eye, EyeOff, HelpCircle, Info, Plug } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { APIMode, RequestPolicy, UpstreamProfile } from "../../types/domain";
import { apiModeLabel, requestPolicyLabel } from "../../lib/profiles";
import { usePlatform } from "../../platform/context";

export function UpstreamProfileEditor({
  draft,
  draftKey,
  showKey,
  savedKeyLoaded,
  savedKeyAvailable,
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
  savedKeyAvailable: boolean;
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
  const usesBridgeStoredKey = draft.apiMode === "runninghub";
  const supportsRequestPolicy = draft.apiMode !== "apimart" && draft.apiMode !== "runninghub";
  const requiresDirectKey = !usesBridgeStoredKey;

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
            { id: "responses" as APIMode, title: "Responses API", sub: "SSE 保活，长任务更稳" },
            { id: "images" as APIMode, title: "Images API", sub: "标准 generations / edits" },
            { id: "runninghub" as APIMode, title: "RunningHub", sub: "桥接 8117，支持文生图/图生图" },
            { id: "apimart" as APIMode, title: "APIMart", sub: "异步提交 + 轮询任务" },
          ]).map((option) => {
            const active = draft.apiMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPatchDraft({
                  apiMode: option.id,
                  requestPolicy: "openai",
                  continuousPoolEnabled: option.id === "images" ? (draft.continuousPoolEnabled ?? true) : false,
                })}
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
            ? "需要 key 绑定到带有 GPT 图像与文本能力的分组，适合提示词优化和长任务。"
            : draft.apiMode === "images"
              ? "使用标准 Images API，兼容范围最广。"
              : draft.apiMode === "apimart"
                ? "使用 APIMart 异步链路，先提交任务，再轮询结果。"
                : "RunningHub 通过本地桥接模块工作，Key 保存在桥接里，当前桌面版 profile 只保存桥接地址和模型键。"}
        </Hint>
      </Field>

      {supportsRequestPolicy ? (
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
            `OpenAI 标准` 更适合直连 OpenAI 或严格兼容实现。`兼容中转扩展` 会额外发送常见 relay 扩展字段。
          </Hint>
        </Field>
      ) : null}

      <Field label={<>上游 BASE_URL <Req /></>}>
        <input
          type="text"
          value={draft.baseURL}
          placeholder={draft.apiMode === "runninghub" ? "http://127.0.0.1:8117" : "https://your-relay.example.com"}
          onChange={(e) => onPatchDraft({ baseURL: e.target.value })}
          spellCheck={false}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
        {baseURLError ? <Hint>{baseURLError}</Hint> : null}
        <Hint>
          {draft.apiMode === "runninghub" ? (
            <>填写 RunningHub 桥接地址。桌面版会通过这里调用 <code className="font-mono-token">/api/upload</code>、<code className="font-mono-token">/api/generate</code>、<code className="font-mono-token">/api/task</code> 和 <code className="font-mono-token">/api/image</code>。</>
          ) : draft.apiMode === "apimart" ? (
            <>只填 APIMart 根地址。应用会自动调用 <code className="font-mono-token">/v1/images/generations</code>、<code className="font-mono-token">/v1/uploads/images</code> 和 <code className="font-mono-token">/v1/tasks/...</code>。</>
          ) : (
            <>只填中转站点根地址。应用会按当前 API 形态自动拼接 <code className="font-mono-token">/v1/responses</code> 或 <code className="font-mono-token">/v1/images/generations</code> / <code className="font-mono-token">/v1/images/edits</code>，不要把这些路径手动粘进来。</>
          )}
        </Hint>
      </Field>

      {requiresDirectKey ? (
        <Field label={<>API Key <Req /></>}>
          <div className="relative min-w-0">
            <input
              key={`${draft.id}:api-key-entry:${savedKeyLoaded ? "ready" : "loading"}`}
              type="text"
              value={draftKey}
              placeholder={savedKeyLoaded ? (savedKeyAvailable ? "已保存；留空表示不修改" : "sk-...") : "(加载中...)"}
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
          <Hint>
            {savedKeyAvailable
              ? "系统凭据里已有 API Key。留空只保存模型、并发等配置；填写新 Key 才会替换。"
              : "API Key 保存到系统凭据存储（Keychain / Credential Manager / Secret Service），不会明文放在 localStorage。"}
          </Hint>
        </Field>
      ) : (
        <Field label="桥接 Key">
          <div className={`${usesAppleUI ? "liquid-glass-panel" : ""} flex items-start gap-2 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              RunningHub API Key 不保存在当前桌面版 profile 里，而是保存在桥接模块。推荐使用“一键配置 RunningHub”写入并验证；这里的保存和测试只会校验桥接地址与桥接返回的能力矩阵。
            </span>
          </div>
        </Field>
      )}

      {draft.apiMode === "responses" || draft.apiMode === "apimart" ? (
        <Field label="文本模型 ID">
          <input
            type="text"
            value={draft.textModelID}
            placeholder={draft.apiMode === "apimart" ? "可选：gpt-5.5 / gpt-4o / gemini-2.0-flash-exp" : "留空 = 默认 gpt-5.5"}
            onChange={(e) => onPatchDraft({ textModelID: e.target.value })}
            spellCheck={false}
            className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
          {draft.apiMode === "apimart" ? (
            <Hint>仅用于提示词优化 / 反推的文本链路；留空时会借用已存在的 Responses/FHL 文本配置。</Hint>
          ) : null}
        </Field>
      ) : null}

      <Field label="图像模型 ID">
        <input
          type="text"
          value={draft.imageModelID}
          placeholder={draft.apiMode === "runninghub" ? "banana2 或 image_g2" : "留空 = 默认 gpt-image-2"}
          onChange={(e) => onPatchDraft({ imageModelID: e.target.value })}
          spellCheck={false}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
        {draft.apiMode === "runninghub" ? (
          <Hint>RunningHub 这里填桥接模型键，不是 OpenAI 官方模型 ID。建议用 `banana2` 或 `image_g2`。</Hint>
        ) : null}
      </Field>

      <Field label="并发数量限制">
        <input
          type="number"
          value={draft.concurrencyLimit || ""}
          placeholder="留空 = 不限制"
          min={0}
          step={1}
          onChange={(e) => onPatchDraft({ concurrencyLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          className={`focus-ring w-full min-w-0 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:placeholder:text-zinc-500 font-mono-token ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
        />
        <Hint>0 / 留空 = 不限制。填正整数后，这个 profile 跨所有标签页最多同时运行这么多任务。</Hint>
      </Field>

      {draft.apiMode === "images" ? (
        <Field label="连续生成池">
          <label className={`flex items-start gap-2 border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-[12px] text-zinc-700 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
            <input
              type="checkbox"
              checked={draft.continuousPoolEnabled === true}
              onChange={(e) => onPatchDraft({ continuousPoolEnabled: e.target.checked })}
              className="mt-0.5"
            />
            <span className="min-w-0 leading-5">
              加入连续生成池：连续生成会在所有已启用、仍有并发容量的 Images 配置之间轮询分配任务。
            </span>
          </label>
        </Field>
      ) : null}

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
              NewAPI 兼容：发送 <code className="font-mono-token">response_format=b64_json</code>，并关闭 stream / partial_images。
            </span>
          </label>
        </Field>
      ) : null}

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

      {!canSave ? (
        <p className="min-w-0 break-words text-[11px] text-zinc-500 [overflow-wrap:anywhere]">
          {requiresDirectKey ? "BASE_URL 和 API Key 必须填齐后才能保存。" : "BASE_URL 必须填写后才能保存。"}
        </p>
      ) : null}

      {draft.apiMode === "images" ? (
        <div className={`${usesAppleUI ? "liquid-glass-panel" : ""} flex items-start gap-2 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            Images API 走标准 <code className="font-mono-token">/v1/images/generations</code> + <code className="font-mono-token">/v1/images/edits</code>，没有 SSE 保活，长任务更容易遇到 Cloudflare 524，但兼容性最广。
          </span>
        </div>
      ) : null}
      {draft.apiMode === "apimart" ? (
        <div className={`${usesAppleUI ? "liquid-glass-panel" : ""} flex items-start gap-2 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {apiModeLabel("apimart")} 使用 <code className="font-mono-token">official_fallback=false</code> 和 <code className="font-mono-token">image_urls</code>，提交后轮询任务结果。
          </span>
        </div>
      ) : null}
      {draft.apiMode === "runninghub" ? (
        <div className={`${usesAppleUI ? "liquid-glass-panel" : ""} flex items-start gap-2 border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--accent)] ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {apiModeLabel("runninghub")} 会把文生图映射到 <code className="font-mono-token">text-to-image</code>，图生图映射到 <code className="font-mono-token">image-to-image</code>，结果图通过桥接代理回传，避免浏览器直接跨域抓取 CDN。
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="upstream-field min-w-0">
      <label className="mb-1.5 block min-w-0 break-words text-xs text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 min-w-0 break-words text-[11px] leading-relaxed text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-500">{children}</p>
  );
}

function Req() {
  return <span className="text-red-500">*</span>;
}
