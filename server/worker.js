// Cloudflare Worker: serves the static client (assets) and a thin API.
//
//   GET  /auth/login      -> Google OAuth (authorization code + PKCE)
//   GET  /auth/callback   -> checks allowlist, sets a signed session cookie
//   POST /auth/logout
//   GET  /api/me          -> {email, generation}
//   POST /api/sync        -> upload missing events, download new ones (see below)
//   POST /api/replace     -> start a new generation ("use local" / reset); old one is archived
//   POST /api/delete-account -> delete the account and all its data (Settings -> Delete profile)
//
// Env: DB (D1), ASSETS, GOOGLE_CLIENT_ID (var), GOOGLE_CLIENT_SECRET (secret),
//      SESSION_SECRET (secret), DEV_LOGIN (local only: enables /auth/dev?email=).
// Signup and limits (vars, see limits()): SIGNUP_MODE "open" (any verified Google account,
//      up to MAX_USERS accounts) or "allowlist"; MAX_USER_BYTES stored per account;
//      MAX_EVENT_BYTES per event. Optional rate-limit bindings: SYNC_LIMITER (per account),
//      AUTH_LIMITER (per IP, sign-in).
//
// The server never interprets events: it stores them per user and generation, dedups by
// event id, and hands them out in arrival order (`seq`), which clients use as a cursor.

const SESSION_COOKIE = 'sk_session';
const OAUTH_COOKIE = 'sk_oauth';
const SESSION_DAYS = 365;
const PAGE = 1000; // events per download page
const MAX_UPLOAD = 500; // events per upload request

// ---- small helpers ----------------------------------------------------------------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setCookie(name, value, { maxAge, path = '/' } = {}) {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}`;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Session cookie: v1.<payload>.<hmac>, payload = {email, iat, exp}. Stateless; the allowlist is
// still checked on every request, so removing an email locks it out immediately.
export async function signSession(env, email, now = Date.now()) {
  const payload = b64url(enc.encode(JSON.stringify({ email, iat: now, exp: now + SESSION_DAYS * 86400000 })));
  return `v1.${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function readSession(env, request) {
  const raw = cookies(request)[SESSION_COOKIE];
  if (!raw) return null;
  const [v, payload, sig] = raw.split('.');
  if (v !== 'v1' || !payload || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); } catch { return null; }
  if (!data.email || data.exp < Date.now()) return null;
  data.iat ??= data.exp - SESSION_DAYS * 86400000; // sessions from before `iat` existed
  return data;
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

async function allowed(env, email) {
  return !!(await env.DB.prepare('SELECT 1 FROM allowlist WHERE email = ?').bind(normEmail(email)).first());
}

export function limits(env) {
  return {
    mode: env.SIGNUP_MODE === 'open' ? 'open' : 'allowlist',
    maxUsers: Number(env.MAX_USERS) || 100,
    maxUserBytes: Number(env.MAX_USER_BYTES) || 30_000_000,
    maxEventBytes: Number(env.MAX_EVENT_BYTES) || 65_536,
  };
}

const account = (env, email) =>
  env.DB.prepare('SELECT generation, bytes, blocked, quota FROM users WHERE email = ?').bind(email).first();

async function emailHash(email) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(email));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Who may use sync. Creates the account on first use while there is room (the user count and
// deletion record are only read then, so they cost nothing per sync). `issued`: when the
// session was signed. Returns {user} or {denied: reason}.
async function admit(env, email, issued = Date.now()) {
  const L = limits(env);
  if (L.mode === 'allowlist' && !(await allowed(env, email))) return { denied: 'not-allowed' };
  let user = await account(env, email);
  if (!user) {
    const gone = await env.DB.prepare('SELECT at FROM deleted_accounts WHERE email_hash = ?').bind(await emailHash(email)).first();
    // A session from before the account was deleted (another device): signed out.
    if (gone && issued <= gone.at) return { denied: 'deleted' };
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (n >= L.maxUsers) return { denied: 'full' };
    // A re-created account gets a generation no old device can have, so their stale sync
    // position is a conflict (they are asked) rather than a silent mismatch.
    const generation = gone ? gone.at : 1;
    await env.DB.prepare('INSERT OR IGNORE INTO users (email, generation, created) VALUES (?, ?, ?)').bind(email, generation, Date.now()).run();
    user = await account(env, email);
  }
  if (user.blocked) return { denied: 'blocked' };
  return { user };
}

const DENIED_PAGE = {
  'not-allowed': (email) => ['Not allowed', `${email} is not on this server's allowlist.`],
  full: () => ['Sync is full', 'The sync server has reached its account limit for now. The app works fully without signing in: your progress stays on this device.'],
  blocked: () => ['Account blocked', 'This account can no longer use sync. The app still works without signing in.'],
};

