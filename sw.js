// 程式本體：先抓網路最新版，沒網路才用快取
// 模型與引擎由 app 自己存在 idscan-models-v1，這裡不碰、更新時也不刪
const CACHE = 'idscan-v9', KEEP = [CACHE, 'idscan-models-v1'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './docs.js', './pair.js', './qrcode.js', './ort/ort.wasm.min.js', './ort/ort-wasm-simd-threaded.mjs'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (/\.(onnx|wasm)$|ppocrv5_dict/.test(url.pathname)) {          // 大檔：先看模型快取
    e.respondWith(caches.open('idscan-models-v1').then(c => c.match(e.request)).then(hit => hit || fetch(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request)));
});
