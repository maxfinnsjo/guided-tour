const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const OVERPASS_CACHE = 'overpass-v1'

// Quantise coords to ~500m grid so minor GPS drift reuses the same cache entry
function gridKey(lat, lon, radius) {
  const step = (radius / 111000) * 0.8
  const glat = Math.round(lat / step) * step
  const glon = Math.round(lon / step) * step
  return `${glat.toFixed(5)},${glon.toFixed(5)},${radius}`
}

const QUERY_TEMPLATE = (lat, lon, radius) => `
[out:json][timeout:25];
(
  node["tourism"~"attraction|museum|artwork|viewpoint|monument|gallery|zoo|theme_park"](around:${radius},${lat},${lon});
  node["historic"~"monument|memorial|castle|ruins|building|archaeological_site|church"](around:${radius},${lat},${lon});
  node["amenity"~"place_of_worship|library|theatre|cinema"](around:${radius},${lat},${lon});
  way["tourism"~"attraction|museum|viewpoint|monument"](around:${radius},${lat},${lon});
  way["historic"](around:${radius},${lat},${lon});
);
out center tags;
`

function cacheRequest(gk) {
  return new Request(`overpass://cache?gk=${encodeURIComponent(gk)}`, { method: 'GET' })
}

async function tryEndpoint(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  return res
}

export async function fetchNearbyPOIs(lat, lon, radiusMeters = 500) {
  const gk = gridKey(lat, lon, radiusMeters)
  const cacheReq = cacheRequest(gk)

  let cache = null
  try { cache = await caches.open(OVERPASS_CACHE) } catch {}

  if (cache) {
    const cached = await cache.match(cacheReq).catch(() => null)
    if (cached) {
      try {
        const data = await cached.json()
        const pois = data.elements.map(el => normalizePOI(el)).filter(p => p.name)
        // Refresh in background — caller already has data, silent failure is fine
        _fetchAndCache(lat, lon, radiusMeters, gk, cache, cacheReq).catch(() => {})
        return pois
      } catch {}
    }
  }

  // No usable cache — wait for network
  return _fetchAndCache(lat, lon, radiusMeters, gk, cache, cacheReq)
}

async function _fetchAndCache(lat, lon, radius, gk, cache, cacheReq) {
  const body = `data=${encodeURIComponent(QUERY_TEMPLATE(lat, lon, radius))}`

  // Race all endpoints — fastest wins; fall back to serial if Promise.any unavailable
  let res
  if (typeof Promise.any === 'function') {
    res = await Promise.any(ENDPOINTS.map(ep => tryEndpoint(ep, body)))
  } else {
    let lastErr
    for (const ep of ENDPOINTS) {
      try { res = await tryEndpoint(ep, body); break } catch (e) { lastErr = e }
    }
    if (!res) throw lastErr
  }

  if (cache) cache.put(cacheReq, res.clone()).catch(() => {})
  const data = await res.json()
  return data.elements.map(el => normalizePOI(el)).filter(p => p.name)
}

function normalizePOI(el) {
  const t = el.tags || {}
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  const type = t.tourism || t.historic || t.amenity || 'poi'
  const name = t.name || t['name:en'] || ''
  const desc = t.description || t['description:en'] || t.wikipedia_excerpt || ''
  return { id: `${el.type}/${el.id}`, lat, lon, name, type, desc, tags: t }
}
