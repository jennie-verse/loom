// calendar-sheet.js — month date picker, dots on days that have blocks.

import { dateKey, parseDateKey, todayKey, pad2 } from "./model.js";
import * as store from "./store.js";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export async function openCalendarSheet({ selectedDate, weekStart = 0, onPick }) {
  const allBlocks = await store.getAllBlocks().catch(() => []);
  const datesWithBlocks = new Set(allBlocks.map((b) => b.date));

  let viewDate = parseDateKey(selectedDate);
  viewDate.setDate(1);

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const frame = document.createElement("div");
  frame.className = "frame";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Choose date");

  const header = document.createElement("div");
  header.className = "sheet-hdr";
  const h2 = document.createElement("h2");
  h2.textContent = "Choose date";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ico";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  header.appendChild(h2);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "sheet-body";

  const nav = document.createElement("div");
  nav.className = "cal-hdr";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button"; prevBtn.className = "ico"; prevBtn.setAttribute("aria-label", "Previous month"); prevBtn.textContent = "‹";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button"; nextBtn.className = "ico"; nextBtn.setAttribute("aria-label", "Next month"); nextBtn.textContent = "›";
  const lbl = document.createElement("div");
  lbl.className = "lbl";
  const todayBtn = document.createElement("button");
  todayBtn.type = "button"; todayBtn.className = "chip"; todayBtn.textContent = "Today";
  nav.appendChild(prevBtn); nav.appendChild(lbl); nav.appendChild(nextBtn); nav.appendChild(todayBtn);
  body.appendChild(nav);

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  body.appendChild(grid);

  function renderMonth() {
    lbl.textContent = `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
    grid.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = document.createElement("div");
      d.className = "cal-dow";
      d.textContent = DOW[(i + weekStart) % 7];
      grid.appendChild(d);
    }
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const startOffset = (first.getDay() - weekStart + 7) % 7;
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const today = todayKey();

    for (let i = 0; i < startOffset; i++) {
      const filler = document.createElement("div");
      grid.appendChild(filler);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dateKey(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      if (key === today) btn.classList.add("today");
      if (key === selectedDate) btn.classList.add("selected");
      const num = document.createElement("span");
      num.textContent = String(day);
      btn.appendChild(num);
      if (datesWithBlocks.has(key)) {
        const dot = document.createElement("span");
        dot.className = "dot";
        btn.appendChild(dot);
      }
      btn.setAttribute("aria-label", key + (datesWithBlocks.has(key) ? ", has blocks" : ""));
      btn.addEventListener("click", () => { close(); onPick(key); });
      grid.appendChild(btn);
    }
  }

  prevBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderMonth(); });
  nextBtn.addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderMonth(); });
  todayBtn.addEventListener("click", () => { close(); onPick(todayKey()); });

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

  renderMonth();
}
