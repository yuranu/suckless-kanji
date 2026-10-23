// Practice: play cards without touching the schedule. Spec in the URL:
//   practice/lesson:<n>   cards of lesson n
//   practice/kanji:<cs>      cards of learned words using any of kanji cs (all of their
//                            words if none is learned)
//   practice/kanji-all:<cs>  cards of all words using any of kanji cs
import { h, clear } from '../ui/dom.js';
import { navigate } from '../nav.js';
import { sessionFrame } from '../ui/session.js';
import { runCard } from '../ui/games.js';
import { ReviewQueue, spreadShuffle } from '../session.js';
import { cardIds } from '../data.js';
import { itemOfCard, kindOfCard } from '../state.js';
import { lessonList, itemsForKanji } from '../progress.js';

function itemsFor(app, spec) {
  const [type, arg] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  if (type === 'lesson') return lessonList(app)[+arg - 1] || [];
  if (type === 'kanji' || type === 'kanji-all') {
    const chars = [...arg];
    const learned = type === 'kanji' ? itemsForKanji(app, chars, true) : [];
    return learned.length ? learned : itemsForKanji(app, chars, false);
  }
  return [];
}

export function practiceScreen(root, app, [spec]) {
  const items = itemsFor(app, spec);
  if (!items.length) { navigate(''); return; }
  const frame = sessionFrame(root, { app, title: 'Practice' });
  const queue = new ReviewQueue(spreadShuffle(items.flatMap(cardIds)));
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
