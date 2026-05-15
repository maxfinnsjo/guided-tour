const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const OVERPASS_CACHE = 'overpass-v1'

// POI types we care about — name + tourism/historic/amenity tags
const QUERY_TEMPLATE = (lat, lon, radius) => `
[out:json][timeout:15];
(
  node["tourism"~"attraction|museum|artwork|viewpoint|monument|gallery|zoo|theme_park"](around:${radius},${lat},${lon});
  node["historic"~"monument|memorial|castle|ruins|building|archaeological_site|church"](around:${radius},${lat},${lon});
  node["amenity"~"place_of_worship|library|theatre|cinema"](around:${radius},${lat},${lon});
  way["tourism"~"attraction|museum|viewpoint|monument"](around:${radius},${lat},${lon});
  way["historic"](around:${radius},${lat},${lon});
);
out center tags;
`

// Cache key is query-body-derived, independent of which endpoint served it
function cacheKey(body) {
  return new Request(`overpass://cache?_k=${btoa(body).slice(0, 80)}`, { method: 'GET' })
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
  const body = `data=${encodeURIComponent(QUERY_TEMPLATE(lat, lon, radiusMeters))}`
  const key = cacheKey(body)
  const cache = await caches.open(OVERPASS_CACHE)

  // Try each endpoint in order, stop at first success
  let lastErr
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await tryEndpoint(endpoint, body)
      cache.put(key, res.clone())
      const data = await res.json()
      return data.elements.map(el => normalizePOI(el)).filter(p => p.name)
    } catch (err) {
      lastErr = err
    }
  }

  // All endpoints failed — serve cached data if available
  const cached = await cache.match(key)
  if (cached) {
    const data = await cached.json()
    return data.elements.map(el => normalizePOI(el)).filter(p => p.name)
  }
  throw lastErr
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
