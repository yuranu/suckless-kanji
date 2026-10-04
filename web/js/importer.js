// Prior-knowledge import: from a set of known kanji and a reached JLPT level, estimate which
// curriculum items are already known, and plan a `seed` event that spreads their first
// reviews over a window instead of making them all due at once.
import { kanjiOfWord, cardIds } from './data.js';

// Kanji found in arbitrary pasted text that belong to the curriculum.
export function kanjiFromText(data, text) {
  return [...new Set([...text])].filter((c) => data.kanjiByChar.has(c));
}

// Known items: kanji-only items for known kanji; words whose kanji are all known and whose
// JLPT level is at or below the reached one (N5 = 5 ... N1 = 1).
// Holes: items of the curriculum sections up to the reached level (N5..level) that are not
// known; "Next lesson" teaches them first. (Stray known kanji from higher levels do not turn
// everything before them into holes.)
export function estimateKnown(data, known, level) {
  const isKnown = (it) => (it.kanji
    ? known.has(it.kanji)
    : it.jlpt >= level && kanjiOfWord(it.word).every((c) => known.has(c)));
  const items = data.items.filter(isKnown);
  const holes = data.items.filter((it) => it.level >= level && !isKnown(it));
  return { items, holes };
}

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Suggested window so that imported cards add about `perDay` reviews a day.
export function suggestDays(cardCount, perDay = 25) {
  return Math.min(365, Math.max(7, Math.ceil(cardCount / perDay)));
}

// Plan first reviews for `items` over `days` days.
// Strength model: items early in the curriculum are assumed well known (stability ~120 days),
// late ones less so (~15); writing is assumed weaker than reading. Weakest cards come due
// first; due days are spread evenly (with deterministic jitter) so the daily load is flat.
// Returns {cards: {cardId: [stability, dueInDays]}, perDay: [count per day]}.
export function planSeed(items, days, skip = new Set()) {
  const n = items.length;
  const cards = [];
  items.forEach((it, i) => {
    const r = n > 1 ? i / (n - 1) : 0; // 0 = earliest known item, 1 = latest
    const base = 120 - 105 * r;
    for (const id of cardIds(it)) {
      if (skip.has(id)) continue;
      const kind = id.slice(id.lastIndexOf('#') + 1);
      const s = base * (kind === 'r' ? 1 : 0.6) * (0.85 + 0.3 * hash01(id));
      cards.push({ id, s });
    }
  });
  cards.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
  const out = {};
  const perDay = new Array(days + 1).fill(0);
  cards.forEach((c, i) => {
    const slot = cards.length > 1 ? (i / (cards.length - 1)) * (days - 1) : 0;
    const jitter = (hash01(c.id + ':due') - 0.5) * Math.min(6, days / 4);
    const due = Math.min(days, Math.max(1, Math.round(1 + slot + jitter)));
    const stability = Math.max(due, Math.round(c.s * 10) / 10);
    out[c.id] = [stability, due];
    perDay[due]++;
  });
  return { cards: out, perDay: perDay.slice(1) };
}
