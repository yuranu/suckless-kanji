#!/usr/bin/env node
// Monte-carlo sanity check of web/stroke.js against every JLPT kanji.
// Simulates a sloppy human: per-stroke offset, scale, rotation, jitter and trimmed ends.
// Reports: true-accept rate (sloppy correct stroke), false-accept rate (another stroke drawn instead),
// and backwards detection.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'web/stroke.js'), 'utf8'), ctx);
const { Stroke } = ctx.window;
const KANJI = JSON.parse(fs.readFileSync(path.join(root, 'web/data/kanji.json'), 'utf8'));

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const range = (a, b) => a + (b - a) * rnd();

function sloppy(pts, mess) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const dx = range(-4, 4) * mess, dy = range(-4, 4) * mess;
  const sc = 1 + range(-0.12, 0.12) * mess, rot = range(-0.08, 0.08) * mess;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const n = pts.length;
  const a = Math.floor(n * range(0, 0.06) * mess), b = n - Math.floor(n * range(0, 0.1) * mess);
  let jx = 0, jy = 0;
  return pts.slice(a, Math.max(b, a + 2)).map(([x, y]) => {
    jx = 0.7 * jx + range(-1, 1) * mess; jy = 0.7 * jy + range(-1, 1) * mess;
    const X = (x - cx) * sc, Y = (y - cy) * sc;
    return [cx + X * cos - Y * sin + dx + jx, cy + X * sin + Y * cos + dy + jy];
  });
}

const mess = +(process.argv[2] || 1);
let tp = 0, tn = 0, fa = 0, fn = 0, back = 0, backN = 0;
const failures = {};
const step = +(process.argv[3] || 8);
for (const k of KANJI.filter((_, i) => i % step === 0)) {
  if (process.env.DBG) console.log(k.c);
  const refs = k.paths.map(Stroke.prepare);
  const raw = k.paths.map((d) => Stroke.resample(Stroke.parsePath(d), 40));
  for (let i = 0; i < refs.length; i++) {
    for (let t = 0; t < 3; t++) {
      tn++;
      const r = Stroke.match(sloppy(raw[i], mess), refs, i);
      if (r.pass) tp++;
      else failures[r.reason + ':' + Object.entries(r.checks).filter(([, v]) => !v).map(([c]) => c).join('+')] =
        (failures[r.reason + ':' + Object.entries(r.checks).filter(([, v]) => !v).map(([c]) => c).join('+')] || 0) + 1;
    }
    for (let j = 0; j < refs.length; j++) {
      if (j === i) continue;
      fn++;
      if (Stroke.match(raw[j], refs, i).pass) { fa++; if (process.env.FA) console.log("FA", k.c, "expected", i + 1, "drew", j + 1); }
    }
    if (refs[i].len > 15) {
      backN++;
      if (Stroke.match(raw[i].slice().reverse(), refs, i).reason === 'backwards') back++;
    }
  }
}
const pct = (a, b) => (100 * a / b).toFixed(2) + '%';
console.log(`mess=${mess}`);
console.log(`sloppy correct stroke accepted : ${pct(tp, tn)} (${tn})`);
console.log(`other stroke wrongly accepted  : ${pct(fa, fn)} (${fn})`);
console.log(`reversed stroke flagged        : ${pct(back, backN)} (${backN})`);
console.log('rejection reasons:', Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 8));
