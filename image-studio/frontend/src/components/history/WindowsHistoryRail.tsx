import {
  ChevronDown, ChevronRight, Clock3, CopyPlus, Filter, Image as ImageIcon,
  Search, Settings2, Split,
} from "lucide-react";
import { historyPreviewSrc, useBlobURL, useImageLoadState } from "../../lib/images";
import type { APIMode, HistoryItem, JobGroupSnapshot, Mode, QualityValue, SizeValue } from "../../types/domain";
import { ContextMenu } from "../common/ContextMenu";
import { RawResponseModal } from "./RawResponseModal";
import type { DateFilter, ModeFilter } from "./HistoryRail";
import type { HistoryPromptEntry, HistoryPromptGroup } from "./historyPromptGroups";
import { HistoryMetaBadges } from "./HistoryMetaBadges";
import { HistoryModeBadge } from "./HistoryModeBadge";
import { HistoryTile } from "./HistoryTile";
import { WindowsHistoryPromptGroup } from "./WindowsHistoryPromptGroup";
import { qualityLabel, sizeLabel } from "./historyLabels";
import type { MenuItem } from "../common/ContextMenu";
import { apiModeLabel, apiModeShortLabel } from "../../state/workspaceRuntime";

export type WindowsHistoryBatchQueueSlot =
  | { type: "result"; index: number; item: HistoryItem }
  | { type: "preview"; index: number; item: HistoryItem }
  | { type: "failed"; index: number; id: string; message?: string }
  | { type: "pending"; index: number; id: string };

