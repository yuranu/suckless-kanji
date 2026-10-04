// Progress backup as a readable YAML file.
//
// Sections: a header and summary, synced settings, the current schedule per card (for
// reading; ignored on import), and the full event log, one event per line. The event lines
// are JSON objects, which are valid YAML flow mappings, so the file is plain YAML while
// import stays exact.
import { replay, dueDay, intervalOf, today, DAY } from './state.js';
import { SYNCED } from './settings.js';

export const FORMAT = 'suckless-kanji-progress';
const KIND = { r: 'reading', w: 'writing', k: 'kanji' };

const q = (v) => JSON.stringify(v); // JSON strings are valid YAML double-quoted scalars

// One-line JSON with ": " and ", " separators: still JSON (exact round trip with JSON.parse)
// and a valid YAML flow collection for YAML 1.1 parsers too (which need the space).
function flow(v) {
  if (Array.isArray(v)) return `[${v.map(flow).join(', ')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${q(k)}: ${flow(x)}`).join(', ')}}`;
  return JSON.stringify(v ?? null);
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Study-day number -> local calendar date, relative to today.
const dayDate = (day, todayDay, now) => ymd(now + (day - todayDay) * DAY);

export function toYaml({ events, reports = [], data, device = '', now = Date.now() }) {
  const state = replay(events);
  const s = state.settings;
  const t = today(state, now);
  const learned = [...state.items.keys()].map((id) => data?.itemById.get(id)).filter(Boolean);
  const cards = [...state.cards.values()].sort((a, b) => dueDay(a, s) - dueDay(b, s) || (a.id < b.id ? -1 : 1));
  const out = [
    '# Suckless Kanji progress backup.',
    '# Import it in Settings -> Your data -> Import / merge. Only `events` is imported (merged by id);',
    '# `summary` and `cards` are a readable snapshot derived from the events.',
    `format: ${FORMAT}`,
    'version: 1',
    `exported: ${q(new Date(now).toISOString())}`,
    `device: ${q(device)}`,
    'summary:',
    `  words_learned: ${learned.filter((it) => !it.kanji).length}`,
    `  kanji_lessons_learned: ${learned.filter((it) => it.kanji).length}`,
    `  cards: ${state.cards.size}`,
    `  due_today: ${cards.filter((c) => dueDay(c, s) <= t).length}`,
    `  reviews: ${[...state.days.values()].reduce((n, d) => n + d.reviews, 0)}`,
    `  events: ${events.length}`,
    'settings:',
    ...[...SYNCED].sort().map((k) => `  ${k}: ${q(s[k])}`),
    `cards:  # ${cards.length} cards by due date`,
  ];
  for (const c of cards) {
    const it = data?.itemById.get(c.item);
    const parts = [
      `card: ${q(c.id)}`,
      it ? (it.kanji ? `kanji: ${q(it.kanji)}` : `word: ${q(it.word)}, kana: ${q(it.kana)}`) : null,
      `kind: ${KIND[c.kind] || c.kind}`,
      `reps: ${c.reps}`,
      `lapses: ${c.lapses}`,
      `last: ${dayDate(c.lastDay, t, now)}`,
      `due: ${dayDate(dueDay(c, s), t, now)}`,
      `interval: ${intervalOf(c, s)}`,
      c.seeded && c.reps === 1 ? 'imported: true' : null,
    ].filter(Boolean);
    out.push(`  - {${parts.join(', ')}}`);
  }
  out.push(`events:  # ${events.length} events, oldest first: the actual history`);
  for (const e of [...events].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))) out.push(`  - ${flow(e)}`);
  out.push(`reports:  # ${reports.length} local drawing-checker reports`);
  for (const r of reports) out.push(`  - ${flow(r)}`);
  return out.join('\n') + '\n';
}

// Parse a backup written by toYaml(). Returns {events, reports}.
export function parseBackup(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => l.trim() === `format: ${FORMAT}`)) throw new Error('Not a suckless-kanji backup file');
  const sections = { events: [], reports: [] };
  let current = null;
  lines.forEach((line, i) => {
    const top = /^([a-z_]+):/.exec(line);
    if (top) { current = top[1] in sections ? top[1] : null; return; }
    if (!current) return;
    const item = /^\s+-\s+(\{.*\})\s*$/.exec(line);
    if (!item) {
      if (line.trim() && !line.trim().startsWith('#')) throw new Error(`Unexpected line ${i + 1} in ${current}`);
      return;
    }
    try {
      sections[current].push(JSON.parse(item[1]));
    } catch {
      throw new Error(`Line ${i + 1}: an entry in ${current} could not be read (edited by hand?)`);
    }
  });
  for (const e of sections.events) {
    if (typeof e.id !== 'string' || typeof e.t !== 'number' || typeof e.type !== 'string') throw new Error(`Malformed event ${q(e.id)}`);
  }
  return sections;
}
