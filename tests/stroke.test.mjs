import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Stroke from '../web/js/stroke.js';

const KANJI = JSON.parse(fs.readFileSync(new URL('../web/data/kanji.json', import.meta.url), 'utf8'));
const kanji = (c) => KANJI.find((k) => k.c === c);

// Reference strokes with radical `comp` (or every stroke, with -1) shifted by (dx, dy).
function shifted(K, dx, dy, comp = -1) {
  return K.refs.map((r, i) => (comp < 0 || K.comps[i] === comp ? r.pts.map(([x, y]) => [x + dx, y + dy]) : r.pts));
}
// Feed the strokes to the freehand matcher; the first reason that is not 'ok', or 'ok'.
function drawFree(K, strokes) {
  const done = [];
  for (const s of strokes) {
    const r = Stroke.matchFree(K, done, s);
    if (r.reason !== 'ok') return r.reason;
    done.push(r.pts);
  }
  return 'ok';
}

test('kanji data: every stroke belongs to a radical component', () => {
  for (const k of KANJI) {
    assert.equal(k.comps.length, k.paths.length, k.c);
    const n = Math.max(...k.comps) + 1;
    for (let id = 0; id < n; id++) assert.ok(k.comps.includes(id), `${k.c}: component ${id}`);
  }
  assert.deepEqual(kanji('語').comps, [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(kanji('国').comps, [0, 0, 1, 1, 1, 1, 1, 0]); // 囗 is split around 玉
});

test('freehand: a whole kanji drawn off-centre is accepted, strict matching rejects it', () => {
  const K = Stroke.prepareKanji(kanji('語'));
  const strokes = shifted(K, 16, -10);
  assert.equal(drawFree(K, strokes), 'ok');
  assert.ok(strokes.some((s, i) => Stroke.match(s, K.refs, i).reason !== 'ok'));
});

test('freehand: radicals may sit a little off, not far off', () => {
  const K = Stroke.prepareKanji(kanji('語'));
  assert.equal(drawFree(K, shifted(K, 8, 0, 1)), 'ok'); // 吾 a little too far right
  assert.equal(drawFree(K, shifted(K, -6, 5, 1)), 'ok'); // a little too close, and lower
  assert.equal(drawFree(K, shifted(K, 26, 0, 1)), 'misplaced');
  assert.equal(drawFree(K, shifted(K, 0, 26, 0)), 'misplaced');
});

test('freehand: stroke order and direction still count', () => {
  const K = Stroke.prepareKanji(kanji('日'));
  const s = shifted(K, 5, 5);
  assert.equal(Stroke.matchFree(K, [], s[0].slice().reverse()).reason, 'backwards');
  const done = [Stroke.matchFree(K, [], s[0]).pts];
  assert.equal(Stroke.matchFree(K, done, s[3]).reason, 'wrong-stroke');
  assert.equal(Stroke.matchFree(K, done, s[1]).reason, 'ok');
});
