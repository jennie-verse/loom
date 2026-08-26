import * as store from "./store.js";
import * as sync from "./sync.js";
import { blockActivityRecord, blockToJournalRecord, localIso } from "./journal-record.js";

const ENABLED_KEY = "loom.journalEnabled.v1";
const CONTENT_KEY = "loom.journalContent.v1";
const ACTIVITY_KEY = "loom.journalActivity.v1";
const HOSTNAME = globalThis.location?.hostname || "";
const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io")
    ? HOSTNAME.slice(0, -".github.io".length)
    : "",
  repo: "webapp-data",
  branch: "main",
});
let clientPromise = null;
let listener = null;
let lastState = { status: "not reported", pendingCount: 0, errorCode: "" };

function readItem(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function writeItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
}

function publish(patch) {
  lastState = { ...lastState, ...patch };
  if (listener) {
    try { listener({ enabled: isJournalEnabled(), ...lastState }); } catch { /* UI only */ }
  }
}

function safeCode(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code)
    ? error.code
    : fallback;
}

export function isJournalEnabled() {
  return readItem(ENABLED_KEY) === "1";
}

export function setJournalEnabled(enabled) {
  writeItem(ENABLED_KEY, enabled ? "1" : "0");
}
export function isJournalContentEnabled() { return readItem(CONTENT_KEY) !== "0"; }
export async function setJournalContentEnabled(enabled) {
  writeItem(CONTENT_KEY, enabled ? "1" : "0");
  const client = await getClient();
  if (client && !enabled) await client.transformPending((record) => ({ ...record, title: "Loom block", updatedAt: localIso(), data: Object.fromEntries(Object.entries({ ...record.data, contentIncluded: false }).filter(([key]) => !["title", "subtitle", "note", "detail"].includes(key))) }));
  await reportJournalStatus();
}

export function getJournalState() {
  return { enabled: isJournalEnabled(), ...lastState };
}

export function onJournalState(fn) {
  listener = typeof fn === "function" ? fn : null;
  if (listener) publish({});
  return () => { if (listener === fn) listener = null; };
}

async function getClient() {
  if (clientPromise) {
    const existing = await clientPromise;
    if (existing) return existing;
    clientPromise = null;
  }
  clientPromise = (async () => {
    const context = sync.getContextId();
    if (!context) return null;
    const module = await import("../../shared/v2/journal.js");
    return module.createJournalClient({
      app: "loom",
      context,
      namespace: "loom-journal",
      isEnabled: isJournalEnabled,
      resolveConfig: async () => {
        const token = sync.getToken();
        if (!token) throw Object.assign(new Error("Journal authentication unavailable"), { type: "auth", code: "AUTH" });
        return { ...REPO, token };
      },
      onState: (state) => publish({
        status: state.status,
        pendingCount: state.pendingCount,
        errorCode: state.errorCode || "",
      }),
    });
  })().catch(() => null);
  return clientPromise;
}

