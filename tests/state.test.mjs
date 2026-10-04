import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, dayIndex, dueCards, intervalOf, DAY } from '../web/js/state.js';
import { makeEvent, MemoryBackend } from '../web/js/store.js';

const T0 = Date.UTC(2026, 0, 10, 12); // noon UTC
const ev = (type, data, t, dev = 'a') => ({ ...makeEvent(type, data, dev, t), tz: 0 });

test('dayIndex rolls over at the configured hour', () => {
  const midnight = Date.UTC(2026, 0, 10);
  assert.equal(dayIndex(midnight + 3 * 3600000, 0, 4), dayIndex(midnight - 3600000, 0, 4)); // 03:00 is still "yesterday"
  assert.equal(dayIndex(midnight + 5 * 3600000, 0, 4), dayIndex(midnight - 3600000, 0, 4) + 1);
  assert.equal(dayIndex(midnight + 2 * 3600000, -180, 0), dayIndex(midnight + 22 * 3600000, 0, 0)); // UTC+3
});

test('learn creates scheduled cards; review reschedules', () => {
  const events = [
    ev('learn', { cards: { '一|いち#r': 3, '一|いち#w': 2 } }, T0),
    ev('review', { card: '一|いち#r', rating: 3, ms: 5000 }, T0 + 3 * DAY),
  ];
  const s = replay(events);
  assert.equal(s.items.size, 1);
  assert.equal(s.cards.size, 2);
  const r = s.cards.get('一|いち#r');
  assert.equal(r.reps, 2);
  assert.equal(r.lastDay - s.cards.get('一|いち#w').lastDay, 3);
  assert.ok(intervalOf(r, s.settings) > 3);
});

test('replay is order-independent and ignores unknown cards and event types', () => {
  const events = [
    ev('learn', { cards: { 'x#r': 3 } }, T0),
    ev('review', { card: 'x#r', rating: 1 }, T0 + DAY),
    ev('review', { card: 'gone#r', rating: 3 }, T0 + DAY),
    ev('future-thing', {}, T0 + DAY),
    ev('review', { card: 'x#r', rating: 3 }, T0 + 2 * DAY),
  ];
  const a = replay(events);
  const b = replay([...events].reverse());
  assert.deepEqual([...a.cards.values()], [...b.cards.values()]);
  assert.equal(a.cards.get('x#r').lapses, 1);
});

test('settings are last-writer-wins and only synced keys apply', () => {
  const s = replay([
    ev('settings', { algorithm: 'sm2', theme: 'dark' }, T0 + 10),
    ev('settings', { algorithm: 'fsrs' }, T0 + 5),
  ]);
  assert.equal(s.settings.algorithm, 'sm2');
  assert.equal(s.settings.theme, 'system'); // device setting: not taken from the log
});

test('switching algorithm re-times cards without new reviews', () => {
  const events = [ev('learn', { cards: { 'x#r': 4 } }, T0)];
  const fsrs = replay(events);
  const sm2 = replay([...events, ev('settings', { algorithm: 'sm2' }, T0 + 1)]);
  assert.notEqual(intervalOf(fsrs.cards.get('x#r'), fsrs.settings), intervalOf(sm2.cards.get('x#r'), sm2.settings));
});

test('forget removes item and its cards', () => {
  const s = replay([
    ev('learn', { cards: { 'x#r': 3, 'x#w': 3, 'y#k': 3 } }, T0),
    ev('forget', { items: ['x'] }, T0 + 1),
  ]);
  assert.deepEqual([...s.cards.keys()], ['y#k']);
  assert.deepEqual([...s.items.keys()], ['y']);
});

test('dueCards respects due day and the daily limit', () => {
  const cards = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`w${i}#r`, 3]));
  const s = replay([ev('learn', { cards }, T0), ev('settings', { maxReviews: 3 }, T0 + 1)]);
  assert.equal(dueCards(s, T0).length, 0); // learned today, due in 3 days (FSRS Good)
  assert.equal(dueCards(s, T0 + 10 * DAY).length, 3);
});

test('two devices merge into the same state', async () => {
  const a = [ev('learn', { cards: { 'x#r': 3 } }, T0, 'a'), ev('review', { card: 'x#r', rating: 3 }, T0 + 4 * DAY, 'a')];
  const b = [ev('review', { card: 'x#r', rating: 1 }, T0 + 2 * DAY, 'b')];
  const store = new MemoryBackend();
  await store.putNew('events', a);
  assert.equal(await store.putNew('events', [...a, ...b]), 1); // duplicates skipped
  const merged = replay(await store.all('events'));
  assert.equal(merged.cards.get('x#r').lapses, 1);
  assert.equal(merged.cards.get('x#r').reps, 3);
});


test('a second learn of the same card (another device) keeps the existing schedule', () => {
  const s = replay([
    ev('learn', { cards: { 'x#r': 3 } }, T0),
    ev('review', { card: 'x#r', rating: 3 }, T0 + 3 * DAY),
    ev('learn', { cards: { 'x#r': 2 } }, T0 + DAY, 'b'),
  ]);
  const c = s.cards.get('x#r');
  assert.equal(c.reps, 2);
  assert.equal(s.items.size, 1);
});
