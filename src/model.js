// model.js — shape validation, length clamping, overlap-column layout, display-tier判定.
// No DOM access, no storage access.

export const LIMITS = {
  title: 60,
  subtitle: 60,
  note: 200,
  detail: 2000,
};

export const COLORS = [
  { key: "rose", name: "Rose" },
  { key: "sky", name: "Sky" },
  { key: "green", name: "Green" },
  { key: "yellow", name: "Yellow" },
  { key: "lav", name: "Lavender" },
  { key: "orange", name: "Orange" },
];
const COLOR_KEYS = new Set(COLORS.map((c) => c.key));

export const DURATION_CHIPS = [15, 30, 45, 60, 90, 120];
export const FONT_STEPS = [6, 8, 10, 12, 14, 17];
export const HOUR_STEPS = [48, 64, 80, 96, 120];
export const SNAP_STEPS = [5, 10, 15, 30];

// Start-time presets shown on the block editor (minutes since midnight).
export const START_PRESET_DEFAULTS = [420, 480, 540, 600, 780, 840, 1140, 1260]; // 07:00 08:00 09:00 10:00 13:00 14:00 19:00 21:00
export const MAX_START_PRESETS = 12;
export const START_NUDGES = [
  { label: "-1h", minutes: -60 },
  { label: "-10m", minutes: -10 },
  { label: "+10m", minutes: 10 },
  { label: "+1h", minutes: 60 },
];

export const DEFAULT_SETTINGS = {
  font: 12,
  hourHeight: 80,
  snap: 5,
  defaultScrollHour: 7,
  collapseNight: true,
  weekStart: 0, // 0 = Sunday
  onboarded: false,
  lastBackupAt: null,
  startPresets: START_PRESET_DEFAULTS,
};

export const MINUTES_PER_DAY = 1440;

// ---------- text helpers ----------

export function clampText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

export function hhmm(min) {
  min = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60);
}

export function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || "").trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 24 || mi < 0 || mi > 59) return null;
  const total = h * 60 + mi;
  return total > MINUTES_PER_DAY ? null : total;
}

export function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function addDays(key, delta) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}

export function todayKey() {
  return dateKey(new Date());
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function weekdayName(key) {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[parseDateKey(key).getDay()];
}

export function isWeekend(key) {
  const day = parseDateKey(key).getDay();
  return day === 0 || day === 6;
}

// ---------- snapping ----------

export function snapMinutes(min, unit) {
  const snapped = Math.round(min / unit) * unit;
  return Math.max(0, Math.min(MINUTES_PER_DAY, snapped));
}

// Moves a block's start by deltaMinutes while keeping its duration fixed,
// clamped to the day — same clamp day-view.js uses when dragging a block.
export function moveStartKeepingDuration(start, duration, deltaMinutes) {
  return Math.max(0, Math.min(MINUTES_PER_DAY - duration, start + deltaMinutes));
}

export function sanitizeStartPresets(list) {
  const seen = new Set();
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MINUTES_PER_DAY || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_START_PRESETS) break;
  }
  return out.sort((a, b) => a - b);
}

// ---------- validation ----------

export function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Normalizes and validates a block draft. Throws { field, message } on hard failure.
export function normalizeBlock(draft) {
  const title = clampText(draft.title, LIMITS.title);
  if (!title) throw { field: "title", message: "Title is required." };

  let start = Math.round(Number(draft.start));
  let duration = Math.round(Number(draft.duration));
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(duration) || duration < 5) duration = 5;
  if (start > MINUTES_PER_DAY - 5) start = MINUTES_PER_DAY - 5;
  if (start + duration > MINUTES_PER_DAY) duration = MINUTES_PER_DAY - start;

  const color = COLOR_KEYS.has(draft.color) ? draft.color : "rose";

  return {
    id: draft.id || makeId(),
    date: draft.date,
    start,
    duration,
    title,
    subtitle: clampText(draft.subtitle, LIMITS.subtitle),
    note: clampText(draft.note, LIMITS.note),
    detail: clampText(draft.detail, LIMITS.detail),
    color,
    done: !!draft.done,
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeTemplateBlock(draft) {
  const title = clampText(draft.title, LIMITS.title);
  if (!title) throw { field: "title", message: "Title is required." };
  let start = Math.round(Number(draft.start));
  let duration = Math.round(Number(draft.duration));
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(duration) || duration < 5) duration = 5;
  if (start + duration > MINUTES_PER_DAY) duration = MINUTES_PER_DAY - start;
  const color = COLOR_KEYS.has(draft.color) ? draft.color : "rose";
  return {
    start, duration, title,
    subtitle: clampText(draft.subtitle, LIMITS.subtitle),
    note: clampText(draft.note, LIMITS.note),
    detail: clampText(draft.detail, LIMITS.detail),
    color,
  };
}

