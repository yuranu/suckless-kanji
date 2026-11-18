// Review backlog: after a break, hundreds of cards can be due at once. This plans a
// `reschedule` event that spreads them over a window of days, most urgent first, so each
// day's load (backlog plus the reviews that come due anyway) is about the same.
//
// Urgency comes from the FSRS memory model (kept for every card, whichever scheduler is
// selected): a card's deadline is the day its predicted recall drops to a floor somewhat
// below the desired retention. The deadline grows with stability, so a well-known card
// (high stability) can wait much longer than a weak or freshly learned one, which loses
// recall fast and comes back first. Cards are placed earliest deadline first.
import { dueDay, naturalDueDay, today } from './state.js';
import { retrievability } from './srs/fsrs.js';

const FACTOR = 19 / 81; // FSRS-5 forgetting curve: R(t, S) = (1 + FACTOR * t / S) ^ -0.5

// Days after its last review at which a card of stability s is recalled with probability r.
const daysToRecall = (s, r) => (s / FACTOR) * (Math.pow(r, -2) - 1);

// The backlog: cards whose scheduler says they are due today or earlier, including cards
// already spread by an earlier reschedule (so planning again replaces that plan). Cards
// failed with Again (relearning) are not included: they are due today regardless.
export function backlogCards(state, now = Date.now()) {
  const t = today(state, now);
  return [...state.cards.values()].filter((c) => !c.relearning && naturalDueDay(c, state.settings) <= t);
}

// Cards overdue from earlier days (not counting ones spread to later days): what the Home
// screen offers to spread.
export function overdueCount(state, now = Date.now()) {
  const t = today(state, now);
  return [...state.cards.values()].filter((c) => !c.relearning && dueDay(c, state.settings) < t).length;
}

// Suggested window: about `perDay` extra reviews a day, at least 2 days and at most 60.
export function suggestSpreadDays(count, perDay = 40) {
  return Math.min(60, Math.max(2, Math.ceil(count / perDay)));
}

// Plan to spread the backlog over `days` days (day 0 = today).
// Returns {
//   cards: {cardId: dueInDays}  the `reschedule` event data,
//   perDay: [n]                 backlog cards placed on each day,
//   base: [n]                   other cards due on each day anyway,
//   recallNow, recallPlanned    mean predicted recall of the backlog if all of it were
//                               reviewed today / on the planned days,
// }
export function planSpread(state, days, now = Date.now()) {
  days = Math.max(1, Math.round(days));
  const t = today(state, now);
  const settings = state.settings;
  const floor = Math.max(0.5, settings.retention - 0.1);
  const backlog = backlogCards(state, now);
  const inBacklog = new Set(backlog.map((c) => c.id));

  // The load that comes anyway: everything else due within the window. Cards failed today
  // (relearning) count on day 0.
  const base = new Array(days).fill(0);
  for (const c of state.cards.values()) {
    if (inBacklog.has(c.id)) continue;
    const d = Math.max(0, dueDay(c, settings) - t);
    if (d < days) base[d]++;
  }

  // How many backlog cards go on each day: water-filling, so that base + backlog is as
  // flat as possible (each card goes to the least loaded day, the earliest on ties).
  const perDay = new Array(days).fill(0);
  for (let i = 0; i < backlog.length; i++) {
    let best = 0;
    for (let d = 1; d < days; d++) if (base[d] + perDay[d] < base[best] + perDay[best]) best = d;
    perDay[best]++;
  }

  // Earliest deadline first: the most urgent cards fill the earliest days.
  const ranked = backlog.map((c) => ({ c, deadline: c.lastDay + daysToRecall(c.fsrs.s, floor) }));
  ranked.sort((a, b) => a.deadline - b.deadline || (a.c.id < b.c.id ? -1 : 1));
  const cards = {};
  let recallNow = 0, recallPlanned = 0, i = 0;
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < perDay[d]; k++, i++) {
      const { c } = ranked[i];
      cards[c.id] = d;
      recallNow += retrievability(Math.max(0, t - c.lastDay), c.fsrs.s);
      recallPlanned += retrievability(Math.max(0, t + d - c.lastDay), c.fsrs.s);
    }
  }
  const n = backlog.length || 1;
  return { cards, perDay, base, recallNow: recallNow / n, recallPlanned: recallPlanned / n };
}
