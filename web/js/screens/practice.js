// Practice: play cards without touching the schedule. Spec in the URL:
//   practice/lesson:<n>   cards of lesson n
//   practice/kanji:<c>    cards of learned words using kanji c (all its words if none learned)
import { h, clear } from '../ui/dom.js';
import { sessionFrame } from '../ui/session.js';
import { runCard } from '../ui/games.js';
import { ReviewQueue } from '../session.js';
import { cardIds } from '../data.js';
import { itemOfCard, kindOfCard } from '../state.js';
import { lessonList, isLearned } from '../progress.js';
import { shuffle } from '../distractors.js';

function itemsFor(app, spec) {
  const [type, arg] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  if (type === 'lesson') return lessonList(app)[+arg - 1] || [];
  if (type === 'kanji') {
    const all = [...(app.data.wordsByKanji.get(arg) || [])];
    const own = app.data.itemById.get(arg);
    if (own) all.unshift(own);
    const learned = all.filter((it) => isLearned(app, it));
    return learned.length ? learned : all;
  }
  return [];
}

export function practiceScreen(root, app, [spec]) {
  const items = itemsFor(app, spec);
  if (!items.length) { location.hash = '#/'; return; }
  const frame = sessionFrame(root, { title: 'Practice' });
  const queue = new ReviewQueue(shuffle(items.flatMap(cardIds)));
  let alive = true, misses = 0;

  (async () => {
    while (queue.remaining) {
      frame.progress(queue.rated.size, queue.total);
      const id = queue.peek();
      const first = !queue.rated.has(id);
      const res = await runCard(frame.body, app, app.data.itemById.get(itemOfCard(id)), kindOfCard(id), 'practice');
      if (!alive) return;
      if (first && !res.ok) misses++;
      queue.answer(id, res.ok);
    }
    frame.progress(1, 1, 'done');
    clear(frame.body).appendChild(h('div.step.done',
      h('h2', 'Practice done'),
      h('p', `${queue.total} cards, ${queue.total - misses} right on the first try.`),
      h('p.muted', 'Practice does not change your review schedule.'),
      h('div.row.center', h('button.btn', { onclick: () => location.reload() }, 'Again'), h('a.btn.primary', { href: '#/' }, 'Home'))));
  })();

  return () => { alive = false; };
}
