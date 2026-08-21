/* sync.js — webapp-data(비공개 저장소)와 주고받는 부분만 모아 둔 모듈.
   화면 코드는 여기 함수만 부르고 GitHub API 를 직접 다루지 않습니다.

   loom 은 빌드 도구가 없어 공용 모듈을 상대 경로로 부릅니다.
   (focus 는 Vite 로 번들해야 해서 절대 주소를 씁니다.)

   다루는 것 세 가지입니다.
     A. loom/data.<ctx>.json            기기 간 동기화 (블록 + 템플릿)
     B. events/loom.<ctx>.YYYY-MM.json  공용 활동 기록 (atlas·trace 가 읽음)
     C. backups/loom/YYYY-MM-DD.json    복원용 스냅샷 (최근 12개 유지)

   동기화는 기본으로 꺼져 있습니다. 꺼진 상태에서도 앱은 완전히 동작해야 하고,
   로컬 저장이 언제나 먼저입니다. */

import { LIMITS, clampText, pad2 } from "./model.js";

const NAMESPACE = "loom";
const HOSTNAME = globalThis.location?.hostname || "";

/* ── 공용 모듈은 필요할 때만 부릅니다 ──────────────────────────────────────

   `import * as Shared from "../../shared/v1/sync.js"` 처럼 정적으로 부르면,
   그 파일 하나를 못 받는 순간 **앱 전체가 빈 화면이 됩니다.** app.js →
   sync-runner.js → sync.js 로 이어지는 모듈 그래프가 통째로 실패하기 때문입니다.
   loom 은 원래 저장소 밖 파일에 하나도 기대지 않는 앱이었고, 동기화를 껐을 때는
   지금도 완전히 동작해야 합니다. 그래서 통신이 필요한 순간에만 동적으로 부르고,
   실패하면 동기화만 쉬게 합니다. (2026-08-10 재현으로 확인) */

let sharedPromise = null;

async function api() {
  if (!sharedPromise) {
    sharedPromise = import("../../shared/v1/sync.js").catch((cause) => {
      sharedPromise = null; // 다음에 다시 시도합니다.
      const error = new Error("The shared sync module could not be loaded.");
      error.type = "network";
      error.cause = cause;
      throw error;
    });
  }
  return sharedPromise;
}

const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io")
    ? HOSTNAME.slice(0, -".github.io".length)
    : "",
  repo: "webapp-data",
  branch: "main",
});

export const KEYS = Object.freeze({
  token: "sync.token.v1",
  enabled: "loom.syncEnabled",
  lastSyncAt: "loom.lastSyncAt",
  lastRemoteBackupAt: "loom.lastRemoteBackupAt",
  pendingEvents: "loom.pendingEvents",
  blockTombstones: "loom.blockTombstones.v1",
});

const BACKUP_KEEP = 12;
// GitHub Contents API 는 1MB 를 넘으면 읽기가 느려지고 커밋도 무거워집니다.
const MAX_FILE_BYTES = 1000000;
// 오프라인 중 쌓인 변경은 오래된 sha 로 재전송되므로 충돌이 정상적으로 납니다.
const CONFLICT_RETRY = 3;

function readItem(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/* ── 토큰과 켜짐 여부 ──────────────────────────────────────────────────── */

export function getToken() {
  return readItem(KEYS.token, "");
}

export function saveToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return false;
  return writeItem(KEYS.token, trimmed);
}

export function clearToken() {
  removeItem(KEYS.token);
}

/** 화면에는 마지막 네 자리만 보여 줍니다. */
export function tokenHint() {
  const token = getToken();
  return token ? `••••${token.slice(-4)}` : "";
}

export function isEnabled() {
  return readItem(KEYS.enabled) === "1";
}

export function setEnabled(enabled) {
  writeItem(KEYS.enabled, enabled ? "1" : "0");
}

/* 컨텍스트 관련 값은 localStorage 만 읽고 씁니다. 통신이 없으므로 공용 모듈을
   부르지 않고 여기서 처리합니다 — 앱이 뜨는 데 필요한 값이라 공용 모듈이 없는
   상황에서도 읽을 수 있어야 합니다. shared/v1 은 고정(수정하지 않음)이므로
   아래 키 이름과 경로 규칙은 바뀌지 않습니다. 검사 스크립트가 실제 shared/v1
   소스와 대조해 어긋나면 실패합니다. */

