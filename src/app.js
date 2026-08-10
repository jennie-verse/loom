// app.js — application shell and wiring. Owns current date/view state and
// mounts the modules listed in the build brief. Not one of the brief's named
// files, but every module below needs a place to be instantiated and wired
// together (same role as app.js in the grove/atlas sibling apps).

import {
  todayKey, dateKey, addDays, parseDateKey, nowMinutes, dayProgress, formatDuration,
  normalizeBlock,
} from "./model.js";
import * as store from "./store.js";
import { createDayView } from "./day-view.js";
import { renderAgenda } from "./agenda-view.js";
import { openBlockSheet, isOpen as isSheetOpen, closeForBackground } from "./block-sheet.js";
import { openCalendarSheet } from "./calendar-sheet.js";
import { openTemplatesSheet, openCopyFromSheet, saveTodayAsTemplate, emptyDayTemplateChip, openApplyTemplate } from "./templates.js";
import { openSettingsSheet } from "./settings.js";
import { exportBackup, importBackup, pickImportFile, daysSinceBackup } from "./backup.js";
import { toast, undoToast, announce, actionToast, confirmDialog } from "./ui.js";
import * as syncRunner from "./sync-runner.js";

const root = document.getElementById("app-root");

const state = {
  date: todayKey(),
  view: "day", // "day" | "agenda"
  settings: null,
  blocks: [],
  dbFailed: false,
};

let dayView = null;
let els = {};

async function init() {
  buildShell();

  try {
    await store.openDB();
  } catch {
    state.dbFailed = true;
    renderErrorScreen();
    return;
  }

  state.settings = store.getSettings();
  applyDisplayVars();
  registerServiceWorker();

  // Local changes start queueing immediately, even while sync is off — turning
  // it on later should not leave the days in between looking empty.
  syncRunner.attach();

  const lostData = await store.checkDataLossRisk();
  if (lostData) {
    showBanner("Storage looks empty but data was expected — check Settings › Import to restore from a backup.");
  } else {
    await maybeShowBackupNotice();
  }

  restoreDraftIfAny();

  await loadDate(state.date, { scrollTo: "auto" });

  if (!state.settings.onboarded) showOnboarding();

  dayView.startClock(() => onClockTick());

  window.addEventListener("resize", debounce(onResize, 200));

  // Runs only when sync is enabled and a token and context exist. Failures are
  // silent: the app is fully usable offline and the queue keeps the changes.
  syncRunner.runSync().then((result) => {
    if (result && result.pulled) refreshCurrent();
  }).catch(() => { /* local storage is always the source of truth */ });
}

// --f must live on an ancestor shared by the header/now-strip/bar/sheets, not
// just the timeline grid — otherwise only day-view's own text scales.
function applyDisplayVars() {
  root.style.setProperty("--f", state.settings.font + "px");
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- shell ----------

function buildShell() {
  root.replaceChildren();
  const app = document.createElement("div");
  app.className = "app";

  const hdr = document.createElement("header");
  hdr.className = "hdr";
  const prevBtn = iconButton("‹", "Previous day");
  const dateBtn = document.createElement("button");
  dateBtn.type = "button";
  dateBtn.className = "hdr-date";
  const stat = document.createElement("span");
  stat.className = "hdr-stat";
  const nextBtn = iconButton("›", "Next day");
  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "hdr-today";
  todayBtn.textContent = "Today";
  hdr.append(prevBtn, dateBtn, stat, nextBtn, todayBtn);

  const notice = document.createElement("div");
  notice.className = "notice hidden";
  const noticeText = document.createElement("span");
  const noticeDismiss = document.createElement("button");
  noticeDismiss.type = "button";
  noticeDismiss.textContent = "Dismiss";
  notice.append(noticeText, noticeDismiss);

  const now = document.createElement("button");
  now.type = "button";
  now.className = "now";

  const scroll = document.createElement("main");
  scroll.className = "scroll";
  scroll.id = "scroll";
  const grid = document.createElement("div");
  grid.className = "grid";
  scroll.appendChild(grid);

  const agendaList = document.createElement("ul");
  agendaList.className = "agenda-list hidden";

  const bar = document.createElement("nav");
  bar.className = "bar";
  const addBtn = barButton("＋", "Add", "Add block");
  const agendaBtn = barButton("▤", "Agenda", "Switch to Agenda view");
  const moreBtn = barButton("⋯", "More", "More options");
  addBtn.classList.add("primary");
  bar.append(addBtn, agendaBtn, moreBtn);

  app.append(hdr, notice, now, scroll, agendaList, bar);
  root.appendChild(app);

  els = { prevBtn, dateBtn, stat, nextBtn, todayBtn, notice, noticeText, noticeDismiss, now, scroll, grid, agendaList, addBtn, agendaBtn, moreBtn };

  prevBtn.addEventListener("click", () => navigateDate(-1));
  nextBtn.addEventListener("click", () => navigateDate(1));
  todayBtn.addEventListener("click", () => loadDate(todayKey(), { scrollTo: "now" }));
  dateBtn.addEventListener("click", openDatePicker);
  noticeDismiss.addEventListener("click", () => els.notice.classList.add("hidden"));
  addBtn.addEventListener("click", () => openCreateSheet());
  agendaBtn.addEventListener("click", () => setView(state.view === "day" ? "agenda" : "day"));
  moreBtn.addEventListener("click", () => openMoreSheet());

  dayView = createDayView({
    scrollEl: scroll,
    gridEl: grid,
    handlers: {
      onCreate: ({ date, start, duration }) => openCreateSheet({ date, start, duration }),
      onEdit: (block) => openEditSheet(block),
      onMoveResize: (updated, announceDone) => moveOrResize(updated, announceDone),
      onDeleteWithUndo: (block) => deleteWithUndo(block),
      onDuplicate: (block) => duplicateBlock(block),
      onApplyTemplateChip: (templateId) => openApplyTemplate(templateId, state.date, () => refreshCurrent()),
      onSwipe: (dir) => navigateDate(dir),
    },
  });
}

function iconButton(glyph, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ico";
  b.setAttribute("aria-label", label);
  b.textContent = glyph;
  return b;
}

function barButton(glyph, label, ariaLabel) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", ariaLabel);
  const g = document.createElement("span");
  g.className = "gly";
  g.textContent = glyph;
  const t = document.createElement("span");
  t.textContent = label;
  b.append(g, t);
  return b;
}

