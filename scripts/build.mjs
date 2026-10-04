#!/usr/bin/env node
// Build web/data/kanji.json: every kanji the curriculum introduces, in introduction order,
// with KanjiVG stroke paths and KANJIDIC metadata. Run after build-curriculum.mjs.
// Entry: {c, level, extra?, meanings, on, kun, freq, paths, types, parts}
//   paths[i]: SVG path `d` of stroke i (centerline, 109x109 box)
//   parts: KanjiVG components (e.g. 語 -> 言 口 吾 五 二), used to find look-alike kanji
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (p) => path.join(root, 'raw', p);

const meta = JSON.parse(fs.readFileSync(raw('kanji-data.json'), 'utf8'));
const curriculum = JSON.parse(fs.readFileSync(path.join(root, 'web/data/curriculum.json'), 'utf8'));

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
  const parts = [...new Set([...svg.matchAll(/kvg:element="([^"]+)"/g)].map((m) => m[1]))].filter((p) => p !== ch);
  return { strokes, parts };
}

const out = curriculum.kanji.map(({ c, level, extra }) => {
  const k = meta[c];
  const { strokes, parts } = loadSvg(c);
  if (k.strokes && k.strokes !== strokes.length) {
    console.warn(`warn ${c}: KANJIDIC says ${k.strokes} strokes, KanjiVG has ${strokes.length}`);
  }
  return {
    c, level, ...(extra ? { extra } : {}),
    meanings: k.meanings, on: k.readings_on, kun: k.readings_kun, freq: k.freq ?? null,
    paths: strokes.map((s) => s.d), types: strokes.map((s) => s.type), parts,
  };
});

fs.writeFileSync(path.join(root, 'web/data/kanji.json'), JSON.stringify(out));
console.log(`wrote web/data/kanji.json: ${out.length} kanji`);
