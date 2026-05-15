const ENDPOINT = 'https://overpass-api.de/api/interpreter'

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

export async function fetchNearbyPOIs(lat, lon, radiusMeters = 500) {
  const body = `data=${encodeURIComponent(QUERY_TEMPLATE(lat, lon, radiusMeters))}`
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Overpass error ${res.status}`)
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
