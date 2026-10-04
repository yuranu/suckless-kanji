// Lesson: introduce each new item, drill all its cards until each was answered correctly
// `learnRepeats` times, then record a `learn` event that schedules the cards.
import { h, add, clear, ruby } from '../ui/dom.js';
import { sessionFrame } from '../ui/session.js';
import { drawpad } from '../ui/drawpad.js';
import { runCard, wordSummary } from '../ui/games.js';
import { Drill } from '../session.js';
import { cardIds } from '../data.js';
import { itemOfCard, kindOfCard, intervalOf } from '../state.js';
import { lessonList, isLearned } from '../progress.js';

// Big kanji with stroke-order animation and a trace pad.
function kanjiPanel(app, k) {
  const holder = h('div.pad-holder');
  let pad = null;
  const trace = () => {
    pad?.destroy();
    pad = drawpad(k, { outline: true, leniency: app.settings.leniency, onComplete: () => setTimeout(trace, 900) });
    clear(holder).appendChild(pad.el);
  };
  const animate = async () => {
    pad?.destroy();
    pad = drawpad(k, {});
    clear(holder).appendChild(pad.el);
    await pad.animate(380);
    setTimeout(trace, 500);
  };
  setTimeout(animate, 50);
  return {
    el: h('div.kanji-panel',
      h('div.kanji-info',
        h('div.label', 'New kanji'),
        h('div.kanji-char', k.c),
        h('div.meaning', k.meanings.join(', ')),
        h('div.readings', k.on.length ? h('div', '音 ' + k.on.join('・')) : null, k.kun.length ? h('div', '訓 ' + k.kun.join('・')) : null),
        h('div.muted.small', `${k.paths.length} strokes · trace it on the pad`),
        h('button.btn.small', { onclick: animate }, 'Stroke order')),
      holder),
    destroy: () => pad?.destroy(),
  };
}

function intro(root, app, item, i, n) {
  return new Promise((resolve) => {
    const kc = item.kanji || item.newKanji;
    const panel = kc ? kanjiPanel(app, app.data.kanjiByChar.get(kc)) : null;
    const next = () => { panel?.destroy(); document.removeEventListener('keydown', onKey); resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' && root.isConnected) next(); };
    document.addEventListener('keydown', onKey);
    clear(root).appendChild(h('div.step.intro',
      h('div.label', `New ${item.kanji ? 'kanji' : 'word'} ${i + 1} of ${n}`),
      item.kanji ? null : wordSummary(app, item),
      panel?.el,
      h('div.row.center', h('button.btn.primary', { onclick: next }, i + 1 < n ? 'Next' : 'Start practice'))));
    if (!item.kanji) app.autoSpeak(item.kana);
  });
}

export function learnScreen(root, app, [n]) {
  const index = +n - 1;
  const lesson = lessonList(app)[index];
  if (!lesson) { location.hash = '#/lessons'; return; }
  const todo = lesson.filter((it) => !isLearned(app, it));

  if (!todo.length) {
    add(root, 
      h('h1.title', `Lesson ${index + 1}`),
      h('p', 'This lesson is already learned. Its cards come back in reviews; you can also practice it now (does not affect scheduling).'),
      h('ul.preview', lesson.map((it) => h('li', h('span.jp', it.kanji || it.word), ' ', h('span.muted', it.kana || ''), h('span.preview-meaning', it.meaning || '')))),
      h('div.row',
        h('a.btn.primary', { href: `#/practice/lesson:${index + 1}` }, 'Practice'),
        h('a.btn', { href: '#/lessons' }, 'All lessons')));
    return;
  }

  const frame = sessionFrame(root, { title: `Lesson ${index + 1}`, confirmExit: 'Leave the lesson? Progress in this lesson is not saved until it is finished.' });
  let alive = true;

  (async () => {
    frame.progress(0, todo.length, 'introduction');
    for (let i = 0; i < todo.length; i++) {
      await intro(frame.body, app, todo[i], i, todo.length);
      if (!alive) return;
      frame.progress(i + 1, todo.length, 'introduction');
    }

    const ids = todo.flatMap(cardIds);
    const drill = new Drill(ids, app.settings.learnRepeats);
    const total = drill.progress;
    while (!drill.done) {
      const id = drill.next();
      frame.progress(total - drill.progress, total, `practice ${total - drill.progress} / ${total}`);
      const item = app.data.itemById.get(itemOfCard(id));
      const { ok } = await runCard(frame.body, app, item, kindOfCard(id), 'learn');
      if (!alive) return;
      drill.answer(id, ok);
    }
    frame.progress(1, 1, 'done');

    const ratings = drill.ratings();
    await app.dispatch('learn', { cards: ratings });
    if (!alive) return;
    const days = ids.map((id) => intervalOf(app.state.cards.get(id), app.state.settings));
    const nextIdx = lessonList(app).findIndex((l, i) => i > index && l.some((it) => !isLearned(app, it)));
    clear(frame.body).appendChild(h('div.step.done',
      h('h2', 'Lesson learned'),
      h('p', `${todo.length} new ${todo.length === 1 ? 'item' : 'items'}, ${ids.length} cards added to your deck.`),
      h('p.muted', `First review in ${Math.min(...days) === Math.max(...days) ? Math.min(...days) : `${Math.min(...days)}–${Math.max(...days)}`} days.`),
      h('ul.preview', todo.map((it) => h('li', h('span.jp', it.kanji || ruby(it.segs)), h('span.preview-meaning', it.meaning || '')))),
      h('div.row.center',
        nextIdx >= 0 ? h('a.btn.primary', { href: `#/learn/${nextIdx + 1}` }, 'Next lesson') : null,
        h('a.btn', { href: '#/' }, 'Home'))));
  })();

  return () => { alive = false; };
}
