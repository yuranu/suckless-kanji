#!/usr/bin/env node
// Build data/curriculum.yaml: every JLPT vocab word written with kanji, in learning order.
//
// Kanji order: N5 -> N1; within a level, the most frequent kanji that unlocks a word right now. Words follow the official levels too:
// while studying level L, a word is available only if its JLPT level is L or easier and all of
// its kanji are known. Each level opens with a review lesson of its words that need only kanji
// from earlier levels; then each kanji lesson unlocks the words that just became writable.
// Inside a lesson: words using only the new kanji first, then easier level, common, shorter.
//
// The tanos kanji lists (2211) miss some kanji the tanos vocab lists use (分, 無, 的, ...).
// Jōyō ones among them are added as `extra` kanji at the level of their easiest word.
//
// Each word gets an example sentence from the Tanaka corpus (Tatoeba), matched by headword AND
// reading. Sentences with only learned kanji are preferred; kanji not yet learned are rewritten
// in hiragana (readings via kuromoji).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const kuromoji = createRequire(import.meta.url)('kuromoji');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = (p) => path.join(root, 'raw', p);
const readJson = (p) => JSON.parse(fs.readFileSync(raw(p), 'utf8').replace(/^﻿/, ''));

// ---- load ----------------------------------------------------------------------
const kanjiData = readJson('kanji-data.json');
const jmdict = new Map(readJson('jmdict-eng.json').words.map((w) => [w.id, w]));
const furigana = new Map();
for (const f of readJson('JmdictFurigana.json')) furigana.set(f.text + '|' + f.reading, f.furigana);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const isKanji = (ch) => /[㐀-䶿一-鿿豈-﫿]/u.test(ch);
const kanjiOf = (s) => [...new Set([...s].filter(isKanji))];
const hasSvg = (ch) => fs.existsSync(raw(`kanjivg/kanji/${ch.codePointAt(0).toString(16).padStart(5, '0')}.svg`));

// ---- vocabulary -----------------------------------------------------------------
const skipped = { usually_kana: [], rare_kanji_form: [], non_joyo_kanji: [] };
let kanaOnly = 0;
const vocab = new Map(); // "kanji|kana" -> word (easiest level wins)
for (const n of [5, 4, 3, 2, 1]) {
  for (const r of parseCsv(fs.readFileSync(raw(`jlpt-vocab-n${n}.csv`), 'utf8'))) {
    if (!kanjiOf(r.kanji).length) { kanaOnly++; continue; } // also catches ＯＫ, ＣＤ, ...
    const key = r.kanji + '|' + r.kana;
    if (vocab.has(key)) continue;
    vocab.set(key, { word: r.kanji, kana: r.kana, jlpt: n, meaning: r.waller_definition, seq: r.jmdict_seq });
  }
}

// Filter by JMdict usage notes.
const words = [];
for (const w of vocab.values()) {
  const e = jmdict.get(w.seq);
  const label = `${w.word} (${w.kana}) N${w.jlpt}`;
  if (e) {
    const form = e.kanji.find((k) => k.text === w.word);
    if (form && form.tags.some((t) => ['rK', 'sK', 'iK', 'oK'].includes(t))) { skipped.rare_kanji_form.push(label); continue; }
    if (e.sense[0] && e.sense[0].misc.includes('uk')) { skipped.usually_kana.push(label); continue; }
    w.common = !!(form && form.common);
    // JMdict meaning: first sense that applies to this spelling + reading. Waller's is the fallback.
    const applies = (list, v) => list.includes('*') || list.includes(v);
    const sense = e.sense.find((x) => applies(x.appliesToKanji, w.word) && applies(x.appliesToKana, w.kana));
    if (sense) w.meaning = sense.gloss.slice(0, 3).map((g) => g.text).join('; ');
    w.pos = (sense || e.sense[0])?.partOfSpeech || [];
  }
  w.id = `${w.word}|${w.kana}`; // stable across regenerations: progress is keyed by it
  words.push(w);
}

