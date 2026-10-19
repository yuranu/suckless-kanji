import { h, add, clear } from '../ui/dom.js';
import { fmtStudy } from '../studytime.js';
import { dueCards, today } from '../state.js';
import { nextLessonItems, forecast, learnedCounts } from '../progress.js';
import { syncPill } from '../ui/sync-ui.js';
import { install } from '../install.js';

export function homeScreen(root, app) {
  function render() {
    const due = dueCards(app.state).length;
    const next = nextLessonItems(app);
    const counts = learnedCounts(app);
    const fc = forecast(app, 7);
    const todayStats = app.state.days.get(today(app.state)) || { reviews: 0, learned: 0, again: 0 };
    const totalWords = app.data.items.filter((it) => !it.kanji).length;

    add(clear(root),
      h('div.row.between', h('h1.title.home-title', 'Suckless Kanji'), syncPill(app)),
      installCard(),
      !app.persistent ? h('div.banner.bad', 'Storage is unavailable in this browser: progress will be lost when the page closes.') : null,

      h('section.card',
        h('div.row.between',
          h('div', h('div.big-number', String(due)), h('div.muted', due === 1 ? 'card due' : 'cards due')),
          h('a.btn.primary' + (due ? '' : '.disabled'), { href: due ? '#/review' : undefined }, 'Review'))),

      next.length ? h('section.card',
        h('div.row.between',
          h('div', h('div.label', 'Next lesson'), h('div.muted', `level N${next[0].level}`)),
          h('a.btn.primary', { href: '#/learn/next' }, 'Learn')),
        h('ul.preview', next.map((it) => h('li',
          it.kanji
            ? [h('span.jp', it.kanji), h('span.muted', ' new kanji')]
            : [h('span.jp', it.word), ' ', h('span.muted', it.kana), h('span.preview-meaning', it.meaning)]))))
        : h('section.card', h('p', 'Every lesson is learned. おめでとう!')),

      app.state.items.size ? h('section.card',
        h('div.row.between',
          h('div', h('div.label', 'Free practice'), h('div.muted.small', 'Drill words of kanji you pick. Does not affect reviews.')),
          h('a.btn.primary', { href: '#/free' }, 'Practice'))) : null,

      !app.state.items.size ? h('section.card',
        h('div.label', 'Already know some kanji?'),
        h('p.muted.small', 'Import what you know: mark your kanji, and their reviews are spread out over the coming weeks instead of all at once.'),
        h('a.btn', { href: '#/import' }, 'Import prior knowledge')) : null,

      h('section.card.stats',
        h('div.stat', h('b', String(counts.words)), h('span', ` / ${totalWords} words`)),
        h('div.stat', h('b', String(counts.kanji)), h('span', ` / ${app.data.kanjiList.length} kanji`)),
        h('div.stat', h('b', String(todayStats.reviews)), h('span', ' reviews today'),
          todayStats.reviews ? h('span.muted', ` · ${Math.round(100 * (1 - todayStats.again / todayStats.reviews))}% correct`) : null),
        h('div.stat', h('b', fmtStudy(todayStats.study || 0)), h('span', ' studied today')),
        h('div.forecast', fc.map((n, i) => h('div.fc-day',
          h('div.fc-bar', { style: { height: `${Math.min(100, (n / Math.max(1, ...fc)) * 100)}%` } }),
          h('div.fc-n', String(n)),
          h('div.fc-label', i === 0 ? 'today' : i === 1 ? 'tmrw' : `+${i}`))))),
    );
  }
  // Shown only in a browser tab where installing is possible; never inside the installed app.
  function installCard() {
    const how = install.available;
    if (!how) return null;
    return h('section.card.install',
      h('div.row.between',
        h('div', h('div.label', 'Install the app'),
          h('div.muted.small', how === 'ios'
            ? 'In Safari: Share, then "Add to Home Screen". It then opens like an app and works offline.'
            : 'Opens in its own window and works fully offline.')),
        how === 'prompt' ? h('button.btn.primary', { onclick: () => install.prompt() }, 'Install') : null));
  }

  render();
  const offApp = app.onChange(render);
  const offInstall = install.onChange(render);
  return () => { offApp(); offInstall(); };
}