// Optional Cloudflare rate-limit binding; absent (e.g. in tests) means unlimited.
async function rateLimited(limiter, key) {
  if (!limiter) return false;
  const { success } = await limiter.limit({ key });
  return !success;
}



// D1 bills reads per row scanned, and COUNT(*) scans the user's whole log. Only call it on
// rare paths (conflict responses), never on every sync.
async function countEvents(env, email, gen) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE email = ? AND gen = ?').bind(email, gen).first();
  return row ? row.n : 0;
}

// ---- auth -------------------------------------------------------------------------
async function login(env, request) {
  const url = new URL(request.url);
  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'set-cookie': setCookie(OAUTH_COOKIE, `${state}.${verifier}`, { maxAge: 600, path: '/auth' }),
    },
  });
}

function page(title, message, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 16px">
<h2>${title}</h2><p>${message}</p><p><a href="/#/settings">Back to the app</a></p></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function callback(env, request) {
  const url = new URL(request.url);
  const [state, verifier] = (cookies(request)[OAUTH_COOKIE] || '').split('.');
  const clearOauth = setCookie(OAUTH_COOKIE, '', { maxAge: 0, path: '/auth' });
  if (!state || url.searchParams.get('state') !== state) return page('Sign-in failed', 'The sign-in request expired or was tampered with. Try again.', 400);
  const code = url.searchParams.get('code');
  if (!code) return page('Sign-in cancelled', 'No authorization was given.', 400);

  // Code exchange directly with Google over TLS: the ID token in the response is trusted
  // without verifying its signature (OpenID Connect Core 3.1.3.7).
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return page('Sign-in failed', `Google rejected the sign-in (${res.status}).`, 502);
  const { id_token: idToken } = await res.json();
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(b64urlDecode(idToken.split('.')[1]))); } catch { claims = null; }
  const okIssuer = claims && (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com');
  if (!okIssuer || claims.aud !== env.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.email_verified) {
    return page('Sign-in failed', 'Unexpected identity token.', 400);
  }
  const email = normEmail(claims.email);
  const { denied } = await admit(env, email);
  if (denied) {
    const r = page(...DENIED_PAGE[denied](email), 403);
    r.headers.append('set-cookie', clearOauth);
    return r;
  }
  return startSession(env, email, [clearOauth]);
}

async function startSession(env, email, extraCookies = []) {
  const headers = new Headers({ location: '/#/settings', 'cache-control': 'no-store' });
  headers.append('set-cookie', setCookie(SESSION_COOKIE, await signSession(env, email), { maxAge: SESSION_DAYS * 86400 }));
  for (const c of extraCookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

// ---- sync -------------------------------------------------------------------------
// POST /api/sync {generation, cursor, events}
//   generation: the client's generation, or null if it never synced.
//   cursor:     highest server seq the client has seen (0 initially).
//   events:     client events the server may not have (<= MAX_UPLOAD).
// -> 200 {generation, cursor, events, more}: server events with seq > cursor (a page).
// -> 409 {conflict, generation, count}: the client must choose merge / local / cloud:
//      'generation' the server moved to another generation (reset / "use local" elsewhere);
//      'first'      the client never synced, and both sides already have events.
async function sync(env, email, user, body) {
  const gen = user.generation;
  const L = limits(env);
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length > MAX_UPLOAD) return json({ error: `at most ${MAX_UPLOAD} events per request` }, 413);
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || e.id.length > 100 || typeof e.t !== 'number' || typeof e.type !== 'string') {
      return json({ error: 'malformed event' }, 400);
    }
  }
  const bodies = events.map((e) => JSON.stringify(e));
  const sizes = bodies.map((b) => enc.encode(b).length);
  if (sizes.some((n) => n > L.maxEventBytes)) return json({ error: 'event-too-large', limit: L.maxEventBytes }, 413);
  if (body.generation === null || body.generation === undefined) {
    // First sync of a device that has its own events: conflict if the server has any.
    if (events.length > 0) {
      const any = await env.DB.prepare('SELECT 1 FROM events WHERE email = ? AND gen = ? LIMIT 1').bind(email, gen).first();
      if (any) return json({ conflict: 'first', generation: gen, count: await countEvents(env, email, gen) }, 409);
    }
  } else if (body.generation !== gen) {
    return json({ conflict: 'generation', generation: gen, count: await countEvents(env, email, gen) }, 409);
  }

  if (events.length) {
    // Storage quota counts only events not stored yet. The cheap upper bound (all of them)
    // decides almost always; near the quota, look up which ones are really new.
    const quota = user.quota ?? L.maxUserBytes;
    let incoming = sizes.reduce((a, b) => a + b, 0);
    if (user.bytes + incoming > quota) {
      const marks = events.map(() => '?').join(',');
      const { results } = await env.DB.prepare(`SELECT id FROM events WHERE email = ? AND gen = ? AND id IN (${marks})`)
        .bind(email, gen, ...events.map((e) => e.id)).all();
      const stored = new Set(results.map((r) => r.id));
      incoming = sizes.reduce((sum, n, i) => (stored.has(events[i].id) ? sum : sum + n), 0);
      if (user.bytes + incoming > quota) return json({ error: 'quota', bytes: user.bytes, quota }, 413);
    }
    const insert = env.DB.prepare('INSERT OR IGNORE INTO events (email, gen, id, body) VALUES (?, ?, ?, ?)');
    const done = await env.DB.batch(events.map((e, i) => insert.bind(email, gen, e.id, bodies[i])));
    const added = sizes.reduce((sum, n, i) => (done[i]?.meta?.changes ? sum + n : sum), 0);
    if (added) await env.DB.prepare('UPDATE users SET bytes = bytes + ? WHERE email = ?').bind(added, email).run();
  }
  const cursor = Number.isInteger(body.cursor) ? body.cursor : 0;
  const { results } = await env.DB
    .prepare('SELECT seq, body FROM events WHERE email = ? AND gen = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(email, gen, cursor, PAGE + 1).all();
  const pageRows = results.slice(0, PAGE);
  return json({
    generation: gen,
    cursor: pageRows.length ? pageRows[pageRows.length - 1].seq : cursor,
    events: pageRows.map((r) => JSON.parse(r.body)),
    more: results.length > PAGE,
  });
}

