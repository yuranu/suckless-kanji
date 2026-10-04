// All curriculum kanji as a grid colored by status, and a per-kanji detail page.
import { h, add, clear, ruby, confirmDialog, toast } from '../ui/dom.js';
import { drawpad } from '../ui/drawpad.js';
import { local } from '../store.js';
import { kanjiStatus, itemStage, isLearned } from '../progress.js';

export function kanjiScreen(root, app) {
  let level = local.get('kanjiLevel', 'all');
  const counts = (list) => {
    const c = { new: 0, young: 0, mature: 0 };
    for (const k of list) c[kanjiStatus(app, k.c)]++;
    return c;
  };
  function render() {
    const list = app.data.kanjiList.filter((k) => level === 'all' || k.level === level);
    const c = counts(list);
    add(clear(root),
      h('h1.title', 'Kanji'),
      h('div.seg', ['all', 5, 4, 3, 2, 1].map((lv) => h('button' + (lv === level ? '.on' : ''), {
        onclick: () => { level = lv; local.set('kanjiLevel', lv); render(); },
      }, lv === 'all' ? 'All' : `N${lv}`))),
      h('div.legend',
        h('span.k-new', `${c.new} not learned`), h('span.k-young', `${c.young} learning`), h('span.k-mature', `${c.mature} mature`)),
      h('div.kanji-wall', list.map((k) => h('a.k-' + kanjiStatus(app, k.c), {
        href: `#/kanji/${encodeURIComponent(k.c)}`, title: k.meanings.join(', '),
      }, k.c))));
  }
  render();
}

export function kanjiDetailScreen(root, app, [c]) {
  const k = app.data.kanjiByChar.get(c);
  if (!k) { add(root, h('p', `${c} is not in the curriculum.`), h('a.btn', { href: '#/kanji' }, 'Back')); return; }
  const words = app.data.wordsByKanji.get(c) || [];
  const own = app.data.itemById.get(c);
  const items = own ? [own, ...words] : words;
  const lessonOf = (it) => Math.floor(it.index / app.settings.wordsPerLesson) + 1;

  const holder = h('div.pad-holder');
  let pad = null;
  let mode = 'trace';
  const newPad = () => {
    pad?.destroy();
    pad = drawpad(k, {
      outline: mode === 'trace',
      leniency: app.settings.leniency,
      onComplete: ({ mistakes }) => {
        toast(mistakes ? `${mistakes} mistake${mistakes > 1 ? 's' : ''}` : 'Perfect');
        setTimeout(newPad, 900);
      },
    });
    clear(holder).appendChild(pad.el);
  };
  const animate = async () => {
    pad?.destroy();
    pad = drawpad(k, {});
    clear(holder).appendChild(pad.el);
    await pad.animate(380);
    setTimeout(newPad, 600);
  };
  const modeBtns = ['trace', 'recall'].map((m) => h('button' + (m === mode ? '.on' : ''), {
    onclick: () => { mode = m; modeBtns.forEach((b) => b.classList.toggle('on', b.textContent.toLowerCase() === m)); newPad(); },
  }, m === 'trace' ? 'Trace' : 'Recall'));
  newPad();

  const learnedItems = items.filter((it) => isLearned(app, it));
  add(root, 
    h('div.row.between', h('a.btn.small', { href: '#/kanji' }, '‹ All kanji'), h('span.muted', `N${k.level} · #${k.index + 1}`)),
    h('section.kanji-detail',
      h('div.kanji-info',
        h('div.kanji-char', k.c),
        h('div.meaning', k.meanings.join(', ')),
        h('div.readings', k.on.length ? h('div', '音 ' + k.on.join('・')) : null, k.kun.length ? h('div', '訓 ' + k.kun.join('・')) : null),
        h('div.muted.small', `${k.paths.length} stroke${k.paths.length > 1 ? 's' : ''}`, k.parts.length ? ` · parts ${k.parts.join(' ')}` : ''),
        h('div.k-status.k-' + kanjiStatus(app, c), { new: 'not learned', young: 'learning', mature: 'mature' }[kanjiStatus(app, c)])),
      h('div',
        holder,
        h('div.row.center', h('div.seg', modeBtns), h('button.btn.small', { onclick: animate }, 'Stroke order'), h('button.btn.small', { onclick: () => pad.hint() }, 'Hint')))),
    h('h3', `Words (${items.length})`),
    items.length ? h('ul.word-list', items.map((it) => h('li.stage-' + itemStage(app, it),
      h('span.jp.wl-word', it.kanji ? it.kanji : ruby(it.segs)),
      h('span.wl-meaning', it.kanji ? 'kanji lesson' : it.meaning),
      h('a.wl-lesson', { href: `#/learn/${lessonOf(it)}` }, `L${lessonOf(it)}`))))
      : h('p.muted', 'No JLPT word uses this kanji yet.'),
    h('div.row',
      h('a.btn.primary', { href: `#/practice/kanji:${encodeURIComponent(c)}` },
        learnedItems.length ? `Practice ${learnedItems.length} learned` : `Preview all ${items.length}`),
      learnedItems.length ? h('button.btn', {
        onclick: async () => {
          if (!await confirmDialog(`Forget ${learnedItems.length} learned item(s) using ${c}? Their cards are removed from the deck and the lessons become unlearned.`, 'Forget')) return;
          await app.dispatch('forget', { items: learnedItems.map((it) => it.id) });
          location.reload();
        },
      }, 'Forget') : null),
    h('p.muted.small', 'Practice does not affect your review schedule.'),
  );
  return () => pad?.destroy();
}
