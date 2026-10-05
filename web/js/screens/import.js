// Prior-knowledge import: mark known kanji, pick the vocabulary level reached, preview the
// review load, then record one `seed` event (see importer.js).
import { h, add, clear, confirmDialog, toast } from '../ui/dom.js';
import { local } from '../store.js';
import { estimateKnown, planSeed, suggestDays, kanjiFromText, seedChunks } from '../importer.js';
import { cardIds } from '../data.js';

const LEVELS = [5, 4, 3, 2, 1];

// Highest level L such that most kanji of levels N5..L are marked: a sensible default for
// "vocabulary reached".
function suggestLevel(app, known) {
  let best = 5;
  for (const lv of LEVELS) {
    const ks = app.data.kanjiList.filter((k) => k.level >= lv);
    if (ks.filter((k) => known.has(k.c)).length >= ks.length * 0.7) best = lv;
  }
  return best;
}

export function importScreen(root, app) {
  const data = app.data;
  const inDeck = new Set(); // kanji already used by learned items: shown as known, locked
  for (const id of app.state.items.keys()) {
    const it = data.itemById.get(id);
    if (it) for (const c of [...(it.word || it.kanji)]) if (data.kanjiByChar.has(c)) inDeck.add(c);
  }
  const known = new Set([...local.get('importKanji', []), ...inDeck]);
  let chosenLevel = local.get('importLevel', null); // null: follow the marked kanji
  let level = 5;
  let fillMode = false;
  let days = null; // null = follow the suggestion
  const save = () => local.set('importKanji', [...known].filter((c) => !inDeck.has(c)));

  // ---- step 1: kanji wall --------------------------------------------------------
  const count = h('span.muted');
  const cells = new Map();
  const wall = h('div.import-wall');
  for (const lv of LEVELS) {
    wall.appendChild(h('div.wall-level', `N${lv}`));
    const grid = h('div.kanji-wall.selectable');
    for (const k of data.kanjiList.filter((x) => x.level === lv)) {
      const cell = h('button', { title: k.meanings.join(', '), onclick: () => tap(k) }, k.c);
      cells.set(k.c, cell);
      grid.appendChild(cell);
    }
    wall.appendChild(grid);
  }
  function paint() {
    for (const [c, cell] of cells) {
      cell.classList.toggle('on', known.has(c));
      cell.classList.toggle('locked', inDeck.has(c));
    }
    count.textContent = `${known.size} of ${data.kanjiList.length} kanji marked`;
    update();
  }
  function tap(k) {
    if (inDeck.has(k.c)) return;
    if (fillMode) {
      for (const x of data.kanjiList) if (x.index <= k.index) known.add(x.c);
    } else if (known.has(k.c)) known.delete(k.c);
    else known.add(k.c);
    save();
    paint();
  }
  const modeBtns = h('div.seg',
    h('button.on', { onclick: (e) => setMode(false, e) }, 'Toggle'),
    h('button', { onclick: (e) => setMode(true, e) }, 'Fill up to'));
  function setMode(fill) {
    fillMode = fill;
    [...modeBtns.children].forEach((b, i) => b.classList.toggle('on', (i === 1) === fill));
  }
  const paste = h('textarea.paste', { placeholder: 'Paste any text containing the kanji you know (e.g. an export from another app)', rows: 3 });

  // ---- step 2 + 3: estimate and plan --------------------------------------------
  const levelSeg = h('div.seg', LEVELS.map((lv) => h('button', {
    onclick: () => { chosenLevel = lv; local.set('importLevel', lv); update(); },
  }, `N${lv}`)));
  const estimate = h('div');
  const daysInput = h('input', { type: 'range', min: 7, max: 365, step: 1, oninput: (e) => { days = +e.target.value; update(); } });
  const daysLabel = h('output');
  const chart = h('div.load-chart');
  const importBtn = h('button.btn.primary', { onclick: doImport }, 'Import');
  let plan = null, planItems = [];

  function update() {
    level = chosenLevel ?? suggestLevel(app, known);
    [...levelSeg.children].forEach((b, i) => b.classList.toggle('on', LEVELS[i] === level));
    const { items, holes } = estimateKnown(data, known, level);
    planItems = items.filter((it) => !app.state.items.has(it.id));
    const nCards = planItems.flatMap(cardIds).length;
    const d = days ?? suggestDays(nCards);
    daysInput.value = d;
    plan = planSeed(planItems, d);
    daysLabel.textContent = `${d} days · ~${Math.round(nCards / d)} reviews/day`;
    const words = planItems.filter((it) => !it.kanji).length;
    const sample = (list) => list.slice(0, 60).map((it) => it.kanji ? `${it.kanji}` : `${it.word}（${it.kana}）`).join('　') + (list.length > 60 ? ' …' : '');
    add(clear(estimate),
      h('p', h('b', String(words)), ' words and ', h('b', String(planItems.length - words)), ' kanji lessons assumed known → ',
        h('b', String(nCards)), ' cards.'),
      holes.length ? h('p.small', h('b', String(holes.length)), ` items of N5–N${level} are not covered (gaps); "Next lesson" teaches them first, in curriculum order.`) : null,
      h('details.small', h('summary', 'Assumed known'), h('p.jp', sample(planItems))),
      holes.length ? h('details.small', h('summary', 'Gaps'), h('p.jp', sample(holes))) : null);
    // Load chart, grouped by week when the window is long.
    const per = plan.perDay;
    const group = per.length > 70 ? 7 : 1;
    const bars = [];
    for (let i = 0; i < per.length; i += group) bars.push(per.slice(i, i + group).reduce((a, b) => a + b, 0) / group);
    const max = Math.max(1, ...bars);
    add(clear(chart), bars.map((v) => h('div.load-bar', { style: { height: `${(v / max) * 100}%` }, title: `${v.toFixed(1)}/day` })));
    importBtn.disabled = !nCards;
    importBtn.textContent = nCards ? `Import ${planItems.length} items` : 'Nothing to import';
  }

  async function doImport() {
    if (!plan || !planItems.length) return;
    const ok = await confirmDialog(`Add ${planItems.length} items (${Object.keys(plan.cards).length} cards) as already known? First reviews are spread over ${daysInput.value} days. You can undo this here later.`, 'Import');
    if (!ok) return;
    for (const cards of seedChunks(plan.cards)) await app.dispatch('seed', { cards });
    local.set('importKanji', []);
    toast(`Imported ${planItems.length} items`);
    location.hash = '#/';
  }

  // ---- undo -------------------------------------------------------------------------
  const seeded = [...app.state.items].filter(([, v]) => v.seeded).map(([id]) => id);
  const undo = seeded.length ? h('section.card',
    h('div.label', 'Previous import'),
    h('p.small', `${seeded.length} items were imported. Undoing removes them and their cards (including any reviews done since).`),
    h('button.btn.danger', {
      onclick: async () => {
        if (!await confirmDialog(`Remove all ${seeded.length} imported items from your deck?`, 'Undo import')) return;
        // In parts: one event naming thousands of items would exceed the sync event size limit.
        for (let i = 0; i < seeded.length; i += 500) await app.dispatch('forget', { items: seeded.slice(i, i + 500) });
        toast('Import undone');
        location.reload();
      },
    }, 'Undo import')) : null;

  add(root,
    h('div.row.between', h('a.btn.small', { href: '#/settings' }, '‹ Settings')),
    h('h1.title', 'Import prior knowledge'),
    h('p.muted', 'Already studied elsewhere? Mark what you know. Those words skip their lessons, and their first reviews are spread over the coming weeks instead of all landing today.'),
    undo,
    h('section.card',
      h('h3', '1. Kanji you know'),
      h('div.row', modeBtns, ...LEVELS.map((lv) => h('button.btn.small', {
        onclick: () => { for (const k of data.kanjiList) if (k.level === lv) known.add(k.c); save(); paint(); },
      }, `+N${lv}`)), h('button.btn.small', {
        onclick: () => { for (const c of [...known]) if (!inDeck.has(c)) known.delete(c); save(); paint(); },
      }, 'Clear')),
      h('p.small.muted', '"Fill up to" marks every kanji before the one you tap (curriculum order), for "I know everything up to about here".'),
      paste,
      h('div.row', h('button.btn.small', {
        onclick: () => {
          const found = kanjiFromText(data, paste.value);
          found.forEach((c) => known.add(c));
          paste.value = '';
          save(); paint();
          toast(`Marked ${found.length} kanji from the text`);
        },
      }, 'Mark kanji from text'), count),
      wall),
    h('section.card',
      h('h3', '2. Vocabulary level reached'),
      h('p.small.muted', 'A word counts as known when you know all its kanji and its JLPT level is at or below this one.'),
      levelSeg,
      estimate),
    h('section.card',
      h('h3', '3. Spread first reviews over'),
      h('div.range', daysInput, daysLabel),
      chart,
      h('p.small.muted', 'Weaker cards (recent material, writing) come first. After its first review each card is scheduled from your actual answers. Regular lessons and reviews come on top.'),
      h('div.row.center', importBtn)),
  );
  paint();
}
