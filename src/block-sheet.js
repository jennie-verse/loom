// block-sheet.js — create/edit sheet: focus trap, draft scratch storage.
// Final writes go through store.js (per file responsibility table).

import { COLORS, DURATION_CHIPS, LIMITS, MINUTES_PER_DAY, normalizeBlock, snapMinutes, moveStartKeepingDuration, sanitizeStartPresets, hhmm, parseHHMM, clampText } from "./model.js";
import * as store from "./store.js";
import { confirmDialog, announce } from "./ui.js";

let openState = null; // { overlay, dirty, snapUnit, onClose }

function colorVar(key) {
  return `var(--c-${key})`;
}

export function isOpen() {
  return !!openState;
}

export function closeForBackground() {
  // Called on visibilitychange while a sheet is open — persist a draft so the
  // in-progress edit survives an iOS background eviction.
  if (!openState) return;
  store.saveDraft(readForm(openState));
}

function readForm(state) {
  const f = state.fields;
  return {
    mode: state.mode,
    id: state.id,
    date: state.date,
    title: f.title.value,
    subtitle: f.subtitle.value,
    note: f.note.value,
    detail: f.detail.value,
    start: f.start.value,
    duration: state.duration,
    color: state.color,
    done: state.done,
  };
}

function isDirty(state) {
  const now = readForm(state);
  return JSON.stringify(now) !== JSON.stringify(state.initial);
}

