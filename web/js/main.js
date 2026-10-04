// Entry point: boot the app context and route hash URLs to screens.
import { createApp } from './app.js';
import { h, clear } from './ui/dom.js';
import { homeScreen } from './screens/home.js';
import { lessonsScreen } from './screens/lessons.js';
import { learnScreen } from './screens/learn.js';
import { reviewScreen } from './screens/review.js';
import { kanjiScreen, kanjiDetailScreen } from './screens/kanji.js';
import { settingsScreen } from './screens/settings.js';
import { practiceScreen } from './screens/practice.js';
import { importScreen } from './screens/import.js';

const ROUTES = [
  [/^$/, homeScreen, 'home'],
  [/^lessons$/, lessonsScreen, 'lessons'],
  [/^learn\/(\d+|next)$/, learnScreen, null],
  [/^review$/, reviewScreen, null],
  [/^kanji$/, kanjiScreen, 'kanji'],
  [/^kanji\/(.+)$/, kanjiDetailScreen, 'kanji'],
  [/^practice\/(.+)$/, practiceScreen, null],
  [/^settings$/, settingsScreen, 'settings'],
  [/^import$/, importScreen, 'settings'],
];

const NAV = [
  ['home', '#/', 'Home'],
  ['lessons', '#/lessons', 'Lessons'],
  ['kanji', '#/kanji', 'Kanji'],
  ['settings', '#/settings', 'Settings'],
];

async function main() {
  const root = document.getElementById('app');
  let app;
  try {
    app = await createApp();
  } catch (err) {
    console.error(err);
    clear(root).appendChild(h('div.screen', h('h2', 'Failed to start'), h('pre', String(err.stack || err))));
    return;
  }
  window.app = app; // handy for debugging from the console

  let cleanup = null;
  function route() {
    const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [re, screen, tab] = ROUTES.find(([r]) => r.test(path)) || ROUTES[0];
    const params = path.match(re)?.slice(1) || [];
    if (typeof cleanup === 'function') cleanup();
    clear(root);
    const body = h('main.screen');
    root.appendChild(body);
    // Full-screen flows (learning, reviews) hide the navigation bar.
    if (tab) {
      root.appendChild(h('nav.tabbar', NAV.map(([id, href, label]) =>
        h('a', { href, class: id === tab ? 'on' : '' }, label))));
    }
    cleanup = screen(body, app, params);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
  }
}

main();