export function WindowsHistoryRail({
  activeProfileId,
  apiKey,
  apiMode,
  baseURL,
  batchQueueCompleted,
  batchQueueMode,
  batchQueueQuality,
  batchQueueRunning,
  batchQueueSize,
  batchQueueSlots,
  batchQueueTotal,
  buildMenu,
  closeMenu,
  closeRaw,
  compareB,
  currentImage,
  dateF,
  deleteHistoryItem,
  filtered,
  generateCount,
  editCount,
  entries,
  history,
  historyHasMore,
  historyFiltersActive,
  historyLoading,
  historyRailCollapsed,
  isTestingKey,
  menu,
  modeF,
  loadMoreHistory,
  openHistoryTimeline,
  openMenu,
  openUpstreamConfig,
  profiles,
  q,
  rawPath,
  recentJobGroups,
  reuseAsSource,
  selectCurrent,
  setActiveProfile,
  setCompareB,
  setDateF,
  setHistoryRailCollapsed,
  setModeF,
  setQ,
  testAPIKey,
  onOpenPromptGroup,
}: {
  activeProfileId: string;
  apiKey: string;
  apiMode: APIMode;
  baseURL: string;
  batchQueueCompleted: number;
  batchQueueMode: Mode;
  batchQueueQuality: QualityValue;
  batchQueueRunning: boolean;
  batchQueueSize: SizeValue;
  batchQueueSlots: WindowsHistoryBatchQueueSlot[];
  batchQueueTotal: number;
  buildMenu: (item: HistoryItem) => MenuItem[];
  closeMenu: () => void;
  closeRaw: () => void;
  compareB: HistoryItem | null;
  currentImage: HistoryItem | null;
  dateF: DateFilter;
  deleteHistoryItem: (id: string) => void | Promise<void>;
  filtered: HistoryItem[];
  generateCount: number;
  editCount: number;
  entries: HistoryPromptEntry[];
  history: HistoryItem[];
  historyHasMore: boolean;
  historyFiltersActive: boolean;
  historyLoading: boolean;
  historyRailCollapsed: boolean;
  isTestingKey: boolean;
  menu: { item: HistoryItem; x: number; y: number } | null;
  modeF: ModeFilter;
  loadMoreHistory: () => void | Promise<void>;
  openHistoryTimeline: () => void;
  openMenu: (item: HistoryItem, x: number, y: number) => void;
  openUpstreamConfig: (source?: "app" | "settings") => void;
  profiles: Array<{ id: string; name: string; apiMode: APIMode }>;
  q: string;
  rawPath: string | null;
  recentJobGroups: JobGroupSnapshot[];
  reuseAsSource: (item: HistoryItem) => void | Promise<void>;
  selectCurrent: (item: HistoryItem) => void | Promise<void>;
  setActiveProfile: (id: string) => void | Promise<void>;
  setCompareB: (item: HistoryItem | null) => void;
  setDateF: (value: DateFilter) => void;
  setHistoryRailCollapsed: (value: boolean) => void;
  setModeF: (value: ModeFilter) => void;
  setQ: (value: string) => void;
  testAPIKey: () => void | Promise<void>;
  onOpenPromptGroup: (group: HistoryPromptGroup) => void;
}) {
  const latest = filtered[0] ?? null;
  const list = historyRailCollapsed ? [] : entries.slice(0, 18);
  const historyById = new Map(history.map((item) => [item.id, item]));
  const resultCountLabel = recentJobGroups.length > 0
    ? `${recentJobGroups.length} 任务组 · ${entries.length}`
    : batchQueueSlots.length > 0
    ? `${batchQueueSlots.length} 队列 · ${entries.length}`
    : `${list.length}${entries.length > list.length ? ` / ${entries.length}` : ""}`;

  return (
    <aside className="history-rail windows-history-rail box-border flex shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--inspector)]">
      <div className="windows-history-stack">
        <section className="platform-card windows-history-upstream">
          <div className="windows-history-card-head">
            <div className="windows-history-title-row">
              <span className="windows-history-title">上游</span>
              <span className={`windows-status-dot ${apiKey && baseURL ? "ready" : "missing"}`} />
              <span className={apiKey && baseURL ? "text-[var(--accent)]" : "text-red-400"}>
                {apiKey && baseURL ? "已配置" : "未配置"}
              </span>
            </div>
            <span className="windows-history-muted">当前连接</span>
          </div>

          {profiles.length > 0 ? (
            <select
              value={activeProfileId}
              onChange={(event) => {
                const id = event.target.value;
                if (id === "__manage__") {
                  openUpstreamConfig("app");
                  return;
                }
                if (id) void setActiveProfile(id);
              }}
              className="focus-ring windows-history-select"
              title="切换上游配置 / 管理"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {apiModeShortLabel(profile.apiMode)}
                </option>
              ))}
              <option value="__manage__">管理配置...</option>
            </select>
          ) : (
            <p className="windows-history-description">还没有上游配置，先建一条再开始生成。</p>
          )}

          <div className="windows-history-actions">
            <button type="button" onClick={() => openUpstreamConfig("app")} className="platform-action-btn">
              上游配置
            </button>
            <button
              type="button"
              onClick={() => void testAPIKey()}
              disabled={!apiKey.trim() || !baseURL.trim() || isTestingKey}
              className="platform-action-btn"
            >
              {isTestingKey ? "检查中..." : "测试"}
            </button>
          </div>
          <span className="windows-history-api-mode">
            {apiModeLabel(apiMode)}
          </span>
        </section>

        <section className="platform-card windows-history-summary">
          <div className="windows-history-card-head">
            <div>
              <div className="windows-history-title">历史</div>
              <div className="windows-history-count">{filtered.length}{filtered.length !== history.length ? ` / ${history.length}` : ""} 项</div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryRailCollapsed(!historyRailCollapsed)}
              className="platform-pill windows-history-collapse"
            >
              {historyRailCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {historyRailCollapsed ? "展开" : "折叠"}
            </button>
          </div>

          <div className="windows-history-stats">
            <button type="button" className={modeF === "all" ? "active" : ""} onClick={() => setModeF("all")}>
              <ImageIcon className="h-3.5 w-3.5" /> 全部 <strong>{history.length}</strong>
            </button>
            <button type="button" className={modeF === "generate" ? "active" : ""} onClick={() => setModeF("generate")}>
              <CopyPlus className="h-3.5 w-3.5" /> 文生图 <strong>{generateCount}</strong>
            </button>
            <button type="button" className={modeF === "edit" ? "active" : ""} onClick={() => setModeF("edit")}>
              <Settings2 className="h-3.5 w-3.5" /> 图生图 <strong>{editCount}</strong>
            </button>
          </div>

          <label className="windows-history-search">
            <Search className="h-3.5 w-3.5" />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索 prompt..." />
          </label>

          <div className="windows-history-filter-row">
            <button type="button" className={dateF === "all" ? "active" : ""} onClick={() => setDateF("all")}>全部</button>
            <button type="button" className={dateF === "today" ? "active" : ""} onClick={() => setDateF("today")}>今天</button>
            <button type="button" className={dateF === "week" ? "active" : ""} onClick={() => setDateF("week")}>本周</button>
          </div>
        </section>

        {compareB ? (
          <button type="button" onClick={() => setCompareB(null)} className="platform-pill windows-compare-exit">
            <Split className="h-3.5 w-3.5" /> 退出对比
          </button>
        ) : null}

        {!historyRailCollapsed && latest ? (
          <section className="platform-card windows-history-feature">
            <div className="windows-history-section-head">
              <span><Clock3 className="h-3.5 w-3.5" /> 最近作品</span>
              <button type="button" onClick={openHistoryTimeline}>完整历史</button>
            </div>
            <HistoryTile
              item={latest}
              isCurrent={currentImage?.id === latest.id}
              isCompare={compareB?.id === latest.id}
              onSelect={selectCurrent}
              onToggleCompare={(next) => setCompareB(next)}
              onReuse={reuseAsSource}
              onDelete={deleteHistoryItem}
              onOpenMenu={(x, y) => openMenu(latest, x, y)}
              variant="windowsFeature"
            />
          </section>
        ) : null}

        {!historyRailCollapsed ? (
          <section className="platform-card windows-history-results">
            <div className="windows-history-section-head">
              <span><Filter className="h-3.5 w-3.5" /> 结果</span>
              <span>{resultCountLabel}</span>
            </div>

            {recentJobGroups.length > 0 ? (
              <div className="space-y-2">
                {recentJobGroups.map((group) => (
                  <WindowsJobGroupCard
                    key={group.groupId}
                    group={group}
                    historyById={historyById}
                    onSelect={selectCurrent}
                  />
                ))}
              </div>
            ) : batchQueueSlots.length > 0 ? (
              <WindowsBatchQueue
                slots={batchQueueSlots}
                completed={batchQueueCompleted}
                total={batchQueueTotal}
                running={batchQueueRunning}
                mode={batchQueueMode}
                size={batchQueueSize}
                quality={batchQueueQuality}
                onSelect={selectCurrent}
              />
            ) : null}

            {list.length === 0 && batchQueueSlots.length === 0 && recentJobGroups.length === 0 ? (
              <div className="windows-history-empty">
                {historyFiltersActive ? "没有匹配项" : "还没有结果"}
              </div>
            ) : list.length > 0 ? (
              <div className="windows-history-list">
                {list.map((entry) => (
                  <WindowsHistoryEntry
                    key={entry.key}
                    entry={entry}
                    currentItemId={currentImage?.id ?? null}
                    compareItemId={compareB?.id ?? null}
                    onDelete={deleteHistoryItem}
                    onOpenMenu={openMenu}
                    onOpenPromptGroup={onOpenPromptGroup}
                    onReuse={reuseAsSource}
                    onSelect={selectCurrent}
                    onToggleCompare={(next) => setCompareB(next)}
                  />
                ))}
              </div>
            ) : null}

            {entries.length > list.length ? (
              <button type="button" onClick={openHistoryTimeline} className="windows-history-more">
                查看更多历史
              </button>
            ) : null}
            {historyHasMore ? (
              <button
                type="button"
                onClick={() => void loadMoreHistory()}
                disabled={historyLoading}
                className="windows-history-more"
              >
                {historyLoading ? "加载中..." : "加载更多历史"}
              </button>
            ) : null}
          </section>
        ) : null}
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.item)} onClose={closeMenu} /> : null}
      {rawPath ? <RawResponseModal path={rawPath} onClose={closeRaw} /> : null}
    </aside>
  );
}

