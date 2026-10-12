// SRS review session over today's due cards. Each card's first answer is recorded as a
// `review` event. A failed card (Again) is marked relearning: it comes back later in the
// session, and stays due (also in later sessions) until answered correctly, which is
// recorded as a `relearn` event.
import { h, add, clear } from '../ui/dom.js';
import { sessionFrame } from '../ui/session.js';
import { runCard } from '../ui/games.js';
import { ReviewQueue, spreadShuffle } from '../session.js';
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

  const frame = sessionFrame(root, { app, title: 'Review' });
  // dueCards picks which cards (most overdue first, up to the daily limit); the order they
  // are shown in is random, so it differs every session.
  const queue = new ReviewQueue(spreadShuffle(due.map((c) => c.id)));
  let alive = true, answered = 0, again = 0, relearned = 0;
  const t0 = Date.now();

  (async () => {
    while (queue.remaining) {
      frame.progress(queue.rated.size, queue.total, `${queue.remaining} left`);
      const id = queue.peek();
      const item = app.data.itemById.get(itemOfCard(id));
      // Relearning passes of failed cards have no rating buttons and are not reviews.
      const relearn = !!app.state.cards.get(id)?.relearning;
      const res = await runCard(frame.body, app, item, kindOfCard(id), relearn ? 'learn' : 'review');
      if (!alive) return;
      queue.answer(id, res.ok);
      if (relearn) {
        if (res.ok) { relearned++; await app.dispatch('relearn', { card: id }); }
      } else {
        answered++;
        if (!res.ok) again++;
        const rating = res.ok ? res.rating : 1;
        await app.dispatch('review', { card: id, rating, ms: res.ms, ...(rating === 1 ? { relearn: true } : {}) });
      }
    }
    frame.progress(1, 1, 'done');
    const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
    clear(frame.body).appendChild(h('div.step.done',
      h('h2', 'Reviews done'),
      answered ? h('p', `${answered} cards in ${mins} min, ${Math.round((100 * (answered - again)) / answered)}% correct on first try.`) : null,
      relearned ? h('p.muted', `${relearned} missed ${relearned === 1 ? 'card' : 'cards'} relearned.`) : null,
      h('div.row.center', h('a.btn.primary', { href: '#/' }, 'Home'))));
  })();

  return () => { alive = false; };
}
