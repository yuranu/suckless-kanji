// "Install as app" support. Chrome/Edge/Android fire `beforeinstallprompt` when the app is
// installable; we keep the event and let a button call prompt() later. Inside the installed
// app (standalone display mode) nothing is offered.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iOS Safari has no install prompt; installing is "Share -> Add to Home Screen".
export const isIosSafari = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // no mini-infobar; we show our own button
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const install = {
  // 'prompt': we can show the browser's install dialog; 'ios': show instructions; null: hide.
  get available() {
    if (isStandalone()) return null;
    if (deferred) return 'prompt';
    if (isIosSafari()) return 'ios';
    return null;
  },
  async prompt() {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    e.prompt();
    const { outcome } = await e.userChoice;
    notify();
    return outcome === 'accepted';
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
