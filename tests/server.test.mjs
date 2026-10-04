import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession } from '../server/worker.js';
import { fakeD1 } from './helpers/d1.mjs';

const BASE = 'https://kanji.example.com';

function setup() {
  const DB = fakeD1();
  DB.raw.exec("INSERT INTO allowlist (email) VALUES ('me@example.com')");
  const env = {
    DB,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response('static') },
  };
  return env;
}

async function call(env, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  if (method === 'POST' && !headers['x-sk-omit']) h.set('x-sk', '1');
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body && JSON.stringify(body) }), env);
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* html or static */ }
  return { status: res.status, data, headers: res.headers };
}

const ev = (id, t = 1) => ({ id, t, tz: 0, dev: 'x', type: 'review', data: {} });
const session = async (env, email = 'me@example.com') => `sk_session=${await signSession(env, email)}`;

test('static assets pass through; API requires a valid session', async () => {
  const env = setup();
  assert.equal((await call(env, '/index.html')).data, 'static');
  assert.equal((await call(env, '/api/me')).status, 401);
  assert.equal((await call(env, '/api/me', { cookie: 'sk_session=v1.forged.sig' })).status, 401);
  const me = await call(env, '/api/me', { cookie: await session(env) });
  assert.equal(me.status, 200);
  assert.deepEqual(me.data, { email: 'me@example.com', generation: 1, count: 0 });
});

test('allowlist is checked on every request, not just at sign-in', async () => {
  const env = setup();
  const cookie = await session(env);
  env.DB.raw.exec('DELETE FROM allowlist');
  assert.equal((await call(env, '/api/me', { cookie })).status, 401);
});

test('POST without the x-sk header is rejected (CSRF)', async () => {
  const env = setup();
  const r = await call(env, '/api/sync', { method: 'POST', body: {}, cookie: await session(env), headers: { 'x-sk-omit': '1' } });
  assert.equal(r.status, 403);
});

test('login redirects to Google with PKCE and sets a state cookie', async () => {
  const env = setup();
  const r = await call(env, '/auth/login');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('redirect_uri'), `${BASE}/auth/callback`);
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.match(r.headers.get('set-cookie'), /^sk_oauth=.+HttpOnly; Secure; SameSite=Lax/);
});

test('callback: allowlisted Google account gets a session; others get 403', async () => {
  const env = setup();
  const login = await call(env, '/auth/login');
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const oauthCookie = login.headers.get('set-cookie').split(';')[0];
  const realFetch = globalThis.fetch;
  for (const [email, expect] of [['Me@Example.com', 302], ['stranger@example.com', 403]]) {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.match(init.body.toString(), /client_secret=client-secret/);
      const claims = { iss: 'https://accounts.google.com', aud: 'client-id', exp: Date.now() / 1000 + 60, email, email_verified: true };
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${b({})}.${b(claims)}.sig` }));
    };
    try {
      const r = await call(env, `/auth/callback?code=abc&state=${state}`, { cookie: oauthCookie });
      assert.equal(r.status, expect, email);
      if (expect === 302) {
        const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sk_session=')).split(';')[0];
        assert.equal((await call(env, '/api/me', { cookie })).data.email, 'me@example.com');
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  assert.equal((await call(env, '/auth/callback?code=abc&state=wrong', { cookie: oauthCookie })).status, 400);
});

test('sync: upload, dedup, cursor paging, two devices', async () => {
  const env = setup();
  const cookie = await session(env);
  const sync = (body) => call(env, '/api/sync', { method: 'POST', body, cookie });

  // device A: first sync with events, empty server -> accepted
  let a = await sync({ generation: null, cursor: 0, events: [ev('a1'), ev('a2')] });
  assert.equal(a.status, 200);
  assert.equal(a.data.generation, 1);
  assert.deepEqual(a.data.events.map((e) => e.id), ['a1', 'a2']);
  const curA = a.data.cursor;

  // device B: never synced, no local events -> just downloads
  let b = await sync({ generation: null, cursor: 0, events: [] });
  assert.deepEqual(b.data.events.map((e) => e.id), ['a1', 'a2']);
  // B adds events, re-sends a duplicate
  b = await sync({ generation: 1, cursor: b.data.cursor, events: [ev('b1'), ev('a1')] });
  assert.deepEqual(b.data.events.map((e) => e.id), ['b1']);

  // A catches up from its cursor
  a = await sync({ generation: 1, cursor: curA, events: [] });
  assert.deepEqual(a.data.events.map((e) => e.id), ['b1']);
  assert.equal((await call(env, '/api/me', { cookie })).data.count, 3);
});

test('sync: first sync with local data against a non-empty server is a conflict', async () => {
  const env = setup();
  const cookie = await session(env);
  const sync = (body) => call(env, '/api/sync', { method: 'POST', body, cookie });
  await sync({ generation: null, cursor: 0, events: [ev('a1')] });
  const r = await sync({ generation: null, cursor: 0, events: [ev('c1')] });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data, { conflict: 'first', generation: 1, count: 1 });
});

test('replace starts a new generation; stale clients get a conflict; old data is archived', async () => {
  const env = setup();
  const cookie = await session(env);
  const sync = (body) => call(env, '/api/sync', { method: 'POST', body, cookie });
  await sync({ generation: null, cursor: 0, events: [ev('old1'), ev('old2')] });
  const rep = await call(env, '/api/replace', { method: 'POST', body: {}, cookie });
  assert.equal(rep.data.generation, 2);
  const up = await sync({ generation: 2, cursor: 0, events: [ev('new1')] });
  assert.deepEqual(up.data.events.map((e) => e.id), ['new1']);
  const stale = await sync({ generation: 1, cursor: 5, events: [ev('x')] });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.conflict, 'generation');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM events WHERE gen = 1').get().n, 2); // archived
});

test('sync pages large downloads', async () => {
  const env = setup();
  const cookie = await session(env);
  const sync = (body) => call(env, '/api/sync', { method: 'POST', body, cookie });
  for (let i = 0; i < 5; i++) {
    await sync({ generation: 1, cursor: 0, events: Array.from({ length: 500 }, (_, j) => ev(`e${i}-${j}`)) });
  }
  let cursor = 0, got = 0, pages = 0, more = true;
  while (more) {
    const r = await sync({ generation: 1, cursor, events: [] });
    got += r.data.events.length;
    cursor = r.data.cursor;
    more = r.data.more;
    pages++;
  }
  assert.equal(got, 2500);
  assert.equal(pages, 3);
  assert.equal((await sync({ generation: 1, cursor: 0, events: Array.from({ length: 501 }, (_, j) => ev(`z${j}`)) })).status, 413);
});