async function queueBlockChange(next, previous) {
  const source = next || previous;
  if (!source) return;
  const entry = recordLocalActivity(next, previous);
  if (!isJournalEnabled()) return;
  const client = await getClient();
  if (!client) {
    publish({ status: "error", errorCode: "MODULE_UNAVAILABLE" });
    return;
  }
  try {
    if (!next) {
      await client.enqueue(blockToJournalRecord(previous, { deleted: true, updatedAt: new Date(), includeContent: isJournalContentEnabled() }), {
        date: previous.date,
      });
      const module = await import("../../shared/v2/journal.js");
      if (!module.JOURNAL_KINDS?.loom?.includes("block-activity")) { publish({ status: "error", errorCode: "CONTRACT_STALE" }); return; }
      await client.enqueue(blockActivityRecord(entry, previous, { includeContent: isJournalContentEnabled() }), { date: entry.date });
      return;
    }
    await client.enqueue(blockToJournalRecord(next, { includeContent: isJournalContentEnabled() }), {
      date: next.date,
      previousDate: previous && previous.date !== next.date ? previous.date : undefined,
    });
    const module = await import("../../shared/v2/journal.js");
    if (!module.JOURNAL_KINDS?.loom?.includes("block-activity")) { publish({ status: "error", errorCode: "CONTRACT_STALE" }); return; }
    await client.enqueue(blockActivityRecord(entry, next || previous, { includeContent: isJournalContentEnabled() }), { date: entry.date });
  } catch (error) {
    publish({ status: "error", errorCode: safeCode(error, "QUEUE_FAILED") });
  }
}
function readActivity() { try { const value = JSON.parse(readItem(ACTIVITY_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
function inferAction(next, previous) { if (!previous) return "created"; if (!next) return "deleted"; if (next.date !== previous.date) return "moved"; if (next.done !== previous.done) return next.done ? "completed" : "reopened"; return "edited"; }
function recordLocalActivity(next, previous) {
  const block = next || previous; const at = localIso(); const date = at.slice(0, 10); const key = `${date}:${block.id}`; const entries = readActivity(); const current = entries[key]; const action = inferAction(next, previous);
  entries[key] = { date, blockId: block.id, title: String(block.title || ""), sourceDate: next?.date || previous?.date, previousSourceDate: previous && next && previous.date !== next.date ? previous.date : undefined, actions: [...new Set([...(current?.actions || []), action])], firstAt: current?.firstAt || at, lastAt: at };
  const cutoff = Date.now() - 90 * 86400000; Object.keys(entries).forEach(id => { if (Date.parse(entries[id].lastAt) < cutoff) delete entries[id]; }); writeItem(ACTIVITY_KEY, JSON.stringify(entries)); return entries[key];
}

export function attachJournal() {
  store.setJournalBlockChangeHook((next, previous) => {
    queueBlockChange(next, previous).catch(() => publish({ status: "error", errorCode: "QUEUE_FAILED" }));
  });
}

export async function toggleJournal(enabled, preferredName = "") {
  if (enabled) {
    if (!sync.getToken()) return { ok: false, reason: "token" };
    if (!sync.getContextId()) await sync.ensureContext(preferredName);
    if (!sync.getContextId()) return { ok: false, reason: "context" };
  }
  clientPromise = null;
  setJournalEnabled(enabled);
  publish({ status: enabled ? "ready" : "disabled", errorCode: "" });
  await reportJournalStatus({ enabledAt: enabled ? localIso() : undefined });
  return { ok: true };
}

export async function reportJournalStatus(extra = {}) {
  const client = await getClient();
  if (!client) return false;
  try {
    await client.reportStatus({ journalEnabled: isJournalEnabled(), contentIncluded: isJournalContentEnabled(), ...extra });
    return true;
  } catch (error) {
    publish({ status: "error", errorCode: safeCode(error, "STATUS_FAILED") });
    return false;
  }
}

export async function backfillJournal(blocks, { from, to, totalDates }) {
  const client = await getClient();
  if (!client) return { written: 0, error: new Error("Journal unavailable") };
  await reportJournalStatus({ backfill: {
    status: "running", from, to, processedDates: 0, totalDates, updatedAt: localIso(),
  } });
  for (const block of blocks) {
    try { await client.enqueue(blockToJournalRecord(block, { includeContent: isJournalContentEnabled() }), { date: block.date }); }
    catch { /* one invalid imported block must not stop the rest */ }
  }
  const result = await client.flush();
  await reportJournalStatus({ backfill: {
    status: result.error ? "partial" : "complete", from, to,
    processedDates: result.error ? 0 : totalDates, totalDates, updatedAt: localIso(),
  } });
  return result;
}

export async function refreshJournalState() {
  const client = await getClient();
  if (client) {
    try { publish({ pendingCount: await client.pendingCount() }); } catch { /* retain safe count */ }
  }
  return getJournalState();
}
