// Welcome screen: shown once per device, on first launch of an empty app (no progress yet).
// Any of its buttons dismisses it for good on this device.
import { h, add, clear } from '../ui/dom.js';
import { local } from '../store.js';

export async function welcomePending(app) {
  if (local.get('welcomed', false)) return false;
  // Existing users (anything in the log) never see it.
  if ((await app.backend.all('events')).length) { local.set('welcomed', true); return false; }
  return true;
}

// onDone: called when the user leaves for Home (the other buttons navigate away themselves).
export function welcomeScreen(root, app, onDone) {
  const done = () => { local.set('welcomed', true); onDone(); };
  function render() {
    // Sign-in only where the sync server answers (not offline, not on a plain static server).
    const canSignIn = app.sync.status.state === 'signed-out';
    add(clear(root), h('div.welcome',
      h('img.welcome-logo', { src: 'icons/icon.svg', alt: '' }),
      h('h1.welcome-title', 'Welcome to Suckless Kanji'),
      h('p.welcome-motto', 'Like any other kanji learning app,', h('br'), 'but doesn\'t suck.'),
      h('ul.welcome-points',
        h('li', h('span.welcome-icon', '✎'), 'Draw every kanji, stroke by stroke'),
        h('li', h('span.welcome-icon', '↻'), 'Spaced repetition (FSRS or Anki\'s SM-2)'),
        h('li', h('span.welcome-icon', '⌁'), 'JLPT N5 → N1, works offline, no ads, free')),
      h('div.welcome-actions',
        h('button.btn.primary', { onclick: done }, 'Start learning'),
        h('a.btn', { href: '#/import', onclick: () => local.set('welcomed', true) }, 'I already know some kanji'),
        canSignIn ? h('a.btn', { href: '/auth/login', onclick: () => local.set('welcomed', true) }, 'Sign in to sync…') : null,
        canSignIn ? h('p.small.muted', 'Optional. Keeps progress in sync across devices.') : null),
      h('p.welcome-links.small', h('a', { href: 'privacy' }, 'Privacy'), ' · ', h('a', { href: 'credits' }, 'Credits'))));
  }
  render();
  return app.onChange(render);
}
