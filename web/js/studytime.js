// Time studied: how long a lesson, review or practice screen was actually used. Counted only
// while the page is visible and focused, and at most IDLE_MS after the last tap or key press
// (an app left open on the table does not count). Recorded as `study` events, {ms}, so the
// daily total is the sum over all synced devices.
const TICK_MS = 5000;
const IDLE_MS = 2 * 60000;
const FLUSH_MS = 5 * 60000; // also saved every few minutes, in case the tab is just killed

export function studyTimer(app) {
  let pending = 0, last = Date.now(), lastInput = Date.now(), lastFlush = Date.now();
  const active = () => document.visibilityState === 'visible' && document.hasFocus();

  function account() {
    const now = Date.now();
    // Count the stretch since the previous check, up to IDLE_MS after the last input.
    if (active()) pending += Math.max(0, Math.min(now, lastInput + IDLE_MS) - last);
    last = now;
  }
  function flush() {
    account();
    lastFlush = Date.now();
    const ms = Math.round(pending / 1000) * 1000;
    if (ms < 1000) return;
    pending = 0;
    app.dispatch('study', { ms });
  }
  const onInput = () => { account(); lastInput = Date.now(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); else { last = Date.now(); } };
  const onBlur = () => account();
  const onFocus = () => { last = Date.now(); };
  const timer = setInterval(() => {
    account();
    if (Date.now() - lastFlush >= FLUSH_MS) flush();
  }, TICK_MS);

  for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, onInput, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    flush();
    clearInterval(timer);
    for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, onInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}

// "1 h 5 min", "12 min", "<1 min"
export function fmtStudy(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return ms > 0 ? '<1 min' : '0 min';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
