import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { indexData, cardIds } from '../web/js/data.js';
import { toYaml, parseBackup } from '../web/js/backup.js';
import { replay, DAY } from '../web/js/state.js';
import { makeEvent } from '../web/js/store.js';

const load = (p) => JSON.parse(fs.readFileSync(new URL(`../web/data/${p}`, import.meta.url), 'utf8'));
const data = indexData(load('curriculum.json'), load('kanji.json'));
const NOW = Date.UTC(2026, 5, 10, 12);

function sampleEvents() {
  const ev = (type, d, t) => makeEvent(type, d, 'dev1', t);
  const items = data.items.slice(0, 8);
  return [
    ev('learn', { cards: Object.fromEntries(items.flatMap(cardIds).map((id) => [id, 3])) }, NOW - 10 * DAY),
    ev('review', { card: `${items[0].id}#r`, rating: 1, ms: 4000 }, NOW - 5 * DAY),
    ev('review', { card: `${items[1].id}#w`, rating: 4, ms: 9000 }, NOW - 4 * DAY),
    ev('settings', { algorithm: 'sm2', wordsPerLesson: 5 }, NOW - 3 * DAY),
    ev('seed', { cards: { [`${data.items[20].id}#r`]: [30, 5] } }, NOW - 2 * DAY),
  ];
}

test('YAML backup round-trips the event log exactly', () => {
  const events = sampleEvents();
  const reports = [{ id: 'r1', t: NOW, kind: 'drawpad', kanji: '日', mistakes: 2 }];
  const yaml = toYaml({ events, reports, data, device: 'dev1', now: NOW });
  const back = parseBackup(yaml);
  const sort = (a) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(sort(back.events), sort(events));
  assert.deepEqual(back.reports, reports);
  assert.deepEqual([...replay(back.events).cards.values()], [...replay(events).cards.values()]);
  assert.match(yaml, /^ {2}- \{card: "一\|いち#r", word: "一", kana: "いち", kind: reading, reps: 2, lapses: 1, /m);
  assert.match(yaml, /^ {2}algorithm: "sm2"$/m);
});

test('YAML backup parses with a standard YAML parser (1.2 and 1.1)', () => {
  const yaml = toYaml({ events: sampleEvents(), data, device: 'dev1', now: NOW });
  for (const version of ['1.2', '1.1']) {
    const d = YAML.parse(yaml, { version, strict: true });
    assert.equal(d.format, 'suckless-kanji-progress', version);
    assert.equal(d.events.length, 5, version);
    assert.equal(d.cards.length, 17, version);
    assert.deepEqual(d.events, parseBackup(yaml).events, version); // same data either way
  }
});

test('damaged files are rejected with a useful message', () => {
  const yaml = toYaml({ events: sampleEvents(), data, now: NOW });
  assert.throws(() => parseBackup('hello: world\n'), /Not a suckless-kanji backup/);
  const broken = yaml.replace(/("type": "review")/, '$1, oops');
  assert.throws(() => parseBackup(broken), /Line \d+: an entry in events could not be read/);
});
