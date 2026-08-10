/* sync-runner.js — 언제 동기화를 돌릴지, 무엇을 올릴지 정하는 곳.
   실제 GitHub 통신은 sync.js 가 합니다.

   순서를 어기면 데이터가 사라집니다. 2026-08-09 focus 에서 실제로 겪었습니다.

     1. 받아오기 (pullData)
     2. 합치기  — 로컬에 없거나 오래된 것만 넣습니다. **지우지 않습니다.**
     3. 올리기  — 올릴 목록은 **저장소에서 새로 읽습니다.** 화면 상태를 쓰지 않습니다.
     4. 이벤트 큐 보내기

   올리기가 받아오기보다 먼저 돌면, 아직 아무것도 못 받은 빈 상태가 원격을 덮어씁니다. */

import * as store from "./store.js";
import * as sync from "./sync.js";
import { buildBackupPayload } from "./backup.js";

// 공용 모듈과 같은 4초 디바운스입니다. 블록을 연달아 옮길 때 요청이 쌓이지 않게 합니다.
const PUSH_DEBOUNCE_MS = 4000;
const EPOCH = "1970-01-01T00:00:00.000Z";

let pushTimer = null;
let inFlight = null;
let listener = null;

function stamp(item) {
  return String(item && item.updatedAt ? item.updatedAt : EPOCH);
}

function notify(state, detail) {
  if (listener) {
    try { listener(state, detail); } catch { /* UI 갱신 실패가 동기화를 막지 않습니다. */ }
  }
}

/** 설정 화면이 상태 줄을 갱신할 수 있도록 등록합니다. */
export function onSyncState(fn) {
  listener = typeof fn === "function" ? fn : null;
}

/* ── 로컬 변경 → 이벤트 큐 ─────────────────────────────────────────────── */

function eventFor(next, previous) {
  const wasDone = Boolean(previous && previous.done);
  const isDone = Boolean(next && next.done);

  // 완료로 바뀜, 또는 완료된 채로 시간·제목이 바뀜 → 이벤트를 새로 씁니다.
  if (isDone) return sync.blockToEvent(next);

  // 완료를 되돌렸거나, 완료된 블록을 지웠습니다.
  // 같은 id 에 deleted: true 로 올려 두면 atlas·trace 가 감춥니다.
  if (wasDone) return sync.blockToEvent(previous, { deleted: true });

  return null;
}

/** 앱 시작 시 한 번 부릅니다. 동기화가 꺼져 있어도 큐에는 쌓아 둡니다
    — 나중에 켰을 때 그동안 한 일이 비어 보이지 않게 하기 위해서입니다. */
export function attach() {
  store.setBlockChangeHook((next, previous) => {
    const event = eventFor(next, previous);
    if (event) sync.queueEvent(event);
    schedulePush();
  });
}

export function schedulePush() {
  if (!sync.isReady()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { runSync().catch(() => {}); }, PUSH_DEBOUNCE_MS);
}

/* ── 한 바퀴 ───────────────────────────────────────────────────────────── */

/** @returns {Promise<{skipped?:boolean, pulled?:number, error?:Error}>} */
export function runSync() {
  if (inFlight) return inFlight;
  inFlight = runSyncOnce().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSyncOnce() {
  if (!sync.isReady()) return { skipped: true };
  clearTimeout(pushTimer);
  notify("syncing");

  try {
    // 1·2. 받아오기 → 합치기
    const remote = await sync.pullData();
    let pulled = 0;
    if (remote) {
      const localBlocks = await store.getAllBlocks();
      const byId = new Map(localBlocks.map((b) => [b.id, b]));
      // 받은 것을 다시 이벤트로 올리지 않도록 훅을 잠시 끕니다.
      await store.withoutBlockHook(async () => {
        for (const block of remote.blocks) {
          const current = byId.get(block.id);
          if (!current || stamp(block) > stamp(current)) {
            await store.putBlock(block);
            pulled += 1;
          }
        }
        for (const template of remote.templates) {
          const current = await store.getTemplateById(template.id);
          if (!current || stamp(template) > stamp(current)) await store.putTemplate(template);
        }
      });
    }

    // 3. 올리기 — 저장소에서 새로 읽습니다. 화면 상태(state.blocks)는 쓰지 않습니다.
    const [blocks, templates] = await Promise.all([store.getAllBlocks(), store.getTemplates()]);
    await sync.pushData({ settings: store.getSettings(), blocks, templates });

    // 4. 밀린 이벤트
    await sync.flushEvents();

    notify("idle", { pulled });
    return { pulled };
  } catch (error) {
    notify("error", { error });
    return { error };
  }
}

/* ── 백업 ──────────────────────────────────────────────────────────────── */

export async function backupToGitHub() {
  const payload = await buildBackupPayload();
  return sync.backupNow(payload);
}
