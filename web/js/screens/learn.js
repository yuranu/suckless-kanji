// Lesson: introduce each new item, drill all its cards until each was answered correctly
// `learnRepeats` times, then record a `learn` event that schedules the cards.
import { h, add, clear, ruby } from '../ui/dom.js';
import { navigate } from '../nav.js';
import { sessionFrame } from '../ui/session.js';
import { drawpad } from '../ui/drawpad.js';
import { runCard, wordSummary } from '../ui/games.js';
import { Drill } from '../session.js';
import { cardIds } from '../data.js';
import { itemOfCard, kindOfCard, intervalOf } from '../state.js';
import { lessonList, isLearned, nextLessonItems, kanjiKnown } from '../progress.js';

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
      h('div.kanji-head',
        h('div.kanji-char', k.c),
        h('div',
          h('div.meaning', k.meanings.join(', ')),
          h('div.readings.left', k.on.length ? h('span', '音 ' + k.on.join('・')) : null, k.kun.length ? h('span', '訓 ' + k.kun.join('・')) : null))),
      holder,
      h('div.row.center',
        h('span.muted.small', `${k.paths.length} stroke${k.paths.length > 1 ? 's' : ''} · trace it`),
        h('button.btn.small', { onclick: animate }, 'Stroke order'))),
    destroy: () => pad?.destroy(),
  };
}

// Introduce one item: the word, then (on its own screen, so each fits a phone) the new kanji
// with stroke order and a trace pad.
async function intro(root, app, item, i, n, showKanji) {
  const kc = showKanji ? item.kanji || item.newKanji : null;
  const last = i + 1 === n;
  if (!item.kanji) {
    app.autoSpeak(item.kana);
    await page(root, h('div.label', `New word ${i + 1} of ${n}`), wordSummary(app, item), kc || !last ? 'Next' : 'Start practice');
  }
  if (kc) {
    const panel = kanjiPanel(app, app.data.kanjiByChar.get(kc));
    await page(root, h('div.label', item.kanji ? `New kanji ${i + 1} of ${n}` : `New kanji in ${item.word}`), panel.el, last ? 'Start practice' : 'Next');
    panel.destroy();
  }
}

function page(root, label, body, buttonText) {
  return new Promise((resolve) => {
    const next = () => { document.removeEventListener('keydown', onKey); resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' && root.isConnected) next(); };
    document.addEventListener('keydown', onKey);
    clear(root).appendChild(h('div.step.intro', label, body,
      h('div.row.center', h('button.btn.primary', { onclick: next }, buttonText))));
  });
}

export function learnScreen(root, app, [n]) {
  const isNext = n === 'next';
  const index = isNext ? -1 : +n - 1;
  const lesson = isNext ? nextLessonItems(app) : lessonList(app)[index];
  if (!lesson || !lesson.length) { navigate('lessons'); return; }
  const todo = lesson.filter((it) => !isLearned(app, it));
  const title = isNext ? 'Lesson' : `Lesson ${index + 1}`;
  // Show the kanji panel only for kanji the user does not know yet (imports, gaps).
  const newKanji = new Set(todo.map((it) => it.kanji || it.newKanji).filter((c) => c && !kanjiKnown(app, c)));

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

  const frame = sessionFrame(root, { app, title, confirmExit: 'Leave the lesson? Progress in this lesson is not saved until it is finished.' });
  let alive = true;

  (async () => {
    frame.progress(0, todo.length, 'introduction');
    for (let i = 0; i < todo.length; i++) {
      await intro(frame.body, app, todo[i], i, todo.length, newKanji.has(todo[i].kanji || todo[i].newKanji));
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
    clear(frame.body).appendChild(h('div.step.done',
      h('h2', 'Lesson learned'),
      h('p', `${todo.length} new ${todo.length === 1 ? 'item' : 'items'}, ${ids.length} cards added to your deck.`),
      h('p.muted', `First review in ${Math.min(...days) === Math.max(...days) ? Math.min(...days) : `${Math.min(...days)}–${Math.max(...days)}`} days.`),
      h('ul.preview', todo.map((it) => h('li', h('span.jp', it.kanji || ruby(it.segs)), h('span.preview-meaning', it.meaning || '')))),
      h('div.row.center',
        nextLessonItems(app).length ? h('button.btn.primary', {
          onclick: () => navigate('learn/next'),
        }, 'Next lesson') : null,
        h('a.btn', { href: '#/' }, 'Home'))));
  })();

  return () => { alive = false; };
}