// ---- kanji set ------------------------------------------------------------------
const kanji = new Map(); // char -> {c, jlpt, freq, extra, meaning}
for (const [c, k] of Object.entries(kanjiData)) {
  if (k.jlpt_new) kanji.set(c, { c, jlpt: k.jlpt_new, freq: k.freq, meaning: k.meanings.join(', '), on: k.readings_on, kun: k.readings_kun });
}
for (const w of words.slice().sort((a, b) => b.jlpt - a.jlpt)) {
  for (const c of kanjiOf(w.word)) {
    const k = kanjiData[c];
    if (kanji.has(c) || !k || !k.grade || k.grade > 8 || !hasSvg(c)) continue; // grade 1-8 = jōyō
    kanji.set(c, { c, jlpt: w.jlpt, freq: k.freq, meaning: k.meanings.join(', '), on: k.readings_on, kun: k.readings_kun, extra: true });
  }
}
const usable = [];
for (const w of words) {
  const missing = kanjiOf(w.word).filter((c) => !kanji.has(c));
  if (missing.length) skipped.non_joyo_kanji.push(`${w.word} (${w.kana}) N${w.jlpt} — ${missing.join('')}`);
  else usable.push(w);
}

// ---- readings ------------------------------------------------------------------
const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const VOICE = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const SEMI = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

// Dictionary readings of a kanji, plus their regular sound changes (rendaku, gemination).
const variantCache = new Map();
function knownReadings(c) {
  if (variantCache.has(c)) return variantCache.get(c);
  const k = kanji.get(c);
  const set = new Set();
  for (const r0 of [...(k?.on || []), ...(k?.kun || [])]) {
    const r = kata2hira(r0).replace(/-/g, '');
    const stems = [r.replace('.', ''), r.split('.')[0]];
    for (const s of stems) {
      if (!s) continue;
      set.add(s);
      if (VOICE[s[0]]) set.add(VOICE[s[0]] + s.slice(1));
      if (SEMI[s[0]]) set.add(SEMI[s[0]] + s.slice(1));
      if (s.length > 1 && 'つちくきり'.includes(s.at(-1))) set.add(s.slice(0, -1) + 'っ');
    }
  }
  variantCache.set(c, set);
  return set;
}

// Split a word into ruby segments; returns null when the furigana data has no entry.
function segments(w) {
  const f = furigana.get(w.word + '|' + w.kana);
  if (!f) return null;
  let prev = null;
  return f.map((s) => {
    let base = s.ruby;
    if (base === '々' && prev) base = prev; // repetition mark reads as the kanji before it
    if (isKanji(s.ruby[s.ruby.length - 1])) prev = s.ruby[s.ruby.length - 1];
    return { ruby: s.ruby, base, rt: s.rt };
  });
}

for (const w of usable) {
  const segs = segments(w);
  w.readings = [];
  w.irregular = [];
  // segs: [text, reading|null] pairs, e.g. 分かる -> [["分","わ"],["かる",null]]
  w.segs = segs ? segs.map((s) => [s.ruby, s.rt || null]) : [[w.word, w.kana]];
  if (!segs) { w.furigana = `${w.word}[${w.kana}]`; w.readings.push(`${w.word}:${w.kana}`); continue; }
  w.furigana = segs.map((s) => (s.rt ? `${s.ruby}[${s.rt}]` : s.ruby)).join('');
  for (const s of segs) {
    if (!s.rt) continue;
    const key = `${s.base}:${s.rt}`;
    w.readings.push(key);
    // Multi-kanji ruby is jukujikun (大人 → おとな); single kanji off-dictionary is irregular.
    if ([...s.base].length > 1 || !knownReadings(s.base).has(s.rt)) w.irregular.push(key);
  }
}

