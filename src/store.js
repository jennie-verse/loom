// store.js — IndexedDB open/migration/CRUD, localStorage settings, persist() request.
// No DOM rendering here.

import { DEFAULT_SETTINGS } from "./model.js";

const DB_NAME = "loom-db";
const DB_VERSION = 1;
const SETTINGS_KEY = "loom.settings.v1";
const HAS_DATA_KEY = "loom.hasData";
const DRAFT_KEY = "loom.draft";

const DEFAULT_TEMPLATES = [
  { id: "tpl-weekday", name: "Weekday", blocks: [] },
  { id: "tpl-weekend", name: "Weekend", blocks: [] },
];

let dbPromise = null;
let dbFailed = false;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbFailed = true;
      reject(err);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("blocks")) {
        const store = db.createObjectStore("blocks", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains("templates")) {
        db.createObjectStore("templates", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      dbFailed = false;
      const db = request.result;
      db.onversionchange = () => db.close();
      seedTemplates(db).finally(() => resolve(db));
    };
    request.onerror = () => {
      dbFailed = true;
      reject(request.error || new Error("Failed to open IndexedDB"));
    };
    request.onblocked = () => {
      // another tab holds an older version open; nothing we can do offline-only
    };
  });
  return dbPromise;
}

export function isDbFailed() {
  return dbFailed;
}

