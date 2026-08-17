import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as model from '../src/model.js';
import { blockToJournalRecord } from '../src/journal-record.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path) => readFileSync(resolve(root, path), 'utf8');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

globalThis.localStorage = memoryStorage();
const sync = await import('../src/sync.js');

test('time parsing and snapping preserve day bounds', () => {
  assert.equal(model.parseHHMM('07:30'), 450);
  assert.equal(model.parseHHMM('24:00'), 1440);
  assert.equal(model.parseHHMM('24:01'), null);
  assert.equal(model.snapMinutes(1439, 15), 1440);
  assert.equal(model.hhmm(1440), '24:00');
});

test('block normalization clamps user content and duration', () => {
  const block = model.normalizeBlock({
    id: 'block-1', date: '2026-08-10', start: 1438, duration: 60,
    title: `  ${'x'.repeat(80)}  `, subtitle: '', note: '', detail: '', color: 'unknown'
  });
  assert.equal(block.title.length, model.LIMITS.title);
  assert.equal(block.start, 1435);
  assert.equal(block.duration, 5);
  assert.equal(block.color, 'rose');
});

test('event shape remains compatible with Atlas and Trace', () => {
  const event = sync.blockToEvent({
    id: 'block-1', title: 'Study', date: '2026-08-10', start: 540,
    duration: 30, createdAt: '2026-08-10T09:00:00-05:00'
  });
  assert.equal(event.v, 1);
  assert.equal(event.id, 'loom:block-1');
  assert.equal(event.app, 'loom');
  assert.equal(event.ref, '../loom/');
  assert.match(event.at, /^2026-08-10T09:30:00[+-]\d{2}:\d{2}$/);
});

test('shared sync module is loaded dynamically', () => {
  const text = source('src/sync.js');
  assert.match(text, /import\(["']\.\.\/\.\.\/shared\/v1\/sync\.js["']\)/);
  assert.doesNotMatch(text, /^import\s+.*shared\/v1\/sync\.js/m);
});

test('service worker allows cross-origin GitHub API requests', () => {
  const worker = source('sw.js');
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(source('index.html'), /connect-src[^;]*https:\/\/api\.github\.com/);
});

test('service worker and visible build versions match', () => {
  const worker = source('sw.js').match(/const VERSION = ["']([^"']+)["']/);
  const app = source('src/version.js').match(/APP_BUILD = ["']([^"']+)["']/);
  assert.ok(worker && app);
  assert.equal(worker[1], app[1]);
});

test('primary touch controls keep a 44px minimum target', () => {
  const css = source('assets/app.css');
  const dayView = source('src/day-view.js');
  assert.match(css, /\.hdr-today\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.now\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.chip\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.night\s*\{[^}]*min-height:\s*44px/s);
  assert.match(dayView, /const NIGHT_BAND_PX = 48;/);
});

test('sync is disabled without credentials and context', () => {
  assert.equal(sync.isEnabled(), false);
  assert.equal(sync.isReady(), false);
  assert.equal(sync.pendingEventCount(), 0);
});

test('journal block projection includes every scheduled field regardless of completion', () => {
  const block = model.normalizeBlock({
    id: 'fixture-block', date: '2026-08-17', start: 9 * 60, duration: 45,
    title: 'Fixture block', subtitle: 'Fixture subtitle', note: 'Fixture note',
    detail: 'Fixture detail', color: 'rose', done: false,
    createdAt: '2026-08-17T14:00:00.000Z',
  });
  const record = blockToJournalRecord(block);
  assert.equal(record.kind, 'block');
  assert.equal(record.title, 'Fixture block');
  assert.deepEqual(record.data, {
    date: '2026-08-17', start: 540, duration: 45, title: 'Fixture block',
    subtitle: 'Fixture subtitle', note: 'Fixture note', detail: 'Fixture detail',
    color: 'rose', done: false,
  });
  assert.equal(JSON.stringify(record).includes('token'), false);
});

test('journal uses a separate default-off key and dynamically loads shared v2', () => {
  const text = source('src/journal.js');
  assert.match(text, /loom\.journalEnabled\.v1/);
  assert.match(text, /import\(["']\.\.\/\.\.\/shared\/v2\/journal\.js["']\)/);
  assert.doesNotMatch(text, /^import\s+.*shared\/v2\/journal\.js/m);
});

test('journal observes single, bulk, date-delete, purge, clear, replace, and undo paths without widening legacy events', () => {
  const storeText = source('src/store.js');
  const backupText = source('src/backup.js');
  const templateText = source('src/templates.js');
  const appText = source('src/app.js');
  assert.match(storeText, /setJournalBlockChangeHook/);
  assert.match(storeText, /bulkPutBlocks[\s\S]*notifyBlockChange\(block, previous\.get\(block\.id\)[\s\S]*journalOnly: true/);
  assert.match(storeText, /deleteBlocksByIds[\s\S]*notifyBlockChange\(null, block, \{ journalOnly: true \}\)/);
  assert.match(storeText, /deleteBlocksForDate[\s\S]*deleteBlocksByIds/);
  assert.match(storeText, /deleteBlocksBefore[\s\S]*deleteBlocksByIds/);
  assert.match(storeText, /clearAllBlocks[\s\S]*notifyBlockChange\(null, block, \{ journalOnly: true \}\)/);
  assert.match(backupText, /clearAllBlocks\(\)[\s\S]*bulkPutBlocks\(data\.blocks\)/);
  assert.match(backupText, /onUndo:[\s\S]*clearAllBlocks\(\)[\s\S]*bulkPutBlocks\(prevBlocks\)/);
  assert.match(templateText, /deleteBlocksForDate\(date\)[\s\S]*bulkPutBlocks\(created\)/);
  assert.match(appText, /attachJournal\(\)/);
  assert.match(storeText, /if \(!journalOnly && blockChangeHook\)/);
});
