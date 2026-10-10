#!/usr/bin/env node
// Build web/fonts/klee-one.woff2: Klee One SemiBold (a textbook-style font whose shapes match
// handwriting, and so KanjiVG's strokes) reduced to the characters the app can show: the
// curriculum, the kanji data, Japanese text in the UI, kana, CJK punctuation and ASCII.
// The full font is 8.5 MB; the subset is about 1.2 MB. Run after build.mjs.
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const at = (...p) => path.join(root, ...p);

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const chars = new Set();
const sources = [at('web/data/curriculum.json'), at('web/data/kanji.json'),
  ...filesUnder(at('web')).filter((f) => /\.(js|html)$/.test(f))];
for (const f of sources) for (const ch of fs.readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 0x7f) chars.add(ch);
for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCodePoint(c));
for (let c = 0x3000; c <= 0x30ff; c++) chars.add(String.fromCodePoint(c)); // punctuation, kana

const text = [...chars].sort().join('');
const font = await subsetFont(fs.readFileSync(at('raw/KleeOne-SemiBold.ttf')), text, { targetFormat: 'woff2' });
fs.mkdirSync(at('web/fonts'), { recursive: true });
fs.writeFileSync(at('web/fonts/klee-one.woff2'), font);
fs.copyFileSync(at('raw/KleeOne-OFL.txt'), at('web/fonts/OFL.txt'));
console.log(`wrote web/fonts/klee-one.woff2: ${chars.size} characters, ${(font.length / 1e6).toFixed(2)} MB`);
