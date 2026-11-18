// Spread overdue reviews: after a break, pick a number of days and the backlog is spread
// over them, most urgent first, as one `reschedule` event (see backlog.js).
import { h, add, clear, toast } from '../ui/dom.js';
import { navigate } from '../nav.js';
import { backlogCards, planSpread, suggestSpreadDays } from '../backlog.js';
import { seedChunks } from '../importer.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export function backlogScreen(root, app) {
  const backlog = backlogCards(app.state);
  const n = backlog.length;
  // Opened from Home or from Settings: the link goes back to whichever it was (nav.js).
  const chain = history.state?.chain;
  const fromSettings = Array.isArray(chain) && chain[chain.length - 2] === 'settings';
  const head = [
    h('div.row.between', h('a.btn.small', { href: fromSettings ? '#/settings' : '#/' }, fromSettings ? '‹ Settings' : '‹ Home')),
    h('h1.title', 'Spread overdue reviews'),
    h('p.muted', 'Missed a few days and the reviews piled up? Spread them over the coming days instead of facing them all at once. The cards you know well wait longer, the weak ones come back first.'),
  ];
  if (!n) {
    add(root, head, h('section.card', h('p', 'Nothing is overdue.'), h('a.btn.primary', { href: '#/' }, 'Home')));
    return;
  }

  const spread = backlog.filter((c) => c.rescheduled != null).length;
  let days = suggestSpreadDays(n);
  let plan = null;
  const daysInput = h('input', { type: 'range', min: 1, max: 60, step: 1, value: days, 'aria-label': 'Days',
    oninput: (e) => { days = +e.target.value; update(); } });
  const daysLabel = h('output');
  const chart = h('div.load-chart');
  const axis = h('div.row.between.small.muted');
  const info = h('div');
  const btn = h('button.btn.primary', { onclick: apply });

  function update() {
    plan = planSpread(app.state, days);
    const totals = plan.perDay.map((x, i) => x + plan.base[i]);
    const peak = Math.max(...totals);
    const regular = Math.round(plan.base.reduce((a, b) => a + b, 0) / days);
    daysLabel.textContent = days === 1 ? '1 day (today)' : `${days} days`;
    const max = Math.max(1, peak);
    add(clear(chart), plan.perDay.map((x, i) => h('div.load-col', { title: `+${i}: ${x} overdue, ${plan.base[i]} regular` },
      h('div.load-bar', { style: { height: `${(x / max) * 100}%` } }),
      h('div.load-bar.base', { style: { height: `${(plan.base[i] / max) * 100}%` } }))));
    add(clear(axis), h('span', 'today'), days > 1 ? h('span', `+${days - 1}`) : null);
    const limit = app.state.settings.maxReviews;
    add(clear(info),
      h('p.small', h('b', `~${Math.round(n / days)}`), ' overdue reviews a day',
        regular ? [' + ', h('b', `~${regular}`), ' that come due anyway'] : null, '.'),
      h('p.small', 'Expected recall of these cards: ', h('b', pct(plan.recallNow)), ' if all reviewed today, ',
        h('b', pct(plan.recallPlanned)), ' on average as spread.'),
      peak > limit ? h('p.small.bad-text', `Some days have more than your limit of ${limit} reviews a day; the rest waits for the next day. Pick more days, or raise the limit in Settings.`) : null);
    btn.textContent = days === 1 ? `Make all ${n} due today` : `Spread ${n} reviews over ${days} days`;
  }

  async function apply() {
    plan = planSpread(app.state, days); // the state may have changed (sync) since the preview
    for (const cards of seedChunks(plan.cards)) await app.dispatch('reschedule', { cards });
    toast(days === 1 ? `${n} reviews due today` : `${n} reviews spread over ${days} days`);
    navigate('');
  }

  add(root, head,
    h('section.card',
      h('p', h('b', String(n)), n === 1 ? ' card is due' : ' cards are due', ' today or earlier',
        spread ? ` (${spread} of them spread earlier; planning again replaces that)` : '', '.'),
      h('h3', 'Spread them over'),
      h('div.range', daysInput, daysLabel),
      chart, axis,
      h('p.small.muted', h('span.legend.accent'), ' overdue\u2003', h('span.legend.base'), ' due anyway'),
      info,
      h('p.small.muted', 'Cards whose predicted recall drops fastest come first: weak and recently learned ones in the first days, well-known ones later. Days with more regular reviews get fewer overdue ones. When a card is answered, the real time since its last review counts. Spreading over 1 day undoes a spread.'),
      h('div.row.center', btn)));
  update();
}
