#!/usr/bin/env node
// Build the app icons from KanjiVG's stroke paths of 字 (no fonts involved, so the output is
// identical on every machine). Writes web/icons/: icon.svg (favicon), icon-192.png,
// icon-512.png and maskable-512.png (full-bleed, glyph inside the 80% safe zone).
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'web/icons');
const kanji = JSON.parse(fs.readFileSync(path.join(root, 'web/data/kanji.json'), 'utf8'));
const glyph = kanji.find((k) => k.c === '字');

const RED = '#c8432b';
const INK = '#ffffff';

// The 109x109 KanjiVG glyph scaled into a `size` box, centered, with a rounded or square
// background.
function svg({ size, glyphScale, radius }) {
  const g = size * glyphScale;
  const offset = (size - g) / 2;
  const stroke = 6.5; // in KanjiVG units: bold enough to read at 16 px
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" rx="${radius}" fill="${RED}"/>
<g transform="translate(${offset} ${offset}) scale(${g / 109})" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
${glyph.paths.map((d) => `<path d="${d}"/>`).join('\n')}
</g>
</svg>
`;
}

const png = (source, width) => new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng();

fs.mkdirSync(out, { recursive: true });
const icon = svg({ size: 512, glyphScale: 0.78, radius: 112 });
const maskable = svg({ size: 512, glyphScale: 0.6, radius: 0 });
fs.writeFileSync(path.join(out, 'icon.svg'), icon);
fs.writeFileSync(path.join(out, 'icon-192.png'), png(icon, 192));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(icon, 512));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(maskable, 512));
console.log('wrote web/icons/{icon.svg,icon-192.png,icon-512.png,maskable-512.png}');
