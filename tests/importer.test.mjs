import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData, cardIds } from '../web/js/data.js';
import { estimateKnown, planSeed, suggestDays, kanjiFromText } from '../web/js/importer.js';
import { replay, dueCards, dueDay, today, DAY } from '../web/js/state.js';
import { makeEvent } from '../web/js/store.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../web/data/${p}`, import.meta.url), 'utf8'));
const data = indexData(load('curriculum.json'), load('kanji.json'));
const NOW = Date.UTC(2026, 5, 1, 12);
const ev = (type, d, t = NOW) => ({ ...makeEvent(type, d, 'a', t), tz: 0 });

// Someone who knows N5-N3 kanji except a few, and vocabulary up to N3.
const known = new Set(data.kanjiList.filter((k) => k.level >= 3).map((k) => k.c));
for (const c of '話書読聞') known.delete(c);

test('kanjiFromText keeps only curriculum kanji', () => {
  assert.deepEqual(kanjiFromText(data, '日本語 and 蟷螂 日'), ['日', '本', '語']);
});

test('estimateKnown: words need all kanji known and level <= reached', () => {
  const { items, holes } = estimateKnown(data, known, 3);
  assert.ok(items.length > 1000, `${items.length}`);
  for (const it of items) {
    if (it.kanji) assert.ok(known.has(it.kanji));
    else assert.ok(it.jlpt >= 3, it.id);
  }
  // Words with the removed kanji are holes; holes stay within the reached levels.
  assert.ok(holes.some((it) => it.word && it.word.includes('話')));
  assert.ok(holes.every((it) => it.level >= 3));
  assert.ok(!items.some((it) => it.word && it.word.includes('話')));
  console.log(`known items ${items.length}, holes ${holes.length}`);
});

test('planSeed: flat load, nothing due today, everything within the window', () => {
  const { items } = estimateKnown(data, known, 3);
  const n = items.flatMap(cardIds).length;
  const days = suggestDays(n);
  const { cards, perDay } = planSeed(items, days);
  assert.equal(Object.keys(cards).length, n);
  assert.equal(perDay.reduce((a, b) => a + b, 0), n);
  const avg = n / days;
  assert.ok(Math.max(...perDay) <= avg * 2 + 3, `max ${Math.max(...perDay)} avg ${avg}`);
  for (const [s, due] of Object.values(cards)) assert.ok(due >= 1 && due <= days && s >= due);
  // Weak cards (late items, writing) come before strong ones on average.
  const first = items[0], last = items[items.length - 1];
  assert.ok(cards[`${last.id}#w`][1] < cards[`${first.id}#r`][1]);
  console.log(`${n} cards over ${days} days, max ${Math.max(...perDay)}/day`);
});

test('seed event: due exactly as planned, existing cards untouched, forget undoes it', () => {
  const { items } = estimateKnown(data, known, 3);
  const days = 60;
  const { cards } = planSeed(items, days);
  const learnedId = `${items[0].id}#r`;
  const s = replay([
    ev('learn', { cards: { [learnedId]: 3 } }, NOW - 2 * DAY),
    ev('seed', { cards }),
  ]);
  assert.equal(s.cards.get(learnedId).seeded, undefined); // lesson-learned card kept as is
  assert.equal(dueCards(s, NOW).length, 0);
  const t = today(s, NOW);
  for (const [id, [, due]] of Object.entries(cards)) {
    if (id === learnedId) continue;
    assert.equal(dueDay(s.cards.get(id), s.settings) - t, due, id);
  }
  // still holds under SM-2
  const sm2 = replay([ev('seed', { cards }), ev('settings', { algorithm: 'sm2' }, NOW + 1)]);
  const [id, [, due]] = Object.entries(cards)[5];
  assert.equal(dueDay(sm2.cards.get(id), sm2.settings) - t, due);
  // daily load after the window is reasonable: everything comes due within `days`
  assert.equal(dueCards(s, NOW + days * DAY).length, Math.min(s.settings.maxReviews, s.cards.size - 1 + 1));
  const undone = replay([ev('seed', { cards }), ev('forget', { items: items.map((it) => it.id) }, NOW + 1)]);
  assert.equal(undone.cards.size, 0);
});

test('seedChunks: small events that replay exactly like one big one', async () => {
  const { seedChunks } = await import('../web/js/importer.js');
  const { items } = estimateKnown(data, known, 3);
  const { cards } = planSeed(items, 60);
  const chunks = seedChunks(cards);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    const bytes = new TextEncoder().encode(JSON.stringify(ev('seed', { cards: c }))).length;
    assert.ok(bytes < 65536 / 2, `${bytes} bytes`);
  }
  const one = replay([ev('seed', { cards })]);
  const many = replay(chunks.map((c, i) => ev('seed', { cards: c }, NOW + i)));
  assert.deepEqual([...many.cards.values()], [...one.cards.values()]);
});
