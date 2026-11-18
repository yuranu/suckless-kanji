import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, dueCards, dueDay, today, intervalOf, DAY } from '../web/js/state.js';
import { makeEvent } from '../web/js/store.js';
import { backlogCards, overdueCount, planSpread, suggestSpreadDays } from '../web/js/backlog.js';

const T0 = Date.UTC(2026, 0, 10, 12);
const ev = (type, data, t, dev = 'a') => ({ ...makeEvent(type, data, dev, t), tz: 0 });

// 300 cards learned over two weeks, then a long break: all of them overdue.
function history() {
  const events = [];
  for (let i = 0; i < 300; i++) {
    const t = T0 + (i % 14) * DAY;
    events.push(ev('learn', { cards: { [`w${i}#r`]: 3 } }, t));
    // Every third card is better known: reviewed Good twice.
    if (i % 3 === 0) {
      for (const k of [1, 4]) events.push(ev('review', { card: `w${i}#r`, rating: 3 }, t + k * DAY + i));
    }
  }
  return events;
}
const events = history();
const NOW = T0 + 90 * DAY;

test('backlog: everything due by today; relearning cards excluded', () => {
  const s = replay([...events, ev('review', { card: 'w1#r', rating: 1, relearn: true }, NOW - 1000)]);
  const b = backlogCards(s, NOW);
  assert.equal(b.length, 299);
  assert.ok(!b.some((c) => c.id === 'w1#r'));
  assert.ok(b.every((c) => dueDay(c, s.settings) <= today(s, NOW)));
  assert.equal(suggestSpreadDays(500), 13);
  assert.equal(suggestSpreadDays(10), 2);
});

test('planSpread: every backlog card placed once, flat load, weak cards first', () => {
  const s = replay(events);
  const n = backlogCards(s, NOW).length;
  const days = 10;
  const plan = planSpread(s, days, NOW);
  assert.equal(Object.keys(plan.cards).length, n);
  assert.equal(plan.perDay.reduce((a, b) => a + b, 0), n);
  const totals = plan.perDay.map((x, i) => x + plan.base[i]);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1 || plan.base.some((x, i) => plan.perDay[i] === 0 && x > 0), totals.join(' '));
  for (const d of Object.values(plan.cards)) assert.ok(d >= 0 && d < days);
  // Better-known (higher stability) cards wait longer on average than weak ones.
  const avg = (pred) => {
    const ds = Object.entries(plan.cards).filter(([id]) => pred(+id.slice(1, -2))).map(([, d]) => d);
    return ds.reduce((a, b) => a + b, 0) / ds.length;
  };
  assert.ok(avg((i) => i % 3 === 0) > avg((i) => i % 3 !== 0) + 2, `${avg((i) => i % 3 === 0)} vs ${avg((i) => i % 3 !== 0)}`);
  assert.ok(plan.recallPlanned < plan.recallNow && plan.recallPlanned > 0);
});

test('planSpread accounts for reviews that come due anyway', () => {
  // 20 cards due on day 2 of the window regardless: that day gets fewer backlog cards.
  const extra = [];
  for (let i = 0; i < 20; i++) extra.push(ev('learn', { cards: { [`x${i}#r`]: 3 } }, NOW - DAY));
  const s = replay([...events, ...extra]);
  const fresh = s.cards.get('x0#r');
  const d = dueDay(fresh, s.settings) - today(s, NOW);
  assert.ok(d > 0 && d < 5, `${d}`);
  const plan = planSpread(s, 5, NOW);
  assert.equal(plan.base[d], 20);
  assert.ok(plan.perDay[d] < plan.perDay[(d + 1) % 5]);
});

test('reschedule event: due as planned, memory untouched, cleared by the next answer', () => {
  const s0 = replay(events);
  const plan = planSpread(s0, 10, NOW);
  const s = replay([...events, ev('reschedule', { cards: plan.cards }, NOW)]);
  const t = today(s, NOW);
  for (const [id, d] of Object.entries(plan.cards)) assert.equal(dueDay(s.cards.get(id), s.settings) - t, d, id);
  const before = s0.cards.get('w0#r'), after = s.cards.get('w0#r');
  assert.deepEqual(after.fsrs, before.fsrs);
  assert.equal(after.lastDay, before.lastDay);
  // Today shows only day-0 cards, and nothing is overdue any more.
  assert.equal(dueCards(s, NOW).length, Math.min(s.settings.maxReviews, plan.perDay[0]));
  assert.equal(overdueCount(s, NOW), 0);
  assert.ok(overdueCount(s0, NOW) > 0);
  // The answer is judged by the real elapsed time and clears the reschedule.
  const [late] = Object.entries(plan.cards).find(([, d]) => d === 9);
  const r = replay([...events, ev('reschedule', { cards: plan.cards }, NOW),
    ev('review', { card: late, rating: 3 }, NOW + 9 * DAY)]).cards.get(late);
  assert.equal(r.rescheduled, undefined);
  assert.equal(dueDay(r, s.settings), r.lastDay + intervalOf(r, s.settings));
  // Planning again includes spread cards; a 1-day window puts everything back on today.
  const again = planSpread(s, 1, NOW);
  assert.equal(Object.keys(again.cards).length, Object.keys(plan.cards).length);
  const undone = replay([...events, ev('reschedule', { cards: plan.cards }, NOW), ev('reschedule', { cards: again.cards }, NOW + 1)]);
  assert.equal(backlogCards(undone, NOW).filter((c) => dueDay(c, undone.settings) === today(undone, NOW)).length, Object.keys(plan.cards).length);
});

test('reschedule never moves a card earlier than its model, and skips unknown or relearning cards', () => {
  const s = replay([
    ev('learn', { cards: { 'a#r': 3, 'b#r': 3 } }, T0),
    ev('review', { card: 'b#r', rating: 1, relearn: true }, T0 + DAY / 4),
    ev('reschedule', { cards: { 'a#r': 0, 'b#r': 5, 'gone#r': 1 } }, T0 + DAY),
  ]);
  const a = s.cards.get('a#r');
  assert.equal(a.rescheduled, a.lastDay + 1);
  assert.ok(intervalOf(a, s.settings) > 1);
  assert.equal(dueDay(a, s.settings), a.lastDay + intervalOf(a, s.settings)); // not earlier
  assert.equal(s.cards.get('b#r').rescheduled, undefined);
  assert.equal(s.cards.has('gone#r'), false);
});