// ---------- display tier (plan §2-3 / brief §0-1) ----------

export const TIERS = { MICRO: "micro", COMPACT: "compact", STANDARD: "standard", FULL: "full", FULL_PLUS: "full+" };

export function tierOf(heightPx, fontPx) {
  if (heightPx < 1.8 * fontPx) return TIERS.MICRO;
  if (heightPx < 3.0 * fontPx) return TIERS.COMPACT;
  if (heightPx < 4.2 * fontPx) return TIERS.STANDARD;
  if (heightPx < 6.4 * fontPx) return TIERS.FULL;
  return TIERS.FULL_PLUS;
}

export function effectiveHourHeight(selectedPx, fontPx) {
  return Math.max(selectedPx, 2.5 * fontPx);
}

// ---------- overlap layout ----------
// Assigns {col, of, clusterId} to each block for a single day using a sweep
// algorithm (interval-graph greedy coloring). Columns beyond the 3rd are
// folded into a "+N" overflow attached to the nearest visible column.
// Returns { layout: Map<id,{col,of,clusterId}>, clusters: Map<clusterId, block[]>, overflow: Map<id (visible anchor), {count, clusterId}> }

export function computeOverlapLayout(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const layout = new Map();
  const clusters = new Map();
  let clusterId = -1;
  let active = []; // { id, end, col }
  let columnsInCluster = 0;

  function closeCluster() {
    if (clusterId < 0) return;
    const of = Math.min(Math.max(columnsInCluster, 1), 3);
    const members = clusters.get(clusterId) || [];
    for (const b of members) {
      const entry = layout.get(b.id);
      entry.of = of;
    }
  }

  for (const b of sorted) {
    active = active.filter((a) => a.end > b.start);
    if (active.length === 0) {
      closeCluster();
      clusterId += 1;
      columnsInCluster = 0;
      clusters.set(clusterId, []);
    }
    const usedCols = new Set(active.map((a) => a.col));
    let col = 0;
    while (usedCols.has(col)) col += 1;
    active.push({ id: b.id, end: b.start + b.duration, col });
    columnsInCluster = Math.max(columnsInCluster, col + 1);
    layout.set(b.id, { col, of: 1, clusterId });
    clusters.get(clusterId).push(b);
  }
  closeCluster();

  // Fold columns >= 3 into overflow attached to the block in col 2 that
  // overlaps them most within the same cluster.
  const overflow = new Map(); // anchorId -> { count, clusterId, members: block[] }
  for (const [id, entry] of layout) {
    if (entry.col < 3) continue;
    const block = blocks.find((x) => x.id === id);
    const clusterMembers = clusters.get(entry.clusterId);
    let anchor = null;
    let bestOverlap = -1;
    for (const cand of clusterMembers) {
      const candEntry = layout.get(cand.id);
      if (candEntry.col !== 2) continue;
      const overlap = Math.min(block.start + block.duration, cand.start + cand.duration) - Math.max(block.start, cand.start);
      if (overlap > bestOverlap) { bestOverlap = overlap; anchor = cand; }
    }
    if (!anchor) {
      // no col-2 member in this cluster (shouldn't happen if columnsInCluster>=3), fall back to any member
      anchor = clusterMembers.find((m) => layout.get(m.id).col < 3) || clusterMembers[0];
    }
    entry.col = -1; // mark hidden
    entry.of = 1;
    const cur = overflow.get(anchor.id) || { count: 0, clusterId: entry.clusterId, members: [] };
    cur.count += 1;
    cur.members.push(block);
    overflow.set(anchor.id, cur);
  }

  return { layout, clusters, overflow };
}

export function clusterMembersFor(clusters, clusterId) {
  return (clusters.get(clusterId) || []).slice().sort((a, b) => a.start - b.start);
}

// ---------- progress ----------

export function dayProgress(blocks) {
  const done = blocks.filter((b) => b.done).length;
  const totalMin = blocks.reduce((sum, b) => sum + b.duration, 0);
  return { done, total: blocks.length, totalMin };
}

export function formatDuration(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return m + "m";
  return h + "h" + (m ? pad2(m) + "m" : "");
}

// ---------- now & next ----------

export function findNowNext(blocks, nowMin) {
  const inProgress = blocks
    .filter((b) => nowMin >= b.start && nowMin < b.start + b.duration)
    .sort((a, b) => a.start - b.start);
  const now = inProgress[0] || null;
  const extra = Math.max(0, inProgress.length - 1);
  const next = blocks
    .filter((b) => b.start > nowMin)
    .sort((a, b) => a.start - b.start)[0] || null;
  return { now, next, extra };
}
