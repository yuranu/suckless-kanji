#!/usr/bin/env node
// Monte-Carlo check of the freehand matcher (matchFree in web/js/stroke.js) on whole kanji.
// Simulates a person drawing a whole kanji from memory: the drawing is shifted and scaled in
// the box, each radical sits a little off and is a little larger or smaller, and every stroke
// is sloppy on its own. Reports, for the freehand matcher and the strict per-stroke one:
//   - sloppy kanji accepted: every stroke accepted, in order (higher is better);
//   - misplaced radical rejected: one radical moved by `far` units (should be caught);
//   - wrong stroke accepted: another stroke drawn instead of the next one (lower is better).
// Usage: test-freehand.mjs [mess=1] [step=8] [far=24]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Stroke = await import(path.join(root, 'web/js/stroke.js'));
const KANJI = JSON.parse(fs.readFileSync(path.join(root, 'web/data/kanji.json'), 'utf8'));

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const range = (a, b) => a + (b - a) * rnd();

const mess = +(process.argv[2] || 1);
const step = +(process.argv[3] || 8);
const far = +(process.argv[4] || 24);
// Tuning: FIT='{"place":0.6,"comp":{"tMax":5}}' overrides the matcher's constants.
if (process.env.FIT) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.FIT))) {
    Stroke.FIT[k] = typeof v === 'object' ? { ...Stroke.FIT[k], ...v } : v;
  }
}

// Similarity-ish transform about a centre: per-axis scale, shift.
const affine = (c, sx, sy, dx, dy) => ([x, y]) => [c[0] + (x - c[0]) * sx + dx, c[1] + (y - c[1]) * sy + dy];

// Per-stroke hand sloppiness (smaller than scripts/test-matcher.mjs: radicals carry the rest).
function sloppy(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const dx = range(-2.5, 2.5) * mess, dy = range(-2.5, 2.5) * mess;
  const sc = 1 + range(-0.1, 0.1) * mess, rot = range(-0.06, 0.06) * mess;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const n = pts.length;
  const a = Math.floor(n * range(0, 0.05) * mess), b = n - Math.floor(n * range(0, 0.08) * mess);
  let jx = 0, jy = 0;
  return pts.slice(a, Math.max(b, a + 2)).map(([x, y]) => {
    jx = 0.7 * jx + range(-0.8, 0.8) * mess; jy = 0.7 * jy + range(-0.8, 0.8) * mess;
    const X = (x - cx) * sc, Y = (y - cy) * sc;
    return [cx + X * cos - Y * sin + dx + jx, cy + X * sin + Y * cos + dy + jy];
  });
}

// One simulated drawing: stroke polylines. `moved`: radical to push `far` units away.
function drawKanji(K, raw, moved = -1) {
  const g = range(0.82, 1.12);
  const G = affine([54.5, 54.5], g * range(0.95, 1.05), g * range(0.95, 1.05), range(-10, 10) * mess, range(-10, 10) * mess);
  const C = K.centers.map((c, id) => {
    let dx = range(-5, 5) * mess, dy = range(-5, 5) * mess;
    if (id === moved) { const a = range(0, 2 * Math.PI); dx = far * Math.cos(a); dy = far * Math.sin(a); }
    const s = 1 + range(-0.12, 0.12) * mess;
    return affine(c, s * range(0.95, 1.05), s * range(0.95, 1.05), dx, dy);
  });
  return raw.map((pts, i) => sloppy(pts.map(C[K.comps[i]])).map(G));
}

// Feed strokes one by one; returns the index of the first rejected stroke, or -1.
function runFree(K, strokes) {
  const done = [];
  for (let i = 0; i < strokes.length; i++) {
    const r = Stroke.matchFree(K, done, strokes[i]);
    if (r.reason !== 'ok') return { at: i, reason: r.reason };
    done.push(r.pts);
  }
  return { at: -1 };
}
function runStrict(K, strokes) {
  for (let i = 0; i < strokes.length; i++) {
    const r = Stroke.match(strokes[i], K.refs, i);
    if (r.reason !== 'ok') return { at: i, reason: r.reason };
  }
  return { at: -1 };
}

const stat = { n: 0, free: 0, strict: 0, movedN: 0, movedFree: 0, movedStrict: 0, wrongN: 0, wrongFree: 0, wrongStrict: 0 };
const reasons = {};
const t0 = Date.now();
for (const k of KANJI.filter((_, i) => i % step === 0)) {
  const K = Stroke.prepareKanji(k);
  const raw = k.paths.map((d) => Stroke.resample(Stroke.parsePath(d), 40));
  const nComp = K.centers.length;
  for (let t = 0; t < 2; t++) {
    const strokes = drawKanji(K, raw);
    stat.n++;
    const f = runFree(K, strokes);
    if (f.at < 0) stat.free++;
    else reasons[f.reason] = (reasons[f.reason] || 0) + 1;
    if (runStrict(K, strokes).at < 0) stat.strict++;

    if (nComp > 1) {
      const moved = drawKanji(K, raw, Math.floor(rnd() * nComp));
      stat.movedN++;
      if (runFree(K, moved).at >= 0) stat.movedFree++;

      if (runStrict(K, moved).at >= 0) stat.movedStrict++;
    }

    // Wrong stroke: correct strokes up to i, then some other stroke j in place of i.
    if (k.paths.length > 1) {
      const i = Math.floor(rnd() * k.paths.length);
      let j = Math.floor(rnd() * (k.paths.length - 1));
      if (j >= i) j++;
      const done = [];
      let ok = true;
      for (let m = 0; m < i && ok; m++) {
        const r = Stroke.matchFree(K, done, strokes[m]);
        if (r.reason === 'ok') done.push(r.pts); else ok = false;
      }
      if (ok) {
        stat.wrongN++;
        if (Stroke.matchFree(K, done, strokes[j]).reason === 'ok') stat.wrongFree++;
        if (Stroke.match(strokes[j], K.refs, i).reason === 'ok') stat.wrongStrict++;
      }
    }
  }
}
const pct = (a, b) => (100 * a / b).toFixed(1).padStart(5) + '%';
console.log(`mess=${mess} far=${far}  (${((Date.now() - t0) / 1000).toFixed(1)} s)          freehand   strict`);
console.log(`sloppy kanji accepted        (${stat.n})`.padEnd(40), pct(stat.free, stat.n), ' ', pct(stat.strict, stat.n));
console.log(`misplaced radical rejected   (${stat.movedN})`.padEnd(40), pct(stat.movedFree, stat.movedN), ' ', pct(stat.movedStrict, stat.movedN));
console.log(`wrong stroke accepted        (${stat.wrongN})`.padEnd(40), pct(stat.wrongFree, stat.wrongN), ' ', pct(stat.wrongStrict, stat.wrongN));
console.log('freehand rejections of sloppy kanji:', reasons);
