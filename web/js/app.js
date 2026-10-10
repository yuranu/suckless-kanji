// App context shared by all screens: static data, the persisted event log and the state
// derived from it, device settings, speech.
import { loadData } from './data.js';
import { IdbBackend, MemoryBackend, local, deviceId, makeEvent } from './store.js';
import { replay, applyEvent } from './state.js';
import { SETTINGS } from './settings.js';
import { tts } from './tts.js';
import { toast } from './ui/dom.js';
import { Sync } from './sync.js';

export async function createApp() {
  const data = await loadData();
  let backend, persistent = true;
  try {
    backend = await new IdbBackend().open();
  } catch (err) {
    console.error('IndexedDB unavailable, progress will not be saved', err);
    backend = new MemoryBackend();
    persistent = false;
  }
  const initial = await backend.all('events');
  let state = replay(initial);
  let lastT = initial.reduce((m, e) => Math.max(m, e.t), 0);
  const dev = deviceId();
  const deviceDefaults = Object.fromEntries(SETTINGS.filter((x) => x.scope === 'device').map((x) => [x.key, x.def]));
  let device = { ...deviceDefaults, ...local.get('deviceSettings', {}) };
  const listeners = new Set();

  const app = {
    data,
    backend,
    dev,
    persistent,
    get state() { return state; },
    get settings() { return { ...state.settings, ...device }; },

    // Persist first, then apply: state never contains something that is not on disk.
    async dispatch(type, payload) {
      const e = makeEvent(type, payload, dev);
      await backend.putNew('events', [e]);
      if (e.t >= lastT) applyEvent(state, e);
      else state = replay(await backend.all('events')); // clock went backwards: replay in order
      lastT = Math.max(lastT, e.t);
      listeners.forEach((fn) => fn());
      app.sync.refreshPending();
      app.scheduleSync();
      return e;
    },

    async reload() {
      const events = await backend.all('events');
      state = replay(events);
      lastT = events.reduce((m, e) => Math.max(m, e.t), 0);
      listeners.forEach((fn) => fn());
    },

    setDevice(key, value) {
      device = { ...device, [key]: value };
      local.set('deviceSettings', device);
      applyTheme();
      listeners.forEach((fn) => fn());
    },

    async setSetting(key, value) {
      const def = SETTINGS.find((x) => x.key === key);
      if (def?.scope === 'device') app.setDevice(key, value);
      else if (state.settings[key] !== value) await app.dispatch('settings', { [key]: value });
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Sync a few seconds after local changes, batching a burst of answers into one request.
    scheduleSync(ms = 4000) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => app.sync.run(), ms);
    },

    speak(text) {
      tts.speak(text, { voice: device.voice, rate: device.rate, onFail: speechFailed });
    },
    autoSpeak(text) {
      if (device.autoplay) app.speak(text);
    },

    // Local-only diagnostics, e.g. "the drawing pad rejected a stroke I wrote correctly".
    async report(kind, detail) {
      await backend.putNew('reports', [{ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), kind, ...detail }]);
    },
  };

  let syncTimer = null;

  // Silence gets explained, but not on every word: at most once a minute.
  let speechWarned = 0;
  function speechFailed(reason) {
    console.warn('speech failed:', reason);
    if (Date.now() - speechWarned < 60_000) return;
    speechWarned = Date.now();
    toast(reason === 'unsupported'
      ? 'This browser cannot read text aloud.'
      : 'No sound: the system speech engine is not responding. On Android, play a word in Google Translate to wake it up, or check Settings → Text-to-speech output.', 7000);
  }
  app.sync = new Sync({
    backend,
    onRemote: () => app.reload(),
    onChange: () => listeners.forEach((fn) => fn()),
  });
  if (persistent) {
    app.sync.refreshPending().then(() => app.sync.run());
    setInterval(() => { if (document.visibilityState === 'visible') app.sync.run(); }, 5 * 60000);
    window.addEventListener('online', () => app.sync.run());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') app.sync.run(); });
  } else {
    app.sync.status.state = 'unavailable';
  }

  function applyTheme() {
    const t = device.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme();

  // Ask the browser not to evict our data under storage pressure.
  try { app.storagePersisted = await navigator.storage?.persist?.(); } catch { app.storagePersisted = false; }
  return app;
}