// Delete the account and everything stored for it, archived generations included. Keeps
// only a hash of the email and the time (see migration 0003), and signs this device out.
async function deleteAccount(env, email) {
  const at = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE email = ?').bind(email),
    env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email),
    env.DB.prepare('INSERT OR REPLACE INTO deleted_accounts (email_hash, at) VALUES (?, ?)').bind(await emailHash(email), at),
  ]);
  return json({ deleted: true }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0 }) });
}

// Start a new, empty generation. The previous one stays in the table as an archive.
async function replace(env, email, user) {
  const gen = user.generation + 1;
  await env.DB.prepare('UPDATE users SET generation = ? WHERE email = ?').bind(gen, email).run();
  return json({ generation: gen, cursor: 0 });
}

// ---- routing ----------------------------------------------------------------------
async function api(env, request, path) {
  // CSRF: API calls must carry a custom header, which cross-site pages cannot send
  // without a CORS preflight (and no CORS is allowed).
  if (request.method === 'POST' && request.headers.get('x-sk') !== '1') return json({ error: 'missing x-sk header' }, 403);
  const session = await readSession(env, request);
  if (!session) return json({ error: 'not signed in' }, 401);
  const email = normEmail(session.email);
  // Per-account rate limit, keyed by the signed session: checked before any database read.
  if (await rateLimited(env.SYNC_LIMITER, email)) return json({ error: 'rate-limited' }, 429, { 'retry-after': '10' });
  const { user, denied } = await admit(env, email, session.iat);
  if (denied) return json({ error: denied }, denied === 'not-allowed' || denied === 'deleted' ? 401 : 403);

  if (path === '/api/me' && request.method === 'GET') {
    return json({ email, generation: user.generation, bytes: user.bytes, quota: user.quota ?? limits(env).maxUserBytes });
  }
  if (path === '/api/sync' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    return sync(env, email, user, body);
  }
  if (path === '/api/replace' && request.method === 'POST') return replace(env, email, user);
  if (path === '/api/delete-account' && request.method === 'POST') return deleteAccount(env, email);
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if ((path === '/auth/login' || path === '/auth/callback')
        && await rateLimited(env.AUTH_LIMITER, request.headers.get('cf-connecting-ip') || 'unknown')) {
        return page('Slow down', 'Too many sign-in attempts from your network. Try again in a minute.', 429);
      }
      if (path === '/auth/login') return login(env, request);
      if (path === '/auth/callback') return callback(env, request);
      if (path === '/auth/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0 }) });
      }
      // Local development only: sign in as any allowlisted email without Google.
      if (path === '/auth/dev' && env.DEV_LOGIN === '1') {
        const email = normEmail(url.searchParams.get('email'));
        const { denied } = await admit(env, email);
        if (denied) return page(...DENIED_PAGE[denied](email), 403);
        return startSession(env, email);
      }
      if (path.startsWith('/api/')) return await api(env, request, path);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'internal error' }, 500);
    }
  },
};
