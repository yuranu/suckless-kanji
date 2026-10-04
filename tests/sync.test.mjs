// End to end: Sync clients (web/js/sync.js) against the real Worker on a fake D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession } from '../server/worker.js';
import { fakeD1 } from './helpers/d1.mjs';
import { Sync } from '../web/js/sync.js';
import { MemoryBackend, makeEvent } from '../web/js/store.js';
import { replay } from '../web/js/state.js';

function server() {
  const DB = fakeD1();
  DB.raw.exec("INSERT INTO allowlist (email) VALUES ('me@example.com'), ('other@example.com')");
  return { DB, GOOGLE_CLIENT_ID: 'c', SESSION_SECRET: 's', ASSETS: { fetch: async () => new Response('') } };
}

async function device(env, name, email = 'me@example.com') {
  const backend = new MemoryBackend();
  let cookie = email ? `sk_session=${await signSession(env, email)}` : '';
  const f = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const res = await worker.fetch(new Request('https://k.test' + path, { ...init, headers }), env);
    if (path === '/auth/logout') cookie = '';
    return res;
  };
  let remote = 0;
  const sync = new Sync({ backend, fetch: f, onRemote: async (n) => { remote += n; } });
  let n = 0;
  const add = async (type, data) => {
    const e = makeEvent(type, data, name, Date.UTC(2026, 0, 1) + (n++) * 1000 + (name === 'B' ? 500 : 0));
    await backend.putNew('events', [e]);
    return e;
  };
  return { backend, sync, add, name, login: async (as) => { cookie = `sk_session=${await signSession(env, as)}`; }, get remote() { return remote; } };
}

const ids = async (d) => (await d.backend.all('events')).map((e) => e.id).sort();

test('two devices converge to the same log and state', async () => {
  const env = server();
  const A = await device(env, 'A');
  const B = await device(env, 'B');
  await A.add('learn', { cards: { 'x#r': 3, 'x#w': 3 } });
  await A.sync.run();
  assert.equal(A.sync.status.state, 'idle');
  await B.sync.run(); // B was empty: downloads, no conflict
  assert.deepEqual(await ids(B), await ids(A));
  await B.add('review', { card: 'x#r', rating: 3 });
  await A.add('review', { card: 'x#w', rating: 1 });
  await B.sync.run();
  await A.sync.run();
  await B.sync.run();
  assert.deepEqual(await ids(A), await ids(B));
  assert.equal((await ids(A)).length, 3);
  const sa = replay(await A.backend.all('events'));
  const sb = replay(await B.backend.all('events'));
  assert.deepEqual([...sa.cards.values()], [...sb.cards.values()]);
  assert.equal(A.sync.status.pending, 0);
  assert.ok(A.remote > 0 && B.remote > 0);
});

test('large logs upload in batches', async () => {
  const env = server();
  const A = await device(env, 'A');
  for (let i = 0; i < 1234; i++) await A.add('review', { card: 'x#r', rating: 3 });
  await A.sync.run();
  const B = await device(env, 'B');
  await B.sync.run();
  assert.equal((await ids(B)).length, 1234);
});

test('first sync with local data on both sides: merge keeps everything', async () => {
  const env = server();
  const A = await device(env, 'A');
  const B = await device(env, 'B');
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  await B.add('learn', { cards: { 'b#r': 3 } });
  await B.sync.run();
  assert.equal(B.sync.status.state, 'conflict');
  assert.equal(B.sync.status.conflict.conflict, 'first');
  await B.sync.resolve('merge');
  assert.equal(B.sync.status.state, 'idle');
  await A.sync.run();
  assert.equal((await ids(A)).length, 2);
  assert.deepEqual(await ids(A), await ids(B));
});

test('use cloud replaces the local log and keeps a local backup', async () => {
  const env = server();
  const A = await device(env, 'A');
  const B = await device(env, 'B');
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  await B.add('learn', { cards: { 'b#r': 3 } });
  await B.sync.run();
  await B.sync.resolve('cloud');
  assert.deepEqual(await ids(B), await ids(A));
  const backups = await B.backend.all('backups');
  assert.equal(backups.length, 1);
  assert.equal(backups[0].events[0].data.cards['b#r'], 3);
});

test('use local starts a new generation; the other device must choose too', async () => {
  const env = server();
  const A = await device(env, 'A');
  const B = await device(env, 'B');
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  await B.add('learn', { cards: { 'b#r': 3 } });
  await B.sync.run();
  await B.sync.resolve('local');
  assert.equal(B.sync.status.state, 'idle');
  // A is now on a stale generation
  await A.add('review', { card: 'a#r', rating: 3 });
  await A.sync.run();
  assert.equal(A.sync.status.state, 'conflict');
  assert.equal(A.sync.status.conflict.conflict, 'generation');
  await A.sync.resolve('cloud');
  assert.deepEqual(await ids(A), await ids(B));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM events WHERE gen = 1').get().n, 1); // archived
});

test('reset everywhere empties both sides; other devices are asked', async () => {
  const env = server();
  const A = await device(env, 'A');
  const B = await device(env, 'B');
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  await B.sync.run();
  await A.sync.resetEverywhere();
  await A.sync.run();
  assert.equal((await ids(A)).length, 0);
  await B.sync.run();
  assert.equal(B.sync.status.state, 'conflict');
});

test('signed out and account switch are detected', async () => {
  const env = server();
  const A = await device(env, 'A', null);
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  assert.equal(A.sync.status.state, 'signed-out');
  await A.login('me@example.com');
  await A.sync.run();
  assert.equal(A.sync.status.state, 'idle');
  await A.login('other@example.com');
  A.sync.set({ state: 'idle' });
  await A.sync.run();
  assert.equal(A.sync.status.state, 'conflict');
  assert.equal(A.sync.status.conflict.kind, 'account');
});

test('sign out keeps local data and forgets the sync position', async () => {
  const env = server();
  const A = await device(env, 'A');
  await A.add('learn', { cards: { 'a#r': 3 } });
  await A.sync.run();
  await A.sync.signOut();
  assert.equal(A.sync.status.state, 'signed-out');
  assert.equal((await ids(A)).length, 1);
  assert.equal((await A.backend.all('synced')).length, 0);
});
