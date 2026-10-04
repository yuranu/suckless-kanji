// Wrong answers for multiple-choice questions. All functions take an rng () => [0,1) so
// tests can be deterministic.
import { kanjiOfWord, kanjiReadings, isKanji } from './data.js';

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Take up to n distinct values from candidate lists, in priority order, skipping banned ones.
function collect(n, banned, ...lists) {
  const out = [];
  const seen = new Set(banned);
  for (const list of lists) {
    for (const v of list) {
      if (out.length >= n) return out;
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  return out;
}

const posClass = (it) => {
  const p = (it.pos && it.pos[0]) || '';
  if (p.startsWith('v')) return 'verb';
  if (p.startsWith('adj')) return 'adj';
  if (p.startsWith('adv')) return 'adv';
  if (p.startsWith('n')) return 'noun';
  return 'other';
};

// Items near `item` in the curriculum (similar level), widening until enough are found.
function nearby(data, item, want, filter, rng) {
  const res = [];
  for (let radius = 200; radius <= data.items.length && res.length < want * 3; radius *= 3) {
    res.length = 0;
    const lo = Math.max(0, item.index - radius), hi = Math.min(data.items.length, item.index + radius);
    for (let i = lo; i < hi; i++) if (filter(data.items[i])) res.push(data.items[i]);
  }
  return shuffle(res, rng);
}

// Reading options (kana). Distractors, most confusing first: the word with one segment
// swapped for another reading of the same kanji; readings of words sharing a kanji;
// words of similar length.
export function readingChoices(item, n, data, rng = Math.random) {
  const valid = new Set((data.itemsBySpelling.get(item.word) || []).map((it) => it.kana));
  valid.add(item.kana);

  const synthetic = [];
  item.segs.forEach(([text, rt], i) => {
    if (!rt || [...text].length !== 1 || !isKanji(text)) return;
    const alts = new Set(kanjiReadings(data.kanjiByChar.get(text)));
    for (const w of data.wordsByKanji.get(text) || []) {
      for (const [t2, r2] of w.segs) if (t2 === text && r2) alts.add(r2);
    }
    alts.delete(rt);
    for (const alt of alts) {
      synthetic.push(item.segs.map(([t, r], j) => (j === i ? alt : r || t)).join(''));
    }
  });

  const len = [...item.kana].length;
  const sharing = [];
  for (const c of kanjiOfWord(item.word || '')) {
    for (const w of data.wordsByKanji.get(c) || []) if (Math.abs([...w.kana].length - len) <= 2) sharing.push(w.kana);
  }
  const similar = nearby(data, item, n, (it) => it.kana && Math.abs([...it.kana].length - len) <= 1, rng).map((it) => it.kana);

  const k = n - 1;
  const fromSynth = collect(Math.ceil(k / 2), valid, shuffle(synthetic, rng));
  const wrong = collect(k, valid, fromSynth, shuffle(sharing, rng), shuffle(synthetic, rng), similar);
  return shuffle([item.kana, ...wrong], rng);
}

// Translation options. Distractors: same part of speech, nearby in the curriculum; never a
// word with the same spelling (alternative readings share the meaning).
export function meaningChoices(item, n, data, rng = Math.random) {
  const banned = new Set([item.meaning]);
  for (const it of data.itemsBySpelling.get(item.word) || []) banned.add(it.meaning);
  const cls = posClass(item);
  const ok = (it) => !it.kanji && it.word !== item.word && it.meaning;
  const same = nearby(data, item, n, (it) => ok(it) && posClass(it) === cls, rng).map((it) => it.meaning);
  const any = nearby(data, item, n, ok, rng).map((it) => it.meaning);
  return shuffle([item.meaning, ...collect(n - 1, banned, same, any)], rng);
}

// Kanji grid for multi-kanji words: the needed kanji plus look-alikes (shared KanjiVG
// components), preferring kanji already introduced; padded with random earlier kanji.
export function kanjiGrid(word, size, data, rng = Math.random) {
  const needed = kanjiOfWord(word);
  const maxIndex = Math.max(...needed.map((c) => data.kanjiByChar.get(c)?.index ?? 0));
  const parts = new Set(needed.flatMap((c) => data.kanjiByChar.get(c)?.parts || []));
  const lookAlike = [], lookAlikeLater = [];
  for (const k of data.kanjiList) {
    if (needed.includes(k.c) || !k.parts.some((p) => parts.has(p))) continue;
    (k.index <= maxIndex + 50 ? lookAlike : lookAlikeLater).push(k.c);
  }
  const earlier = data.kanjiList.slice(0, Math.max(maxIndex + 1, 40)).map((k) => k.c);
  const want = Math.max(size, needed.length) - needed.length;
  const lookCount = Math.ceil(want * 0.6);
  const wrong = collect(want, needed,
    collect(lookCount, needed, shuffle(lookAlike, rng), shuffle(lookAlikeLater, rng)),
    shuffle(earlier, rng), shuffle(data.kanjiList.map((k) => k.c), rng));
  return shuffle([...needed, ...wrong], rng);
}