export async function openBlockSheet({ date, block = null, start = null, duration = 30, settings, onSaved, onDeleted }) {
  if (openState) return; // one sheet at a time
  const host = document.getElementById("sheet-host");
  const mode = block ? "edit" : "create";
  const snapUnit = settings.snap;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", mode === "edit" ? "Edit block" : "New block");

  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = mode === "edit" ? "Edit block" : "New block";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ico";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  header.appendChild(h2);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "sheet-body";

  // ----- Title -----
  const titleField = field("Title");
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = LIMITS.title;
  titleInput.value = block ? block.title : "";
  titleField.appendChild(titleInput);
  body.appendChild(titleField);

  // ----- Subtitle -----
  const subtitleField = field("Subtitle (optional)");
  const subtitleInput = document.createElement("input");
  subtitleInput.type = "text";
  subtitleInput.maxLength = LIMITS.subtitle;
  subtitleInput.value = block ? block.subtitle || "" : "";
  subtitleField.appendChild(subtitleInput);
  body.appendChild(subtitleField);

  // ----- Note -----
  const noteField = field("Note (optional)");
  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.maxLength = LIMITS.note;
  noteInput.value = block ? block.note || "" : "";
  const noteCount = document.createElement("div");
  noteCount.className = "count";
  noteField.appendChild(noteInput);
  noteField.appendChild(noteCount);
  body.appendChild(noteField);
  const updateNoteCount = () => { noteCount.textContent = `${noteInput.value.length} / ${LIMITS.note}`; };
  noteInput.addEventListener("input", updateNoteCount);
  updateNoteCount();

  // ----- Detail (collapsible) -----
  const detailField = field("");
  const detailToggle = document.createElement("button");
  detailToggle.type = "button";
  detailToggle.className = "detail-toggle";
  const hasInitialDetail = !!(block && block.detail);
  detailToggle.textContent = (hasInitialDetail ? "▾" : "▸") + " Detail note";
  detailToggle.setAttribute("aria-expanded", hasInitialDetail ? "true" : "false");
  const detailInput = document.createElement("textarea");
  detailInput.maxLength = LIMITS.detail;
  detailInput.value = block ? block.detail || "" : "";
  detailInput.className = hasInitialDetail ? "" : "hidden";
  const detailCount = document.createElement("div");
  detailCount.className = "count";
  detailField.appendChild(detailToggle);
  detailField.appendChild(detailInput);
  detailField.appendChild(detailCount);
  body.appendChild(detailField);
  const updateDetailCount = () => { detailCount.textContent = `${detailInput.value.length} / ${LIMITS.detail}`; };
  updateDetailCount();
  detailInput.addEventListener("input", updateDetailCount);
  detailToggle.addEventListener("click", () => {
    const expanded = detailToggle.getAttribute("aria-expanded") === "true";
    detailToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    detailToggle.textContent = (expanded ? "▸" : "▾") + " Detail note";
    detailInput.classList.toggle("hidden", expanded);
    if (!expanded) detailInput.focus();
  });

  // ----- Start -----
  const startField = field("Start");
  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.step = snapUnit * 60;
  const initialStart = block ? block.start : (start ?? 8 * 60);
  startInput.value = hhmm(initialStart);
  const startHint = document.createElement("div");
  startHint.className = "hint";
  startField.appendChild(startInput);
  startField.appendChild(startHint);

  function applyStartChange() {
    const raw = parseHHMM(startInput.value);
    if (raw == null) return;
    const snapped = snapMinutes(raw, snapUnit);
    if (snapped !== raw) {
      startInput.value = hhmm(snapped);
      startHint.textContent = `Rounded to ${hhmm(snapped)}`;
    } else {
      startHint.textContent = "";
    }
  }

  // ----- Start presets -----
  const presets = sanitizeStartPresets(settings.startPresets);
  if (presets.length) {
    const presetRow = document.createElement("div");
    presetRow.className = "chiprow";
    presetRow.style.marginTop = "8px";
    presets.forEach((min) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = hhmm(min);
      b.setAttribute("aria-label", `Set start to ${hhmm(min)}`);
      b.addEventListener("click", () => {
        startInput.value = hhmm(min);
        applyStartChange();
      });
      presetRow.appendChild(b);
    });
    startField.appendChild(presetRow);
  }

  // ----- Start nudge buttons -----
  const nudgeRow = document.createElement("div");
  nudgeRow.className = "chiprow";
  nudgeRow.style.marginTop = "8px";
  [
    { label: "-1h", minutes: -60 },
    { label: "-10m", minutes: -10 },
    { label: "+10m", minutes: 10 },
    { label: "+1h", minutes: 60 },
  ].forEach(({ label, minutes }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    const dir = minutes < 0 ? "back" : "forward";
    const amount = Math.abs(minutes) >= 60 ? `${Math.abs(minutes) / 60} hour` : `${Math.abs(minutes)} minutes`;
    b.setAttribute("aria-label", `Move start ${dir} ${amount}`);
    b.addEventListener("click", () => {
      const cur = parseHHMM(startInput.value);
      if (cur == null) return;
      const next = moveStartKeepingDuration(cur, currentDuration, minutes);
      startInput.value = hhmm(next);
      applyStartChange();
    });
    nudgeRow.appendChild(b);
  });
  startField.appendChild(nudgeRow);

  body.appendChild(startField);

  // ----- Duration -----
  const durField = field("Duration");
  const durChips = document.createElement("div");
  durChips.className = "chiprow";
  let currentDuration = block ? block.duration : duration;
  const customWrap = document.createElement("div");
  customWrap.style.marginTop = "8px";
  const customInput = document.createElement("input");
  customInput.type = "number";
  customInput.min = "5";
  customInput.max = "1435";
  customInput.step = String(snapUnit);
  customWrap.appendChild(customInput);
  customWrap.classList.add("hidden");

  const isPreset = DURATION_CHIPS.includes(currentDuration);
  const chipButtons = DURATION_CHIPS.map((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = d >= 60 ? (d % 60 === 0 ? d / 60 + "h" : Math.floor(d / 60) + "h" + (d % 60) + "m") : d + "m";
    b.setAttribute("aria-pressed", String(d === currentDuration));
    b.addEventListener("click", () => {
      currentDuration = d;
      chipButtons.forEach((cb) => cb.setAttribute("aria-pressed", "false"));
      customChip.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
      customWrap.classList.add("hidden");
    });
    return b;
  });
  const customChip = document.createElement("button");
  customChip.type = "button";
  customChip.className = "chip";
  customChip.textContent = "Custom";
  customChip.setAttribute("aria-pressed", String(!isPreset));
  customChip.addEventListener("click", () => {
    chipButtons.forEach((cb) => cb.setAttribute("aria-pressed", "false"));
    customChip.setAttribute("aria-pressed", "true");
    customWrap.classList.remove("hidden");
    customInput.focus();
  });
  chipButtons.forEach((b) => durChips.appendChild(b));
  durChips.appendChild(customChip);
  if (!isPreset) { customWrap.classList.remove("hidden"); customInput.value = String(currentDuration); }
  customInput.addEventListener("input", () => {
    const v = parseInt(customInput.value, 10);
    if (Number.isFinite(v) && v >= 5) currentDuration = v;
  });
  durField.appendChild(durChips);
  durField.appendChild(customWrap);
  body.appendChild(durField);

  // ----- Color -----
  const colorField = field("Color");
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  let currentColor = block ? block.color : "rose";
  const swatchButtons = COLORS.map(({ key, name }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch-btn";
    b.setAttribute("aria-pressed", String(key === currentColor));
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorVar(key);
    dot.textContent = key === currentColor ? "✓" : "";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = name;
    b.appendChild(dot);
    b.appendChild(lbl);
    b.addEventListener("click", () => {
      currentColor = key;
      swatchButtons.forEach((sb, i) => {
        sb.setAttribute("aria-pressed", String(COLORS[i].key === key));
        sb.querySelector(".dot").textContent = COLORS[i].key === key ? "✓" : "";
      });
    });
    return b;
  });
  swatchButtons.forEach((b) => swatches.appendChild(b));
  colorField.appendChild(swatches);
  body.appendChild(colorField);

  // ----- Done -----
  const doneField = document.createElement("div");
  doneField.className = "field toggle-row";
  const doneLbl = document.createElement("label");
  doneLbl.textContent = "Done";
  doneLbl.style.marginBottom = "0";
  const doneSwitch = document.createElement("button");
  doneSwitch.type = "button";
  doneSwitch.className = "switch";
  let currentDone = block ? !!block.done : false;
  doneSwitch.setAttribute("role", "switch");
  doneSwitch.setAttribute("aria-checked", String(currentDone));
  doneSwitch.addEventListener("click", () => {
    currentDone = !currentDone;
    doneSwitch.setAttribute("aria-checked", String(currentDone));
  });
  doneField.appendChild(doneLbl);
  doneField.appendChild(doneSwitch);
  body.appendChild(doneField);

  const errBox = document.createElement("div");
  errBox.className = "err-box hidden";
  body.appendChild(errBox);

  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  let deleteBtn = null;
  if (mode === "edit") {
    deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn danger";
    deleteBtn.textContent = "Delete";
    foot.appendChild(deleteBtn);
  }
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn ghost";
  cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Save";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);

  sheet.appendChild(header);
  sheet.appendChild(body);
  sheet.appendChild(foot);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  host.appendChild(overlay);

  const state = {
    mode, id: block ? block.id : null, date,
    fields: { title: titleInput, subtitle: subtitleInput, note: noteInput, detail: detailInput, start: startInput },
    get duration() { return currentDuration; },
    get color() { return currentColor; },
    get done() { return currentDone; },
  };
  state.initial = readForm(state);

  const returnFocus = document.activeElement;
  const focusablesSelector = "button, input, textarea, select, [tabindex]:not([tabindex='-1'])";

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = Array.from(sheet.querySelectorAll(focusablesSelector)).filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function requestClose() {
    if (isDirty(state)) {
      const ok = await confirmDialog({
        title: "Discard changes?",
        message: "You have unsaved changes to this block.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!ok) return;
    }
    doClose();
  }

  function doClose() {
    document.removeEventListener("keydown", onKeydown);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    store.clearDraft();
    openState = null;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
    trapFocus(e);
  }

  // IME composition guard: never let a composition-committing Enter submit the form.
  let composing = false;
  [titleInput, subtitleInput, noteInput, detailInput].forEach((el) => {
    el.addEventListener("compositionstart", () => { composing = true; });
    el.addEventListener("compositionend", () => { composing = false; });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (composing || e.isComposing)) { e.stopPropagation(); return; }
      if (e.key === "Enter" && el !== detailInput) { e.preventDefault(); }
    });
  });

  closeBtn.addEventListener("click", requestClose);
  cancelBtn.addEventListener("click", requestClose);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) requestClose(); });
  document.addEventListener("keydown", onKeydown);

  startInput.addEventListener("change", applyStartChange);

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Delete block?",
        message: `"${block.title}" will be removed.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      doClose();
      if (onDeleted) onDeleted(block);
    });
  }

  saveBtn.addEventListener("click", async () => {
    errBox.classList.add("hidden");
    let raw;
    try {
      const rawStart = parseHHMM(startInput.value);
      raw = normalizeBlock({
        id: state.id,
        date,
        start: rawStart == null ? (block ? block.start : start ?? 480) : snapMinutes(rawStart, snapUnit),
        duration: currentDuration,
        title: titleInput.value,
        subtitle: subtitleInput.value,
        note: noteInput.value,
        detail: detailInput.value,
        color: currentColor,
        done: currentDone,
        createdAt: block ? block.createdAt : undefined,
      });
    } catch (err) {
      errBox.textContent = err.message || "Please check the form.";
      errBox.classList.remove("hidden");
      return;
    }
    try {
      await store.putBlock(raw);
    } catch (err) {
      errBox.textContent = "Couldn't save — storage may be full. Your text is still here.";
      errBox.classList.remove("hidden");
      return;
    }
    doClose();
    announce(`${raw.title} saved, ${hhmm(raw.start)} to ${hhmm(raw.start + raw.duration)}`);
    if (onSaved) onSaved(raw);
  });

  openState = { overlay, requestClose };

  window.requestAnimationFrame(() => titleInput.focus());
  if (mode === "create") titleInput.select();
}

function field(labelText) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  if (labelText) {
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
  }
  return wrap;
}
