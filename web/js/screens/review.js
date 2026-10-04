// SRS review session over today's due cards. Each card's first answer is recorded as a
// `review` event; failed cards come back later in the session until passed.
import { h, add, clear } from '../ui/dom.js';
import { sessionFrame } from '../ui/session.js';
import { runCard } from '../ui/games.js';
import { ReviewQueue } from '../session.js';
import { dueCards, itemOfCard, kindOfCard, dueDay, today } from '../state.js';

export function reviewScreen(root, app) {
  const due = dueCards(app.state).filter((c) => app.data.itemById.has(c.item));
  if (!due.length) {
    const t = today(app.state);
    const next = Math.min(...[...app.state.cards.values()].map((c) => dueDay(c, app.state.settings)));
    add(root, h('h1.title', 'Reviews'),
      h('p', 'Nothing is due right now.'),
      Number.isFinite(next) ? h('p.muted', `Next review ${next - t <= 1 ? 'tomorrow' : `in ${next - t} days`}.`) : null,
      h('a.btn.primary', { href: '#/' }, 'Home'));
    return;
  }

  const frame = sessionFrame(root, { title: 'Review' });
  const queue = new ReviewQueue(due.map((c) => c.id));
  let alive = true, answered = 0, again = 0;
  const t0 = Date.now();

  (async () => {
    while (queue.remaining) {
      frame.progress(queue.rated.size, queue.total, `${queue.total - answered} left`);
      const id = queue.peek();
      const first = !queue.rated.has(id);
      const item = app.data.itemById.get(itemOfCard(id));
      // Relearning passes of failed cards are practice only: no rating buttons, no event.
      const res = await runCard(frame.body, app, item, kindOfCard(id), first ? 'review' : 'learn');
      if (!alive) return;
      queue.answer(id, res.ok);
      if (first) {
        answered++;
        if (!res.ok) again++;
        await app.dispatch('review', { card: id, rating: res.ok ? res.rating : 1, ms: res.ms });
      }
    }
    frame.progress(1, 1, 'done');
    const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
    clear(frame.body).appendChild(h('div.step.done',
      h('h2', 'Reviews done'),
      h('p', `${answered} cards in ${mins} min, ${Math.round((100 * (answered - again)) / answered)}% correct on first try.`),
      h('div.row.center', h('a.btn.primary', { href: '#/' }, 'Home'))));
  })();

  return () => { alive = false; };
}
