import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as model from '../src/model.js';

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

test('sync is disabled without credentials and context', () => {
  assert.equal(sync.isEnabled(), false);
  assert.equal(sync.isReady(), false);
  assert.equal(sync.pendingEventCount(), 0);
});
