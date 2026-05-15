import L from 'leaflet'
import { fetchNearbyPOIs } from './overpass.js'
import { distance, watchPosition, getAccuratePosition } from './geo.js'
import { show as showCard } from './flashcard.js'
import * as tour from './tour.js'

// ── Map setup ────────────────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: true, attributionControl: true })
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)

// ── State ─────────────────────────────────────────────────────────────────────

let userMarker = null
let poiMarkers = new Map()  // id → marker
let loadedPOIs = new Map()  // id → poi
let lastFetchCenter = null
const FETCH_RADIUS = 600
const REFETCH_DISTANCE = 200
const PROXIMITY_ALERT = 80

// ── UI refs ───────────────────────────────────────────────────────────────────

const statusText = document.getElementById('status-text')
const recenterBtn = document.getElementById('btn-recenter')
const btnTour = document.getElementById('btn-tour')
const btnFaq = document.getElementById('btn-faq')
const tourPanel = document.getElementById('tour-panel')
const tourClose = document.getElementById('tour-close')
const faqPanel = document.getElementById('faq-panel')
const faqClose = document.getElementById('faq-close')

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
    statusText.textContent = `${loadedPOIs.size} places nearby`
    lastFetchCenter = { lat, lon }
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

// Get a fresh fix (maximumAge:0) for the initial center, independent of watchPosition
getAccuratePosition()
  .then(pos => {
    const { latitude: lat, longitude: lon } = pos.coords
    map.setView([lat, lon], 16)
  })
  .catch(() => {
    map.setView([51.505, -0.09], 13)
  })

watchPosition(
  pos => {
    const { latitude: lat, longitude: lon } = pos.coords
    statusText.textContent = `${loadedPOIs.size} places nearby`

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
  err => {
    statusText.textContent = 'Location unavailable'
    console.warn('Geolocation error', err)
  }
)

// ── Tour integration ──────────────────────────────────────────────────────────

// Add markers when tour starts
document.addEventListener('tour:started', () => {
  for (const poi of tour.getPOIs()) {
    if (poi.lat && poi.lon) {
      loadedPOIs.set(poi.id, poi)
      addPOIMarker(poi)
    }
  }
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
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
