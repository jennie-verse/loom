function pad(value) {
  return String(Math.abs(value)).padStart(2, "0");
}

export function localIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid journal timestamp");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${String(date.getMilliseconds()).padStart(3, "0")}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function blockStartIso(block) {
  const [year, month, day] = String(block.date).split("-").map(Number);
  const start = Math.max(0, Math.min(1439, Number(block.start) || 0));
  return localIso(new Date(year, month - 1, day, Math.floor(start / 60), start % 60, 0, 0));
}

export function blockToJournalRecord(block, options = {}) {
  if (!block || typeof block.id !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(block.date)) {
    throw new Error("Invalid Loom block");
  }
  let updatedAt;
  try { updatedAt = localIso(options.updatedAt || block.updatedAt); }
  catch { updatedAt = localIso(); }
  const includeContent = options.includeContent !== false;
  return {
    id: block.id,
    kind: "block",
    at: blockStartIso(block),
    updatedAt,
    deleted: options.deleted === true,
    title: includeContent ? String(block.title || "Untitled block") : "Loom block",
    data: {
      date: block.date,
      start: Math.max(0, Number(block.start) || 0),
      duration: Math.max(0, Number(block.duration) || 0),
      ...(includeContent ? { title: String(block.title || ""), subtitle: String(block.subtitle || ""), note: String(block.note || ""), detail: String(block.detail || "") } : {}),
      color: String(block.color || "rose"),
      done: block.done === true, contentIncluded: includeContent,
    },
  };
}

export function blockActivityRecord(entry, block, { includeContent = true } = {}) {
  return { id: `${entry.blockId}:${entry.date}`, kind: "block-activity", at: entry.firstAt, updatedAt: entry.lastAt, deleted: false,
    title: includeContent ? String(block?.title || entry.title || "Untitled block") : "Loom block",
    data: { activityDate: entry.date, sourceDate: entry.sourceDate, previousSourceDate: entry.previousSourceDate || undefined,
      actions: entry.actions, firstAt: entry.firstAt, lastAt: entry.lastAt, contentIncluded: includeContent,
      historyAccuracy: "exact", originTimestamp: entry.lastAt } };
}
