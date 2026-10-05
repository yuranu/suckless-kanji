// Client side of server/worker.js sync. No UI here: screens read `status` and call
// run() / resolve() / signOut().
//
// Local bookkeeping (IndexedDB): `synced` holds ids of events the server has; meta record
// 'sync' holds {generation, cursor, email, lastSync}. Each run uploads unsynced events in
// batches and downloads everything past the cursor; new remote events trigger onRemote().
// A 409 from the server is a conflict the user resolves: merge / local / cloud.

const BATCH = 500;
const META = 'sync';

export class Sync {
  constructor({ backend, fetch: f = (...a) => fetch(...a), base = '', onRemote = async () => {}, onChange = () => {},
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.backend = backend;
    this.fetch = f;
    this.sleep = sleep;
    this.base = base;
    this.onRemote = onRemote;
    this.onChange = onChange;
    // state: 'unavailable' (no server, e.g. plain static hosting), 'signed-out', 'idle',
    // 'syncing', 'error', 'conflict', 'denied' (server refused the account: denied = 'full' or
    // 'blocked'). usage: {bytes, quota} of server storage. error 'quota': storage quota reached.
    this.status = { state: 'idle', email: null, lastSync: null, pending: 0, error: null, conflict: null, denied: null, usage: null };
    this.running = null;
  }

  set(patch) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }

  async meta() {
    return (await this.backend.get('meta', META)) || { id: META, generation: null, cursor: 0, email: null, lastSync: null };
  }
  async saveMeta(m) { await this.backend.put('meta', { ...m, id: META }); }

  async call(path, body) {
    const init = body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-sk': '1' }, body: JSON.stringify(body) };
    // Rate limited (429): wait as told and retry, so a long download just slows down.
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(this.base + path, init);
      if (res.status === 429 && attempt < 5) {
        await this.sleep(1000 * (Number(res.headers?.get?.('retry-after')) || 10));
        continue;
      }
      let data = null;
      try { data = await res.json(); } catch { /* not JSON: static host without API */ }
      return { status: res.status, data };
    }
  }

  async pendingEvents() {
    const synced = new Set((await this.backend.all('synced')).map((r) => r.id));
    return (await this.backend.all('events'))
      .filter((e) => !synced.has(e.id))
      .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  }

  async refreshPending() {
    this.set({ pending: (await this.pendingEvents()).length });
  }

  // Sign-in state and server reachability.
  async check() {
    let r;
    try { r = await this.call('/api/me'); } catch (err) {
      this.set({ state: 'error', error: 'offline' });
      return false;
    }
    if (r.status === 401) { this.set({ state: 'signed-out', email: null }); return false; }
    if (r.status === 403 && r.data?.error) { this.set({ state: 'denied', denied: r.data.error }); return false; }
    if (r.status !== 200 || !r.data || !r.data.email) { this.set({ state: 'unavailable' }); return false; }
    const m = await this.meta();
    // Signed in as someone else than last time: never mix two people's logs silently.
    if (m.email && m.email !== r.data.email) {
      this.set({ state: 'conflict', email: r.data.email, conflict: { kind: 'account', generation: r.data.generation, previous: m.email } });
      return false;
    }
    this.set({ email: r.data.email, lastSync: m.lastSync, denied: null,
      usage: r.data.quota ? { bytes: r.data.bytes, quota: r.data.quota } : null });
    return true;
  }

  // One full sync. Concurrent calls share the running one.
  run() {
    if (!this.running) this.running = this._run().finally(() => { this.running = null; });
    return this.running;
  }

  async _run() {
    if (this.status.state === 'conflict') return;
    if (!(await this.check())) return;
    this.set({ state: 'syncing', error: null });
    let received = 0;
    try {
      const m = await this.meta();
      const pending = await this.pendingEvents();
      let more = true;
      while (pending.length || more) {
        const batch = pending.splice(0, BATCH);
        const r = await this.call('/api/sync', { generation: m.generation, cursor: m.cursor, events: batch });
        if (r.status === 401) { this.set({ state: 'signed-out' }); return; }
        if (r.status === 403 && r.data?.error) { this.set({ state: 'denied', denied: r.data.error }); return; }
        if (r.status === 413 && r.data?.error === 'quota') {
          this.set({ state: 'error', error: 'quota', usage: { bytes: r.data.bytes, quota: r.data.quota } });
          return;
        }
        if (r.status === 409) {
          this.set({ state: 'conflict', conflict: { ...r.data, local: (await this.backend.all('events')).length } });
          return;
        }
        if (r.status !== 200) throw new Error(r.data?.error || `server error ${r.status}`);
        received += await this.backend.putNew('events', r.data.events);
        await this.backend.putNew('synced', [...batch, ...r.data.events].map((e) => ({ id: e.id })));
        m.generation = r.data.generation;
        m.cursor = r.data.cursor;
        m.email = this.status.email;
        await this.saveMeta(m);
        more = r.data.more;
      }
      m.lastSync = Date.now();
      await this.saveMeta(m);
      this.set({ state: 'idle', lastSync: m.lastSync, pending: 0 });
    } catch (err) {
      this.set({ state: 'error', error: err.message || String(err) });
    } finally {
      if (received) await this.onRemote(received);
    }
  }

  async backup(reason) {
    const events = await this.backend.all('events');
    if (!events.length) return;
    await this.backend.put('backups', { id: `${Date.now()}`, t: Date.now(), reason, events });
  }

  // Resolve a conflict:
  //   merge: union of both logs (nothing is lost; the safe default)
  //   cloud: replace this device's log with the server's (local log kept in `backups`)
  //   local: replace the server's log with this device's (server archives the old one)
  async resolve(choice) {
    const c = this.status.conflict;
    if (!c) return;
    const m = await this.meta();
    await this.backend.clear('synced');
    if (choice === 'local') {
      const r = await this.call('/api/replace', {});
      if (r.status !== 200) throw new Error(r.data?.error || `server error ${r.status}`);
      Object.assign(m, { generation: r.data.generation, cursor: 0 });
    } else {
      if (choice === 'cloud') {
        await this.backup(`replaced by cloud (${c.kind})`);
        await this.backend.clear('events');
        await this.onRemote(0); // local state is now empty until the download lands
      }
      Object.assign(m, { generation: c.generation, cursor: 0 });
    }
    m.email = this.status.email;
    await this.saveMeta(m);
    this.set({ state: 'idle', conflict: null });
    await this.run();
  }

  // Reset progress everywhere: a new empty generation on the server (the old one is archived
  // there) and an empty local log (backed up locally).
  async resetEverywhere() {
    await this.backup('reset');
    const r = await this.call('/api/replace', {});
    if (r.status !== 200) throw new Error(r.data?.error || `server error ${r.status}`);
    await this.backend.clear('events');
    await this.backend.clear('synced');
    await this.saveMeta({ ...(await this.meta()), generation: r.data.generation, cursor: 0 });
  }

  // Sign out; local data stays. Forget the sync position so a later sign-in (possibly as
  // another account) is treated as a first sync.
  async signOut() {
    await this.call('/auth/logout', {});
    await this.backend.clear('synced');
    await this.saveMeta({ id: META, generation: null, cursor: 0, email: null, lastSync: null });
    this.set({ state: 'signed-out', email: null, conflict: null, lastSync: null });
  }
}
