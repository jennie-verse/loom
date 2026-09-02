// settings.js — settings screen: font size, hour height, snap unit, defaults,
// backup/restore entry points, purge old data, full reset.

import { FONT_STEPS, HOUR_STEPS, SNAP_STEPS, DEFAULT_SETTINGS, START_PRESET_DEFAULTS, MAX_START_PRESETS, sanitizeStartPresets, hhmm, parseHHMM, todayKey } from "./model.js";
import * as store from "./store.js";
import { exportBackup, importBackup, pickImportFile, daysSinceBackup } from "./backup.js";
import { confirmDialog, undoToast, toast } from "./ui.js";
import * as sync from "./sync.js";
import * as syncRunner from "./sync-runner.js";
import * as journal from "./journal.js";
import { APP_BUILD } from "./version.js";

/* ── Sync section ────────────────────────────────────────────────────────
   Sync is off until it is switched on here, and the app is fully usable while
   it stays off. Two rules are load-bearing:

   1. The device name is asked for BEFORE sync is switched on. The context id is
      fixed at creation and goes into the remote file names, so a name added
      afterwards would only change the label — the files would stay
      `context-3f2a1b9c`. Only a–z and 0–9 survive into the id.
   2. Ordinary uploads never shrink remote data accidentally. Intentional block
      deletions are represented by durable tombstones and applied on every device.
   ────────────────────────────────────────────────────────────────────── */