// ---------- data loading ----------

async function loadDate(date, { scrollTo = null } = {}) {
  state.date = date;
  const [blocks, emptyChip] = await Promise.all([
    store.getBlocksForDate(date),
    store.getBlocksForDate(date).then((b) => (b.length === 0 ? emptyDayTemplateChip(date) : null)),
  ]);
  state.blocks = blocks;
  renderHeader();
  renderNowStrip();
  const isToday = date === todayKey();
  dayView.render({ date, blocks, settings: state.settings, isToday, emptyTemplateChip: emptyChip });
  if (state.view === "agenda") renderAgendaView();

  if (scrollTo === "now" || (scrollTo === "auto" && isToday)) {
    dayView.scrollToMinute(isToday ? nowMinutes() : state.settings.defaultScrollHour * 60);
  } else if (scrollTo === "auto") {
    dayView.scrollToMinute(state.settings.defaultScrollHour * 60);
  }
}

async function refreshCurrent(scrollTo = null) {
  await loadDate(state.date, { scrollTo });
}

function renderHeader() {
  const d = parseDateKey(state.date);
  els.dateBtn.textContent = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " ▾";
  const { done, total, totalMin } = dayProgress(state.blocks);
  els.stat.textContent = total === 0 ? "" : `${done}/${total} · ${formatDuration(totalMin)}`;
}

function renderNowStrip() {
  dayView.renderNowNext(els.now, {
    date: state.date,
    blocks: state.blocks,
    isToday: state.date === todayKey(),
    onTap: () => dayView.scrollToMinute(nowMinutes()),
  });
}

function setView(view) {
  state.view = view;
  const isAgenda = view === "agenda";
  els.scroll.classList.toggle("hidden", isAgenda);
  els.agendaList.classList.toggle("hidden", !isAgenda);
  els.agendaBtn.setAttribute("aria-pressed", String(isAgenda));
  if (isAgenda) renderAgendaView();
}

function renderAgendaView() {
  renderAgenda(els.agendaList, {
    blocks: state.blocks,
    handlers: {
      onEdit: (block) => openEditSheet(block),
      onToggleDone: (block) => toggleDone(block),
      onDelete: (block) => deleteWithUndo(block),
      onDuplicate: (block) => duplicateBlock(block),
    },
  });
}

function navigateDate(delta) {
  loadDate(addDays(state.date, delta), { scrollTo: "auto" });
}

// ---------- block CRUD wiring ----------

function openCreateSheet({ date = state.date, start = defaultCreateStart(), duration = 30 } = {}) {
  if (state.dbFailed) { toast("Storage unavailable — can't add blocks right now"); return; }
  openBlockSheet({ date, start, duration, settings: state.settings, onSaved: () => refreshCurrent() });
}

