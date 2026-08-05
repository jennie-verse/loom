// ui.js — toasts, Undo, confirm dialogs, aria-live announcements. No domain logic.

const toastsHost = () => document.getElementById("toasts");
const liveRegion = () => document.getElementById("aria-live");

let currentToast = null; // { el, timer, onExpire }

export function announce(message) {
  const region = liveRegion();
  if (!region) return;
  region.textContent = "";
  // Re-trigger even if the same message repeats.
  window.requestAnimationFrame(() => { region.textContent = message; });
}

function settleCurrentToast() {
  if (!currentToast) return;
  clearTimeout(currentToast.timer);
  if (currentToast.onExpire) currentToast.onExpire();
  if (currentToast.el && currentToast.el.parentNode) currentToast.el.parentNode.removeChild(currentToast.el);
  currentToast = null;
}

// Plain status toast (no undo action) — used sparingly per plan §5-5.
export function toast(message, { duration = 3000 } = {}) {
  settleCurrentToast();
  const host = toastsHost();
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  host.appendChild(el);
  const timer = setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
    if (currentToast && currentToast.el === el) currentToast = null;
  }, duration);
  currentToast = { el, timer, onExpire: null };
}

// Undo toast: `onUndo` reverts the action, `onCommit` finalizes it (called when
// the toast expires, or immediately when superseded by a new toast).
export function undoToast(message, { onUndo, onCommit, duration = 5000 } = {}) {
  settleCurrentToast();
  const host = toastsHost();
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Undo";
  el.appendChild(span);
  el.appendChild(btn);
  host.appendChild(el);

  const finish = (committed) => {
    clearTimeout(timer);
    if (el.parentNode) el.parentNode.removeChild(el);
    if (currentToast && currentToast.el === el) currentToast = null;
    if (committed && onCommit) onCommit();
  };

  btn.addEventListener("click", () => {
    finish(false);
    if (onUndo) onUndo();
  });

  const timer = setTimeout(() => finish(true), duration);
  currentToast = { el, timer, onExpire: onCommit || null };
}

// Generic toast with a custom action button (e.g. "Reload"), no auto-commit callback.
export function actionToast(message, { actionLabel, onAction, duration = 8000 } = {}) {
  settleCurrentToast();
  const host = toastsHost();
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = actionLabel;
  el.appendChild(span);
  el.appendChild(btn);
  host.appendChild(el);
  const finish = () => {
    clearTimeout(timer);
    if (el.parentNode) el.parentNode.removeChild(el);
    if (currentToast && currentToast.el === el) currentToast = null;
  };
  btn.addEventListener("click", () => { finish(); if (onAction) onAction(); });
  const timer = setTimeout(finish, duration);
  currentToast = { el, timer, onExpire: null };
}

// Confirm dialog rendered as a small sheet-like modal. Returns a Promise<boolean>.
export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "frame";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "alertdialog");
    sheet.setAttribute("aria-modal", "true");

    const body = document.createElement("div");
    body.className = "sheet-body";
    const h2 = document.createElement("h2");
    h2.style.fontSize = "15px";
    h2.style.marginBottom = "8px";
    h2.textContent = title;
    const p = document.createElement("p");
    p.style.color = "var(--text-2)";
    p.style.fontSize = "13px";
    p.textContent = message;
    body.appendChild(h2);
    body.appendChild(p);

    const foot = document.createElement("div");
    foot.className = "sheet-foot";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = cancelLabel;
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = danger ? "btn danger" : "btn primary";
    okBtn.textContent = confirmLabel;
    foot.appendChild(cancelBtn);
    foot.appendChild(okBtn);

    sheet.appendChild(body);
    sheet.appendChild(foot);
    frame.appendChild(sheet);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    const previousFocus = document.activeElement;
    okBtn.focus();

    function close(result) {
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      if (e.key === "Tab") {
        const focusables = [cancelBtn, okBtn];
        const idx = focusables.indexOf(document.activeElement);
        e.preventDefault();
        const next = e.shiftKey ? (idx <= 0 ? focusables.length - 1 : idx - 1) : (idx === focusables.length - 1 ? 0 : idx + 1);
        focusables[next].focus();
      }
    }

    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey);
  });
}