function browserHistoryId(jobId: string) {
  return `job:${jobId}`;
}

function summarizeGroupState(group: JobGroupSnapshot) {
  const summary = group.statusSummary;
  if (summary.running > 0 || summary.queued > 0) {
    return `运行中 ${summary.succeeded + summary.failed + summary.cancelled + summary.interrupted}/${group.batchCount}`;
  }
  if (summary.failed > 0 || summary.interrupted > 0) {
    return `${summary.succeeded} 成功 · ${summary.failed + summary.interrupted} 失败`;
  }
  if (summary.cancelled > 0) {
    return `${summary.succeeded} 成功 · ${summary.cancelled} 已取消`;
  }
  return `${summary.succeeded} 成功`;
}

function slotStateLabel(status: JobGroupSnapshot["slots"][number]["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "已中断";
    default:
      return status;
  }
}

function slotDisplayLabel(slot: JobGroupSnapshot["slots"][number]) {
  if (slot.fallbackMode === "contact_sheet") {
    if (slot.status === "succeeded") return "兼容模式成功";
    if (slot.status === "running") return "兼容重试中";
    if (slot.status === "failed") return "兼容模式失败";
  }
  return slotStateLabel(slot.status);
}

function slotDisplayMessage(slot: JobGroupSnapshot["slots"][number]) {
  const raw = (slot.errorMessage || slot.stage || "").trim();
  if (slot.fallbackMode === "contact_sheet") {
    if (slot.status === "succeeded") return "多参考图直传失败后，已用合成参考图完成。";
    if (slot.status === "running") return "多参考图直传失败，正在使用合成参考图兼容模式。";
  }
  return raw;
}