// ---- example sentences ------------------------------------------------------------
// jpn_indices.csv: jpn_id \t eng_id \t B-line. B-line tokens: headword(reading)[sense]{surface}~
// where (reading) may instead be (#jmdict_seq), and ~ marks a checked, good example.
const jpnText = new Map();
for (const line of fs.readFileSync(raw('jpn_sentences.tsv'), 'utf8').split('\n')) {
  const [id, , text] = line.split('\t');
  if (text) jpnText.set(id, text);
}
const readingsOf = new Map(); // kanji spelling -> Set of kana, across all of JMdict
for (const e of jmdict.values()) {
  for (const k of e.kanji) {
    if (!readingsOf.has(k.text)) readingsOf.set(k.text, new Set());
    for (const r of e.kana) if (r.appliesToKanji.includes('*') || r.appliesToKanji.includes(k.text)) readingsOf.get(k.text).add(r.text);
  }
}
const TOKEN = /^([^([{~]+)(?:\(([^)]*)\))?(?:\[\d+\])?(?:\{([^}]*)\})?(~)?$/;
const byHeadword = new Map(); // headword -> [{jpn, eng, reading, surface, checked}]
const engNeeded = new Set();
for (const line of fs.readFileSync(raw('jpn_indices.csv'), 'utf8').split('\n')) {
  const [jpn, eng, bline] = line.split('\t');
  if (!bline || !jpnText.has(jpn)) continue;
  for (const tok of bline.split(' ')) {
    const m = TOKEN.exec(tok);
    if (!m) continue;
    const [, head, reading, surface, checked] = m;
    if (!byHeadword.has(head)) byHeadword.set(head, []);
    byHeadword.get(head).push({ jpn, eng, reading, surface: surface || head, checked: !!checked });
    engNeeded.add(eng);
  }
}
const engText = new Map();
for (const line of fs.readFileSync(raw('eng_sentences.tsv'), 'utf8').split('\n')) {
  const t = line.indexOf('\t');
  const id = line.slice(0, t);
  if (engNeeded.has(id)) engText.set(id, line.slice(line.indexOf('\t', t + 1) + 1));
}

const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: path.join(root, 'node_modules/kuromoji/dict') }).build((e, t) => (e ? reject(e) : resolve(t))));

// Spelling up to the last kanji: what must literally appear in the sentence (会う -> 会, 大きい -> 大).
const stemOf = (word) => { const cs = [...word]; let i = cs.length; while (i && !isKanji(cs[i - 1]) && cs[i - 1] !== '々') i--; return cs.slice(0, i).join(''); };
const sentenceUses = new Map();

function candidates(w) {
  const all = byHeadword.get(w.word) || [];
  const onlyReading = (readingsOf.get(w.word)?.size ?? 1) === 1;
  const stem = stemOf(w.word);
  return all.filter((c) =>
    (c.reading === w.kana || c.reading === '#' + w.seq || (!c.reading && onlyReading)) &&
    c.surface.includes(stem) && jpnText.get(c.jpn).includes(c.surface));
}

// Rewrite tokens containing unlearned kanji as hiragana; null if the target word gets mangled.
function kanaize(text, learnedSet, stem) {
  const out = tokenizer.tokenize(text).map((t) => {
    const unknown = [...t.surface_form].some((ch) => isKanji(ch) && !learnedSet.has(ch));
    return unknown && t.reading ? kata2hira(t.reading) : t.surface_form;
  }).join('');
  return out.includes(stem) ? out : null;
}

function pickExample(w, learnedSet) {
  const stem = stemOf(w.word);
  const scored = [];
  for (const c of candidates(w)) {
    const text = jpnText.get(c.jpn);
    const len = [...text].length;
    if (len > 32 || !engText.has(c.eng)) continue;
    const unknown = kanjiOf(text).filter((ch) => !learnedSet.has(ch)).length;
    // Short, no unlearned kanji, checked by Tanaka editors, not already used for other words.
    const score = unknown * 12 + Math.max(len, 8) + (c.checked ? 0 : 4) + (sentenceUses.get(c.jpn) || 0) * 6;
    scored.push({ c, text, unknown, score });
  }
  scored.sort((a, b) => a.score - b.score);
  for (const s of scored.slice(0, 5)) {
    const ja = s.unknown ? kanaize(s.text, learnedSet, stem) : s.text;
    if (!ja) continue;
    sentenceUses.set(s.c.jpn, (sentenceUses.get(s.c.jpn) || 0) + 1);
    return { ja, en: engText.get(s.c.eng), kanaized: s.unknown, tatoeba: +s.c.jpn };
  }
  return null;
}

// ---- order ----------------------------------------------------------------------
const order = [...kanji.values()].sort((a, b) => b.jlpt - a.jlpt || (a.freq ?? 1e9) - (b.freq ?? 1e9) || a.c.localeCompare(b.c));
const learned = new Set();
const seenReadings = new Set();
const pending = new Set(usable);
const lessons = []; // {k, words} for a kanji lesson, {review: level, words} for a level opener

