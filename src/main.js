import L from 'leaflet'
import { fetchNearbyPOIs } from './overpass.js'
import { distance, watchPosition, getFastPosition } from './geo.js'
import { show as showCard, hide as hideCard } from './flashcard.js'
import * as tour from './tour.js'

// ── Map setup ────────────────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: true, attributionControl: true })
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)

// ── State ─────────────────────────────────────────────────────────────────────

let userMarker = null
let userLatLon = null        // kept current for drawer distance sorting
let poiMarkers = new Map()  // id → marker
let loadedPOIs = new Map()  // id → poi
let lastFetchCenter = null
const FETCH_RADIUS = 600
const REFETCH_DISTANCE = 200
const PROXIMITY_ALERT = 80
const POI_STORAGE_KEY = 'guided-tour-pois-v1'

function persistPOIs() {
  try {
    const arr = [...loadedPOIs.values()]
    localStorage.setItem(POI_STORAGE_KEY, JSON.stringify(arr))
  } catch {}
}

function loadPersistedPOIs() {
  try {
    const raw = localStorage.getItem(POI_STORAGE_KEY)
    if (!raw) return
    const arr = JSON.parse(raw)
    for (const poi of arr) {
      if (!loadedPOIs.has(poi.id)) {
        loadedPOIs.set(poi.id, poi)
        addPOIMarker(poi)
      }
    }
    refreshDrawer()
  } catch {}
}

// ── UI refs ───────────────────────────────────────────────────────────────────

const statusText = document.getElementById('status-text')
const recenterBtn = document.getElementById('btn-recenter')
const btnTour = document.getElementById('btn-tour')
const btnFaq = document.getElementById('btn-faq')
const tourPanel = document.getElementById('tour-panel')
const tourClose = document.getElementById('tour-close')
const faqPanel = document.getElementById('faq-panel')
const faqClose = document.getElementById('faq-close')
const poiDrawer = document.getElementById('poi-drawer')
const poiDrawerHandle = document.getElementById('poi-drawer-handle')
const poiDrawerLabel = document.getElementById('poi-drawer-label')
const poiDrawerList = document.getElementById('poi-drawer-list')

// ── Panel toggles ─────────────────────────────────────────────────────────────

btnTour.addEventListener('click', () => {
  tourPanel.classList.toggle('hidden')
  faqPanel.classList.add('hidden')
})
tourClose.addEventListener('click', () => tourPanel.classList.add('hidden'))
btnFaq.addEventListener('click', () => {
  faqPanel.classList.toggle('hidden')
  tourPanel.classList.add('hidden')
})
faqClose.addEventListener('click', () => faqPanel.classList.add('hidden'))
recenterBtn.addEventListener('click', () => {
  if (userMarker) map.setView(userMarker.getLatLng(), map.getZoom())
})

poiDrawerHandle.addEventListener('click', () => {
  const flashcard = document.getElementById('flashcard')
  if (!flashcard.classList.contains('hidden')) {
    hideCard()
    setTimeout(() => poiDrawer.classList.add('open'), 260)
    return
  }
  poiDrawer.classList.toggle('open')
})

// ── POI markers ───────────────────────────────────────────────────────────────

const poiIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:10px;height:10px;border-radius:50%;
    background:var(--accent,#e94560);
    border:2px solid #fff;
    box-shadow:0 0 4px #00000080;
  "></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
})

function addPOIMarker(poi) {
  if (poiMarkers.has(poi.id) || poi.lat == null) return
  const marker = L.marker([poi.lat, poi.lon], { icon: poiIcon, title: poi.name })
    .addTo(map)
    .on('click', () => showCard(poi))
  poiMarkers.set(poi.id, marker)
}

// ── Nearby POI drawer ─────────────────────────────────────────────────────────

function refreshDrawer() {
  const all = [...loadedPOIs.values()].filter(p => p.lat != null)
  // Sort by distance from user if we have a position, else by name
  if (userLatLon) {
    const { lat, lon } = userLatLon
    all.sort((a, b) => distance(lat, lon, a.lat, a.lon) - distance(lat, lon, b.lat, b.lon))
  } else {
    all.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }
  poiDrawerLabel.textContent = `${all.length} place${all.length !== 1 ? 's' : ''} nearby`
  poiDrawerList.innerHTML = all.map(poi => {
    const dist = userLatLon
      ? formatDist(distance(userLatLon.lat, userLatLon.lon, poi.lat, poi.lon))
      : ''
    return `<li data-id="${poi.id}">
      <span class="poi-row-dist">${dist}</span>
      <span class="poi-row-name">${poi.name || '(unnamed)'}</span>
      <span class="poi-row-type">${(poi.type || '').replace(/_/g, ' ')}</span>
    </li>`
  }).join('')
  ;[...poiDrawerList.children].forEach(li => {
    li.addEventListener('click', () => {
      const poi = loadedPOIs.get(li.dataset.id)
      if (!poi) return
      map.setView([poi.lat, poi.lon], 17)
      poiDrawer.classList.remove('open')
      setTimeout(() => showCard(poi), 260)
    })
  })
}