function slotStateClass(status: JobGroupSnapshot["slots"][number]["status"]) {
  switch (status) {
    case "succeeded":
      return "border-emerald-400/40 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-200";
    case "failed":
    case "interrupted":
      return "border-red-400/40 bg-red-500/[0.08] text-red-700 dark:text-red-200";
    case "cancelled":
      return "border-zinc-400/30 bg-zinc-500/[0.08] text-zinc-600 dark:text-zinc-300";
    case "running":
      return "border-[color:var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]";
    default:
      return "border-black/[0.08] bg-black/[0.03] text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-300";
  }
}

function WindowsJobGroupCard({
  group,
  historyById,
  onSelect,
}: {
  group: JobGroupSnapshot;
  historyById: Map<string, HistoryItem>;
  onSelect: (item: HistoryItem) => void | Promise<void>;
}) {
  const slots = [...group.slots].sort((a, b) => a.batchIndex - b.batchIndex);
  return (
    <div className="rounded-[16px] border border-black/[0.06] bg-white/70 p-3 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <HistoryModeBadge mode={group.mode} />
            <HistoryMetaBadges items={[sizeLabel(group.size), qualityLabel(group.quality), `${group.batchCount} 张`]} compact />
          </div>
          <p className="line-clamp-2 text-[12px] leading-5 text-zinc-700 dark:text-zinc-200">
            {group.prompt || "(无 prompt)"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-black/[0.08] px-2 py-1 text-[11px] text-zinc-600 dark:border-white/[0.08] dark:text-zinc-300">
          {summarizeGroupState(group)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {slots.map((slot) => (
          <WindowsJobSlot
            key={slot.jobId}
            item={historyById.get(browserHistoryId(slot.jobId)) ?? null}
            slot={slot}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function WindowsJobSlot({
  item,
  slot,
  onSelect,
}: {
  item: HistoryItem | null;
  slot: JobGroupSnapshot["slots"][number];
  onSelect: (item: HistoryItem) => void | Promise<void>;
}) {
  if (slot.status === "succeeded" && item) {
    return <WindowsJobImageSlot item={item} slot={slot} onSelect={onSelect} />;
  }
  return <WindowsJobStateSlot slot={slot} />;
}

function WindowsJobImageSlot({
  item,
  slot,
  onSelect,
}: {
  item: HistoryItem;
  slot: JobGroupSnapshot["slots"][number];
  onSelect: (item: HistoryItem) => void | Promise<void>;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const imageLoadState = useImageLoadState(imageSrc || null);
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-[14px] border border-black/[0.06] bg-[var(--surface)] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--accent)]/35 dark:border-white/[0.06]"
      onClick={() => void onSelect(item)}
      title={item.prompt}
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-black/[0.04] dark:bg-white/[0.06]">
        {imageSrc && imageLoadState === "ready" ? (
          <img src={imageSrc} alt={item.prompt || `result ${slot.batchIndex + 1}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <span className="text-[11px] text-zinc-500">图 {slot.batchIndex + 1}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">第 {slot.batchIndex + 1} 张</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${slotStateClass(slot.status)}`}>
            {slotDisplayLabel(slot)}
          </span>
        </span>
        <span className="line-clamp-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-300">
          {slot.revisedPrompt || item.revisedPrompt || item.prompt}
        </span>
      </span>
    </button>
  );
}

function WindowsJobStateSlot({
  slot,
}: {
  slot: JobGroupSnapshot["slots"][number];
}) {
  const message = slotDisplayMessage(slot);
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-black/[0.06] bg-[var(--surface)] px-2.5 py-2 dark:border-white/[0.06]">
      <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] border text-[12px] font-semibold ${slotStateClass(slot.status)}`}>
        {slot.batchIndex + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">第 {slot.batchIndex + 1} 张</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${slotStateClass(slot.status)}`}>
            {slotDisplayLabel(slot)}
          </span>
        </span>
        {message ? (
          <span className="line-clamp-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-300" title={message}>
            {message}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-300">
            等待上游返回结果
          </span>
        )}
      </span>
    </div>
  );
}

function WindowsBatchQueue({
  completed,
  mode,
  onSelect,
  quality,
  running,
  size,
  slots,
  total,
}: {
  completed: number;
  mode: Mode;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  quality: QualityValue;
  running: boolean;
  size: SizeValue;
  slots: WindowsHistoryBatchQueueSlot[];
  total: number;
}) {
  const successCount = slots.filter((slot) => slot.type === "result").length;
  const failedCount = slots.filter((slot) => slot.type === "failed").length;
  const pendingCount = slots.filter((slot) => slot.type === "pending" || slot.type === "preview").length;
  const statusText = running
    ? `运行中 ${completed}/${Math.max(total, slots.length)}`
    : failedCount > 0
      ? `${successCount} 成功 · ${failedCount} 失败`
      : `${successCount} 成功`;

  return (
    <div className="windows-history-batch-queue" aria-label="本批生成队列">
      <div className="windows-history-batch-head">
        <span>本批队列</span>
        <strong>{statusText}</strong>
      </div>
      <div className="windows-history-batch-list">
        {slots.map((slot) => {
          if (slot.type === "result" || slot.type === "preview") {
            return (
              <WindowsBatchQueueImageSlot
                key={`${slot.type}-${slot.item.id}-${slot.index}`}
                slot={slot}
                onSelect={onSelect}
              />
            );
          }
          return (
            <WindowsBatchQueueStateSlot
              key={`${slot.type}-${slot.id}`}
              slot={slot}
              mode={mode}
              size={size}
              quality={quality}
            />
          );
        })}
      </div>
      {pendingCount > 0 ? (
        <div className="windows-history-batch-note">等待中的槽位会在任务结束后保留为失败 / 未返回。</div>
      ) : null}
    </div>
  );
}

function WindowsBatchQueueImageSlot({
  onSelect,
  slot,
}: {
  onSelect: (item: HistoryItem) => void | Promise<void>;
  slot: Extract<WindowsHistoryBatchQueueSlot, { type: "result" | "preview" }>;
}) {
  const item = slot.item;
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const imageLoadState = useImageLoadState(imageSrc || null);
  const isPreview = slot.type === "preview";
  return (
    <button
      type="button"
      className={`windows-history-batch-slot ${isPreview ? "preview" : "success"}`}
      onClick={() => {
        if (!isPreview) void onSelect(item);
      }}
      disabled={isPreview}
      title={item.prompt}
    >
      <span className="windows-history-batch-index">{slot.index + 1}</span>
      <span className="windows-history-batch-thumb">
        {imageSrc && imageLoadState === "ready" ? (
          <img src={imageSrc} alt={item.prompt || `batch ${slot.index + 1}`} loading="eager" decoding="async" />
        ) : (
          <span className="history-thumb-fallback" aria-hidden="true" />
        )}
      </span>
      <span className="windows-history-batch-main">
        <span className="windows-history-batch-prompt">{item.prompt || "(无 prompt)"}</span>
        <span className="windows-history-batch-meta">
          <HistoryModeBadge mode={item.mode} />
          <HistoryMetaBadges items={[sizeLabel(item.size), qualityLabel(item.quality)]} compact />
          <span className="windows-history-batch-state">{isPreview ? "等待 final" : "成功"}</span>
        </span>
      </span>
    </button>
  );
}

function WindowsBatchQueueStateSlot({
  mode,
  quality,
  size,
  slot,
}: {
  mode: Mode;
  quality: QualityValue;
  size: SizeValue;
  slot: Extract<WindowsHistoryBatchQueueSlot, { type: "failed" | "pending" }>;
}) {
  const failed = slot.type === "failed";
  const failureMessage = failed ? slot.message?.trim() || "" : "";
  return (
    <div className={`windows-history-batch-slot ${failed ? "failed" : "pending"}`}>
      <span className="windows-history-batch-index">{slot.index + 1}</span>
      <span className="windows-history-batch-placeholder">{failed ? "!" : "..."}</span>
      <span className="windows-history-batch-main">
        <span className="windows-history-batch-prompt">
          第 {slot.index + 1} 张{failed ? "生成失败 / 未返回" : "等待返回"}
        </span>
        {failureMessage ? (
          <span className="windows-history-batch-error" title={failureMessage}>
            {failureMessage}
          </span>
        ) : null}
        <span className="windows-history-batch-meta">
          <HistoryModeBadge mode={mode} />
          <HistoryMetaBadges items={[sizeLabel(size), qualityLabel(quality)]} compact />
          <span className="windows-history-batch-state">{failed ? "失败" : "队列中"}</span>
        </span>
      </span>
    </div>
  );
}

function WindowsHistoryEntry({
  compareItemId,
  currentItemId,
  entry,
  onDelete,
  onOpenMenu,
  onOpenPromptGroup,
  onReuse,
  onSelect,
  onToggleCompare,
}: {
  compareItemId: string | null;
  currentItemId: string | null;
  entry: HistoryPromptEntry;
  onDelete: (id: string) => void | Promise<void>;
  onOpenMenu: (item: HistoryItem, x: number, y: number) => void;
  onOpenPromptGroup: (group: HistoryPromptGroup) => void;
  onReuse: (item: HistoryItem) => void | Promise<void>;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onToggleCompare: (item: HistoryItem | null) => void;
}) {
  if (entry.kind === "group") {
    return (
      <WindowsHistoryPromptGroup
        group={entry.group}
        currentItemId={currentItemId}
        compareItemId={compareItemId}
        onOpenMenu={onOpenMenu}
        onOpenGroup={() => onOpenPromptGroup(entry.group)}
        onSelect={onSelect}
        onToggleCompare={onToggleCompare}
      />
    );
  }

  return (
    <WindowsHistoryRow
      item={entry.item}
      isCurrent={currentItemId === entry.item.id}
      isCompare={compareItemId === entry.item.id}
      onDelete={onDelete}
      onOpenMenu={(x, y) => onOpenMenu(entry.item, x, y)}
      onReuse={onReuse}
      onSelect={onSelect}
      onToggleCompare={onToggleCompare}
    />
  );
}

function WindowsHistoryRow({
  item,
  isCompare,
  isCurrent,
  onDelete,
  onOpenMenu,
  onReuse,
  onSelect,
  onToggleCompare,
}: {
  item: HistoryItem;
  isCompare: boolean;
  isCurrent: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onOpenMenu: (x: number, y: number) => void;
  onReuse: (item: HistoryItem) => void | Promise<void>;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onToggleCompare: (item: HistoryItem | null) => void;
}) {
  return (
    <HistoryTile
      item={item}
      isCurrent={isCurrent}
      isCompare={isCompare}
      onSelect={onSelect}
      onToggleCompare={onToggleCompare}
      onReuse={onReuse}
      onDelete={onDelete}
      onOpenMenu={onOpenMenu}
      variant="windowsList"
    />
  );
}
