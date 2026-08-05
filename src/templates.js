// templates.js — template CRUD, Add / Fill gaps / Replace application, Copy from…

import { normalizeTemplateBlock, normalizeBlock, isWeekend, hhmm, LIMITS, COLORS } from "./model.js";
import * as store from "./store.js";
import { undoToast, confirmDialog, toast } from "./ui.js";
import { openCalendarSheet } from "./calendar-sheet.js";

export async function getTemplateList() {
  return store.getTemplates();
}

export async function emptyDayTemplateChip(date) {
  const id = isWeekend(date) ? "tpl-weekend" : "tpl-weekday";
  const tpl = await store.getTemplateById(id).catch(() => null);
  if (!tpl || !tpl.blocks || tpl.blocks.length === 0) return null;
  return { id: tpl.id, name: tpl.name };
}

function overlaps(a, b) {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

function instantiate(templateBlock, date) {
  return normalizeBlock({ ...templateBlock, date, id: undefined, done: false });
}

// mode: "add" | "fillgaps" | "replace"
export async function applyTemplate(templateId, date, mode) {
  const tpl = await store.getTemplateById(templateId);
  if (!tpl) throw new Error("Template not found");
  const existing = await store.getBlocksForDate(date);

  if (mode === "replace") {
    await store.deleteBlocksForDate(date);
    const created = tpl.blocks.map((tb) => instantiate(tb, date));
    await store.bulkPutBlocks(created);
    return { added: created.length, updated: 0, skipped: 0, previous: existing, created };
  }

  if (mode === "fillgaps") {
    const toAdd = tpl.blocks.filter((tb) => !existing.some((e) => overlaps(e, tb)));
    const created = toAdd.map((tb) => instantiate(tb, date));
    await store.bulkPutBlocks(created);
    return { added: created.length, updated: 0, skipped: tpl.blocks.length - toAdd.length, created };
  }

  // add
  const created = tpl.blocks.map((tb) => instantiate(tb, date));
  await store.bulkPutBlocks(created);
  return { added: created.length, updated: 0, skipped: 0, created };
}

export async function openApplyTemplate(templateId, date, onApplied) {
  const tpl = await store.getTemplateById(templateId);
  if (!tpl || tpl.blocks.length === 0) {
    openTemplateEditor(tpl, { onSaved: onApplied });
    return;
  }
  const choice = await pickMode(tpl.name);
  if (!choice) return;

  if (choice === "replace") {
    const ok = await confirmDialog({
      title: "Replace today's blocks?",
      message: `This removes all of today's blocks and applies "${tpl.name}" instead.`,
      confirmLabel: "Replace",
      danger: true,
    });
    if (!ok) return;
  }

  const result = await applyTemplate(templateId, date, choice);
  if (choice === "replace") {
    undoToast(`Replaced with ${tpl.name} (${result.added})`, {
      onUndo: async () => {
        await store.deleteBlocksForDate(date);
        await store.bulkPutBlocks(result.previous);
        onApplied();
      },
    });
  } else {
    toast(`Added ${result.added}${result.skipped ? `, skipped ${result.skipped}` : ""} from ${tpl.name}`);
  }
  onApplied();
}

function pickMode(templateName) {
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
    h2.textContent = `Apply ${templateName}`;
    body.appendChild(h2);
    const opts = [
      ["add", "Add", "Keep existing blocks, add these too"],
      ["fillgaps", "Fill gaps", "Only add where today is empty"],
      ["replace", "Replace", "Remove today's blocks and use this instead"],
    ];
    for (const [key, label, desc] of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.style.width = "100%";
      b.style.marginBottom = "8px";
      b.style.textAlign = "left";
      const strong = document.createElement("div");
      strong.style.fontWeight = "700";
      strong.textContent = label;
      const small = document.createElement("div");
      small.style.fontSize = "12px";
      small.style.color = "var(--text-2)";
      small.textContent = desc;
      b.appendChild(strong);
      b.appendChild(small);
      b.addEventListener("click", () => { close(); resolve(key); });
      body.appendChild(b);
    }
    const foot = document.createElement("div");
    foot.className = "sheet-foot";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn ghost"; cancel.style.flex = "1"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { close(); resolve(null); });
    foot.appendChild(cancel);
    sheet.appendChild(body);
    sheet.appendChild(foot);
    frame.appendChild(sheet);
    overlay.appendChild(frame);
    document.getElementById("sheet-host").appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { close(); resolve(null); } });
  });
}

