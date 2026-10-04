// FSRS-5 memory model (https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).
// State: {s: stability in days, d: difficulty 1..10}. Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.

export const FSRS_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81; // so that R(S, S) = 0.9

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsed, s) {
  return Math.pow(1 + (FACTOR * elapsed) / s, DECAY);
}

// Days until recall probability drops to `retention`.
export function fsrsInterval(s, retention = 0.9, maxInterval = 36500) {
  const ivl = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, maxInterval);
}

const initDifficulty = (r, w) => clamp(w[4] - Math.exp(w[5] * (r - 1)) + 1, 1, 10);

export function fsrsInit(rating, w = FSRS_WEIGHTS) {
  return { s: w[rating - 1], d: initDifficulty(rating, w) };
}

function nextDifficulty(d, r, w) {
  const delta = -w[6] * (r - 3);
  const damped = d + (delta * (10 - d)) / 9; // linear damping
  return clamp(w[7] * initDifficulty(4, w) + (1 - w[7]) * damped, 1, 10); // mean reversion
}

// elapsed: whole days since the previous review.
export function fsrsNext({ s, d }, rating, elapsed, w = FSRS_WEIGHTS) {
  const nd = nextDifficulty(d, rating, w);
  if (elapsed < 1) {
    // Same-day review: short-term stability update.
    return { s: Math.max(0.01, s * Math.exp(w[17] * (rating - 3 + w[18]))), d: nd };
  }
  const r = retrievability(elapsed, s);
  if (rating === 1) {
    const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    return { s: Math.max(0.01, Math.min(s, sf)), d: nd };
  }
  const hard = rating === 2 ? w[15] : 1;
  const easy = rating === 4 ? w[16] : 1;
  const ss = s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy);
  return { s: ss, d: nd };
}
