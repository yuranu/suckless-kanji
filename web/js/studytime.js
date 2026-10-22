// Time studied: how long a lesson, review or practice screen was actually used. Counted only
// while the page is visible, and at most IDLE_MS after the last tap or key press (an app left
// open on the table does not count). Recorded as `study` events, {ms}, so the daily total is
// the sum over all synced devices.
//
// Unsaved time lives in localStorage ("sk.study"), written synchronously on every update.
// Switching apps on Android can freeze or kill the page before an IndexedDB write commits,
// which used to lose up to FLUSH_MS of study time each time. Closed chunks keep a fixed
// event id until they are saved, so sending one again after a lost write (or one that did
// land) is harmless: the event log dedups by id.
import { local } from './store.js';

const TICK_MS = 5000;
const IDLE_MS = 2 * 60000;
const FLUSH_MS = 5 * 60000;
const KEY = 'study';

const load = () => {
  const st = local.get(KEY, null);
  return st && Array.isArray(st.chunks) ? st : { open: 0, chunks: [] };
};
const store = (st) => local.set(KEY, st);

// Move the open time into a closed chunk with its own event id.
function close(app, now = Date.now()) {
  const st = load();
  const ms = Math.floor(st.open / 1000) * 1000;
  if (ms >= 1000) {
    st.chunks.push({ id: `${now.toString(36)}-${app.dev}-s${Math.random().toString(36).slice(2, 6)}`, t: now, ms });
    st.open -= ms;
    store(st);
  }
}

// Save closed chunks as events; each is forgotten only once its write has completed.
let sending = false;
async function send(app) {
  if (sending) return;
  sending = true;
  try {
    for (const c of load().chunks) {
      await app.dispatch('study', { ms: c.ms }, { id: c.id, t: c.t });
      const st = load();
      st.chunks = st.chunks.filter((x) => x.id !== c.id);
      store(st);
    }
  } catch (err) {
    console.warn('study time not saved yet, will retry', err);
  } finally {
    sending = false;
  }
}

// At startup: time left over from a page that was killed mid-session.
export function recoverStudy(app) {
  close(app);
  return send(app);
}

export function studyTimer(app) {
  let last = Date.now(), lastInput = Date.now(), lastFlush = Date.now();
  const visible = () => document.visibilityState === 'visible';

  function account() {
    const now = Date.now();
    // The stretch since the previous check, up to IDLE_MS after the last input.
    const add = visible() ? Math.max(0, Math.min(now, lastInput + IDLE_MS) - last) : 0;
    last = now;
    if (add > 0) {
      const st = load();
      st.open += add;
      store(st);
    }
  }
  function flush() {
    account();
    lastFlush = Date.now();
    close(app);
    send(app);
  }
  const onInput = () => { account(); lastInput = Date.now(); };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      // `visible()` is already false here: count the stretch up to now first.
      const now = Date.now();
      const st = load();
      st.open += Math.max(0, Math.min(now, lastInput + IDLE_MS) - last);
      store(st);
      last = now;
      close(app);
      send(app);
    } else {
      last = Date.now();
      send(app); // anything a frozen page did not manage to save
    }
  };
  const timer = setInterval(() => {
    account();
    if (Date.now() - lastFlush >= FLUSH_MS) flush();
  }, TICK_MS);

  for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, onInput, true);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    flush();
    clearInterval(timer);
    for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, onInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// "1 h 5 min", "12 min", "<1 min"
export function fmtStudy(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return ms > 0 ? '<1 min' : '0 min';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