export async function openTemplatesSheet({ date, onApplied }) {
  const templates = await getTemplateList();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Templates");
  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = "Templates";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "ico"; closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  header.appendChild(h2); header.appendChild(closeBtn);
  const body = document.createElement("div");
  body.className = "sheet-body";
  const list = document.createElement("ul");
  list.className = "tpl-list";

  function row(tpl) {
    const li = document.createElement("li");
    li.className = "tpl-row";
    const name = document.createElement("button");
    name.type = "button";
    name.style.background = "none"; name.style.border = "0"; name.style.textAlign = "left"; name.style.flex = "1"; name.style.font = "inherit"; name.style.cursor = "pointer"; name.style.minHeight = "44px";
    const nameLbl = document.createElement("div");
    nameLbl.className = "name";
    nameLbl.textContent = tpl.name;
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = tpl.blocks.length === 0 ? "Empty — tap to set up" : `${tpl.blocks.length} block${tpl.blocks.length > 1 ? "s" : ""}`;
    name.appendChild(nameLbl);
    name.appendChild(count);
    name.addEventListener("click", async () => {
      if (tpl.blocks.length === 0) {
        openTemplateEditor(tpl, { onSaved: () => refresh() });
      } else {
        close();
        await openApplyTemplate(tpl.id, date, onApplied);
      }
    });
    li.appendChild(name);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.setAttribute("aria-label", `Edit ${tpl.name}`);
    editBtn.textContent = "✎";
    editBtn.addEventListener("click", () => openTemplateEditor(tpl, { onSaved: () => refresh() }));
    li.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", `Delete ${tpl.name}`);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Delete template?", message: `"${tpl.name}" will be removed.`, confirmLabel: "Delete", danger: true });
      if (!ok) return;
      await store.deleteTemplate(tpl.id);
      refresh();
    });
    li.appendChild(delBtn);
    return li;
  }

  async function refresh() {
    const fresh = await getTemplateList();
    list.replaceChildren();
    fresh.forEach((t) => list.appendChild(row(t)));
  }
  templates.forEach((t) => list.appendChild(row(t)));
  body.appendChild(list);

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn";
  newBtn.style.width = "100%";
  newBtn.style.marginTop = "10px";
  newBtn.textContent = "+ New template";
  newBtn.addEventListener("click", async () => {
    const name = await promptText("New template", "Template name");
    if (!name) return;
    const tpl = { id: "tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 40), blocks: [] };
    await store.putTemplate(tpl);
    await refresh();
    openTemplateEditor(tpl, { onSaved: () => refresh() });
  });
  body.appendChild(newBtn);

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

export function openTemplateEditor(template, { onSaved }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `Set up ${template.name}`);
  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = `Set up ${template.name}`;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "ico"; closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  header.appendChild(h2); header.appendChild(closeBtn);
  const body = document.createElement("div");
  body.className = "sheet-body";

  let blocks = template.blocks.map((b) => ({ ...b }));
  const list = document.createElement("ul");
  list.className = "tpl-list";
  body.appendChild(list);

  function renderList() {
    list.replaceChildren();
    blocks.sort((a, b) => a.start - b.start).forEach((b, idx) => {
      const li = document.createElement("li");
      li.className = "tpl-row";
      const label = document.createElement("div");
      label.style.flex = "1";
      label.replaceChildren();
      const nameEl = document.createElement("div");
      nameEl.className = "name";
      nameEl.textContent = b.title;
      const sub = document.createElement("div");
      sub.className = "count";
      sub.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.duration)}`;
      label.appendChild(nameEl);
      label.appendChild(sub);
      li.appendChild(label);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${b.title}`);
      rm.textContent = "🗑";
      rm.addEventListener("click", () => { blocks.splice(blocks.indexOf(b), 1); renderList(); });
      li.appendChild(rm);
      list.appendChild(li);
    });
  }
  renderList();

  const addForm = document.createElement("div");
  addForm.style.marginTop = "14px";
  addForm.style.borderTop = "1px solid var(--line)";
  addForm.style.paddingTop = "14px";

  const titleField = document.createElement("div");
  titleField.className = "field";
  const titleLbl = document.createElement("label"); titleLbl.textContent = "Title";
  const titleInput = document.createElement("input"); titleInput.type = "text"; titleInput.maxLength = LIMITS.title;
  titleField.appendChild(titleLbl); titleField.appendChild(titleInput);

  const timeRow = document.createElement("div");
  timeRow.style.display = "flex";
  timeRow.style.gap = "10px";
  const startField = document.createElement("div"); startField.className = "field"; startField.style.flex = "1";
  const startLbl = document.createElement("label"); startLbl.textContent = "Start";
  const startInput = document.createElement("input"); startInput.type = "time"; startInput.value = "09:00";
  startField.appendChild(startLbl); startField.appendChild(startInput);
  const durField = document.createElement("div"); durField.className = "field"; durField.style.flex = "1";
  const durLbl = document.createElement("label"); durLbl.textContent = "Duration (min)";
  const durInput = document.createElement("input"); durInput.type = "number"; durInput.min = "5"; durInput.value = "30";
  durField.appendChild(durLbl); durField.appendChild(durInput);
  timeRow.appendChild(startField); timeRow.appendChild(durField);

  const colorField = document.createElement("div");
  colorField.className = "field";
  const colorLbl = document.createElement("label"); colorLbl.textContent = "Color";
  const select = document.createElement("select");
  COLORS.forEach((c) => { const opt = document.createElement("option"); opt.value = c.key; opt.textContent = c.name; select.appendChild(opt); });
  colorField.appendChild(colorLbl); colorField.appendChild(select);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn";
  addBtn.style.width = "100%";
  addBtn.textContent = "+ Add block to template";
  addBtn.addEventListener("click", () => {
    const [h, m] = startInput.value.split(":").map((n) => parseInt(n, 10));
    if (!titleInput.value.trim() || !Number.isFinite(h)) return;
    try {
      const tb = normalizeTemplateBlock({
        title: titleInput.value, start: h * 60 + m, duration: parseInt(durInput.value, 10) || 30, color: select.value,
      });
      blocks.push(tb);
      renderList();
      titleInput.value = "";
    } catch { /* ignore invalid */ }
  });

  addForm.appendChild(titleField);
  addForm.appendChild(timeRow);
  addForm.appendChild(colorField);
  addForm.appendChild(addBtn);
  body.appendChild(addForm);

  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button"; cancelBtn.className = "btn ghost"; cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button"; saveBtn.className = "btn primary"; saveBtn.textContent = "Save";
  foot.appendChild(cancelBtn); foot.appendChild(saveBtn);

  sheet.appendChild(header);
  sheet.appendChild(body);
  sheet.appendChild(foot);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  document.getElementById("sheet-host").appendChild(overlay);

  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  saveBtn.addEventListener("click", async () => {
    await store.putTemplate({ ...template, blocks });
    close();
    if (onSaved) onSaved();
  });
}

