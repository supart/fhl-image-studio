import { historyPageIsStalled } from "./historyRetention.ts";

export type HistoryPaginationState<T> = {
  history: T[];
  historyHasMore: boolean;
  historyCursorBeforeDayStart: number | null;
  loadMoreHistory: () => Promise<void>;
};

export async function ensureAllHistoryLoaded<T>(
  getState: () => HistoryPaginationState<T>,
): Promise<void> {
  while (getState().historyHasMore) {
    const before = getState();
    const beforeCursor = before.historyCursorBeforeDayStart;
    const beforeCount = before.history.length;
    await before.loadMoreHistory();
    const after = getState();
    if (historyPageIsStalled(
      beforeCursor,
      beforeCount,
      after.historyCursorBeforeDayStart,
      after.history.length,
      after.historyHasMore,
    )) {
      throw new Error("历史分页游标未推进，已停止加载以避免重复循环。");
    }
  }
}

export function historyItemsAtOrAfter<T extends { createdAt: number }>(
  items: T[],
  cutoff: number,
): T[] {
  return items.filter((item) => item.createdAt >= cutoff);
}

export async function clearAllHistory<T extends { id: string }>(
  getState: () => HistoryPaginationState<T> & {
    deleteHistoryItem: (id: string) => Promise<void>;
  },
  confirmClear: (count: number) => boolean | Promise<boolean>,
): Promise<number> {
  await ensureAllHistoryLoaded(getState);
  const allHistory = [...getState().history];
  if (!await confirmClear(allHistory.length)) return 0;
  for (const item of allHistory) {
    await getState().deleteHistoryItem(item.id);
  }
  return allHistory.length;
}
