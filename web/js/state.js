// Event-sourced user state. The event log is the only thing persisted (and, later, synced):
// state = replay(events). Replay is deterministic: events are ordered by (t, id) and every
// event carries its own timestamp and timezone offset, so any device gets the same result.
//
// Event: {id, t, tz, dev, type, data}
//   learn    {cards: {cardId: rating}}   lesson finished; creates and first-schedules cards
//   review   {card, rating, ms}          an SRS review answer
//   seed     {cards: {cardId: [s, due]}} prior knowledge import: card with stability s days,
//                                        first due `due` days after the event; existing cards
//                                        are left alone
//   forget   {items: [itemId]}           drop items and their cards (back to unlearned)
//   settings {key: value, ...}           synced settings (last writer wins)
// Card ids are `${itemId}#${kind}`, kind: r (reading), w (writing), k (kanji-only item).
// Unknown cards/items (e.g. after a curriculum change) are ignored, never fatal.

import { DEFAULTS, SYNCED } from './settings.js';
import { sm2Init, sm2Next, SM2_DEFAULTS } from './srs/sm2.js';
import { fsrsInit, fsrsNext, fsrsInterval } from './srs/fsrs.js';

export const DAY = 86400000;

// Local "study day" number: days roll over at `rolloverHour` local time.
export function dayIndex(t, tz, rolloverHour) {
  return Math.floor((t - tz * 60000 - rolloverHour * 3600000) / DAY);
}

export const itemOfCard = (cardId) => cardId.slice(0, cardId.lastIndexOf('#'));
export const kindOfCard = (cardId) => cardId.slice(cardId.lastIndexOf('#') + 1);

export function createState() {
  return {
    settings: { ...DEFAULTS },
    items: new Map(), // itemId -> {day}
    cards: new Map(), // cardId -> card
    days: new Map(), // day -> {reviews, again, learned, ms}
    eventCount: 0,
  };
}

const sm2Options = (s) => ({
  ...SM2_DEFAULTS,
  startingEase: s.sm2StartingEase,
  easyBonus: s.sm2EasyBonus,
  intervalModifier: s.sm2IntervalModifier,
  maxInterval: s.maxInterval,
});

function dayStats(state, day) {
  if (!state.days.has(day)) state.days.set(day, { reviews: 0, again: 0, learned: 0, ms: 0 });
  return state.days.get(day);
}

export function applyEvent(state, e) {
  state.eventCount++;
  const day = dayIndex(e.t, e.tz, state.settings.rolloverHour);
  const d = e.data || {};
  switch (e.type) {
    case 'settings':
      for (const [k, v] of Object.entries(d)) if (SYNCED.has(k)) state.settings[k] = v;
      break;
    case 'learn': {
      const o = sm2Options(state.settings);
      for (const [cardId, rating] of Object.entries(d.cards || {})) {
        // The same lesson finished on two devices before syncing: the first one counts,
        // the later one must not wipe reviews done in between.
        if (state.cards.has(cardId)) continue;
        const item = itemOfCard(cardId);
        if (!state.items.has(item)) {
          state.items.set(item, { day });
          dayStats(state, day).learned++;
        }
        state.cards.set(cardId, {
          id: cardId, item, kind: kindOfCard(cardId), reps: 1, lapses: 0, lastDay: day,
          sm2: sm2Init(rating, o), fsrs: fsrsInit(rating),
        });
      }
      break;
    }
    case 'review': {
      const c = state.cards.get(d.card);
      if (!c) break;
      const elapsed = Math.max(0, day - c.lastDay);
      c.sm2 = sm2Next(c.sm2, d.rating, elapsed, sm2Options(state.settings));
      c.fsrs = fsrsNext(c.fsrs, d.rating, elapsed);
      c.reps++;
      if (d.rating === 1) c.lapses++;
      c.lastDay = day;
      const st = dayStats(state, day);
      st.reviews++;
      st.ms += d.ms || 0;
      if (d.rating === 1) st.again++;
      break;
    }
    case 'seed':
      for (const [cardId, [stability, due]] of Object.entries(d.cards || {})) {
        if (state.cards.has(cardId)) continue;
        const item = itemOfCard(cardId);
        if (!state.items.has(item)) state.items.set(item, { day, seeded: true });
        const s = Math.max(1, stability);
        // Pretend the last review was one interval before the due day, with the same interval
        // in both models (FSRS at 90% retention), so either puts the first review on `due`.
        const ivl = fsrsInterval(s, 0.9, Infinity);
        state.cards.set(cardId, {
          id: cardId, item, kind: kindOfCard(cardId), reps: 1, lapses: 0, seeded: true,
          lastDay: day + due - ivl,
          sm2: { interval: ivl, ease: state.settings.sm2StartingEase }, fsrs: { s, d: 5 },
        });
      }
      break;
    case 'forget':
      for (const item of d.items || []) {
        state.items.delete(item);
        for (const id of [...state.cards.keys()]) if (itemOfCard(id) === item) state.cards.delete(id);
      }
      break;
    default:
      break; // unknown event types from newer app versions are skipped
  }
  return state;
}

