// Session queues. Pure: no UI, no persistence.

const itemOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('#'));

// Random order in which the cards of one word (reading + writing) are not next to each
// other when that can be avoided: seeing a word's reading right before writing it gives
// the answer away.
export function spreadShuffle(ids, rng = Math.random) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const same = (x, y) => x !== undefined && y !== undefined && itemOf(x) === itemOf(y);
  for (let i = 1; i < a.length; i++) {
    if (!same(a[i], a[i - 1])) continue;
    let j = i + 1;
    while (j < a.length && same(a[j], a[i - 1])) j++;
    if (j < a.length) { [a[i], a[j]] = [a[j], a[i]]; continue; } // later neighbours are checked as i advances
    // Nothing later to swap with (pair at the end): move a[i] to an earlier slot where it
    // creates no new pair, and the card it displaces fits between a[i - 1] and a[i + 1].
    for (let k = 0; k < i - 1; k++) {
      if (same(a[k], a[i - 1]) || same(a[k], a[i + 1])) continue;
      if (same(a[i], a[k - 1]) || same(a[i], a[k + 1])) continue;
      [a[i], a[k]] = [a[k], a[i]];
      break;
    }
  }
  return a;
}

// SRS review: each card is rated once (its first answer). A failed card comes back a few
// cards later until it is answered correctly (Anki's relearning), without new ratings.
export class ReviewQueue {
  constructor(cardIds, gap = 4) {
    this.queue = cardIds.slice();
    this.gap = gap;
    this.rated = new Set();
    this.total = cardIds.length;
    this.failed = 0;
  }
  get remaining() { return this.queue.length; }
  peek() { return this.queue[0] ?? null; }
  // Returns true when this answer is the card's rating (first time seen).
  answer(cardId, ok) {
    const first = !this.rated.has(cardId);
    this.rated.add(cardId);
    this.queue.shift();
    if (!ok) {
      if (first) this.failed++;
      this.queue.splice(Math.min(this.gap, this.queue.length), 0, cardId);
    }
    return first;
  }
}

// Lesson drill: every card must be answered correctly `repeats` times; a mistake adds one
// more required repetition (up to repeats + 2). Cards are interleaved, never the same card
// twice in a row when another is available.
export class Drill {
  constructor(cardIds, repeats = 2, rng = Math.random) {
    this.need = new Map(cardIds.map((id) => [id, repeats]));
    this.mistakes = new Map(cardIds.map((id) => [id, 0]));
    this.max = repeats + 2;
    this.rng = rng;
    this.last = null;
    this.current = null;
  }
  get done() { return [...this.need.values()].every((n) => n <= 0); }
  get progress() {
    let left = 0;
    for (const n of this.need.values()) left += Math.max(0, n);
    return left;
  }
  next() {
    const open = [...this.need].filter(([, n]) => n > 0).map(([id]) => id);
    if (!open.length) return (this.current = null);
    // Prefer a different word than the last card, then at least a different card.
    const other = this.last ? open.filter((id) => itemOf(id) !== itemOf(this.last)) : open;
    const notSame = open.filter((id) => id !== this.last);
    const pool = other.length ? other : notSame.length ? notSame : open;
    // Weight by how much is left, so weak cards come up more.
    const weights = pool.map((id) => this.need.get(id));
    let r = this.rng() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r >= weights[i] && i < pool.length - 1) r -= weights[i++];
    this.current = pool[i];
    this.last = this.current;
    return this.current;
  }
  answer(cardId, ok) {
    if (ok) this.need.set(cardId, this.need.get(cardId) - 1);
    else {
      this.mistakes.set(cardId, this.mistakes.get(cardId) + 1);
      this.need.set(cardId, Math.min(this.max, this.need.get(cardId) + 1));
    }
  }
  // First scheduling rating per card: Good if never missed in the lesson, else Hard.
  ratings() {
    return Object.fromEntries([...this.mistakes].map(([id, m]) => [id, m ? 2 : 3]));
  }
}