const CONTEXT_KEY = `${NAMESPACE}.syncContextId`;
const CONTEXT_LABEL_KEY = `${NAMESPACE}.syncContextLabel`;

export function getContextId() {
  return readItem(CONTEXT_KEY, "");
}

export function getContextLabel() {
  return readItem(CONTEXT_LABEL_KEY, "");
}

/** 컨텍스트별로 분리된 파일 경로. 마지막 점 앞에 기기 ID 를 넣습니다.
    (이벤트 파일 이름은 순서가 달라서 이 함수를 쓰지 않습니다 — flushEvents 참고) */
function contextFilePath(basePath, contextId) {
  const dot = basePath.lastIndexOf(".");
  if (dot === -1) return `${basePath}.${contextId}`;
  return `${basePath.slice(0, dot)}.${contextId}${basePath.slice(dot)}`;
}

/** 컨텍스트 ID 를 만듭니다.

    **ID 는 만들 때 정해지고 이후 바뀌지 않습니다.** 파일 이름에 들어가기 때문입니다.
    그래서 동기화를 켜기 전에 받은 이름을 여기로 넘겨 ID 에 반영합니다.
    이름 없이 만들면 `context-3f2a1b9c` 처럼 되어 어느 기기 파일인지 알아볼 수 없습니다.

    공용 모듈은 이름에서 영문 소문자와 숫자만 남깁니다(파일 이름 규칙).
    한글만 적으면 전부 걸러져 `context-…` 가 되므로 화면에서 영문 입력을 안내합니다. */
export async function ensureContext(preferredName) {
  const Shared = await api();
  return Shared.ensureContextId(NAMESPACE, () => String(preferredName || "").trim());
}

/** 사용자가 붙이는 이름입니다. 한글도 그대로 저장됩니다. 파일 이름과는 무관합니다. */
export function setContextLabel(label) {
  writeItem(CONTEXT_LABEL_KEY, String(label || "").trim());
}

export function getLastSyncAt() {
  return Number(readItem(KEYS.lastSyncAt, "0")) || 0;
}

export function getLastRemoteBackupAt() {
  return Number(readItem(KEYS.lastRemoteBackupAt, "0")) || 0;
}

/** 동기화가 실제로 동작할 수 있는 상태인지. 셋 중 하나라도 없으면 조용히 쉽니다. */
export function isReady() {
  return Boolean(isEnabled() && getToken() && getContextId());
}

function config() {
  return { ...REPO, token: getToken() };
}

/** 화면에 그대로 보여 줄 수 있는 영문 한 줄로 바꿉니다. */
export function describeError(error) {
  if (!error) return "Sync failed.";
  if (error.type === "auth") return "Token may be expired or lacks permission.";
  if (error.type === "network") return "Network unavailable. Changes are queued.";
  if (error.type === "notfound") return "The repository path was not found.";
  if (error.type === "conflict") return "Another device wrote first. Queued to send again.";
  if (error.type === "toolarge") return "The file is too large to sync. Export a backup file instead.";
  return "Sync failed. Check the token and repository access.";
}

function tooLarge(message) {
  const error = new Error(message);
  error.type = "toolarge";
  return error;
}

/* ── B. 공용 활동 기록 ─────────────────────────────────────────────────── */

function monthKey(isoLocal) {
  return String(isoLocal).slice(0, 7);
}

