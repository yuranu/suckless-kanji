// Free practice: pick kanji, drill the cards of their words. Out of band: practice never
// records review events, so the schedule is untouched. Reached from Home.
import { h, add, clear } from '../ui/dom.js';
import { local } from '../store.js';
import { cardIds, kanjiOfWord } from '../data.js';
import { kanjiStatus, itemsForKanji } from '../progress.js';

export function freePracticeScreen(root, app) {
  const data = app.data;
  let showAll = local.get('freeShowAll', false);
  let learnedOnly = local.get('freeLearnedOnly', true);
  const selected = new Set(local.get('freeSelection', []));
  const save = () => local.set('freeSelection', [...selected]);

  // Kanji of the items learned on the most recent study day.
  function lastLessonKanji() {
    let last = -Infinity;
    for (const v of app.state.items.values()) last = Math.max(last, v.day);
    const out = new Set();
    for (const [id, v] of app.state.items) {
      if (v.day !== last) continue;
      const it = data.itemById.get(id);
      if (it) kanjiOfWord(it.word || it.kanji).forEach((c) => out.add(c));
    }
    return out;
  }

  function render() {
    const learnedKanji = data.kanjiList.filter((k) => kanjiStatus(app, k.c) !== 'new');
    const shown = showAll ? data.kanjiList : learnedKanji;
    const chars = [...selected];
    const items = itemsForKanji(app, chars, learnedOnly);
    const cards = items.reduce((n, it) => n + cardIds(it).length, 0);
    const spec = `${learnedOnly ? 'kanji' : 'kanji-all'}:${chars.join('')}`;
    const pick = (set) => { set.forEach((c) => selected.add(c)); save(); render(); };

    add(clear(root),
      h('div.row.between', h('a.btn.small', { href: '#/' }, '‹ Home')),
      h('h1.title', 'Free practice'),
      h('p.muted', 'Pick kanji and drill the words that use them. This does not count as review: your schedule is not touched.'),
      h('div.row',
        h('button.btn.small', { onclick: () => pick(lastLessonKanji()) }, 'Last lesson'),
        h('button.btn.small', { onclick: () => pick(learnedKanji.map((k) => k.c)) }, 'All learned'),
        h('button.btn.small', { onclick: () => { selected.clear(); save(); render(); } }, 'Clear'),
        h('label.small', { style: { marginLeft: 'auto' } }, h('input', {
          type: 'checkbox', checked: showAll,
          onchange: (e) => { showAll = e.target.checked; local.set('freeShowAll', showAll); render(); },
        }), ' show all kanji')),
      shown.length
        ? h('div.kanji-wall.picker-wall', shown.map((k) => h('button.k-' + kanjiStatus(app, k.c) + (selected.has(k.c) ? '.sel' : ''), {
          title: k.meanings.join(', '),
          onclick: () => { if (selected.has(k.c)) selected.delete(k.c); else selected.add(k.c); save(); render(); },
        }, k.c)))
        : h('p.muted', 'No kanji learned yet. Tick "show all kanji" to practice any of them.'),
      h('div.select-bar',
        h('div.select-info',
          h('b', `${chars.length} kanji`), ` · ${items.length} words · ${cards} cards`,
          h('label.small', h('input', {
            type: 'checkbox', checked: learnedOnly,
            onchange: (e) => { learnedOnly = e.target.checked; local.set('freeLearnedOnly', learnedOnly); render(); },
          }), ' only learned words')),
        h('div.row', h('a.btn.primary' + (cards ? '' : '.disabled'), { href: cards ? `#/practice/${encodeURIComponent(spec)}` : undefined }, 'Start')),
        chars.length && !cards ? h('p.small.muted', 'None of these words is learned yet: untick "only learned words" to drill them anyway.') : null));
  }
  render();
}
