// day-view.js — timeline rendering, drag/resize, current-time line, Now & Next,
// night collapse. Never touches storage directly; all persistence goes through
// the handlers supplied by app.js.

import {
  MINUTES_PER_DAY, hhmm, pad2, nowMinutes, tierOf, effectiveHourHeight,
  computeOverlapLayout, clusterMembersFor, snapMinutes, dayProgress, formatDuration,
  findNowNext, TIERS,
} from "./model.js";
import { announce } from "./ui.js";

const NIGHT_END_HOUR = 6;
const NIGHT_BAND_PX = 26;
const HOLD_MS = 400;
const MOVE_THRESHOLD = 10;
const EDGE_EXCLUDE_PX = 24;
const SWIPE_MIN_DX = 60;
const AUTOSCROLL_ZONE = 60;

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createDayView({ scrollEl, gridEl, handlers }) {
  const nightExpanded = new Set(); // date keys expanded this session
  let clockTimer = null;
  let lastCtx = null;
  let drag = null; // active gesture state
  let focusedBlockId = null;

  function yFor(min, hh, night) {
    if (!night) return (min / 60) * hh;
    const nightMin = NIGHT_END_HOUR * 60;
    if (min <= nightMin) return (min / nightMin) * NIGHT_BAND_PX;
    return NIGHT_BAND_PX + ((min - nightMin) / 60) * hh;
  }

  function minFor(y, hh, night) {
    const nightMin = NIGHT_END_HOUR * 60;
    if (!night) return (y / hh) * 60;
    if (y <= NIGHT_BAND_PX) return (y / NIGHT_BAND_PX) * nightMin;
    return nightMin + ((y - NIGHT_BAND_PX) / hh) * 60;
  }

  function render(ctx) {
    lastCtx = ctx;
    const { date, blocks, settings, isToday } = ctx;
    const f = settings.font;
    const hh = effectiveHourHeight(settings.hourHeight, f);
    const nightOn = settings.collapseNight
      && !nightExpanded.has(date)
      && !blocks.some((b) => b.start < NIGHT_END_HOUR * 60);

    gridEl.style.setProperty("--f", f + "px");
    gridEl.style.setProperty("--hh", hh + "px");

    const total = yFor(MINUTES_PER_DAY, hh, nightOn);
    gridEl.style.height = total + "px";
    const focusToRestore = focusedBlockId;
    gridEl.replaceChildren();

    // hour rows + half-hour lines + hit targets for empty-slot tap
    for (let hnum = 0; hnum <= 24; hnum++) {
      const mn = hnum * 60;
      if (nightOn && hnum > 0 && hnum < NIGHT_END_HOUR) continue;
      const top = yFor(mn, hh, nightOn);
      const row = document.createElement("div");
      row.className = "hour";
      row.style.top = top + "px";
      row.style.height = hh + "px";
      const span = document.createElement("span");
      span.textContent = pad2(hnum);
      row.appendChild(span);
      gridEl.appendChild(row);

      if (hnum < 24 && !(nightOn && hnum < NIGHT_END_HOUR)) {
        const half = document.createElement("div");
        half.className = "half";
        half.style.top = (top + hh / 2) + "px";
        gridEl.appendChild(half);

        if (!(nightOn && mn < NIGHT_END_HOUR * 60)) {
          const hit = document.createElement("button");
          hit.type = "button";
          hit.className = "hourhit";
          hit.style.top = top + "px";
          hit.style.height = hh + "px";
          hit.setAttribute("aria-label", `Add block at ${pad2(hnum)}:00`);
          hit.addEventListener("click", (e) => {
            const rect = hit.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const rawMin = mn + (offsetY / hh) * 60;
            const snapped = snapMinutes(rawMin, settings.snap);
            handlers.onCreate({ date, start: Math.min(snapped, MINUTES_PER_DAY - 30), duration: 30 });
          });
          gridEl.appendChild(hit);
        }
      }
    }

    if (nightOn) {
      const night = document.createElement("button");
      night.type = "button";
      night.className = "night";
      night.style.top = "2px";
      night.style.height = Math.max(0, NIGHT_BAND_PX - 4) + "px";
      night.textContent = "00–06 · tap to expand";
      night.addEventListener("click", () => {
        nightExpanded.add(date);
        render(lastCtx);
      });
      gridEl.appendChild(night);
    }

    // lanes (blocks)
    const lanes = document.createElement("div");
    lanes.className = "lanes";
    gridEl.appendChild(lanes);

    const { layout, clusters, overflow } = computeOverlapLayout(blocks);
    const sorted = [...blocks].sort((a, b) => a.start - b.start);

    for (const b of sorted) {
      const entry = layout.get(b.id);
      if (entry.col < 0) continue; // folded into overflow
      const top = yFor(b.start, hh, nightOn);
      const bottom = yFor(b.start + b.duration, hh, nightOn);
      const h = Math.max(bottom - top, 14);
      const of = entry.of;
      const col = entry.col;
      const gap = 3;
      const wExpr = of === 1 ? "100%" : `calc((100% - ${gap * (of - 1)}px) / ${of})`;
      const left = col === 0 ? "0px" : `calc((100% + ${gap}px) / ${of} * ${col})`;

      const el = renderBlock(b, top, h, left, wExpr, f);
      lanes.appendChild(el);
      attachBlockInteractions(el, b, { hh, nightOn, date, settings });

      const of1 = overflow.get(b.id);
      if (of1) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "more";
        more.style.top = (top + h + 3) + "px";
        more.style.height = "18px";
        more.style.left = left;
        more.style.width = wExpr;
        more.textContent = `+${of1.count}`;
        more.setAttribute("aria-label", `${of1.count} more overlapping block${of1.count > 1 ? "s" : ""}`);
        more.addEventListener("click", () => {
          const members = clusterMembersFor(clusters, of1.clusterId);
          openOverlapSheet(members, (picked) => handlers.onEdit(picked));
        });
        lanes.appendChild(more);
      }
    }

    // current-time line
    let nowLine = null;
    if (isToday) {
      nowLine = document.createElement("div");
      nowLine.className = "nowline";
      nowLine.style.top = yFor(nowMinutes(), hh, nightOn) + "px";
      gridEl.appendChild(nowLine);
    }

    // empty-day hint
    if (blocks.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      const p = document.createElement("p");
      p.textContent = "No blocks — tap an hour to start";
      hint.appendChild(p);
      if (ctx.emptyTemplateChip) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = `Apply ${ctx.emptyTemplateChip.name}`;
        chip.addEventListener("click", () => handlers.onApplyTemplateChip(ctx.emptyTemplateChip.id));
        hint.appendChild(chip);
      }
      gridEl.appendChild(hint);
    }

    if (focusToRestore) {
      const toFocus = lanes.querySelector(`[data-id="${CSS.escape(focusToRestore)}"]`);
      if (toFocus) toFocus.focus();
    }

    return { scrollToMinute: (min) => scrollToMinute(min, hh, nightOn) };
  }

  function renderBlock(b, top, h, left, wExpr, f) {
    const tier = tierOf(h, f);
    const el = document.createElement("div");
    el.className = `blk ${b.color}${b.done ? " done" : ""}`;
    el.style.top = top + "px";
    el.style.height = h + "px";
    el.style.left = left;
    el.style.width = wExpr;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.id = b.id;
    const hasDetail = !!b.detail;
    if (tier === TIERS.COMPACT) el.classList.add("has-when");
    if (hasDetail) el.classList.add("has-pip");

    const t = document.createElement("div");
    t.className = "t";
    t.textContent = b.title;
    el.appendChild(t);

    if (tier === TIERS.COMPACT) {
      const when = document.createElement("div");
      when.className = "when";
      when.textContent = hhmm(b.start);
      el.appendChild(when);
    }
    if (tier === TIERS.STANDARD) {
      const mid = b.subtitle || b.note;
      if (mid) {
        const s = document.createElement("div");
        s.className = "s";
        s.textContent = mid;
        el.appendChild(s);
      }
    }
    if (tier === TIERS.FULL || tier === TIERS.FULL_PLUS) {
      if (b.subtitle) {
        const s = document.createElement("div");
        s.className = "s";
        s.textContent = b.subtitle;
        el.appendChild(s);
      }
      if (b.note) {
        const n = document.createElement("div");
        n.className = "n " + (tier === TIERS.FULL_PLUS ? "two" : "one");
        n.textContent = b.note;
        el.appendChild(n);
      }
    }
    if (hasDetail) {
      const pip = document.createElement("span");
      pip.className = "pip";
      pip.setAttribute("aria-label", "Has detail note");
      el.appendChild(pip);
    }
    if (b.done) {
      const chk = document.createElement("span");
      chk.className = "chk";
      chk.textContent = "✓";
      el.appendChild(chk);
    }

    const rz = document.createElement("div");
    rz.className = "rzhandle";
    rz.setAttribute("aria-hidden", "true");
    el.appendChild(rz);

    const endLabel = hhmm(b.start + b.duration);
    el.setAttribute("aria-label", `${b.title}, ${hhmm(b.start)} to ${endLabel}${hasDetail ? ", has detail note" : ""}${b.done ? ", done" : ""}`);

    return el;
  }

  function attachBlockInteractions(el, block, { hh, nightOn, date, settings }) {
    const rz = el.querySelector(".rzhandle");

    el.addEventListener("keydown", (e) => onBlockKeydown(e, block, { hh, nightOn, date, settings }));
    el.addEventListener("focus", () => { focusedBlockId = block.id; });
    el.addEventListener("blur", () => { if (focusedBlockId === block.id) focusedBlockId = null; });

    rz.addEventListener("pointerdown", (e) => startResize(e, el, rz, block, { hh, nightOn, date, settings }));

    el.addEventListener("pointerdown", (e) => {
      if (e.target === rz) return;
      startPress(e, el, block, { hh, nightOn, date, settings });
    });

    el.addEventListener("click", (e) => {
      if (drag && drag.suppressClick) { e.preventDefault(); return; }
      handlers.onEdit(block);
    });
  }

  function onBlockKeydown(e, block, { date, settings }) {
    const snap = settings.snap;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handlers.onEdit(block);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = (e.key === "ArrowUp" ? -1 : 1) * snap;
      if (e.shiftKey) {
        const newDuration = Math.max(5, Math.min(MINUTES_PER_DAY - block.start, block.duration + delta));
        handlers.onMoveResize({ ...block, duration: newDuration }, () => {
          announce(`${block.title} length changed to ${formatDuration(newDuration)}`);
        });
      } else {
        const newStart = Math.max(0, Math.min(MINUTES_PER_DAY - block.duration, block.start + delta));
        handlers.onMoveResize({ ...block, start: newStart }, () => {
          announce(`${block.title} moved to ${hhmm(newStart)}`);
        });
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      handlers.onDeleteWithUndo(block);
    }
  }

  function startPress(e, el, block, ctxLocal) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const origTop = parseFloat(el.style.top);
    let armed = false;
    let moved = false;
    let cancelled = false;
    let secondPointer = false;

    const holdTimer = setTimeout(() => {
      if (cancelled) return;
      armed = true;
      el.classList.add("dragging");
      if (!prefersReducedMotion()) el.style.transition = "box-shadow .1s, transform .1s";
    }, HOLD_MS);

    function onExtraPointerDown(ev) {
      if (ev.pointerId === pointerId) return;
      secondPointer = true;
      cancel();
    }

    function cancel() {
      cancelled = true;
      clearTimeout(holdTimer);
      el.classList.remove("dragging");
      el.style.transform = "";
      document.removeEventListener("pointerdown", onExtraPointerDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopAutoScroll();
    }

    function onMove(ev) {
      if (cancelled || !armed) {
        const dy = Math.abs(ev.clientY - startY);
        const dx = Math.abs(ev.clientX - startX);
        if (!armed && (dy > MOVE_THRESHOLD || dx > MOVE_THRESHOLD)) {
          // moved before hold fired: this is a page scroll, bail out entirely
          cancel();
        }
        return;
      }
      moved = true;
      ev.preventDefault();
      const dy = ev.clientY - startY;
      const newTop = origTop + dy;
      el.style.transform = `translateY(${newTop - origTop}px)`;
      maybeAutoScroll(ev.clientY);
    }

    function onUp(ev) {
      clearTimeout(holdTimer);
      document.removeEventListener("pointerdown", onExtraPointerDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopAutoScroll();
      el.classList.remove("dragging");

      if (cancelled || secondPointer) {
        el.style.transform = "";
        return;
      }
      if (!armed) {
        // quick tap: let the click handler open the edit sheet
        el.style.transform = "";
        return;
      }
      if (!moved) {
        el.style.transform = "";
        drag = { suppressClick: true };
        setTimeout(() => { drag = null; }, 0);
        openContextMenu(el, block);
        return;
      }
      // committed move
      drag = { suppressClick: true };
      setTimeout(() => { drag = null; }, 0);
      const dy = ev.clientY - startY;
      const rawStart = minFor(origTop + dy, ctxLocal.hh, ctxLocal.nightOn);
      let newStart = snapMinutes(rawStart, ctxLocal.settings.snap);
      newStart = Math.max(0, Math.min(MINUTES_PER_DAY - block.duration, newStart));
      el.style.transform = "";
      if (newStart !== block.start) {
        handlers.onMoveResize({ ...block, start: newStart }, () => {
          announce(`${block.title} moved to ${hhmm(newStart)}`);
        });
      }
    }

    document.addEventListener("pointerdown", onExtraPointerDown, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function startResize(e, el, rz, block, ctxLocal) {
    e.stopPropagation();
    e.preventDefault();
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const origH = parseFloat(el.style.height);
    el.classList.add("dragging");

    function onMove(ev) {
      ev.preventDefault();
      const dy = ev.clientY - startY;
      el.style.height = Math.max(14, origH + dy) + "px";
      maybeAutoScroll(ev.clientY);
    }
    function onUp(ev) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopAutoScroll();
      el.classList.remove("dragging");
      drag = { suppressClick: true };
      setTimeout(() => { drag = null; }, 0);
      const dy = ev.clientY - startY;
      const bottom = parseFloat(el.style.top) + origH + dy;
      const rawEnd = minFor(bottom, ctxLocal.hh, ctxLocal.nightOn);
      let newEnd = snapMinutes(rawEnd, ctxLocal.settings.snap);
      newEnd = Math.max(block.start + 5, Math.min(MINUTES_PER_DAY, newEnd));
      const newDuration = newEnd - block.start;
      if (newDuration !== block.duration) {
        handlers.onMoveResize({ ...block, duration: newDuration }, () => {
          announce(`${block.title} length changed to ${formatDuration(newDuration)}`);
        });
      } else {
        render(lastCtx);
      }
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  let autoScrollRAF = null;
  function maybeAutoScroll(clientY) {
    const rect = scrollEl.getBoundingClientRect();
    let speed = 0;
    if (clientY < rect.top + AUTOSCROLL_ZONE) speed = -Math.ceil((rect.top + AUTOSCROLL_ZONE - clientY) / 4);
    else if (clientY > rect.bottom - AUTOSCROLL_ZONE) speed = Math.ceil((clientY - (rect.bottom - AUTOSCROLL_ZONE)) / 4);
    if (speed === 0) { stopAutoScroll(); return; }
    if (autoScrollRAF) return;
    const step = () => {
      scrollEl.scrollTop += speed;
      autoScrollRAF = requestAnimationFrame(step);
    };
    autoScrollRAF = requestAnimationFrame(step);
  }
  function stopAutoScroll() {
    if (autoScrollRAF) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
  }

  function openContextMenu(anchorEl, block) {
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.left = Math.min(rect.left, window.innerWidth - 160) + "px";
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.background = "var(--card)";
    menu.style.border = "1px solid var(--line)";
    menu.style.borderRadius = "10px";
    menu.style.boxShadow = "0 6px 16px rgba(74,58,64,.2)";
    menu.style.zIndex = "40";
    menu.style.overflow = "hidden";
    menu.setAttribute("role", "menu");

    const dup = document.createElement("button");
    dup.type = "button";
    dup.textContent = "Duplicate";
    dup.setAttribute("role", "menuitem");
    styleMenuItem(dup);
    dup.addEventListener("click", () => { close(); handlers.onDuplicate(block); });

    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("role", "menuitem");
    del.style.color = "var(--coral)";
    styleMenuItem(del);
    del.addEventListener("click", () => { close(); handlers.onDeleteWithUndo(block); });

    menu.appendChild(dup);
    menu.appendChild(del);
    document.body.appendChild(menu);
    dup.focus();

    function onDocClick(e) { if (!menu.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    function close() {
      document.removeEventListener("pointerdown", onDocClick, true);
      document.removeEventListener("keydown", onKey);
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      anchorEl.focus();
    }
    setTimeout(() => document.addEventListener("pointerdown", onDocClick, true), 0);
    document.addEventListener("keydown", onKey);
  }
  function styleMenuItem(btn) {
    btn.style.display = "block";
    btn.style.width = "140px";
    btn.style.minHeight = "44px";
    btn.style.padding = "0 14px";
    btn.style.textAlign = "left";
    btn.style.background = "none";
    btn.style.border = "0";
    btn.style.font = "inherit";
    btn.style.cursor = "pointer";
  }

  function openOverlapSheet(members, onPick) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const frame = document.createElement("div");
    frame.className = "frame";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Overlapping blocks");
    const header = document.createElement("div");
    header.className = "sheet-hdr";
    const h2 = document.createElement("h2");
    h2.textContent = "Overlapping blocks";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ico";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
    header.appendChild(h2);
    header.appendChild(closeBtn);
    const body = document.createElement("div");
    body.className = "sheet-body";
    const list = document.createElement("ul");
    list.className = "agenda-list";
    list.style.padding = "0";
    for (const b of members) {
      const li = document.createElement("li");
      li.className = "agenda-row";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = `var(--c-${b.color})`;
      const btn = document.createElement("button");
      btn.className = "body";
      btn.type = "button";
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = `${hhmm(b.start)}–${hhmm(b.start + b.duration)}`;
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = b.title;
      btn.appendChild(time);
      btn.appendChild(t);
      btn.addEventListener("click", () => { close(); onPick(b); });
      li.appendChild(swatch);
      li.appendChild(btn);
      list.appendChild(li);
    }
    body.appendChild(list);
    sheet.appendChild(header);
    sheet.appendChild(body);
    frame.appendChild(sheet);
    overlay.appendChild(frame);
    document.getElementById("sheet-host").appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  function scrollToMinute(min, hh, nightOn) {
    const top = yFor(min, hh, nightOn);
    scrollEl.scrollTop = Math.max(0, top - scrollEl.clientHeight / 2);
  }

  function attachSwipe(onSwipe) {
    let startX = null, startY = null, tracking = false;
    scrollEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.clientX < EDGE_EXCLUDE_PX || e.clientX > window.innerWidth - EDGE_EXCLUDE_PX) return;
      if (e.target.closest(".blk") || e.target.closest(".rzhandle")) return;
      startX = e.clientX; startY = e.clientY; tracking = true;
    });
    scrollEl.addEventListener("pointerup", (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) >= SWIPE_MIN_DX && Math.abs(dx) > 2 * Math.abs(dy)) {
        onSwipe(dx > 0 ? -1 : 1);
      }
    });
    scrollEl.addEventListener("pointercancel", () => { tracking = false; });
  }

  function renderNowNext(el, { date, blocks, isToday, onTap }) {
    el.replaceChildren();
    el.onclick = onTap;
    if (isToday) {
      const { now, next, extra } = findNowNext(blocks, nowMinutes());
      const dot = document.createElement("span"); dot.className = "dot";
      const l = document.createElement("span"); l.className = "l";
      l.textContent = now ? `${now.title} · ${Math.max(0, (now.start + now.duration) - nowMinutes())}m left${extra ? ` +${extra}` : ""}` : "Free";
      const arw = document.createElement("span"); arw.className = "arw"; arw.textContent = "→";
      const r = document.createElement("span"); r.className = "r";
      r.textContent = next ? `${next.title} ${hhmm(next.start)}` : "Nothing left today";
      el.appendChild(dot); el.appendChild(l); el.appendChild(arw); el.appendChild(r);
    } else {
      const { total, totalMin } = dayProgress(blocks);
      const l = document.createElement("span"); l.className = "l";
      l.textContent = total === 0 ? "No blocks" : `${total} block${total > 1 ? "s" : ""} · ${formatDuration(totalMin)}`;
      el.appendChild(l);
    }
  }

  function startClock(rerenderFn) {
    stopClock();
    clockTimer = setInterval(rerenderFn, 60000);
    document.addEventListener("visibilitychange", onVisibility);
    function onVisibility() {
      if (document.hidden) {
        stopClock(false);
      } else {
        rerenderFn();
        clockTimer = setInterval(rerenderFn, 60000);
      }
    }
    startClock._onVisibility = onVisibility;
  }
  function stopClock(removeListener = true) {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (removeListener && startClock._onVisibility) {
      document.removeEventListener("visibilitychange", startClock._onVisibility);
    }
  }

  attachSwipe((dir) => handlers.onSwipe(dir));

  return {
    render,
    renderNowNext,
    scrollToMinute: (min) => { if (lastCtx) { const hh = effectiveHourHeight(lastCtx.settings.hourHeight, lastCtx.settings.font); scrollToMinute(min, hh, lastCtx.settings.collapseNight && !nightExpanded.has(lastCtx.date) && !lastCtx.blocks.some((b) => b.start < NIGHT_END_HOUR * 60)); } },
    startClock,
    stopClock,
    minuteAtScrollCenter: () => {
      if (!lastCtx) return null;
      const hh = effectiveHourHeight(lastCtx.settings.hourHeight, lastCtx.settings.font);
      const nightOn = lastCtx.settings.collapseNight && !nightExpanded.has(lastCtx.date) && !lastCtx.blocks.some((b) => b.start < NIGHT_END_HOUR * 60);
      return minFor(scrollEl.scrollTop + scrollEl.clientHeight / 2, hh, nightOn);
    },
  };
}