function buildSyncSection(sec) {
  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  sec.appendChild(status);

  // --- device name ---
  const nameRow = document.createElement("div");
  nameRow.className = "settings-row";
  nameRow.style.flexDirection = "column";
  nameRow.style.alignItems = "stretch";
  const nameLbl = document.createElement("label");
  nameLbl.className = "lbl";
  nameLbl.textContent = "Device name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.autocapitalize = "none";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.placeholder = "iphone-home";
  nameInput.style.marginTop = "6px";
  nameLbl.htmlFor = nameInput.id = "sync-device-name";
  const nameHint = document.createElement("p");
  nameHint.className = "hint";
  nameHint.textContent = "Use English letters and numbers — the file name is built from this and cannot be changed later.";
  nameRow.append(nameLbl, nameInput, nameHint);
  sec.appendChild(nameRow);

  // --- token ---
  const tokenRow = document.createElement("div");
  tokenRow.className = "settings-row";
  tokenRow.style.flexDirection = "column";
  tokenRow.style.alignItems = "stretch";
  const tokenLbl = document.createElement("label");
  tokenLbl.className = "lbl";
  tokenLbl.textContent = "Access token";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocapitalize = "none";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.placeholder = "github_pat_…";
  tokenInput.style.marginTop = "6px";
  tokenLbl.htmlFor = tokenInput.id = "sync-token";
  const tokenBtns = document.createElement("div");
  tokenBtns.style.display = "flex";
  tokenBtns.style.gap = "8px";
  tokenBtns.style.marginTop = "8px";
  const saveTokenBtn = document.createElement("button");
  saveTokenBtn.type = "button"; saveTokenBtn.className = "btn"; saveTokenBtn.style.flex = "1"; saveTokenBtn.textContent = "Save token";
  const clearTokenBtn = document.createElement("button");
  clearTokenBtn.type = "button"; clearTokenBtn.className = "btn"; clearTokenBtn.style.flex = "1"; clearTokenBtn.textContent = "Clear token";
  tokenBtns.append(saveTokenBtn, clearTokenBtn);
  tokenRow.append(tokenLbl, tokenInput, tokenBtns);
  sec.appendChild(tokenRow);

  // --- enable switch ---
  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  const enableLbl = document.createElement("div");
  enableLbl.className = "lbl";
  enableLbl.textContent = "Sync with GitHub";
  const enableSwitch = document.createElement("button");
  enableSwitch.type = "button";
  enableSwitch.className = "switch";
  enableSwitch.setAttribute("role", "switch");
  enableRow.append(enableLbl, enableSwitch);
  sec.appendChild(enableRow);

  // --- actions ---
  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.gap = "8px";
  actionRow.style.marginTop = "8px";
  const syncNowBtn = document.createElement("button");
  syncNowBtn.type = "button"; syncNowBtn.className = "btn"; syncNowBtn.style.flex = "1"; syncNowBtn.textContent = "Sync now";
  const remoteBackupBtn = document.createElement("button");
  remoteBackupBtn.type = "button"; remoteBackupBtn.className = "btn"; remoteBackupBtn.style.flex = "1"; remoteBackupBtn.textContent = "Back up to GitHub";
  actionRow.append(syncNowBtn, remoteBackupBtn);
  sec.appendChild(actionRow);

  const warn = document.createElement("p");
  warn.className = "hint";
  warn.textContent = "Deleted blocks sync to your other devices the next time each device connects.";
  sec.appendChild(warn);

  function fmtWhen(ms) {
    if (!ms) return "never";
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
  }

  function refresh(message) {
    const on = sync.isEnabled();
    const hint = sync.tokenHint();
    enableSwitch.setAttribute("aria-checked", String(on));
    tokenInput.placeholder = hint || "github_pat_…";
    nameInput.disabled = Boolean(sync.getContextId());
    nameInput.value = sync.getContextLabel() || nameInput.value;
    syncNowBtn.disabled = !sync.isReady();
    remoteBackupBtn.disabled = !sync.isReady();

    if (message) { status.textContent = message; return; }
    if (!on) {
      status.textContent = "Off — everything stays on this device.";
      return;
    }
    const pending = sync.pendingEventCount();
    status.textContent = `On · device ${sync.getContextId() || "—"} · last sync ${fmtWhen(sync.getLastSyncAt())}`
      + (pending ? ` · ${pending} queued` : "");
  }

  syncRunner.onSyncState((state, detail) => {
    if (state === "syncing") { status.textContent = "Syncing…"; return; }
    if (state === "error") { refresh(sync.describeError(detail && detail.error)); return; }
    refresh();
  });

  saveTokenBtn.addEventListener("click", () => {
    if (!sync.saveToken(tokenInput.value)) { toast("Enter a token first"); return; }
    tokenInput.value = "";
    refresh("Token saved.");
  });

  clearTokenBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear the token?",
      message: "Sync stops until a token is entered again. Nothing stored on this device is removed.",
      confirmLabel: "Clear token",
      danger: true,
    });
    if (!ok) return;
    sync.clearToken();
    sync.setEnabled(false);
    refresh("Token cleared.");
  });

  enableSwitch.addEventListener("click", async () => {
    if (sync.isEnabled()) {
      sync.setEnabled(false);
      refresh();
      return;
    }
    if (!sync.getToken()) { toast("Save an access token first"); return; }
    // The id is created here, once, from the name typed above.
    if (!sync.getContextId()) {
      const typed = nameInput.value.trim();
      if (!/[a-z0-9]/i.test(typed)) {
        toast("Enter a device name using English letters or numbers");
        nameInput.focus();
        return;
      }
      try {
        await sync.ensureContext(typed);
      } catch (error) {
        // The shared module is fetched on demand; if it cannot be loaded the
        // switch must stay off rather than leave a half-configured state.
        refresh(sync.describeError(error));
        return;
      }
      sync.setContextLabel(typed);
    }
    sync.setEnabled(true);
    refresh();
    const result = await syncRunner.runSync();
    refresh(result && result.error ? sync.describeError(result.error) : undefined);
  });

  syncNowBtn.addEventListener("click", async () => {
    const result = await syncRunner.runSync();
    refresh(result && result.error ? sync.describeError(result.error) : "Synced.");
  });

  remoteBackupBtn.addEventListener("click", async () => {
    remoteBackupBtn.disabled = true;
    try {
      await syncRunner.backupToGitHub();
      refresh(`Backed up to GitHub · ${fmtWhen(sync.getLastRemoteBackupAt())}`);
    } catch (error) {
      refresh(sync.describeError(error));
    } finally {
      remoteBackupBtn.disabled = !sync.isReady();
    }
  });

  refresh();
  // The listener outlives the DOM unless the sheet detaches it on close.
  return () => syncRunner.onSyncState(null);
}

function dateValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rangeDays(from, to) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function buildJournalSection(sec) {
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Optionally send every scheduled block to Daybook, whether complete or not. This stays off until you choose it, even when Sync is on.";
  sec.appendChild(intro);

  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  const enableLabel = document.createElement("div");
  enableLabel.className = "lbl";
  enableLabel.textContent = "Include in journal";
  const enableSwitch = document.createElement("button");
  enableSwitch.type = "button";
  enableSwitch.className = "switch";
  enableSwitch.setAttribute("role", "switch");
  enableRow.append(enableLabel, enableSwitch);
  sec.appendChild(enableRow);

  const contentRow = document.createElement("div");
  contentRow.className = "settings-row";
  const contentLabel = document.createElement("div");
  contentLabel.className = "lbl";
  contentLabel.textContent = "Upload content to private Journal";
  const contentSwitch = document.createElement("button");
  contentSwitch.type = "button";
  contentSwitch.className = "switch";
  contentSwitch.setAttribute("role", "switch");
  contentRow.append(contentLabel, contentSwitch);
  sec.appendChild(contentRow);
  const contentHint = document.createElement("p");
  contentHint.className = "hint";
  contentHint.textContent = "When off, titles, subtitles, notes and details are omitted. This is separate from Daybook Compact and does not erase Git history.";
  sec.appendChild(contentHint);

  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  sec.appendChild(status);

  const historyTitle = document.createElement("div");
  historyTitle.className = "lbl";
  historyTitle.textContent = "Add existing history";
  sec.appendChild(historyTitle);
  const historyHint = document.createElement("p");
  historyHint.className = "hint";
  historyHint.textContent = "Runs only when you request it. Blocks already deleted cannot be recovered.";
  sec.appendChild(historyHint);

  const range = document.createElement("div");
  range.className = "journal-range";
  const fromLabel = document.createElement("label");
  fromLabel.className = "lbl";
  fromLabel.textContent = "From";
  const from = document.createElement("input");
  from.type = "date";
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  from.value = dateValue(start);
  fromLabel.appendChild(from);
  const toLabel = document.createElement("label");
  toLabel.className = "lbl";
  toLabel.textContent = "To";
  const to = document.createElement("input");
  to.type = "date";
  to.value = dateValue();
  toLabel.appendChild(to);
  range.append(fromLabel, toLabel);
  sec.appendChild(range);

  const actions = document.createElement("div");
  actions.className = "journal-actions";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "btn";
  previewButton.textContent = "Preview";
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "btn";
  importButton.textContent = "Import";
  const redactButton = document.createElement("button");
  redactButton.type = "button";
  redactButton.className = "btn";
  redactButton.textContent = "Remove content";
  const clearActivityButton = document.createElement("button");
  clearActivityButton.type = "button";
  clearActivityButton.className = "btn";
  clearActivityButton.textContent = "Clear captured activity";
  actions.append(previewButton, importButton, redactButton, clearActivityButton);
  sec.appendChild(actions);
  const previewLine = document.createElement("p");
  previewLine.className = "hint";
  previewLine.textContent = "Default range: recent 3 months";
  previewLine.setAttribute("aria-live", "polite");
  sec.appendChild(previewLine);
  let preview = null;

  function refresh(state = journal.getJournalState()) {
    enableSwitch.setAttribute("aria-checked", String(state.enabled));
    status.textContent = state.enabled
      ? `${state.errorCode || state.status} · ${state.pendingCount || 0} pending`
      : "Off — no Loom records are sent to Daybook.";
    contentSwitch.setAttribute("aria-checked", String(journal.isJournalContentEnabled()));
  }

  contentSwitch.addEventListener("click", async () => { await journal.setJournalContentEnabled(!journal.isJournalContentEnabled()); refresh(await journal.refreshJournalState()); });

  async function makePreview() {
    const days = rangeDays(from.value, to.value);
    if (!days) { toast("Choose a valid date range"); return null; }
    const blocks = (await store.getAllBlocks()).filter((block) => block.date >= from.value && block.date <= to.value);
    preview = { from: from.value, to: to.value, days, blocks };
    previewLine.textContent = `${days} day${days === 1 ? "" : "s"} · ${blocks.length} block${blocks.length === 1 ? "" : "s"} available`;
    return preview;
  }

  enableSwitch.addEventListener("click", async () => {
    const enabling = !journal.isJournalEnabled();
    let preferredName = sync.getContextLabel();
    if (enabling && !sync.getContextId()) {
      preferredName = document.getElementById("sync-device-name")?.value.trim() || "";
      if (!/[a-z0-9]/i.test(preferredName)) {
        toast("Enter a device name in Sync using English letters or numbers");
        document.getElementById("sync-device-name")?.focus();
        return;
      }
    }
    const result = await journal.toggleJournal(enabling, preferredName);
    if (!result.ok) {
      toast(result.reason === "token" ? "Save an access token first" : "Set a device name first");
      refresh();
      return;
    }
    refresh(await journal.refreshJournalState());
    toast(enabling ? "New Loom blocks will be included in Daybook" : "Journal inclusion is off");
  });

  previewButton.addEventListener("click", makePreview);
  from.addEventListener("change", () => { preview = null; previewLine.textContent = "Preview the selected range before importing"; });
  to.addEventListener("change", () => { preview = null; previewLine.textContent = "Preview the selected range before importing"; });
  importButton.addEventListener("click", async () => {
    if (!journal.isJournalEnabled()) { toast("Turn on Include in journal first"); return; }
    if (!preview || preview.from !== from.value || preview.to !== to.value) await makePreview();
    if (!preview) return;
    const ok = await confirmDialog({
      title: "Add existing history?",
      message: `${preview.blocks.length} block(s) from ${preview.from} through ${preview.to} will be added to Daybook.`,
      confirmLabel: "Import",
    });
    if (!ok) return;
    const result = await journal.backfillJournal(preview.blocks, {
      from: preview.from, to: preview.to, totalDates: preview.days,
    });
    previewLine.textContent = result.error
      ? "Import paused · pending blocks will retry when online"
      : `Imported ${result.written} block${result.written === 1 ? "" : "s"}`;
    refresh(await journal.refreshJournalState());
  });
  redactButton.addEventListener("click", async () => {
    if (!journal.isJournalEnabled()) { toast("Turn on Include in journal first"); return; }
    if (journal.isJournalContentEnabled()) { toast("Turn off content upload on every active installation first"); return; }
    if (!rangeDays(from.value, to.value)) { toast("Choose a valid date range"); return; }
    const ok = await confirmDialog({
      title: "Remove content from current Daybook records?",
      message: "This installation's current projections will become metadata-only. Loom blocks, normal Sync, and existing Git history stay unchanged.",
      confirmLabel: "Remove content",
    });
    if (!ok) return;
    const result = await journal.redactJournalContent(from.value, to.value);
    previewLine.textContent = result.error
      ? `Partial · ${result.processedDates || 0}/${result.totalDates || 0} day(s) · pending work will retry`
      : `Content removed from ${result.redactedRecords} current record(s)`;
    refresh(await journal.refreshJournalState());
  });
  clearActivityButton.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Clear captured activity?",
      message: "This clears Loom's 90-day local activity history on this device. Blocks and remote Journal records are unchanged.",
      confirmLabel: "Clear activity",
    });
    if (!ok) return;
    journal.clearActivityLedger();
    previewLine.textContent = "Captured activity cleared on this device";
  });

  const detach = journal.onJournalState(refresh);
  journal.refreshJournalState().then(refresh);
  return detach;
}

