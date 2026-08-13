export const ANDROID_BATCH_GRID_COLUMNS = 2;

const GAP_PX = 8;
const OVERSCAN_ROWS = 2;
const MIN_TILE_HEIGHT_PX = 156;
const MAX_TILE_HEIGHT_PX = 260;

export interface AndroidBatchGridMetrics {
  columnWidth: number;
  rowHeight: number;
  rowStride: number;
}
export interface AndroidBatchGridWindow {
  startRow: number;
  endRow: number;
  totalRows: number;
  totalHeight: number;
}

export function androidBatchGridMetrics(containerWidth: number): AndroidBatchGridMetrics {
  const safeWidth = Math.max(0, containerWidth);
  const columnWidth = Math.max(0, (safeWidth - GAP_PX) / ANDROID_BATCH_GRID_COLUMNS);
  const rowHeight = Math.min(
    MAX_TILE_HEIGHT_PX,
    Math.max(MIN_TILE_HEIGHT_PX, Math.round(columnWidth * 1.1)),
  );
  return {
    columnWidth,
    rowHeight,
    rowStride: rowHeight + GAP_PX,
  };
}

export function androidBatchGridWindow({
  itemCount,
  scrollTop,
  viewportHeight,
  rowStride,
  rowHeight,
}: {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowStride: number;
  rowHeight: number;
}): AndroidBatchGridWindow {
  const totalRows = Math.ceil(Math.max(0, itemCount) / ANDROID_BATCH_GRID_COLUMNS);
  const safeStride = Math.max(1, rowStride);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const firstVisibleRow = Math.floor(safeScrollTop / safeStride);
  const lastVisibleRowExclusive = Math.ceil((safeScrollTop + safeViewportHeight) / safeStride);
  const startRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
  const endRow = Math.min(totalRows, lastVisibleRowExclusive + OVERSCAN_ROWS);
  return {
    startRow,
    endRow,
    totalRows,
    totalHeight: totalRows > 0 ? ((totalRows - 1) * safeStride) + rowHeight : 0,
  };
}
