export const MAX_HISTORY_ITEMS = 120;

export function retainHistoryItems<T>(
  items: T[],
  retainAll: boolean,
  maxItems = MAX_HISTORY_ITEMS,
): T[] {
  if (retainAll || items.length <= maxItems) return items;
  return items.slice(0, maxItems);
}

export function historyPageHasMore(
  nextCursor: unknown,
  itemCount: number,
  retainAll: boolean,
  maxItems = MAX_HISTORY_ITEMS,
): boolean {
  return !!nextCursor && (retainAll || itemCount < maxItems);
}

export function historyPageIsStalled(
  beforeCursor: unknown,
  beforeCount: number,
  afterCursor: unknown,
  afterCount: number,
  afterHasMore: boolean,
): boolean {
  return afterHasMore && afterCursor === beforeCursor && afterCount === beforeCount;
}
