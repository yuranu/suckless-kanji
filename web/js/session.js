// Session queues. Pure: no UI, no persistence.

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
    const pool = open.length > 1 ? open.filter((id) => id !== this.last) : open;
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