export const compareEvents = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function replay(events) {
  const state = createState();
  for (const e of [...events].sort(compareEvents)) applyEvent(state, e);
  return state;
}

// Deterministic ±5% fuzz for intervals of 3+ days, so cards learned together spread out.
function fuzz(ivl, seed) {
  if (ivl < 3) return ivl;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const f = ((h >>> 0) / 4294967296) * 0.1 - 0.05;
  return Math.max(1, Math.round(ivl * (1 + f)));
}

// Interval under the currently selected algorithm. Both models are always up to date, so
// changing the algorithm or desired retention re-times every card immediately.
export function intervalOf(card, settings) {
  const raw = settings.algorithm === 'sm2'
    ? card.sm2.interval
    : fsrsInterval(card.fsrs.s, settings.retention, settings.maxInterval);
  // Imported cards keep their planned first due day exactly (fuzz could make them overdue).
  if (card.seeded && card.reps === 1) return Math.min(settings.maxInterval, raw);
  return Math.min(settings.maxInterval, fuzz(raw, card.id + ':' + card.reps));
}

export const dueDay = (card, settings) => card.lastDay + intervalOf(card, settings);

export function today(state, now = Date.now()) {
  return dayIndex(now, new Date(now).getTimezoneOffset(), state.settings.rolloverHour);
}

// Cards due today, most overdue first; capped by what is left of the daily review limit.
export function dueCards(state, now = Date.now()) {
  const t = today(state, now);
  const done = state.days.get(t)?.reviews || 0;
  const due = [];
  for (const c of state.cards.values()) {
    const dd = dueDay(c, state.settings);
    if (dd <= t) due.push({ c, dd });
  }
  due.sort((a, b) => a.dd - b.dd || (a.c.id < b.c.id ? -1 : 1));
  return due.slice(0, Math.max(0, state.settings.maxReviews - done)).map((x) => x.c);
}

// Learned / mature status of a card, for coloring.
export function cardStage(card, settings) {
  if (!card) return 'new';
  return intervalOf(card, settings) >= 21 ? 'mature' : 'young';
}

// Interval each rating would give if the card were answered now (for the rating buttons).
export function previewIntervals(state, card, now = Date.now()) {
  const elapsed = Math.max(0, today(state, now) - card.lastDay);
  const out = {};
  for (const r of [1, 2, 3, 4]) {
    const next = {
      ...card,
      reps: card.reps + 1,
      sm2: sm2Next(card.sm2, r, elapsed, sm2Options(state.settings)),
      fsrs: fsrsNext(card.fsrs, r, elapsed),
    };
    out[r] = intervalOf(next, state.settings);
  }
  return out;
}