/** 로컬 오프셋을 살린 ISO 문자열. 하루 경계를 보는 앱들이 있어 UTC 로 바꾸지 않습니다. */
export function localIso(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const pad = (value) => String(Math.abs(value)).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

/** 블록이 끝나는 시각. 이벤트의 `at` 은 이 값입니다.

    체크한 시각이 아니라 **블록이 놓인 시각**을 씁니다. 어제 일정을 오늘 아침에
    체크해도 trace 의 어제 타임라인에 제자리로 들어가야 하기 때문입니다.
    `date` 는 로컬 날짜 문자열이므로 로컬 기준으로 되돌립니다. */
function blockEndDate(block) {
  const [y, m, d] = String(block.date).split("-").map((n) => parseInt(n, 10));
  const end = Math.min(1440, Number(block.start) + Number(block.duration));
  return new Date(y, m - 1, d, Math.floor(end / 60), end % 60, 0, 0);
}

/** 완료 표시한 블록 하나를 공용 이벤트 모양으로 바꿉니다.

    loom 이 헤더에서 "실제로 한 일"로 세는 기준은 `done` 입니다(`done/total`).
    이벤트도 같은 기준을 씁니다. 만들기만 하고 안 한 블록은 올리지 않습니다.
    체크를 되돌리면 같은 id 에 `deleted: true` 로 다시 올려 소비자가 감춥니다. */
export function blockToEvent(block, { deleted = false } = {}) {
  if (!block || typeof block.id !== "string" || !block.date) return null;
  const minutes = Math.max(1, Math.round(Number(block.duration) || 0));
  const event = {
    v: 1,
    id: `${NAMESPACE}:${block.id}`,
    app: NAMESPACE,
    kind: "block.done",
    at: localIso(blockEndDate(block)),
    title: `Completed a ${minutes}-min block`,
    // 사용자가 적은 제목입니다. 한글 그대로 두고, HTML 은 넣지 않습니다.
    detail: clampText(block.title, LIMITS.note),
    ref: "../loom/",
  };
  if (deleted) event.deleted = true;
  return event;
}

function pendingEvents() {
  const value = parseJson(readItem(KEYS.pendingEvents, "[]"), []);
  return Array.isArray(value) ? value : [];
}

/** 아직 보내지 못한 이벤트를 로컬에 쌓아 둡니다.
    공용 outbox 는 보낼 본문을 통째로 저장하는데, 이벤트 파일은 보낼 때마다
    원격과 다시 합쳐야 해서 본문을 미리 굳히면 안 됩니다. 그래서 이벤트만 모읍니다. */
export function queueEvent(event) {
  if (!event) return;
  const queue = pendingEvents().filter((item) => item.id !== event.id);
  queue.push(event);
  writeItem(KEYS.pendingEvents, JSON.stringify(queue));
}

export function pendingEventCount() {
  return pendingEvents().length;
}

export function clearPendingEvents() {
  writeItem(KEYS.pendingEvents, "[]");
}

function mergeEventsById(current, incoming) {
  const merged = new Map();
  current.forEach((event) => { if (event && event.id) merged.set(event.id, event); });
  let changed = false;
  incoming.forEach((event) => {
    if (!event || !event.id) return;
    const previous = merged.get(event.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(event)) return;
    merged.set(event.id, event);
    changed = true;
  });
  return { list: [...merged.values()], changed };
}

async function writeEventMonth(cfg, path, incoming) {
  const Shared = await api();
  for (let attempt = 0; attempt < CONFLICT_RETRY; attempt += 1) {
    const existing = await Shared.readFile(cfg, path);
    const current = existing.exists ? parseJson(existing.content, []) : [];
    const merged = mergeEventsById(Array.isArray(current) ? current : [], incoming);
    if (!merged.changed) return;

    const body = `${JSON.stringify(merged.list, null, 2)}\n`;
    if (body.length > MAX_FILE_BYTES) {
      throw tooLarge("The monthly event file is too large.");
    }

    try {
      await Shared.writeFile(cfg, path, body, {
        sha: existing.sha || undefined,
        message: `loom: add ${incoming.length} event(s) to ${path}`,
      });
      return;
    } catch (error) {
      // 다른 기기가 먼저 썼습니다. 최신 sha 로 다시 읽어 합친 뒤 재시도합니다.
      if (error && error.type === "conflict" && attempt < CONFLICT_RETRY - 1) continue;
      throw error;
    }
  }
}

/** 쌓인 이벤트를 달별로 나눠 보냅니다. 성공한 달의 것만 큐에서 뺍니다. */
export async function flushEvents() {
  if (!isReady()) return { sent: 0, remaining: pendingEventCount() };
  const queue = pendingEvents();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  const cfg = config();
  const contextId = getContextId();
  const byMonth = new Map();
  queue.forEach((event) => {
    const key = monthKey(event.at);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(event);
  });

  let sent = 0;
  let firstError = null;
  const stillPending = [];

  for (const [month, events] of byMonth) {
    // 이름 순서가 <앱>.<기기>.<YYYY-MM>.json 이어야 atlas·trace 파서가 알아봅니다.
    // contextFilePath() 는 마지막 점 앞에 기기 ID 를 넣기 때문에
    // loom.2026-08.<ctx>.json 이 되어 버립니다. 그래서 직접 만듭니다.
    const path = `events/${NAMESPACE}.${contextId}.${month}.json`;
    try {
      await writeEventMonth(cfg, path, events);
      sent += events.length;
    } catch (error) {
      if (!firstError) firstError = error;
      stillPending.push(...events);
    }
  }

  writeItem(KEYS.pendingEvents, JSON.stringify(stillPending));
  if (firstError && sent === 0) throw firstError;
  return { sent, remaining: stillPending.length };
}

/* ── A. 기기 간 동기화 ─────────────────────────────────────────────────── */

function dataPath(contextId) {
  return contextFilePath(`${NAMESPACE}/data.json`, contextId);
}

const EPOCH = "1970-01-01T00:00:00.000Z";

function stamp(item) {
  // 기본 템플릿에는 updatedAt 이 없습니다. 없는 쪽이 항상 지도록 둡니다.
  return String(item && item.updatedAt ? item.updatedAt : EPOCH);
}

function tombstoneStamp(item) {
  return String(item && item.deletedAt ? item.deletedAt : EPOCH);
}

function normalizeTombstones(value) {
  const merged = new Map();
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (!item || typeof item.id !== "string" || !item.id || Number.isNaN(Date.parse(item.deletedAt))) return;
    const previous = merged.get(item.id);
    if (!previous || tombstoneStamp(item) > tombstoneStamp(previous)) {
      merged.set(item.id, { id: item.id, deletedAt: item.deletedAt });
    }
  });
  return [...merged.values()];
}

