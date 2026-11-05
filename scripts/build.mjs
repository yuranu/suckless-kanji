#!/usr/bin/env node
// Build web/data/kanji.json: every kanji the curriculum introduces, in introduction order,
// with KanjiVG stroke paths and KANJIDIC metadata. Run after build-curriculum.mjs.
// Entry: {c, level, extra?, meanings, on, kun, freq, paths, types, comps, parts}
//   paths[i]: SVG path `d` of stroke i (centerline, 109x109 box)
//   comps[i]: component (radical) of stroke i, numbered from 0, see components()
//   parts: KanjiVG components (e.g. 語 -> 言 口 吾 五 二), used to find look-alike kanji
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (p) => path.join(root, 'raw', p);

const meta = JSON.parse(fs.readFileSync(raw('kanji-data.json'), 'utf8'));
const curriculum = JSON.parse(fs.readFileSync(path.join(root, 'web/data/curriculum.json'), 'utf8'));

// Top-level components of a kanji (e.g. 語 -> 言, 吾), for the drawing checker: each may sit a
// little off relative to the others. The KanjiVG group tree is walked down while it has a single
// child group (a wrapper); the children of the first level with several are the components.
// Groups split around another one (kvg:part, e.g. 囗 in 国) are one component; consecutive
// strokes outside any group (the dots of 母) form one too.
function components(svg, ch, n) {
  const body = svg.slice(svg.indexOf('kvg:StrokePaths'), svg.indexOf('kvg:StrokeNumbers'));
  const root = { kids: [] };
  const stack = [root];
  for (const m of body.matchAll(/<g\b([^>]*)>|<\/g>|<path id="kvg:[0-9a-f]+-s(\d+)"/g)) {
    if (m[0] === '</g>') stack.pop();
    else if (m[2]) stack[stack.length - 1].kids.push(+m[2] - 1);
    else {
      const attr = (a) => (new RegExp(`kvg:${a}="([^"]*)"`).exec(m[1]) || [])[1];
      const g = { element: attr('element'), part: attr('part'), kids: [] };
      stack[stack.length - 1].kids.push(g);
      stack.push(g);
    }
  }
  const strokesOf = (g) => (typeof g === 'number' ? [g] : g.kids.flatMap(strokesOf));
  let top = root;
  while (top.kids.length === 1 && typeof top.kids[0] !== 'number') top = top.kids[0];
  const comp = new Array(n).fill(-1);
  let next = 0, loose = -1;
  const split = new Map(); // element of a kvg:part group -> its component
  for (const kid of top.kids) {
    let id;
    if (typeof kid === 'number') id = loose >= 0 ? loose : (loose = next++);
    else {
      loose = -1;
      if (kid.part && kid.element && split.has(kid.element)) id = split.get(kid.element);
      else {
        id = next++;
        if (kid.part && kid.element) split.set(kid.element, id);
      }
    }
    for (const i of strokesOf(kid)) comp[i] = id;
  }
  if (comp.includes(-1)) throw new Error(`${ch}: stroke outside the group tree`);
  return comp;
}

function loadSvg(ch) {
  const hex = ch.codePointAt(0).toString(16).padStart(5, '0');
  const svg = fs.readFileSync(path.join(raw('kanjivg/kanji'), `${hex}.svg`), 'utf8');
  const strokes = [];
  for (const m of svg.matchAll(/<path id="kvg:[0-9a-f]+-s(\d+)"([^>]*?)\sd="([^"]+)"/g)) {
    const type = /kvg:type="([^"]*)"/.exec(m[2]);
    strokes.push({ n: +m[1], d: m[3], type: type ? type[1] : '' });
  }
  strokes.sort((a, b) => a.n - b.n);
  strokes.forEach((s, i) => { if (s.n !== i + 1) throw new Error(`${ch}: stroke numbering gap`); });
  const comps = components(svg, ch, strokes.length);
  const parts = [...new Set([...svg.matchAll(/kvg:element="([^"]+)"/g)].map((m) => m[1]))].filter((p) => p !== ch);
  return { strokes, comps, parts };
}

const out = curriculum.kanji.map(({ c, level, extra }) => {
  const k = meta[c];
  const { strokes, comps, parts } = loadSvg(c);
  if (k.strokes && k.strokes !== strokes.length) {
    console.warn(`warn ${c}: KANJIDIC says ${k.strokes} strokes, KanjiVG has ${strokes.length}`);
  }
  return {
    c, level, ...(extra ? { extra } : {}),
    meanings: k.meanings, on: k.readings_on, kun: k.readings_kun, freq: k.freq ?? null,
    paths: strokes.map((s) => s.d), types: strokes.map((s) => s.type), comps, parts,
  };
});

fs.writeFileSync(path.join(root, 'web/data/kanji.json'), JSON.stringify(out));
console.log(`wrote web/data/kanji.json: ${out.length} kanji`);
