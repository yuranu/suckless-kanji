// Sync status pill (Home) and the Sync section of Settings, including conflict resolution.
import { h, confirmDialog, toast } from './dom.js';

export function ago(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function syncPill(app) {
  const st = app.sync.status;
  const pend = st.pending ? ` · ${st.pending} to upload` : '';
  switch (st.state) {
    case 'unavailable': return null;
    case 'signed-out': return h('a.sync-pill', { href: '#/settings' }, '☁ Sign in to sync');
    case 'syncing': return h('span.sync-pill', '☁ Syncing…');
    case 'conflict': return h('a.sync-pill.bad', { href: '#/settings' }, '☁ Sync needs your decision');
    case 'error': return h('button.sync-pill.bad', { title: st.error, onclick: () => app.sync.run() },
      st.error === 'offline' ? `☁ Offline${pend}` : `☁ Sync failed — retry${pend}`);
    default: return h('span.sync-pill', `☁ Synced ${ago(st.lastSync)}${pend}`);
  }
}

const CONFLICT_TEXT = {
  first: (c) => `The cloud already has progress (${c.count} events) and so does this device (${c.local} events).`,
  generation: (c) => `Progress was reset or replaced from another device. The cloud has ${c.count} events, this device ${c.local}.`,
  account: (c) => `This device last synced as ${c.previous}. Signed in as a different account, whose cloud has ${c.count} events.`,
};

export function syncSection(app, rerender) {
  const st = app.sync.status;
  const run = (fn) => async () => {
    try { await fn(); } catch (err) { toast(`Sync: ${err.message}`, 4000); }
    rerender();
  };
  const body = [];
  if (st.state === 'unavailable') {
    body.push(h('p.small.muted', 'Sync is not available here: the app is served without its server (e.g. a local static server).'));
  } else if (st.state === 'signed-out' || !st.email) {
    body.push(
      h('p.small', 'Sign in to sync progress between devices. Without signing in, everything stays on this device.'),
      h('a.btn.primary', { href: '/auth/login' }, 'Sign in with Google'));
  } else {
    body.push(
      h('p.small', 'Signed in as ', h('b', st.email), '.'),
      h('p.small.muted', `Last sync ${ago(st.lastSync)}`, st.pending ? ` · ${st.pending} events waiting to upload` : '',
        st.state === 'error' ? ` · last attempt failed: ${st.error}` : ''),
      h('div.row',
        h('button.btn', { disabled: st.state === 'syncing', onclick: run(() => app.sync.run()) }, st.state === 'syncing' ? 'Syncing…' : 'Sync now'),
        h('button.btn', {
          onclick: run(async () => {
            if (await confirmDialog('Sign out? Progress on this device stays; it just stops syncing.', 'Sign out')) await app.sync.signOut();
          }),
        }, 'Sign out')));
  }
  if (st.state === 'conflict' && st.conflict) {
    const c = st.conflict;
    const kind = c.kind || c.conflict;
    body.push(h('div.conflict',
      h('p', h('b', 'Sync needs your decision. '), (CONFLICT_TEXT[kind] || CONFLICT_TEXT.generation)(c)),
      h('div.choices-col',
        h('button.btn.primary', { onclick: run(() => app.sync.resolve('merge')) }, 'Merge both (recommended)'),
        h('button.btn', {
          onclick: run(async () => {
            if (await confirmDialog('Replace the cloud with this device\'s progress? The cloud\'s current progress is archived on the server, not deleted.', 'Use this device')) await app.sync.resolve('local');
          }),
        }, 'Use this device\'s progress'),
        h('button.btn', {
          onclick: run(async () => {
            if (await confirmDialog('Replace this device\'s progress with the cloud\'s? A copy of this device\'s progress is kept as a local backup.', 'Use the cloud')) await app.sync.resolve('cloud');
          }),
        }, 'Use the cloud\'s progress')),
      h('p.small.muted', 'Merging keeps everything from both sides: reviews done on either device all count.')));
  }
  return h('section.card.settings', h('h3', 'Sync'), body);
}
