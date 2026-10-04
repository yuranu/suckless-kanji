// Installability and offline guarantees of the web app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = new URL('../web/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, web));

function filesUnder(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

// URLs as served by Cloudflare static assets: index.html is "./", x.html is "x".
const servedUrl = (file) => (file === 'index.html' ? './' : file.replace(/\.html$/, ''));

function precacheList() {
  const src = read('sw.js').toString();
  const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)[1];
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('service worker precaches every file of the app, and nothing that does not exist', () => {
  const files = filesUnder(fileURLToPath(web)).filter((f) => f !== 'sw.js');
  const expected = files.map(servedUrl).sort();
  assert.deepEqual([...precacheList()].sort(), expected,
    'web/sw.js PRECACHE is out of date: add or remove entries so the app works fully offline');
});

test('manifest meets Chrome installability requirements', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons']) assert.ok(m[k], k);
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(m.display));
  const sizes = m.icons.filter((i) => i.type === 'image/png').map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  const html = read('index.html').toString();
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
});

test('manifest icons exist with the declared pixel size', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const icon of m.icons) {
    const buf = read(icon.src);
    if (icon.type !== 'image/png') continue;
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', icon.src);
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // IHDR
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
});