function unlock(level, isNew) {
  const ws = [...pending].filter((w) => w.jlpt >= level && kanjiOf(w.word).every((c) => learned.has(c)));
  ws.forEach((w) => pending.delete(w));
  const onlyNew = (w) => kanjiOf(w.word).every(isNew);
  ws.sort((a, b) =>
    onlyNew(b) - onlyNew(a) || b.jlpt - a.jlpt || (b.common ? 1 : 0) - (a.common ? 1 : 0) ||
    kanjiOf(a.word).length - kanjiOf(b.word).length || a.word.length - b.word.length || a.kana.localeCompare(b.kana));
  for (const w of ws) {
    w.new_readings = w.readings.filter((r) => !seenReadings.has(r));
    w.new_readings.forEach((r) => seenReadings.add(r));
    w.example = pickExample(w, learned);
  }
  return ws;
}

for (const level of [5, 4, 3, 2, 1]) {
  const review = unlock(level, () => false);
  if (review.length) lessons.push({ review: level, words: review });
  // Next kanji: the most frequent one that unlocks a word right now; a kanji that would make an
  // empty lesson waits until it is useful (or until nothing else is left).
  const remaining = order.filter((x) => x.jlpt === level);
  while (remaining.length) {
    const unlocks = new Set();
    for (const w of pending) {
      if (w.jlpt < level) continue;
      const missing = kanjiOf(w.word).filter((c) => !learned.has(c));
      if (missing.length === 1) unlocks.add(missing[0]);
    }
    const i = Math.max(0, remaining.findIndex((x) => unlocks.has(x.c)));
    const [k] = remaining.splice(i, 1);
    learned.add(k.c);
    lessons.push({ k, words: unlock(level, (c) => c === k.c) });
  }
}
if (pending.size) throw new Error('unplaced words: ' + [...pending].map((w) => w.word).join(' '));

