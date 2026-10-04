import test from 'node:test';
import assert from 'node:assert/strict';
import { sm2Init, sm2Next } from '../web/js/srs/sm2.js';
import { fsrsInit, fsrsNext, fsrsInterval, retrievability } from '../web/js/srs/fsrs.js';

test('sm2: graduation intervals', () => {
  assert.deepEqual(sm2Init(3), { interval: 1, ease: 2.5 });
  assert.equal(sm2Init(4).interval, 4);
  assert.equal(sm2Init(2).ease, 2.35);
});

test('sm2: on-time Good multiplies by ease', () => {
  assert.deepEqual(sm2Next({ interval: 10, ease: 2.5 }, 3, 10), { interval: 25, ease: 2.5 });
});

test('sm2: ratings are strictly ordered', () => {
  const s = { interval: 1, ease: 2.5 };
  const [h, g, e] = [2, 3, 4].map((r) => sm2Next(s, r, 1).interval);
  assert.ok(h < g && g < e, `${h} ${g} ${e}`);
});

test('sm2: lapse resets interval and lowers ease, floored', () => {
  assert.deepEqual(sm2Next({ interval: 40, ease: 2.5 }, 1, 40), { interval: 1, ease: 2.3 });
  assert.equal(sm2Next({ interval: 40, ease: 1.35 }, 1, 40).ease, 1.3);
});

test('sm2: overdue Good credits half the delay', () => {
  assert.equal(sm2Next({ interval: 10, ease: 2 }, 3, 20).interval, 30); // (10 + 10/2) * 2
});

test('fsrs: interval equals stability at 90% retention', () => {
  assert.equal(fsrsInterval(10, 0.9), 10);
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.ok(fsrsInterval(10, 0.95) < 10 && fsrsInterval(10, 0.8) > 10);
});

test('fsrs: first rating sets initial stability', () => {
  assert.equal(fsrsInit(3).s, 3.173);
  assert.equal(fsrsInterval(fsrsInit(3).s), 3);
  assert.ok(fsrsInit(1).d > fsrsInit(4).d);
});

test('fsrs: success grows stability, failure shrinks it', () => {
  const st = { s: 10, d: 5 };
  const good = fsrsNext(st, 3, 10);
  const again = fsrsNext(st, 1, 10);
  assert.ok(good.s > 10, `good ${good.s}`);
  assert.ok(again.s < 10, `again ${again.s}`);
  assert.ok(fsrsNext(st, 2, 10).s < good.s && fsrsNext(st, 4, 10).s > good.s);
  assert.ok(again.d > st.d && fsrsNext(st, 4, 10).d < st.d);
});

test('fsrs: difficulty stays within 1..10', () => {
  let st = fsrsInit(1);
  for (let i = 0; i < 50; i++) st = fsrsNext(st, 1, 1);
  assert.ok(st.d <= 10 && st.d >= 1);
  st = fsrsInit(4);
  for (let i = 0; i < 50; i++) st = fsrsNext(st, 4, 30);
  assert.ok(st.d >= 1);
});
