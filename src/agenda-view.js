// agenda-view.js — list rendering and row-level actions. No timeline math here.

import { hhmm } from "./model.js";

export function renderAgenda(listEl, { blocks, handlers }) {
  listEl.replaceChildren();
  if (blocks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "agenda-empty";
    empty.textContent = "No blocks — switch to Day to tap an hour and add one";
    listEl.appendChild(empty);
    return;
  }

  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (const b of sorted) {
    const li = document.createElement("li");
    li.className = "agenda-row" + (b.done ? " done" : "");

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `var(--c-${b.color})`;
    li.appendChild(swatch);

    const body = document.createElement("button");
    body.type = "button";
    body.className = "body";
    body.setAttribute("aria-label", `${b.title}, ${hhmm(b.start)} to ${hhmm(b.start + b.duration)}${b.detail ? ", has detail note" : ""}${b.done ? ", done" : ""}`);

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.duration)}`;
    body.appendChild(time);

    const t = document.createElement("div");
    t.className = "t";
    t.textContent = b.title;
    body.appendChild(t);

    if (b.subtitle) {
      const s = document.createElement("div");
      s.className = "s";
      s.textContent = b.subtitle;
      body.appendChild(s);
    }
    if (b.note) {
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = b.note;
      body.appendChild(n);
    }
    body.addEventListener("click", () => handlers.onEdit(b));
    li.appendChild(body);

    if (b.detail) {
      const pip = document.createElement("span");
      pip.className = "pip";
      pip.setAttribute("aria-label", "Has detail note");
      li.appendChild(pip);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.setAttribute("aria-label", b.done ? `Mark ${b.title} not done` : `Mark ${b.title} done`);
    doneBtn.textContent = "✓";
    doneBtn.style.color = b.done ? "var(--mint)" : "var(--text-2)";
    doneBtn.addEventListener("click", () => handlers.onToggleDone(b));
    actions.appendChild(doneBtn);

    const dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.setAttribute("aria-label", `Duplicate ${b.title}`);
    dupBtn.textContent = "⧉";
    dupBtn.addEventListener("click", () => handlers.onDuplicate(b));
    actions.appendChild(dupBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", `Delete ${b.title}`);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => handlers.onDelete(b));
    actions.appendChild(delBtn);

    li.appendChild(actions);
    listEl.appendChild(li);
  }
}