function defaultCreateStart() {
  const n = nowMinutes();
  return Math.min(1410, Math.max(0, Math.round(n / state.settings.snap) * state.settings.snap));
}

function openEditSheet(block) {
  if (state.dbFailed) { toast("Storage unavailable — can't edit blocks right now"); return; }
  openBlockSheet({
    date: state.date, block, settings: state.settings,
    onSaved: () => refreshCurrent(),
    onDeleted: (b) => deleteWithUndo(b),
  });
}

async function moveOrResize(updated, announceDone) {
  const prev = state.blocks.find((b) => b.id === updated.id);
  if (!prev) return;
  const saved = normalizeBlock({ ...prev, ...updated });
  await store.putBlock(saved);
  await refreshCurrent();
  if (announceDone) announceDone();
  const moved = saved.start !== prev.start;
  const label = moved ? "Moved" : "Resized";
  undoToast(`${label} ${saved.title}`, {
    onUndo: async () => { await store.putBlock(prev); await refreshCurrent(); },
  });
}

async function toggleDone(block) {
  const saved = normalizeBlock({ ...block, done: !block.done });
  await store.putBlock(saved);
  await refreshCurrent();
}

async function deleteWithUndo(block) {
  await store.deleteBlock(block.id);
  await refreshCurrent();
  undoToast(`Deleted ${block.title}`, {
    onUndo: async () => { await store.putBlock(block); await refreshCurrent(); },
  });
}

async function duplicateBlock(block) {
  const copy = normalizeBlock({ ...block, id: undefined, done: false });
  await store.putBlock(copy);
  await refreshCurrent();
  toast(`Duplicated "${block.title}"`);
}

// ---------- date picker ----------

function openDatePicker() {
  openCalendarSheet({
    selectedDate: state.date,
    weekStart: state.settings.weekStart,
    onPick: (date) => loadDate(date, { scrollTo: "auto" }),
  });
}

// ---------- More sheet ----------

function openMoreSheet() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "More");
  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = "More";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "ico"; closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  header.append(h2, closeBtn);
  const body = document.createElement("div");
  body.className = "sheet-body";

  const items = [
    ["Templates", () => { close(); openTemplatesSheet({ date: state.date, onApplied: () => refreshCurrent() }); }],
    ["Copy from…", () => { close(); openCopyFromSheet({ date: state.date, weekStart: state.settings.weekStart, onApplied: () => refreshCurrent() }); }],
    ["Save today as template", () => { close(); saveTodayAsTemplate(state.date, state.blocks); }],
    ["Clear today", () => { close(); clearToday(); }],
    ["Export JSON", () => { close(); exportBackup(); }],
    ["Import JSON", async () => { close(); const f = await pickImportFile(); if (f) importBackup(f, { onDone: () => refreshCurrent() }); }],
    ["Settings", () => { close(); openSettingsSheet({ onChanged: (s) => { state.settings = s; applyDisplayVars(); refreshCurrent(); } }); }],
  ];
  for (const [label, action] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.style.width = "100%";
    b.style.marginBottom = "8px";
    b.style.textAlign = "left";
    b.textContent = label;
    b.addEventListener("click", action);
    body.appendChild(b);
  }

  sheet.append(header, body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  document.getElementById("sheet-host").appendChild(overlay);
  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}

async function clearToday() {
  if (state.blocks.length === 0) { toast("Today is already empty"); return; }
  const ok = await confirmDialog({ title: "Clear today?", message: `All ${state.blocks.length} blocks on this day will be removed.`, confirmLabel: "Clear", danger: true });
  if (!ok) return;
  const snapshot = state.blocks.slice();
  await store.deleteBlocksForDate(state.date);
  await refreshCurrent();
  undoToast(`Cleared ${snapshot.length} blocks`, {
    onUndo: async () => { await store.bulkPutBlocks(snapshot); await refreshCurrent(); },
  });
}

// ---------- onboarding / empty / error states ----------

