// Anki's legacy SM-2 variant. Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy. Intervals in days.
// Learning steps are replaced by the app's lesson drill, so a card's first scheduling is
// "graduation" (init); every later answer is a review (next).

export const SM2_DEFAULTS = {
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  minEase: 1.3,
  hardFactor: 1.2,
  easyBonus: 1.3,
  intervalModifier: 1,
  lapseFactor: 0, // new interval after a lapse = old * lapseFactor (min 1 day)
  maxInterval: 36500,
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function sm2Init(rating, o = SM2_DEFAULTS) {
  if (rating === 4) return { interval: o.easyInterval, ease: o.startingEase + 0.15 };
  if (rating === 2) return { interval: o.graduatingInterval, ease: o.startingEase - 0.15 };
  return { interval: o.graduatingInterval, ease: o.startingEase };
}

// elapsed: whole days since the previous review.
export function sm2Next(state, rating, elapsed, o = SM2_DEFAULTS) {
  const ivl = state.interval;
  const delay = Math.max(0, elapsed - ivl); // days overdue
  const cap = (x) => clamp(Math.round(x), 1, o.maxInterval);
  let { ease } = state;
  if (rating === 1) {
    ease = Math.max(o.minEase, ease - 0.2);
    return { interval: cap(ivl * o.lapseFactor), ease };
  }
  const hard = cap(Math.max(ivl + 1, ivl * o.hardFactor * o.intervalModifier));
  if (rating === 2) return { interval: hard, ease: Math.max(o.minEase, ease - 0.15) };
  const good = cap(Math.max(hard + 1, (ivl + delay / 2) * ease * o.intervalModifier));
  if (rating === 3) return { interval: good, ease };
  const easy = cap(Math.max(good + 1, (ivl + delay) * ease * o.easyBonus * o.intervalModifier));
  return { interval: easy, ease: ease + 0.15 };
}