// ---- emit YAML ------------------------------------------------------------------
// Strings are JSON-quoted: always valid YAML, no escaping surprises with : [ ] # etc.
const q = JSON.stringify;
const list = (a) => '[' + a.map(q).join(', ') + ']';
// Flatten: one lesson per word+reading. The first word using a kanji introduces it (new_kanji);
// a kanji that unlocks no word at its level becomes a kanji-only lesson so none are dropped.
const flat = [];
for (const { k, review, words: ws } of lessons) {
  const level = review || k.jlpt;
  if (k && !ws.length) { flat.push({ level, kanjiOnly: k }); continue; }
  ws.forEach((w, i) => flat.push({ level, w, newKanji: k && i === 0 ? k : null }));
}
const wordLessons = flat.filter((x) => x.w);
const kanjiLessons = lessons.filter((l) => l.k);
const levelCount = (n) => kanjiLessons.filter((l) => l.k.jlpt === n).length;
const out = [];
out.push(
  '# Generated by scripts/build-curriculum.mjs — do not edit.',
  '# One lesson = one word with one reading, in study order. Level by level, N5 -> N1: a word appears',
  '# only once its JLPT level is reached and all its kanji are learned. Each level (after N5) starts',
  '# with that level\'s words written with kanji from earlier levels; then kanji are introduced one at',
  '# a time (most frequent kanji that unlocks a word at that point), each followed by the words it unlocks.',
  '# Lesson fields:',
  '#   id: stable key ("word|kana", or the kanji for kanji-only lessons); app progress is keyed by it',
  '#   level: curriculum section (JLPT N-level being studied); jlpt: the word\'s own JLPT level',
  '#   new_kanji: kanji introduced by this lesson, with its meaning',
  '#   word, kana, furigana (Anki style), meaning, common: false if not a JMdict common word',
  '#   new: readings first seen in this lesson ("字:reading"; multi-kanji key = jukujikun)',
  '#   irregular: readings not in KANJIDIC even after rendaku / gemination',
  '#   example: Tanaka/Tatoeba sentence using this word with this reading; only kanji learned so far,',
  '#     otherwise unlearned kanji are written in hiragana (kanaized: true). tatoeba = sentence id.',
  '#   Kanji-only lessons (kanji: ...) introduce a kanji no word at its level uses yet.',
  '# Sources: tanos.co.uk JLPT lists (via stephenmk/yomitan-jlpt-vocab, davidluzgouveia/kanji-data),',
  '#   JMdict + KANJIDIC2 (EDRDG, CC BY-SA 4.0), JmdictFurigana (CC BY-SA 4.0), Tatoeba (CC BY 2.0 FR).',
  'stats:',
  `  lessons: ${flat.length}`,
  `  word_lessons: ${wordLessons.length}`,
  `  kanji_only_lessons: ${flat.length - wordLessons.length}`,
  `  kanji: ${kanjiLessons.length}  # N5 ${levelCount(5)}, N4 ${levelCount(4)}, N3 ${levelCount(3)}, N2 ${levelCount(2)}, N1 ${levelCount(1)}`,
  `  extra_kanji: ${kanjiLessons.filter((l) => l.k.extra).length}  # used by JLPT vocab but missing from the tanos kanji lists`,
  `  with_example: ${wordLessons.filter((x) => x.w.example).length}`,
  `  examples_kanaized: ${wordLessons.filter((x) => x.w.example?.kanaized).length}  # unlearned kanji rewritten in hiragana`,
  `  skipped_kana_only: ${kanaOnly}`,
  `  skipped_usually_kana: ${skipped.usually_kana.length}`,
  `  skipped_rare_kanji_form: ${skipped.rare_kanji_form.length}`,
  `  skipped_non_joyo_kanji: ${skipped.non_joyo_kanji.length}`,
  '',
  'lessons:',
);
const kanjiLine = (k) => `{kanji: ${q(k.c)}, meaning: ${q(k.meaning)}${k.extra ? ', extra: true' : ''}}`;
flat.forEach(({ level, w, newKanji, kanjiOnly }, i) => {
  out.push(`  - lesson: ${i + 1}`, `    id: ${q(kanjiOnly ? kanjiOnly.c : w.id)}`, `    level: ${level}`);
  if (kanjiOnly) {
    out.push(`    kanji: ${q(kanjiOnly.c)}`, `    meaning: ${q(kanjiOnly.meaning)}`);
    if (kanjiOnly.extra) out.push('    extra: true');
    return;
  }
  if (newKanji) out.push(`    new_kanji: ${kanjiLine(newKanji)}`);
  out.push(`    word: ${q(w.word)}`, `    kana: ${q(w.kana)}`, `    furigana: ${q(w.furigana)}`,
    `    jlpt: ${w.jlpt}`, `    meaning: ${q(w.meaning)}`);
  if (w.common === false) out.push('    common: false');
  if (w.new_readings.length) out.push(`    new: ${list(w.new_readings)}`);
  if (w.irregular.length) out.push(`    irregular: ${list(w.irregular)}`);
  if (w.example) {
    const e = w.example;
    out.push(`    example: {ja: ${q(e.ja)}, en: ${q(e.en)}${e.kanaized ? ', kanaized: true' : ''}, tatoeba: ${e.tatoeba}}`);
  }
});
out.push('', 'skipped:');
for (const [reason, items] of Object.entries(skipped)) {
  out.push(`  ${reason}:`);
  for (const s of items) out.push(`    - ${q(s)}`);
}

// App copy: same lessons as compact JSON, plus the kanji introduction order for scripts/build.mjs.
const json = {
  items: flat.map(({ level, w, newKanji, kanjiOnly }) => (kanjiOnly
    ? { id: kanjiOnly.c, level, kanji: kanjiOnly.c }
    : {
      id: w.id, level, jlpt: w.jlpt, word: w.word, kana: w.kana, segs: w.segs, meaning: w.meaning, pos: w.pos,
      ...(newKanji ? { newKanji: newKanji.c } : {}),
      ...(w.example ? { example: { ja: w.example.ja, en: w.example.en } } : {}),
    })),
  kanji: kanjiLessons.map((l) => ({ c: l.k.c, level: l.k.jlpt, ...(l.k.extra ? { extra: true } : {}) })),
};
fs.mkdirSync(path.join(root, 'web/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'web/data/curriculum.json'), JSON.stringify(json));

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/curriculum.yaml'), out.join('\n') + '\n');
console.log(`wrote data/curriculum.yaml: ${flat.length} lessons (${wordLessons.length} words, ${kanjiLessons.length} kanji)`);
console.log(Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length])), 'kana-only', kanaOnly);
