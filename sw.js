// Service worker: приложение полностью работает офлайн.
// - Оболочка (html/css/js/иконки): сразу из кэша, в фоне обновляется из сети.
// - data/words.json: сначала сеть (чтобы новые слова появлялись сразу), без сети — из кэша.
// При изменении списка файлов ниже увеличьте номер версии.

const CACHE = 'hsk-cards-v1';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/audio.js',
  'js/storage.js',
  'js/celebrate.js',
  'data/words.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];

const SCOPE = self.registration.scope;
const WORDS_URL = new URL('data/words.json', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.href.split('?')[0] === WORDS_URL) {
    event.respondWith(networkFirst(event));
  } else if (req.mode === 'navigate') {
    event.respondWith(cacheFirstAndUpdate(event, SCOPE));
  } else {
    event.respondWith(cacheFirstAndUpdate(event, req));
  }
});

async function cacheFirstAndUpdate(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(event.request)
    .then((res) => {
      if (res && res.ok && !res.redirected && res.type === 'basic') {
        return cache.put(key, res.clone()).then(() => res, () => res);
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  if (event.request.mode === 'navigate') {
    const shell = await cache.match(SCOPE);
    if (shell) return shell;
  }
  return Response.error();
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(WORDS_URL, { cache: 'no-store' }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      event.waitUntil(cache.put(WORDS_URL, copy));
    }
    return res;
  });
  event.waitUntil(network.catch(() => null));

  try {
    // Медленная сеть: через 4 секунды отдаём кэш, а сеть обновит его в фоне
    const res = await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (res && res.ok) return res;
    throw new Error('bad response');
  } catch {
    const cached = await cache.match(WORDS_URL);
    return cached || Response.error();
  }
}