export async function openCopyFromSheet({ date, weekStart, onApplied }) {
  await openCalendarSheet({
    selectedDate: date,
    weekStart,
    onPick: async (sourceDate) => {
      if (sourceDate === date) { toast("Pick a different day to copy from"); return; }
      const source = await store.getBlocksForDate(sourceDate);
      if (source.length === 0) { toast(`${sourceDate} has no blocks`); return; }
      const created = source.map((b) => normalizeBlock({ ...b, id: undefined, date, done: false }));
      await store.bulkPutBlocks(created);
      undoToast(`Copied ${created.length} from ${sourceDate}`, {
        onUndo: async () => { await store.deleteBlocksByIds(created.map((c) => c.id)); onApplied(); },
      });
      onApplied();
    },
  });
}

export async function saveTodayAsTemplate(date, blocksToday) {
  if (blocksToday.length === 0) { toast("Nothing to save — today has no blocks"); return; }
  const name = await promptText("Save as template", "Template name");
  if (!name) return;
  const tplBlocks = blocksToday.map((b) => normalizeTemplateBlock(b));
  const tpl = { id: "tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 40), blocks: tplBlocks };
  await store.putTemplate(tpl);
  toast(`Saved as "${tpl.name}"`);
}

function promptText(title, placeholder) {
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
    h2.textContent = title;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.maxLength = 40;
    body.appendChild(h2);
    body.appendChild(input);
    const foot = document.createElement("div");
    foot.className = "sheet-foot";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn ghost"; cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "btn primary"; ok.textContent = "Save";
    foot.appendChild(cancel); foot.appendChild(ok);
    sheet.appendChild(body); sheet.appendChild(foot);
    frame.appendChild(sheet); overlay.appendChild(frame);
    document.getElementById("sheet-host").appendChild(overlay);
    function close(v) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
    cancel.addEventListener("click", () => close(null));
    ok.addEventListener("click", () => close(input.value.trim() || null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    window.requestAnimationFrame(() => input.focus());
  });
}