function mergeTombstonesById(base, incoming) {
  return normalizeTombstones([...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

export function getBlockTombstones() {
  return normalizeTombstones(parseJson(readItem(KEYS.blockTombstones, "[]"), []));
}

function saveBlockTombstones(tombstones) {
  const normalized = normalizeTombstones(tombstones);
  writeItem(KEYS.blockTombstones, JSON.stringify(normalized));
  return normalized;
}

export function recordBlockDeletion(block) {
  if (!block || typeof block.id !== "string" || !block.id) return null;
  const tombstone = { id: block.id, deletedAt: new Date().toISOString() };
  saveBlockTombstones(mergeTombstonesById(getBlockTombstones(), [tombstone]));
  return tombstone;
}

export function clearBlockTombstone(id) {
  if (!id) return;
  saveBlockTombstones(getBlockTombstones().filter((item) => item.id !== id));
}

export function mergeBlockTombstones(incoming) {
  return saveBlockTombstones(mergeTombstonesById(getBlockTombstones(), incoming));
}

export function applyBlockTombstones(items, tombstones) {
  const deleted = new Map(normalizeTombstones(tombstones).map((item) => [item.id, item]));
  return (Array.isArray(items) ? items : []).filter((item) => {
    const tombstone = deleted.get(item && item.id);
    return !tombstone || tombstoneStamp(tombstone) < stamp(item);
  });
}

/** 같은 id 는 updatedAt 이 최신인 쪽이 이깁니다. 삭제는 tombstone이 별도로 이깁니다. */
function mergeById(base, incoming) {
  const merged = new Map();
  (Array.isArray(base) ? base : []).forEach((item) => {
    if (item && typeof item.id === "string") merged.set(item.id, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((item) => {
    if (!item || typeof item.id !== "string") return;
    const previous = merged.get(item.id);
    if (!previous || stamp(item) >= stamp(previous)) merged.set(item.id, item);
  });
  return [...merged.values()];
}

/** 이 기기의 블록·템플릿을 한 파일로 올립니다. 기기마다 파일이 분리됩니다.

    **올리기는 tombstone 없는 기록을 실수로 줄이지 않습니다.** 원격 항목과 합집합을
    만들어 씁니다. 화면 상태가 아직 안 채워졌거나 IndexedDB 가 잠깐 안 열리는 등
    어떤 이유로든 빈 목록이 들어와도 원격 기록이 지워지지 않게 하기 위한 안전장치입니다.
    (2026-08-09: focus 에서 빈 목록이 올라가 원격 세션 3건이 실제로 사라졌습니다.)

    사용자가 지운 블록은 별도 tombstone으로 남겨 다른 기기에서도 숨깁니다.

    settings 는 올리기만 하고 받을 때 적용하지 않습니다. 글자 크기·시간 간격은
    기기마다 다른 값이 맞습니다. 백업에서 되돌릴 때를 위해 담아만 둡니다. */
export async function pushData({ settings, blocks, templates }) {
  const Shared = await api();
  if (!isReady()) return false;
  const cfg = config();
  const contextId = getContextId();
  const path = dataPath(contextId);

  const existing = await Shared.readFile(cfg, path);
  let previousBlocks = [];
  let previousTemplates = [];
  let previousTombstones = [];
  if (existing.exists) {
    const previous = parseJson(existing.content, null);
    if (previous && previous.data) {
      if (Array.isArray(previous.data.blocks)) previousBlocks = previous.data.blocks;
      if (Array.isArray(previous.data.templates)) previousTemplates = previous.data.templates;
      if (Array.isArray(previous.data.blockTombstones)) previousTombstones = previous.data.blockTombstones;
    }
  }

  const blockTombstones = mergeTombstonesById(previousTombstones, getBlockTombstones());
  const mergedBlocks = applyBlockTombstones(mergeById(previousBlocks, blocks), blockTombstones);

  const body = `${JSON.stringify({
    v: 1,
    app: NAMESPACE,
    context: contextId,
    updatedAt: new Date().toISOString(),
    data: {
      settings,
      blocks: mergedBlocks,
      templates: mergeById(previousTemplates, templates),
      blockTombstones,
    },
  }, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge("The loom data file is too large to sync.");
  }

  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `loom: update ${path}`,
  });
  writeItem(KEYS.lastSyncAt, String(Date.now()));
  return true;
}

/** 모든 기기의 파일을 읽어 블록·템플릿을 합칩니다. 같은 id 는 updatedAt 최신이 이깁니다. */
export async function pullData() {
  const Shared = await api();
  if (!isReady()) return null;
  const cfg = config();
  const entries = await Shared.listDir(cfg, NAMESPACE);
  const files = entries.filter((entry) => (
    entry.type === "file" && /^data\.[a-z0-9-]+\.json$/i.test(entry.name)
  ));
  if (files.length === 0) return { blocks: [], templates: [], blockTombstones: getBlockTombstones() };

  let blocks = [];
  let templates = [];
  let blockTombstones = [];
  for (const entry of files) {
    const file = await Shared.readFile(cfg, entry.path);
    if (!file.exists) continue;
    const payload = parseJson(file.content, null);
    if (!payload || !payload.data) continue;
    blocks = mergeById(blocks, payload.data.blocks);
    templates = mergeById(templates, payload.data.templates);
    blockTombstones = mergeTombstonesById(blockTombstones, payload.data.blockTombstones);
  }
  blockTombstones = mergeBlockTombstones(blockTombstones);
  blocks = applyBlockTombstones(blocks, blockTombstones);
  writeItem(KEYS.lastSyncAt, String(Date.now()));
  return { blocks, templates, blockTombstones };
}

/* ── C. 백업 ───────────────────────────────────────────────────────────── */

function backupDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 백업 본문은 기기 파일 내보내기와 같은 모양입니다. 기존 가져오기가 그대로 읽습니다. */
export async function backupNow(backupPayload) {
  const Shared = await api();
  if (!isReady()) return false;
  const cfg = config();
  const path = `backups/${NAMESPACE}/${backupDayKey(Date.now())}.json`;
  const body = `${JSON.stringify(backupPayload, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge("The backup is too large to upload. Export it to Files instead.");
  }

  const existing = await Shared.readFile(cfg, path);
  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `loom: back up ${path}`,
  });
  writeItem(KEYS.lastRemoteBackupAt, String(Date.now()));
  await pruneBackups(cfg);
  return true;
}

/** 최근 12개만 남기고 오래된 것부터 지웁니다. 실패해도 백업 자체는 성공으로 둡니다. */
async function pruneBackups(cfg) {
  const Shared = await api();
  try {
    const entries = await Shared.listDir(cfg, `backups/${NAMESPACE}`);
    const files = entries
      .filter((entry) => entry.type === "file" && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const extra = files.slice(0, Math.max(0, files.length - BACKUP_KEEP));
    for (const entry of extra) {
      await Shared.deleteFile(cfg, entry.path, entry.sha, `loom: prune ${entry.path}`);
    }
  } catch {
    // 정리는 부가 작업입니다. 실패해도 다음 백업에서 다시 시도합니다.
  }
}
