// Offline by design: on install, every file of the app is downloaded into the cache, so
// it works without a network from then on. Requests go to the network first (updates show up
// immediately) but give up after a few seconds and use the cached copy, so a flaky
// connection never hangs the app. API and sign-in requests are never cached.
//
// PRECACHE must list every file in web/ (tests/pwa.test.mjs enforces it). Paths are the
// URLs Cloudflare serves: "./" for index.html, "privacy" for privacy.html. Changing the list
// changes this file, which makes browsers install the new worker.
const CACHE = 'suckless-kanji-v3';
const NETWORK_TIMEOUT_MS = 3000;
const PRECACHE = [
  './',
  'privacy',
  'credits',
  'manifest.webmanifest',
  'version.json', // written at deploy time (scripts/version.mjs), not in git
  'css/app.css',
  'data/curriculum.json',
  'data/kanji.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'js/app.js',
  'js/backup.js',
  'js/data.js',
  'js/distractors.js',
  'js/importer.js',
  'js/install.js',
  'js/main.js',
  'js/progress.js',
  'js/screens/free.js',
  'js/screens/home.js',
  'js/screens/import.js',
  'js/screens/kanji.js',
  'js/screens/learn.js',
  'js/screens/lessons.js',
  'js/screens/practice.js',
  'js/screens/review.js',
  'js/screens/settings.js',
  'js/session.js',
  'js/settings.js',
  'js/srs/fsrs.js',
  'js/srs/sm2.js',
  'js/state.js',
  'js/store.js',
  'js/stroke.js',
  'js/sync.js',
  'js/tts.js',
  'js/ui/dom.js',
  'js/ui/drawpad.js',
  'js/ui/games.js',
  'js/ui/session.js',
  'js/ui/sync-ui.js',
];

self.addEventListener('install', (e) => {
  // Each file separately: one failure (e.g. a dev server without clean URLs) must not
  // prevent caching the rest.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

function fromNetwork(request) {
  return fetch(request).then((res) => {
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
}

async function networkFirst(request) {
  // Navigations to the app (any hash) are answered from the shell cached as "./".
  const isShell = request.mode === 'navigate' && new URL(request.url).pathname === '/';
  const cached = () => caches.match(isShell ? './' : request, { ignoreSearch: true });
  const network = fromNetwork(request);
  network.catch(() => {}); // if the cache answers, a later network failure is expected
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await cached()) || (await network); // slow network: use the cache if we have it
  } catch {
    const hit = await cached();
    if (hit) return hit;
    throw new Error('offline and not cached: ' + request.url);
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return; // never cache
  e.respondWith(networkFirst(e.request));
});
