import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexData, lessons, cardIds, kanjiOfWord } from '../web/js/data.js';
import { readingChoices, meaningChoices, kanjiGrid } from '../web/js/distractors.js';
import { ReviewQueue, Drill, spreadShuffle } from '../web/js/session.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../web/data/${p}`, import.meta.url), 'utf8'));
const data = indexData(load('curriculum.json'), load('kanji.json'));

function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const byId = (id) => data.itemById.get(id);

test('data: every word kanji has stroke data; lessons cover all items', () => {
  for (const it of data.items) {
    for (const c of kanjiOfWord(it.word || it.kanji)) assert.ok(data.kanjiByChar.has(c), `${it.id}: ${c}`);
  }
  assert.equal(lessons(data, 4).flat().length, data.items.length);
  assert.deepEqual(cardIds(byId('一|いち')), ['一|いち#r', '一|いち#w']);
});

test('data: every kanji is drawn by some writing or kanji card', () => {
  // Single-kanji words and kanji-only items draw their kanji; multi-kanji words use a grid,
  // except `draw` cards, which draw their new kanji.
  const drawn = new Set();
  for (const it of data.items) {
    const ks = kanjiOfWord(it.word || it.kanji);
    if (ks.length === 1) drawn.add(ks[0]);
    if (it.draw) {
      assert.ok(ks.length > 1 && ks.includes(it.draw) && it.draw === it.newKanji, it.id);
      drawn.add(it.draw);
    }
  }
  const missing = data.kanjiList.map((k) => k.c).filter((c) => !drawn.has(c));
  assert.deepEqual(missing, []);
});

test('readingChoices: n unique options, one correct, no other valid reading', () => {
  const rng = seeded(1);
  for (const it of data.items.filter((x) => !x.kanji).filter((_, i) => i % 7 === 0)) {
    for (const n of [4, 8]) {
      const ch = readingChoices(it, n, data, rng);
      assert.equal(new Set(ch).size, ch.length, it.id);
      assert.equal(ch.length, n, it.id);
      const valid = data.itemsBySpelling.get(it.word).map((x) => x.kana);
      assert.deepEqual(ch.filter((c) => valid.includes(c)), [it.kana], it.id);
    }
  }
});

test('meaningChoices: n unique options, never a same-spelling meaning', () => {
  const rng = seeded(2);
  for (const it of data.items.filter((x) => !x.kanji).filter((_, i) => i % 7 === 0)) {
    const ch = meaningChoices(it, 6, data, rng);
    assert.equal(new Set(ch).size, 6, it.id);
    const same = data.itemsBySpelling.get(it.word).map((x) => x.meaning);
    assert.deepEqual(ch.filter((m) => same.includes(m)), [it.meaning], it.id);
  }
});

test('kanjiGrid: contains all needed kanji, exact size, unique', () => {
  const rng = seeded(3);
  for (const it of data.items.filter((x) => !x.kanji && kanjiOfWord(x.word).length > 1).filter((_, i) => i % 5 === 0)) {
    const g = kanjiGrid(it.word, 9, data, rng);
    assert.equal(g.length, Math.max(9, kanjiOfWord(it.word).length));
    assert.equal(new Set(g).size, g.length);
    for (const c of kanjiOfWord(it.word)) assert.ok(g.includes(c));
  }
});

test('ReviewQueue: failed cards return until passed, rated once', () => {
  const q = new ReviewQueue(['a', 'b', 'c'], 1);
  assert.equal(q.answer('a', false), true);
  assert.deepEqual(q.queue, ['b', 'a', 'c']);
  assert.equal(q.answer('b', true), true);
  assert.equal(q.answer('a', true), false); // relearn pass: not a new rating
  q.answer('c', true);
  assert.equal(q.remaining, 0);
  assert.equal(q.failed, 1);
});

test('Drill: needs `repeats` passes per card, mistakes add work and lower rating', () => {
  const d = new Drill(['a', 'b'], 2, seeded(4));
  let steps = 0, prev = null, missedOnce = false;
  while (!d.done && steps++ < 50) {
    const open = [...d.need].filter(([, n]) => n > 0).length;
    const c = d.next();
    if (open > 1) assert.notEqual(c, prev);
    prev = c;
    const ok = !(c === 'a' && !missedOnce);
    if (!ok) missedOnce = true;
    d.answer(c, ok);
  }
  assert.ok(d.done);
  assert.equal(steps, 6); // a: miss + 3 passes (the miss added one), b: 2 passes
  assert.deepEqual(d.ratings(), { a: 2, b: 3 });
});

test('sample choices (eyeball)', () => {
  const rng = seeded(5);
  for (const id of ['一日|ついたち', '大人|おとな', '心配|しんぱい', '分かる|わかる', '警官|けいかん']) {
    const it = byId(id);
    if (!it) continue;
    console.log(id, readingChoices(it, 6, data, rng).join(' '), '|', meaningChoices(it, 4, data, rng).join(' / '));
    if (kanjiOfWord(it.word).length > 1) console.log('   grid', kanjiGrid(it.word, 12, data, rng).join(''));
  }
});

test('itemsForKanji: union over kanji, deduped, curriculum order, learned filter', async () => {
  const { itemsForKanji } = await import('../web/js/progress.js');
  const learned = new Set(['一|いち', '一日|いちにち', '人|ひと']);
  const app = { data, state: { items: new Map([...learned].map((id) => [id, {}])) } };
  const all = itemsForKanji(app, ['一', '日'], false);
  const ids = all.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length); // 一日 uses both kanji but appears once
  assert.ok(ids.includes('一日|いちにち') && ids.includes('一つ|ひとつ'));
  assert.deepEqual(all.map((it) => it.index), [...all.map((it) => it.index)].sort((a, b) => a - b));
  assert.deepEqual(itemsForKanji(app, ['一', '日'], true).map((it) => it.id), ['一|いち', '一日|いちにち']);
});

test('spreadShuffle: a permutation, random, and keeps a word\'s cards apart', () => {
  const ids = Array.from({ length: 10 }, (_, i) => [`w${i}#r`, `w${i}#w`]).flat();
  const item = (id) => id.split('#')[0];
  const orders = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const out = spreadShuffle(ids, seeded(seed));
    assert.deepEqual([...out].sort(), [...ids].sort());
    for (let i = 1; i < out.length; i++) assert.notEqual(item(out[i]), item(out[i - 1]), out.join(' '));
    orders.add(out.join());
  }
  assert.ok(orders.size > 190); // practically every session differs
  assert.deepEqual(spreadShuffle(['a#r', 'a#w'], seeded(1)).sort(), ['a#r', 'a#w']); // unavoidable: fine
});

test('Drill: never shows two cards of the same word in a row when another word is open', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const d = new Drill(['a#r', 'a#w', 'b#r', 'b#w', 'c#r', 'c#w'], 2, seeded(seed));
    let prev = null;
    while (!d.done) {
      const open = new Set([...d.need].filter(([, n]) => n > 0).map(([id]) => id.split('#')[0]));
      const c = d.next();
      if (prev && open.size > 1) assert.notEqual(c.split('#')[0], prev.split('#')[0]);
      prev = c;
      d.answer(c, true);
    }
  }
});
