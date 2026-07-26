// IndexedDB + localStorage helpers for non-secret frontend persistence.

import type { HistoryItem } from "../types/domain";
import { base64ToBlob, blobToBase64 } from "./images";
import { storageDBName, storageKey } from "./storageNamespace.ts";

const DB_NAME = storageDBName("image-studio");
const DB_VERSION = 4;
const HISTORY_STORE = "history";
const HISTORY_FULL_STORE = "historyFull";
const LEGACY_DB_NAME = "keyval-store";
const LEGACY_STORE_NAME = "keyval";
const LEGACY_SHARED_API_KEY = storageKey("gptcodex.apiKey");
const MIGRATE_LEGACY_HISTORY = false;

type HistoryRecord = HistoryItem & { searchText: string; searchTokens: string[] };
type FullRecord = { id: string; image: Blob };
export type HistoryPageCursor = {
  createdAt: number;
  id: string;
  direction: "newest" | "oldest";
};
export type HistoryPageResult = {
  items: HistoryItem[];
  nextCursor: HistoryPageCursor | null;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("mode", "mode", { unique: false });
          store.createIndex("createdAt_mode", ["mode", "createdAt"], { unique: false });
          store.createIndex("searchText", "searchText", { unique: false });
          store.createIndex("searchTokens", "searchTokens", { unique: false, multiEntry: true });
        } else {
          store = req.transaction!.objectStore(HISTORY_STORE);
        }
        if (!store.indexNames.contains("createdAt_id")) {
          store.createIndex("createdAt_id", ["createdAt", "id"], { unique: true });
        }
        if (!store.indexNames.contains("savedPath")) {
          store.createIndex("savedPath", "savedPath", { unique: false });
        }
        if (!db.objectStoreNames.contains(HISTORY_FULL_STORE)) {
          db.createObjectStore(HISTORY_FULL_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function openLegacyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cursorAsPromise<T>(
  req: IDBRequest<IDBCursorWithValue | null>,
  opts: {
    limit?: number;
    accept: (value: T) => boolean;
  },
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const value = cursor.value as T;
      if (opts.accept(value)) {
        out.push(value);
        if (opts.limit && out.length >= opts.limit) {
          resolve(out);
          return;
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

function normalizeHistoryRecord(item: HistoryItem): HistoryRecord {
  const searchText = `${item.prompt ?? ""} ${item.revisedPrompt ?? ""}`.trim().toLowerCase();
  const {
    imageBlob: _imageBlob,
    previewBlob: _previewBlob,
    imageB64,
    ...metadata
  } = item;
  void _imageBlob;
  void _previewBlob;
  const hasDurablePath = !!item.savedPath && !item.savedPath.startsWith("memory://");
  return {
    ...metadata,
    ...(hasDurablePath ? {} : { imageB64 }),
    searchText,
    searchTokens: buildSearchTokens(searchText),
  };
}

function buildSearchTokens(searchText: string): string[] {
  const out = new Set<string>();
  const words = searchText.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  for (const word of words) {
    const max = Math.min(word.length, 24);
    for (let i = 1; i <= max; i++) {
      out.add(word.slice(0, i));
    }
  }
  return Array.from(out);
}

function openHistoryTx(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  return openDB().then((db) => {
    const tx = db.transaction(HISTORY_STORE, mode);
    return { store: tx.objectStore(HISTORY_STORE), tx };
  });
}

function openFullTx(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  return openDB().then((db) => {
    const tx = db.transaction(HISTORY_FULL_STORE, mode);
    return { store: tx.objectStore(HISTORY_FULL_STORE), tx };
  });
}

export function loadLegacySharedAPIKey(): string {
  try {
    return localStorage.getItem(LEGACY_SHARED_API_KEY) ?? "";
  } catch {
    return "";
  }
}

export function loadLegacyModeAPIKey(mode: "responses" | "images"): string {
  try {
    return localStorage.getItem(storageKey(`gptcodex.${mode}.apiKey`)) ?? "";
  } catch {
    return "";
  }
}

export function clearLegacyAPIKeys(): void {
  try {
    localStorage.removeItem(LEGACY_SHARED_API_KEY);
    localStorage.removeItem(storageKey("gptcodex.responses.apiKey"));
    localStorage.removeItem(storageKey("gptcodex.images.apiKey"));
  } catch {
    // ignore
  }
}

function stripHistoryRecord(record: HistoryRecord): HistoryItem {
  const { searchText, searchTokens, ...item } = record;
  void searchText;
  void searchTokens;
  if (item.savedPath && !item.savedPath.startsWith("memory://") && !item.imageB64) {
    return {
      ...item,
      imageId: undefined,
      previewUrl: undefined,
      fullUrl: undefined,
    };
  }
  return item;
}

export async function persistHistoryItems(items: HistoryItem[]): Promise<void> {
  if (items.length === 0) return;
  const { store, tx } = await openHistoryTx("readwrite");
  for (const item of items) {
    store.put(normalizeHistoryRecord(item));
  }
  await txDone(tx);
}

export async function persistHistoryItem(item: HistoryItem): Promise<void> {
  await persistHistoryItems([item]);
}

export async function persistHistoryFullImages(items: Array<{ id: string; imageB64: string }>): Promise<void> {
  if (items.length === 0) return;
  const { store, tx } = await openFullTx("readwrite");
  for (const item of items) {
    if (!item.id || !item.imageB64.trim()) continue;
    store.put({ id: item.id, image: base64ToBlob(item.imageB64) });
  }
  await txDone(tx);
}

export async function persistHistoryFullImage(id: string, imageB64: string): Promise<void> {
  await persistHistoryFullImages([{ id, imageB64 }]);
}

export async function loadHistoryFullImage(id: string): Promise<string> {
  const { store, tx } = await openFullTx("readonly");
  const rec = await reqAsPromise<FullRecord | undefined>(store.get(id));
  await txDone(tx);
  return rec?.image ? blobToBase64(rec.image) : "";
}

export async function pruneHistoryStorage(keepIDs: string[]): Promise<void> {
  const keep = new Set(keepIDs);
  const { store: historyStore, tx: historyTx } = await openHistoryTx("readwrite");
  const historyKeys = await reqAsPromise<IDBValidKey[]>(historyStore.getAllKeys());
  for (const id of historyKeys) {
    if (typeof id === "string" && !keep.has(id)) historyStore.delete(id);
  }
  await txDone(historyTx);

  const { store: fullStore, tx: fullTx } = await openFullTx("readwrite");
  const fullKeys = await reqAsPromise<IDBValidKey[]>(fullStore.getAllKeys());
  for (const id of fullKeys) {
    if (typeof id === "string" && !keep.has(id)) fullStore.delete(id);
  }
  await txDone(fullTx);
}

export async function removeHistoryItem(id: string): Promise<void> {
  const { store: historyStore, tx: historyTx } = await openHistoryTx("readwrite");
  historyStore.delete(id);
  await txDone(historyTx);

  const { store: fullStore, tx: fullTx } = await openFullTx("readwrite");
  fullStore.delete(id);
  await txDone(fullTx);
}

async function migrateLegacyHistoryIfNeeded(): Promise<void> {
  const [historyCount, fullCount] = await Promise.all([withHistoryCount(), withFullCount()]);
  if (historyCount > 0 && fullCount > 0) return;

  try {
    const legacy = await openLegacyDB();
    const tx = legacy.transaction(LEGACY_STORE_NAME, "readonly");
    const store = tx.objectStore(LEGACY_STORE_NAME);
    if (!store.getAll || !store.getAllKeys) return;
    const [keys, values] = await Promise.all([
      reqAsPromise<IDBValidKey[]>(store.getAllKeys()),
      reqAsPromise<HistoryRecord[]>(store.getAll()),
    ]);
    const records = keys.map((k, i) => ({ key: k, value: values[i] }));
    const historyItems = records.filter(({ key }) => typeof key === "string" && key.startsWith("history:"));
    const fullItems = records.filter(({ key }) => typeof key === "string" && key.startsWith("history-full:"));

    if (historyCount === 0 && historyItems.length > 0) {
      const { store: histStore, tx: histTx } = await openHistoryTx("readwrite");
      for (const { value } of historyItems) {
        if (!value?.id) continue;
        histStore.put(normalizeHistoryRecord(value));
      }
      await txDone(histTx);
    }

    if (fullCount === 0 && fullItems.length > 0) {
      const { store: fullStore, tx: fullTx } = await openFullTx("readwrite");
      for (const { key, value } of fullItems) {
        if (typeof key !== "string") continue;
        const id = key.slice("history-full:".length);
        if (!id || typeof value !== "string") continue;
        fullStore.put({ id, image: base64ToBlob(value) });
      }
      await txDone(fullTx);
    }
  } catch {
    // ignore migration failures; app can still run with empty new db
  }
}

async function withHistoryCount(): Promise<number> {
  const { store, tx } = await openHistoryTx("readonly");
  const count = await reqAsPromise<number>(store.count());
  await txDone(tx);
  return count;
}

async function withFullCount(): Promise<number> {
  const { store, tx } = await openFullTx("readonly");
  const count = await reqAsPromise<number>(store.count());
  await txDone(tx);
  return count;
}

export async function loadAllHistory(limit?: number): Promise<HistoryItem[]> {
  if (MIGRATE_LEGACY_HISTORY) await migrateLegacyHistoryIfNeeded();
  const { store, tx } = await openHistoryTx("readonly");
  // ★ 必须走 createdAt index,不是默认 primary key —— primary key 是 uuid
  // 字符串,逆序排列等于随机,会让历史侧栏顺序看起来抽象。createdAt index
  // direction="prev" 才是真正的「由近及远(新→旧)」。
  const cappedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : undefined;
  const items = await cursorAsPromise<HistoryRecord>(
    store.index("createdAt").openCursor(null, "prev"),
    { limit: cappedLimit, accept: () => true },
  );
  await txDone(tx);
  // 双保险:即便老数据 createdAt 字段缺失被丢到末尾,这里再用 JS sort 一道
  // 兜底,保证 UI 拿到的永远是新→旧顺序。
  const out = items.map(stripHistoryRecord);
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return out;
}

export async function loadHistoryPage(opts?: {
  cursor?: HistoryPageCursor | null;
  limit?: number;
  direction?: "newest" | "oldest";
}): Promise<HistoryPageResult> {
  if (MIGRATE_LEGACY_HISTORY) await migrateLegacyHistoryIfNeeded();
  const { store, tx } = await openHistoryTx("readonly");
  const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0
    ? Math.floor(opts.limit)
    : 24;
  const direction = opts?.direction === "oldest" ? "oldest" : "newest";
  const cursorValue = opts?.cursor?.direction === direction ? opts.cursor : null;
  const range = cursorValue
    ? direction === "newest"
      ? IDBKeyRange.upperBound([cursorValue.createdAt, cursorValue.id], true)
      : IDBKeyRange.lowerBound([cursorValue.createdAt, cursorValue.id], true)
    : null;
  const result = await new Promise<{ records: HistoryRecord[]; nextCursor: HistoryPageCursor | null }>((resolve, reject) => {
    const out: HistoryRecord[] = [];
    const req = store.index("createdAt_id").openCursor(range, direction === "newest" ? "prev" : "next");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve({ records: out, nextCursor: null });
        return;
      }
      const value = cursor.value as HistoryRecord;
      if (out.length >= limit) {
        const last = out[out.length - 1];
        resolve({
          records: out,
          nextCursor: { createdAt: last.createdAt, id: last.id, direction },
        });
        return;
      }
      out.push(value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return {
    items: result.records.map(stripHistoryRecord),
    nextCursor: result.nextCursor,
  };
}

export async function loadHistoryItemsByIds(ids: string[]): Promise<HistoryItem[]> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const { store, tx } = await openHistoryTx("readonly");
  const records = await Promise.all(
    unique.map((id) => reqAsPromise<HistoryRecord | undefined>(store.get(id))),
  );
  await txDone(tx);
  return records.filter((record): record is HistoryRecord => !!record).map(stripHistoryRecord);
}

export async function loadHistoryItemsBySavedPaths(paths: string[]): Promise<HistoryItem[]> {
  const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const { store, tx } = await openHistoryTx("readonly");
  const index = store.index("savedPath");
  const records = await Promise.all(
    unique.map((path) => reqAsPromise<HistoryRecord | undefined>(index.get(path))),
  );
  await txDone(tx);
  return records.filter((record): record is HistoryRecord => !!record).map(stripHistoryRecord);
}

async function openExistingHistoryDB(name: string): Promise<IDBDatabase | null> {
  const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  if (databases.length > 0 && !databases.some((entry) => entry.name === name)) return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function migrateHistoryFromNamespace(sourceNamespace: string): Promise<number> {
  const sourceName = `image-studio-${sourceNamespace}`;
  if (sourceName === DB_NAME) return 0;
  const sourceDB = await openExistingHistoryDB(sourceName);
  if (!sourceDB || !sourceDB.objectStoreNames.contains(HISTORY_STORE)) {
    sourceDB?.close();
    return 0;
  }
  const sourceTx = sourceDB.transaction(HISTORY_STORE, "readonly");
  const sourceRecords = await reqAsPromise<HistoryRecord[]>(sourceTx.objectStore(HISTORY_STORE).getAll());
  await txDone(sourceTx);
  sourceDB.close();
  if (sourceRecords.length === 0) return 0;

  const { store, tx } = await openHistoryTx("readwrite");
  const targetKeys = new Set((await reqAsPromise<IDBValidKey[]>(store.getAllKeys())).map(String));
  let migrated = 0;
  for (const record of sourceRecords) {
    if (!record?.id || targetKeys.has(record.id)) continue;
    store.put(normalizeHistoryRecord(stripHistoryRecord(record)));
    migrated += 1;
  }
  await txDone(tx);
  return migrated;
}

export async function loadHistoryByFilters(opts: {
  mode?: "all" | "generate" | "edit";
  from?: number;
  q?: string;
  limit?: number;
}): Promise<HistoryItem[]> {
  if (MIGRATE_LEGACY_HISTORY) await migrateLegacyHistoryIfNeeded();
  const { store, tx } = await openHistoryTx("readonly");
  const needle = opts.q?.trim().toLowerCase() ?? "";
  const from = opts.from ?? 0;
  const terms = needle ? needle.split(/\s+/).filter(Boolean) : [];
  const accept = (item: HistoryRecord): boolean => {
    if (opts.mode && opts.mode !== "all" && item.mode !== opts.mode) return false;
    if (from > 0 && item.createdAt < from) return false;
    if (needle && !item.searchText.includes(needle)) return false;
    return true;
  };

  let items: HistoryRecord[] = [];
  if (needle && terms.length > 0) {
    const candidateIDs = await collectCandidateIDs(store, terms);
    const records = await Promise.all(candidateIDs.map((id) => reqAsPromise<HistoryRecord | undefined>(store.get(id))));
    items = records.filter((v): v is HistoryRecord => !!v && accept(v));
  } else if (opts.mode && opts.mode !== "all") {
    const range = from > 0
      ? IDBKeyRange.bound([opts.mode, from], [opts.mode, Number.MAX_SAFE_INTEGER])
      : IDBKeyRange.bound([opts.mode, 0], [opts.mode, Number.MAX_SAFE_INTEGER]);
    items = await cursorAsPromise<HistoryRecord>(store.index("createdAt_mode").openCursor(range, "prev"), {
      limit: opts.limit,
      accept,
    });
  } else if (from > 0) {
    items = await cursorAsPromise<HistoryRecord>(store.index("createdAt").openCursor(IDBKeyRange.lowerBound(from), "prev"), {
      limit: opts.limit,
      accept,
    });
  } else {
    items = await cursorAsPromise<HistoryRecord>(store.openCursor(null, "prev"), {
      limit: opts.limit,
      accept,
    });
  }

  await txDone(tx);
  return items.map(stripHistoryRecord);
}

async function collectCandidateIDs(store: IDBObjectStore, terms: string[]): Promise<string[]> {
  if (terms.length === 0) return [];
  const byTerm = await Promise.all(
    terms.map((term) => reqAsPromise<HistoryRecord[]>(store.index("searchTokens").getAll(term))),
  );
  const sets = byTerm.map((items) => new Set(items.map((item) => item.id)));
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  const out: string[] = [];
  for (const id of first) {
    if (rest.every((set) => set.has(id))) out.push(id);
  }
  return out;
}