function seedTemplates(db) {
  return new Promise((resolve) => {
    const tx = db.transaction("templates", "readwrite");
    const store = tx.objectStore("templates");
    let pending = DEFAULT_TEMPLATES.length;
    if (pending === 0) { resolve(); return; }
    for (const tpl of DEFAULT_TEMPLATES) {
      const getReq = store.get(tpl.id);
      getReq.onsuccess = () => {
        if (!getReq.result) store.put(tpl);
        pending -= 1;
        if (pending === 0) resolve();
      };
      getReq.onerror = () => {
        pending -= 1;
        if (pending === 0) resolve();
      };
    }
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- blocks ----------

export async function getBlocksForDate(date) {
  const db = await openDB();
  const store = tx(db, "blocks", "readonly");
  const index = store.index("date");
  const result = await reqToPromise(index.getAll(IDBKeyRange.only(date)));
  return result || [];
}

export async function getBlockById(id) {
  const db = await openDB();
  return reqToPromise(tx(db, "blocks", "readonly").get(id));
}

// ---------- block change hook (sync.js listens here) ----------
// The legacy events hook retains its original single-block scope. Journal has
// a separate hook that also observes bulk writes and bulk deletions.

let blockChangeHook = null;
let syncBlockChangeHook = null;
let journalBlockChangeHook = null;
let hookSuppressed = false;

export function setBlockChangeHook(fn) {
  blockChangeHook = typeof fn === "function" ? fn : null;
}

/** Sync observes every block write/delete path, including bulk operations. */
export function setSyncBlockChangeHook(fn) {
  syncBlockChangeHook = typeof fn === "function" ? fn : null;
}

/** Journal observes every persisted block path, including bulk import,
    date deletion, purge, replace, and their undo paths. It stays separate
    from the legacy events hook so those events retain their original scope. */
export function setJournalBlockChangeHook(fn) {
  journalBlockChangeHook = typeof fn === "function" ? fn : null;
}

/** Runs fn with the hook off — used while applying data pulled from other
    devices, which must not be re-queued as new local events. */
export async function withoutBlockHook(fn) {
  hookSuppressed = true;
  try {
    return await fn();
  } finally {
    hookSuppressed = false;
  }
}

function notifyBlockChange(next, previous, { journalOnly = false } = {}) {
  if (hookSuppressed) return;
  if (!journalOnly && blockChangeHook) {
    try { blockChangeHook(next, previous); } catch { /* legacy events never block a local save */ }
  }
  if (syncBlockChangeHook) {
    try { syncBlockChangeHook(next, previous); } catch { /* sync never blocks a local save */ }
  }
  if (journalBlockChangeHook) {
    try { journalBlockChangeHook(next, previous); } catch { /* journal never blocks a local save */ }
  }
}

export async function putBlock(block) {
  const db = await openDB();
  let previous = null;
  try {
    previous = await reqToPromise(tx(db, "blocks", "readonly").get(block.id));
  } catch {
    previous = null;
  }
  await reqToPromise(tx(db, "blocks", "readwrite").put(block));
  markHasData(true);
  await requestPersistOnce();
  notifyBlockChange(block, previous || null);
  return block;
}

export async function bulkPutBlocks(blocks) {
  const db = await openDB();
  const previous = new Map();
  for (const block of blocks) {
    try { previous.set(block.id, await reqToPromise(tx(db, "blocks", "readonly").get(block.id))); }
    catch { previous.set(block.id, null); }
  }
  const store = tx(db, "blocks", "readwrite");
  await Promise.all(blocks.map((b) => reqToPromise(store.put(b))));
  markHasData(true);
  blocks.forEach((block) => notifyBlockChange(block, previous.get(block.id) || null, { journalOnly: true }));
  return blocks;
}

export async function deleteBlock(id) {
  const db = await openDB();
  let previous = null;
  try {
    previous = await reqToPromise(tx(db, "blocks", "readonly").get(id));
  } catch {
    previous = null;
  }
  await reqToPromise(tx(db, "blocks", "readwrite").delete(id));
  notifyBlockChange(null, previous || null);
}

export async function deleteBlocksByIds(ids) {
  const db = await openDB();
  const previous = [];
  for (const id of ids) {
    try { previous.push(await reqToPromise(tx(db, "blocks", "readonly").get(id))); }
    catch { previous.push(null); }
  }
  const store = tx(db, "blocks", "readwrite");
  await Promise.all(ids.map((id) => reqToPromise(store.delete(id))));
  previous.forEach((block) => { if (block) notifyBlockChange(null, block, { journalOnly: true }); });
}

export async function deleteBlocksForDate(date) {
  const blocks = await getBlocksForDate(date);
  await deleteBlocksByIds(blocks.map((b) => b.id));
  return blocks;
}

export async function getAllBlocks() {
  const db = await openDB();
  const result = await reqToPromise(tx(db, "blocks", "readonly").getAll());
  return result || [];
}

export async function deleteBlocksBefore(dateKeyExclusive) {
  const all = await getAllBlocks();
  const toDelete = all.filter((b) => b.date < dateKeyExclusive);
  await deleteBlocksByIds(toDelete.map((b) => b.id));
  return toDelete.length;
}

export async function clearAllBlocks() {
  const db = await openDB();
  const previous = await reqToPromise(tx(db, "blocks", "readonly").getAll()).catch(() => []);
  await reqToPromise(tx(db, "blocks", "readwrite").clear());
  previous.forEach((block) => notifyBlockChange(null, block, { journalOnly: true }));
}

export async function countBlocks() {
  const db = await openDB();
  return reqToPromise(tx(db, "blocks", "readonly").count());
}

// ---------- templates ----------

export async function getTemplates() {
  const db = await openDB();
  const result = await reqToPromise(tx(db, "templates", "readonly").getAll());
  return (result || []).sort((a, b) => {
    const aDefault = a.id.startsWith("tpl-") ? 0 : 1;
    const bDefault = b.id.startsWith("tpl-") ? 0 : 1;
    return aDefault - bDefault || a.name.localeCompare(b.name);
  });
}

export async function getTemplateById(id) {
  const db = await openDB();
  return reqToPromise(tx(db, "templates", "readonly").get(id));
}

export async function putTemplate(template) {
  const db = await openDB();
  await reqToPromise(tx(db, "templates", "readwrite").put(template));
  return template;
}

export async function deleteTemplate(id) {
  const db = await openDB();
  await reqToPromise(tx(db, "templates", "readwrite").delete(id));
}

// ---------- settings (localStorage) ----------

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    // storage unavailable/full — setting simply won't persist across reloads
  }
  return merged;
}

export function resetSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* noop */ }
  return { ...DEFAULT_SETTINGS };
}

// ---------- data-loss guard (plan §5-2) ----------

function markHasData(value) {
  try { localStorage.setItem(HAS_DATA_KEY, value ? "true" : "false"); } catch { /* noop */ }
}

export function hadDataFlag() {
  try { return localStorage.getItem(HAS_DATA_KEY) === "true"; } catch { return false; }
}

export async function checkDataLossRisk() {
  if (!hadDataFlag()) return false;
  const count = await countBlocks().catch(() => -1);
  return count === 0;
}

let persistRequested = false;
async function requestPersistOnce() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // best-effort only
  }
}

// ---------- draft (block-sheet in-progress edits, survives backgrounding) ----------

export function saveDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* noop */ }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}
