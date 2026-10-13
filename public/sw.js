// WhaleSonar service worker — network-first: luôn lấy bản mới nhất, chỉ dùng cache khi mất mạng.
const CACHE = 'whalesonar-v2';
const SHELL = ['./', 'index.html', 'style.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Chỉ xử lý file của app; dữ liệu API luôn đi thẳng ra mạng
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // cache: 'no-cache' → luôn hỏi lại GitHub Pages xem có bản mới không (bỏ qua bộ nhớ tạm 10 phút của trình duyệt)
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
