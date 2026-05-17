const searchCache = new Map()
const geocodeCache = new Map()
let lastGeocode = 0

function quantiseKey(lat, lon) {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lon * 1000) / 1000}`
}

export async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null) return null
  const key = quantiseKey(lat, lon)
  if (geocodeCache.has(key)) return geocodeCache.get(key)

  const wait = Math.max(0, 1000 - (Date.now() - lastGeocode))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastGeocode = Date.now()

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    )
    if (!res.ok) throw new Error(res.status)
    const data = await res.json()
    const a = data.address || {}
    const result = {
      road: a.road || a.pedestrian || a.path || null,
      suburb: a.suburb || a.neighbourhood || a.quarter || null,
      city: a.city || a.town || a.village || null
    }
    geocodeCache.set(key, result)
    return result
  } catch {
    geocodeCache.set(key, null)
    return null
  }
}

function buildSearchQuery(poi, address) {
  const parts = [poi.name]
  if (poi.type && poi.type !== 'poi') {
    parts.push(poi.type.replace(/_/g, ' '))
  }
  if (address) {
    if (address.road) parts.push(address.road)
    else if (address.suburb) parts.push(address.suburb)
    if (address.city && !address.road && !address.suburb) parts.push(address.city)
  }
  return parts.join(' ').slice(0, 80)
}

async function searchWikipedia(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data.query?.search || []
  } catch {
    return []
  }
}

function isGoodMatch(result) {
  const title = result.title.toLowerCase()
  if (/\((name|given name|surname|forename|personal name)\)/.test(title)) return false
  if (/\(disambiguation\)/.test(title)) return false
  return true
}

async function fetchWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.extract) return null
    return { extract: data.extract, url: data.content_urls?.desktop?.page || '' }
  } catch {
    return null
  }
}

export async function fetchCommonsImage(name) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(name)}&gsrnamespace=6&prop=imageinfo` +
    `&iiprop=url|extmetadata&iilimit=1&format=json&origin=*`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const pages = Object.values(data.query?.pages || {})
    if (!pages.length) return null
    const info = pages[0].imageinfo?.[0]
    if (!info?.url) return null
    const meta = info.extmetadata || {}
    return {
      url: info.url,
      credit: meta.Artist?.value?.replace(/<[^>]+>/g, '') || null,
      license: meta.LicenseShortName?.value || null,
    }
  } catch {
    return null
  }
}

export async function enrichFromWebSearch(poi, existingWikiUrl) {
  if (searchCache.has(poi.id)) return searchCache.get(poi.id)

  const address = await reverseGeocode(poi.lat, poi.lon)
  const query = buildSearchQuery(poi, address)
  const results = await searchWikipedia(query)

  for (const result of results) {
    if (!isGoodMatch(result)) continue
    // Skip if it's the same article already shown in #fc-wiki
    if (existingWikiUrl && existingWikiUrl.includes(encodeURIComponent(result.title.replace(/ /g, '_')))) {
      searchCache.set(poi.id, null)
      return null
    }
    const summary = await fetchWikipediaSummary(result.title)
    if (summary) {
      searchCache.set(poi.id, summary)
      return summary
    }
  }

  searchCache.set(poi.id, null)
  return null
}
