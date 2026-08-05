// settings.js — settings screen: font size, hour height, snap unit, defaults,
// backup/restore entry points, purge old data, full reset.

import { FONT_STEPS, HOUR_STEPS, SNAP_STEPS, DEFAULT_SETTINGS, todayKey } from "./model.js";
import * as store from "./store.js";
import { exportBackup, importBackup, pickImportFile, daysSinceBackup } from "./backup.js";
import { confirmDialog, undoToast, toast } from "./ui.js";

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

  const resetFontRow = document.createElement("div");
  resetFontRow.className = "settings-row";
  const rfLbl = document.createElement("div"); rfLbl.className = "lbl"; rfLbl.textContent = "Restore default display";
  const rfBtn = document.createElement("button");
  rfBtn.type = "button"; rfBtn.className = "btn"; rfBtn.textContent = "Restore";
  rfBtn.addEventListener("click", () => {
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

  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}