function formatDist(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`
}

// ── Fetch POIs from Overpass ───────────────────────────────────────────────────

async function fetchPOIs(lat, lon) {
  statusText.textContent = 'Fetching nearby places…'
  try {
    const pois = await fetchNearbyPOIs(lat, lon, FETCH_RADIUS)
    for (const poi of pois) {
      if (!loadedPOIs.has(poi.id)) {
        loadedPOIs.set(poi.id, poi)
        addPOIMarker(poi)
      }
    }
    refreshDrawer()
    persistPOIs()
    lastFetchCenter = { lat, lon }
    const n = loadedPOIs.size
    statusText.textContent = `${n} place${n !== 1 ? 's' : ''} nearby`
    setTimeout(() => { statusText.textContent = '' }, 4000)
  } catch (err) {
    statusText.textContent = 'Could not fetch places'
    console.error(err)
  }
}

// ── Proximity checks ──────────────────────────────────────────────────────────

let lastAlertedId = null

function checkProximity(lat, lon) {
  for (const [id, poi] of loadedPOIs) {
    if (poi.lat == null) continue
    const d = distance(lat, lon, poi.lat, poi.lon)
    if (d < PROXIMITY_ALERT && id !== lastAlertedId) {
      lastAlertedId = id
      showCard(poi)
      break
    }
  }
}

function checkTourProximity(lat, lon) {
  const poi = tour.getCurrentPOI()
  if (!poi || poi.lat == null) return
  const d = distance(lat, lon, poi.lat, poi.lon)
  if (d < PROXIMITY_ALERT) {
    showCard(poi)
    tour.markVisited(tour.getCurrentIndex())
  }
}

// ── Location tracking ─────────────────────────────────────────────────────────

// Load last session's POIs immediately so the map isn't blank while GPS resolves
loadPersistedPOIs()

// Phase 1: fast low-accuracy fix (IP/WiFi) — centers the map immediately
// Phase 2: watchPosition with high-accuracy refines the marker in the background
let centered = false
let centeredViaFallback = false

getFastPosition()
  .then(pos => {
    const { latitude: lat, longitude: lon } = pos.coords
    userLatLon = { lat, lon }
    map.setView([lat, lon], 16)
    userMarker = L.circleMarker([lat, lon], {
      radius: 7,
      color: '#fff',
      fillColor: '#4a9eff',
      fillOpacity: 1,
      weight: 2,
    }).addTo(map)
    fetchPOIs(lat, lon)
    centered = true
  })
  .catch(() => {
    map.setView([51.505, -0.09], 13)
    statusText.textContent = 'Locating via GPS…'
    centered = true
    centeredViaFallback = true
  })

watchPosition(
  pos => {
    const { latitude: lat, longitude: lon } = pos.coords
    userLatLon = { lat, lon }

    if (!userMarker) {
      userMarker = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#fff',
        fillColor: '#4a9eff',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map)
    } else {
      userMarker.setLatLng([lat, lon])
    }

    // Center map on first watchPosition fix if getFastPosition didn't already do it
    if (!centered || centeredViaFallback) {
      map.setView([lat, lon], 16)
      centered = true
      centeredViaFallback = false
      statusText.textContent = 'Location found'
      setTimeout(() => { statusText.textContent = '' }, 3000)
    }

    const shouldFetch =
      !lastFetchCenter ||
      distance(lat, lon, lastFetchCenter.lat, lastFetchCenter.lon) > REFETCH_DISTANCE

    if (shouldFetch) fetchPOIs(lat, lon)

    if (tour.isActive()) {
      checkTourProximity(lat, lon)
    } else {
      checkProximity(lat, lon)
    }
  },
  err => { console.warn('Geolocation watch error', err) }
)

// ── Tour integration ──────────────────────────────────────────────────────────

document.addEventListener('tour:started', () => {
  for (const poi of tour.getPOIs()) {
    if (poi.lat && poi.lon) {
      loadedPOIs.set(poi.id, poi)
      addPOIMarker(poi)
    }
  }
  refreshDrawer()
})

// POI added/loaded from tour — show on map immediately
document.addEventListener('tour:poi-added', e => {
  const poi = e.detail
  loadedPOIs.set(poi.id, poi)
  if (poi.lat != null && poi.lon != null && poi.lat !== '' && poi.lon !== '') {
    addPOIMarker(poi)
  }
  refreshDrawer()
})

// Coordinate pick mode: hides tour panel, waits for map click, calls back with lat/lon
function enterPickMode(cb) {
  const hint = document.createElement('div')
  hint.id = 'pick-hint'
  hint.textContent = 'Tap the map to place the POI'
  document.getElementById('app').appendChild(hint)

  const handler = e => {
    map.off('click', handler)
    hint.remove()
    cb(e.latlng.lat, e.latlng.lng)
  }
  map.on('click', handler)
}

tour.setPickModeHandler(enterPickMode)

// ── Service worker ────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/guided-tour/sw.js').catch(() => {})
  })
}
