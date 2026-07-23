/* =============================================
   AttendPro Service Worker — Offline Support
   ============================================= */

const CACHE_NAME = 'attendpro-v20';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/settings.js',
  './js/drive.js',
  './js/firebase-sync.js',
  './js/manpower.js',
  './js/attendance.js',
  './js/jobs.js',
  './js/reports.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// CDN libraries to cache
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

/* -------- Install -------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache static assets
      return cache.addAll(STATIC_ASSETS).then(() => {
        // Try to cache CDN assets (best effort)
        return Promise.allSettled(CDN_ASSETS.map(url => cache.add(url)));
      });
    }).then(() => self.skipWaiting())
  );
});

/* -------- Activate -------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* -------- Fetch -------- */
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Network-first for navigation requests
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