function showOnboarding() {
  const card = document.createElement("div");
  card.className = "onboard";
  const lines = ["Tap any hour to add a block", "Drag a block to move it", "Everything stays on this device"];
  for (const l of lines) {
    const p = document.createElement("p");
    p.textContent = l;
    card.appendChild(p);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const setupBtn = document.createElement("button");
  setupBtn.type = "button"; setupBtn.className = "btn primary"; setupBtn.textContent = "Set up a Weekday template";
  const startBtn = document.createElement("button");
  startBtn.type = "button"; startBtn.className = "btn ghost"; startBtn.textContent = "Start empty";
  actions.append(setupBtn, startBtn);
  card.appendChild(actions);
  els.grid.appendChild(card);

  function dismiss() {
    if (card.parentNode) card.parentNode.removeChild(card);
    state.settings = store.setSettings({ onboarded: true });
  }
  setupBtn.addEventListener("click", async () => {
    dismiss();
    const { openTemplateEditor } = await import("./templates.js");
    const tpl = await store.getTemplateById("tpl-weekday");
    openTemplateEditor(tpl, { onSaved: () => refreshCurrent() });
  });
  startBtn.addEventListener("click", dismiss);
}

function renderErrorScreen() {
  root.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "app";
  const err = document.createElement("div");
  err.className = "err-state";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Storage unavailable";
  const desc = document.createElement("div");
  desc.className = "desc";
  desc.textContent = "Your data is safe but cannot be loaded right now. New blocks can't be saved until this is resolved.";
  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  const retryBtn = document.createElement("button");
  retryBtn.type = "button"; retryBtn.className = "btn primary"; retryBtn.textContent = "Retry";
  retryBtn.addEventListener("click", () => window.location.reload());
  const diagBtn = document.createElement("button");
  diagBtn.type = "button"; diagBtn.className = "btn"; diagBtn.textContent = "Export diagnostics";
  diagBtn.addEventListener("click", exportDiagnostics);
  actions.append(retryBtn, diagBtn);
  err.append(title, desc, actions);
  wrap.appendChild(err);
  root.appendChild(wrap);
}

function exportDiagnostics() {
  const info = {
    userAgent: navigator.userAgent,
    time: new Date().toISOString(),
    hasIndexedDB: typeof indexedDB !== "undefined",
    storageEstimate: null,
  };
  const blob = new Blob([JSON.stringify(info, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "loom-diagnostics.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function showBanner(message) {
  els.noticeText.textContent = message;
  els.notice.classList.remove("hidden");
}

async function maybeShowBackupNotice() {
  // Nothing saved yet means nothing to lose — a fresh install should not open on a
  // warning. Only nag once there are blocks worth exporting.
  if ((await store.countBlocks()) === 0) return;

  const days = daysSinceBackup(state.settings.lastBackupAt);
  if (days >= 30) {
    showBanner(`It's been ${days === Infinity ? "a while" : days + " days"} since your last backup — export one from Settings.`);
  }
}

// ---------- draft restore ----------

function restoreDraftIfAny() {
  const draft = store.loadDraft();
  if (!draft) return;
  store.clearDraft();
  // Reopening exactly where the user left off: re-open the sheet pre-filled.
  if (draft.mode === "edit") {
    store.getBlockById(draft.id).then((block) => {
      if (!block) return;
      openBlockSheet({
        date: draft.date, block: { ...block, title: draft.title, subtitle: draft.subtitle, note: draft.note, detail: draft.detail, start: draft.start, duration: draft.duration, color: draft.color, done: draft.done },
        settings: state.settings, onSaved: () => refreshCurrent(),
      });
    });
  } else {
    openBlockSheet({ date: draft.date, settings: state.settings, onSaved: () => refreshCurrent() });
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && isSheetOpen()) closeForBackground();
});

// ---------- clock / midnight rollover ----------

function onClockTick() {
  const today = todayKey();
  const wasToday = state.date === today || state._lastToday === undefined;
  if (state._lastToday && state._lastToday !== today && state.date === state._lastToday) {
    // midnight passed while viewing "today" — follow it forward
    toast("A new day has started");
    loadDate(today, { scrollTo: "now" });
  } else {
    renderNowStrip();
    dayView.render({ date: state.date, blocks: state.blocks, settings: state.settings, isToday: state.date === today });
  }
  state._lastToday = today;
}

// ---------- resize / rotation ----------

function onResize() {
  const minute = dayView.minuteAtScrollCenter();
  if (minute != null) dayView.scrollToMinute(minute);
}

// ---------- service worker ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          announceUpdate(reg);
        }
      });
    });
  }).catch(() => { /* offline-first app still works without SW */ });
}

function announceUpdate(reg) {
  if (isSheetOpen()) {
    const retry = () => { if (isSheetOpen()) setTimeout(retry, 2000); else showUpdateToast(reg); };
    setTimeout(retry, 2000);
    return;
  }
  showUpdateToast(reg);
}

function showUpdateToast(reg) {
  actionToast("New version available", {
    actionLabel: "Reload",
    onAction: () => { if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" }); },
  });
}

init();
