// Persistence: an append-only event log in IndexedDB (the source of truth) plus a small
// device-local key/value area in localStorage for per-device settings.
// Sync (later) = exchange events the other side lacks, by id; see state.js for the model.

const DB_NAME = 'suckless-kanji';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export class IdbBackend {
  async open() {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
    };
    this.db = await req(r);
    return this;
  }
  async all(store) {
    return req(this.db.transaction(store).objectStore(store).getAll());
  }
  // Inserts records whose id is not stored yet; returns how many were new.
  async putNew(store, records) {
    const have = new Set(records.length > 1 ? await req(this.db.transaction(store).objectStore(store).getAllKeys()) : []);
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
}

export class MemoryBackend {
  constructor() { this.stores = { events: new Map(), reports: new Map() }; }
  async open() { return this; }
  async all(store) { return [...this.stores[store].values()]; }
  async putNew(store, records) {
    let added = 0;
    for (const r of records) if (!this.stores[store].has(r.id)) { this.stores[store].set(r.id, r); added++; }
    return added;
  }
  async clear(store) { this.stores[store].clear(); }
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

export const EXPORT_FORMAT = 'suckless-kanji-events';

export function exportBlob(events, reports) {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exported: new Date().toISOString(), events, reports }, null, 0);
}

export function parseExport(text) {
  const d = JSON.parse(text);
  if (d.format !== EXPORT_FORMAT || !Array.isArray(d.events)) throw new Error('Not a suckless-kanji export file');
  for (const e of d.events) {
    if (typeof e.id !== 'string' || typeof e.t !== 'number' || typeof e.type !== 'string') throw new Error('Malformed event in export');
  }
  return d;
}
