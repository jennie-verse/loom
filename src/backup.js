// backup.js — Export/Import, format validation, Merge rules.

import * as store from "./store.js";
import { pad2 } from "./model.js";
import { toast, undoToast, confirmDialog } from "./ui.js";

const FORMAT = "loom-backup";
const VERSION = 1;

function backupFilename() {
  const d = new Date();
  return `loom-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
}

export async function exportBackup() {
  const [blocks, templates] = await Promise.all([store.getAllBlocks(), store.getTemplates()]);
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    blocks,
    templates,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  store.setSettings({ lastBackupAt: new Date().toISOString() });
  toast("Backup exported");
}

function validatePayload(data) {
  if (!data || typeof data !== "object") return "Not a valid JSON object.";
  if (data.format !== FORMAT) return "This file isn't a Loom backup.";
  if (typeof data.version !== "number" || data.version > VERSION) return "This backup was made by a newer version of Loom.";
  if (!Array.isArray(data.blocks)) return "Backup is missing block data.";
  if (!Array.isArray(data.templates)) return "Backup is missing template data.";
  return null;
}

export function pickImportFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

export async function importBackup(file, { onDone } = {}) {
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    toast("Couldn't read that file — not valid JSON");
    return;
  }
  const err = validatePayload(data);
  if (err) {
    toast(err);
    return;
  }

  const mode = await pickImportMode();
  if (!mode) return;

  if (mode === "replace") {
    const ok = await confirmDialog({
      title: "Replace all data?",
      message: "This removes every block and template currently on this device.",
      confirmLabel: "Replace all",
      danger: true,
    });
    if (!ok) return;
    const [prevBlocks, prevTemplates] = await Promise.all([store.getAllBlocks(), store.getTemplates()]);
    await store.clearAllBlocks();
    await store.bulkPutBlocks(data.blocks);
    for (const t of prevTemplates) await store.deleteTemplate(t.id);
    for (const t of data.templates) await store.putTemplate(t);
    undoToast(`Replaced with backup (${data.blocks.length} blocks)`, {
      onUndo: async () => {
        await store.clearAllBlocks();
        await store.bulkPutBlocks(prevBlocks);
        for (const t of data.templates) await store.deleteTemplate(t.id);
        for (const t of prevTemplates) await store.putTemplate(t);
        if (onDone) onDone();
      },
    });
    if (onDone) onDone();
    return;
  }

  // merge
  let added = 0, updated = 0, skipped = 0;
  const existing = await store.getAllBlocks();
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (const incoming of data.blocks) {
    const current = byId.get(incoming.id);
    if (!current) {
      await store.putBlock(incoming);
      added += 1;
    } else if (new Date(incoming.updatedAt) > new Date(current.updatedAt)) {
      await store.putBlock(incoming);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  for (const tpl of data.templates) {
    const current = await store.getTemplateById(tpl.id);
    if (!current) added += 0, await store.putTemplate(tpl);
    else await store.putTemplate(tpl);
  }
  toast(`Merged — added ${added} · updated ${updated} · skipped ${skipped}`);
  if (onDone) onDone();
}

function pickImportMode() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const frame = document.createElement("div");
    frame.className = "frame";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    const body = document.createElement("div");
    body.className = "sheet-body";
    const h2 = document.createElement("h2");
    h2.style.marginBottom = "10px";
    h2.textContent = "Import backup";
    body.appendChild(h2);
    const mergeBtn = document.createElement("button");
    mergeBtn.type = "button"; mergeBtn.className = "btn"; mergeBtn.style.width = "100%"; mergeBtn.style.marginBottom = "8px"; mergeBtn.style.textAlign = "left";
    mergeBtn.replaceChildren();
    const mergeStrong = document.createElement("div"); mergeStrong.style.fontWeight = "700"; mergeStrong.textContent = "Merge";
    const mergeSmall = document.createElement("div"); mergeSmall.style.fontSize = "12px"; mergeSmall.style.color = "var(--text-2)"; mergeSmall.textContent = "Keep both, newer wins on conflicts";
    mergeBtn.appendChild(mergeStrong); mergeBtn.appendChild(mergeSmall);
    const replaceBtn = document.createElement("button");
    replaceBtn.type = "button"; replaceBtn.className = "btn"; replaceBtn.style.width = "100%"; replaceBtn.style.textAlign = "left";
    const replaceStrong = document.createElement("div"); replaceStrong.style.fontWeight = "700"; replaceStrong.textContent = "Replace all";
    const replaceSmall = document.createElement("div"); replaceSmall.style.fontSize = "12px"; replaceSmall.style.color = "var(--text-2)"; replaceSmall.textContent = "Remove current data first";
    replaceBtn.appendChild(replaceStrong); replaceBtn.appendChild(replaceSmall);
    body.appendChild(mergeBtn); body.appendChild(replaceBtn);
    const foot = document.createElement("div");
    foot.className = "sheet-foot";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn ghost"; cancel.style.flex = "1"; cancel.textContent = "Cancel";
    foot.appendChild(cancel);
    sheet.appendChild(body); sheet.appendChild(foot);
    frame.appendChild(sheet); overlay.appendChild(frame);
    document.getElementById("sheet-host").appendChild(overlay);
    function close(v) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
    mergeBtn.addEventListener("click", () => close("merge"));
    replaceBtn.addEventListener("click", () => close("replace"));
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

export function daysSinceBackup(lastBackupAt) {
  if (!lastBackupAt) return Infinity;
  const ms = Date.now() - new Date(lastBackupAt).getTime();
  return Math.floor(ms / 86400000);
}
