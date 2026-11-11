// 程式本體：先抓網路最新版，沒網路才用快取
// 辨識模型與引擎（model/、ort/）：檔案大，存進快取後就一直用快取
const CACHE = 'idscan-v4';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
const put = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const heavy = url.origin === location.origin && /\/(model|ort)\//.test(url.pathname);
  if (url.origin === location.origin && !heavy) {
    e.respondWith(fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => put(e.request, res))));
  }
});
