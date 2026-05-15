const CACHE = 'guided-tour-v1'
const PRECACHE = ['/', '/src/style.css', '/src/main.js']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Cache-first for same-origin assets, network-first for Overpass/tiles
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
    return
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request))
  )
})