export function openSettingsSheet({ onChanged }) {
  let settings = store.getSettings();

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Settings");

  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = "Settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "ico"; closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  header.appendChild(h2); header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "sheet-body";

  function section(title) {
    const sec = document.createElement("div");
    sec.className = "settings-section";
    const h3 = document.createElement("h3");
    h3.textContent = title;
    sec.appendChild(h3);
    body.appendChild(sec);
    return sec;
  }

  function chipRow(sec, labelText, values, current, formatLabel, onPick) {
    const row = document.createElement("div");
    row.className = "settings-row";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.textContent = labelText;
    row.appendChild(lbl);
    const chips = document.createElement("div");
    chips.className = "chiprow";
    chips.style.marginTop = "8px";
    const buttons = values.map((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = formatLabel(v);
      b.setAttribute("aria-pressed", String(v === current));
      b.addEventListener("click", () => {
        buttons.forEach((bb) => bb.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        onPick(v);
      });
      chips.appendChild(b);
      return b;
    });
    row.appendChild(chips);
    sec.appendChild(row);
  }

  function persist(partial) {
    settings = store.setSettings(partial);
    onChanged(settings);
  }

  const displaySec = section("Display");
  chipRow(displaySec, "Font size", FONT_STEPS, settings.font, (v) => v + "px", (v) => persist({ font: v }));
  chipRow(displaySec, "Time interval", HOUR_STEPS, settings.hourHeight, (v) => v + "px", (v) => persist({ hourHeight: v }));
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Narrower intervals may hide notes on shorter blocks.";
  displaySec.appendChild(hint);
  chipRow(displaySec, "Snap", SNAP_STEPS, settings.snap, (v) => v + "m", (v) => persist({ snap: v }));

  const presetsSec = section("Start presets");
  const presetsHint = document.createElement("p");
  presetsHint.className = "hint";
  presetsHint.textContent = "Quick-start buttons on the block editor. Up to 12.";
  presetsSec.appendChild(presetsHint);

  const presetsList = document.createElement("div");
  presetsList.className = "chiprow";
  presetsList.style.marginTop = "8px";
  presetsSec.appendChild(presetsList);

  function renderPresetsList() {
    presetsList.innerHTML = "";
    sanitizeStartPresets(settings.startPresets).forEach((min) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = `${hhmm(min)} ✕`;
      chip.setAttribute("aria-label", `Remove ${hhmm(min)} preset`);
      chip.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Remove preset?",
          message: `${hhmm(min)} will be removed from Start presets.`,
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        persist({ startPresets: settings.startPresets.filter((m) => m !== min) });
        renderPresetsList();
      });
      presetsList.appendChild(chip);
    });
  }
  renderPresetsList();

  const presetAddRow = document.createElement("div");
  presetAddRow.style.display = "flex";
  presetAddRow.style.gap = "8px";
  presetAddRow.style.marginTop = "8px";
  presetAddRow.style.alignItems = "center";
  const presetAddInput = document.createElement("input");
  presetAddInput.type = "time";
  presetAddInput.style.flex = "1";
  presetAddInput.style.width = "auto";
  const presetAddBtn = document.createElement("button");
  presetAddBtn.type = "button";
  presetAddBtn.className = "btn";
  presetAddBtn.textContent = "Add";
  presetAddBtn.addEventListener("click", () => {
    const raw = parseHHMM(presetAddInput.value);
    if (raw == null) { toast("Enter a valid time"); return; }
    const current = sanitizeStartPresets(settings.startPresets);
    if (current.includes(raw)) { toast("Already in the list"); return; }
    if (current.length >= MAX_START_PRESETS) { toast(`Up to ${MAX_START_PRESETS} presets`); return; }
    persist({ startPresets: sanitizeStartPresets([...current, raw]) });
    renderPresetsList();
    presetAddInput.value = "";
  });
  presetAddRow.append(presetAddInput, presetAddBtn);
  presetsSec.appendChild(presetAddRow);

  const presetResetRow = document.createElement("div");
  presetResetRow.className = "settings-row";
  const presetResetLbl = document.createElement("div");
  presetResetLbl.className = "lbl";
  presetResetLbl.textContent = "Reset to defaults";
  const presetResetBtn = document.createElement("button");
  presetResetBtn.type = "button";
  presetResetBtn.className = "btn";
  presetResetBtn.textContent = "Reset";
  presetResetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reset start presets?",
      message: "Start presets will be restored to the default 8 times.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    persist({ startPresets: [...START_PRESET_DEFAULTS] });
    renderPresetsList();
  });
  presetResetRow.append(presetResetLbl, presetResetBtn);
  presetsSec.appendChild(presetResetRow);

  const behaviorSec = section("Behavior");
  const nightRow = document.createElement("div");
  nightRow.className = "settings-row";
  const nightLbl = document.createElement("div"); nightLbl.className = "lbl"; nightLbl.textContent = "Collapse empty night (00–06)";
  const nightSwitch = document.createElement("button");
  nightSwitch.type = "button"; nightSwitch.className = "switch"; nightSwitch.setAttribute("role", "switch");
  nightSwitch.setAttribute("aria-checked", String(settings.collapseNight));
  nightSwitch.addEventListener("click", () => {
    const next = !settings.collapseNight;
    nightSwitch.setAttribute("aria-checked", String(next));
    persist({ collapseNight: next });
  });
  nightRow.appendChild(nightLbl); nightRow.appendChild(nightSwitch);
  behaviorSec.appendChild(nightRow);

  const scrollRow = document.createElement("div");
  scrollRow.className = "settings-row";
  const scrollLbl = document.createElement("div"); scrollLbl.className = "lbl"; scrollLbl.textContent = "Default scroll hour";
  const scrollInput = document.createElement("input");
  scrollInput.type = "number"; scrollInput.min = "0"; scrollInput.max = "23"; scrollInput.style.width = "70px";
  scrollInput.value = String(settings.defaultScrollHour);
  scrollInput.addEventListener("change", () => {
    const v = Math.max(0, Math.min(23, parseInt(scrollInput.value, 10) || 0));
    scrollInput.value = String(v);
    persist({ defaultScrollHour: v });
  });
  scrollRow.appendChild(scrollLbl); scrollRow.appendChild(scrollInput);
  behaviorSec.appendChild(scrollRow);

  const weekRow = document.createElement("div");
  weekRow.className = "settings-row";
  const weekLbl = document.createElement("div"); weekLbl.className = "lbl"; weekLbl.textContent = "Week starts on";
  const weekSel = document.createElement("select");
  ["Sunday", "Monday"].forEach((name, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = name; weekSel.appendChild(o); });
  weekSel.value = String(settings.weekStart);
  weekSel.style.width = "auto";
  weekSel.addEventListener("change", () => persist({ weekStart: parseInt(weekSel.value, 10) }));
  weekRow.appendChild(weekLbl); weekRow.appendChild(weekSel);
  behaviorSec.appendChild(weekRow);

  const backupSec = section("Backup");
  const lastBackupP = document.createElement("p");
  lastBackupP.className = "hint";
  const days = daysSinceBackup(settings.lastBackupAt);
  lastBackupP.textContent = settings.lastBackupAt ? `Last backup: ${days} day${days === 1 ? "" : "s"} ago` : "No backup yet";
  backupSec.appendChild(lastBackupP);
  const backupRow = document.createElement("div");
  backupRow.style.display = "flex";
  backupRow.style.gap = "8px";
  backupRow.style.marginTop = "8px";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button"; exportBtn.className = "btn"; exportBtn.style.flex = "1"; exportBtn.textContent = "Export JSON";
  exportBtn.addEventListener("click", async () => { await exportBackup(); settings = store.getSettings(); lastBackupP.textContent = "Last backup: 0 days ago"; });
  const importBtn = document.createElement("button");
  importBtn.type = "button"; importBtn.className = "btn"; importBtn.style.flex = "1"; importBtn.textContent = "Import JSON";
  importBtn.addEventListener("click", async () => {
    const file = await pickImportFile();
    if (!file) return;
    await importBackup(file, { onDone: () => onChanged(store.getSettings()) });
  });
  backupRow.appendChild(exportBtn); backupRow.appendChild(importBtn);
  backupSec.appendChild(backupRow);

  const detachSync = buildSyncSection(section("Sync"));
  const detachJournal = buildJournalSection(section("Journal"));

  const dangerSec = section("Data");
  const purgeRow = document.createElement("div");
  purgeRow.className = "settings-row";
  const purgeLbl = document.createElement("div"); purgeLbl.className = "lbl"; purgeLbl.textContent = "Delete data before…";
  const purgeInput = document.createElement("input");
  purgeInput.type = "date";
  purgeInput.value = todayKey();
  purgeInput.style.width = "auto";
  const purgeBtn = document.createElement("button");
  purgeBtn.type = "button"; purgeBtn.className = "btn danger"; purgeBtn.textContent = "Delete";
  purgeBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Delete old data?", message: `All blocks before ${purgeInput.value} will be permanently removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const n = await store.deleteBlocksBefore(purgeInput.value);
    toast(`Deleted ${n} block${n === 1 ? "" : "s"}`);
    onChanged(settings);
  });
  purgeRow.appendChild(purgeLbl);
  const purgeControls = document.createElement("div");
  purgeControls.style.display = "flex";
  purgeControls.style.gap = "6px";
  purgeControls.appendChild(purgeInput);
  purgeControls.appendChild(purgeBtn);
  purgeRow.appendChild(purgeControls);
  dangerSec.appendChild(purgeRow);

  const resetRow = document.createElement("div");
  resetRow.className = "settings-row";
  const resetLbl = document.createElement("div"); resetLbl.className = "lbl"; resetLbl.textContent = "Reset everything";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button"; resetBtn.className = "btn danger"; resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Reset everything?", message: "All blocks, templates, and settings on this device will be permanently removed.", confirmLabel: "Reset everything", danger: true });
    if (!ok) return;
    await store.clearAllBlocks();
    const templates = await store.getTemplates();
    for (const t of templates) await store.deleteTemplate(t.id);
    settings = store.resetSettings();
    close();
    onChanged(settings);
  });
  resetRow.appendChild(resetLbl); resetRow.appendChild(resetBtn);
  dangerSec.appendChild(resetRow);

  const aboutSec = section("About");
  const buildP = document.createElement("p");
  buildP.className = "hint";
  // A Service Worker serves the cached build first, so a deployed fix can sit
  // unused. This line is how you tell which build is actually running.
  buildP.textContent = `App version ${APP_BUILD}`;
  aboutSec.appendChild(buildP);

  const resetFontRow = document.createElement("div");
  resetFontRow.className = "settings-row";
  const rfLbl = document.createElement("div"); rfLbl.className = "lbl"; rfLbl.textContent = "Restore default display";
  const rfBtn = document.createElement("button");
  rfBtn.type = "button"; rfBtn.className = "btn"; rfBtn.textContent = "Restore";
  rfBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Restore default display?",
      message: "Text size, row height and snap will be restored to their defaults.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    persist({ font: DEFAULT_SETTINGS.font, hourHeight: DEFAULT_SETTINGS.hourHeight, snap: DEFAULT_SETTINGS.snap });
    close(); openSettingsSheet({ onChanged });
  });
  resetFontRow.appendChild(rfLbl); resetFontRow.appendChild(rfBtn);
  displaySec.appendChild(resetFontRow);

  sheet.appendChild(header);
  sheet.appendChild(body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  document.getElementById("sheet-host").appendChild(overlay);

  function close() { detachSync(); detachJournal(); if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}
