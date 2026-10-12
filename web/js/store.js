// Persistence: an append-only event log in IndexedDB (the source of truth) plus a small
// device-local key/value area in localStorage for per-device settings.
// Sync (sync.js) exchanges events the other side lacks, by id; see state.js for the model.

const DB_NAME = 'suckless-kanji';
const DB_VERSION = 2;
// events: the log. reports: local drawpad diagnostics. synced: ids of events the server has.
// meta: small records such as the sync cursor. backups: local log copies taken before a
// destructive sync choice ("use cloud", reset).
const STORES = ['events', 'reports', 'synced', 'meta', 'backups'];

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export class IdbBackend {
  async open() {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    };
    this.db = await req(r);
    return this;
  }
  async all(store) {
    return req(this.db.transaction(store).objectStore(store).getAll());
  }
  // Inserts records whose id is not stored yet; returns how many were new.
  async putNew(store, records) {
    const read = this.db.transaction(store).objectStore(store);
    const have = new Set(records.length > 20
      ? await req(read.getAllKeys())
      : (await Promise.all(records.map((r) => req(read.getKey(r.id))))).filter((k) => k !== undefined));
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    let added = 0;
    for (const rec of records) {
      if (have.has(rec.id)) continue;
      os.put(rec); // records are immutable, so a racing duplicate put is harmless
      added++;
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    return added;
  }
  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  async get(store, id) {
    return req(this.db.transaction(store).objectStore(store).get(id));
  }
  // Insert or overwrite (for mutable records: meta, backups).
  async put(store, record) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(record);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  async delete(store, id) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
}

export class MemoryBackend {
  constructor() { this.stores = Object.fromEntries(STORES.map((n) => [n, new Map()])); }
  async open() { return this; }
  async all(store) { return [...this.stores[store].values()]; }
  async putNew(store, records) {
    let added = 0;
    for (const r of records) if (!this.stores[store].has(r.id)) { this.stores[store].set(r.id, r); added++; }
    return added;
  }
  async clear(store) { this.stores[store].clear(); }
  async get(store, id) { return this.stores[store].get(id); }
  async put(store, record) { this.stores[store].set(record.id, record); }
  async delete(store, id) { this.stores[store].delete(id); }
}

// ---- device-local storage (best effort) -------------------------------------------
export const local = {
  get(key, fallback) {
    try { const v = localStorage.getItem('sk.' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('sk.' + key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

// Forget everything this app stored on this device: progress, backups, sync position, and
// local settings (localStorage keys "sk.*").
export async function wipeDevice(backend) {
  for (const name of STORES) await backend.clear(name);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sk.')) localStorage.removeItem(k);
  } catch { /* private mode etc. */ }
}

export function deviceId() {
  let id = local.get('device', null);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    local.set('device', id);
  }
  return id;
}

let seq = 0;
export function makeEvent(type, data, dev, now = Date.now()) {
  seq = (seq + 1) % 1296;
  return {
    id: `${now.toString(36)}-${dev}-${seq.toString(36).padStart(2, '0')}`,
    t: now,
    tz: new Date(now).getTimezoneOffset(),
    dev,
    type,
    data,
  };
}
