const CACHE = 'guided-tour-v3'

self.addEventListener('install', e => {
  // Only cache the shell HTML — not source files, which Vite rewrites
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/')).then(() => self.skipWaiting())
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
  const url = new URL(e.request.url)

  // External (tiles, Overpass, Wikipedia, Wikidata): cache-then-network
  // Always store successful responses; serve cache when network fails or errors
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        try {
          const res = await fetch(e.request.clone())
          if (res.ok) cache.put(e.request, res.clone())
          return res
        } catch {
          const cached = await cache.match(e.request)
          if (cached) return cached
          throw new Error('offline')
        }
      })
    )
    return
  }

  // Same-origin: network-first so updates are always picked up;
  // fall back to cache only when offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
