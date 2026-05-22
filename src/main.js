import L from 'leaflet'
import { fetchNearbyPOIs } from './overpass.js'
import { distance, watchPosition } from './geo.js'
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
let manualPin = null         // { lat, lon } when user has overridden position
let manualPinMarker = null
let poiMarkers = new Map()  // id → marker
let loadedPOIs = new Map()  // id → poi
let lastFetchCenter = null
let routeLine = null         // dashed line from user to current tour POI
const FETCH_RADIUS = 600
const REFETCH_DISTANCE = 200
const PROXIMITY_ALERT = 80
function clearPOIs() {
  for (const marker of poiMarkers.values()) marker.remove()
  poiMarkers.clear()
  loadedPOIs.clear()
  lastFetchCenter = null
}

// ── UI refs ───────────────────────────────────────────────────────────────────

const statusText = document.getElementById('status-text')
const recenterBtn = document.getElementById('btn-recenter')
const clearPinBtn = document.getElementById('btn-clear-pin')
const btnTheme = document.getElementById('btn-theme')
const btnTour = document.getElementById('btn-tour')
const tourPanel = document.getElementById('tour-panel')
const tourClose = document.getElementById('tour-close')
const poiDrawer = document.getElementById('poi-drawer')
const poiDrawerHandle = document.getElementById('poi-drawer-handle')
const poiDrawerLabel = document.getElementById('poi-drawer-label')
const poiDrawerList = document.getElementById('poi-drawer-list')

// ── Theme toggle ─────────────────────────────────────────────────────────────

const THEME_KEY = 'guided-tour-theme'
function applyTheme(light) {
  document.documentElement.classList.toggle('light', light)
  btnTheme.textContent = light ? '☽' : '☀'
  document.getElementById('meta-theme-color').setAttribute('content', light ? '#ede8dc' : '#1a1a2e')
}
;(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  applyTheme(saved === 'light')
})()
btnTheme.addEventListener('click', () => {
  const isLight = !document.documentElement.classList.contains('light')
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark')
  applyTheme(isLight)
})

// ── Panel toggles ─────────────────────────────────────────────────────────────

btnTour.addEventListener('click', () => tourPanel.classList.toggle('hidden'))
tourClose.addEventListener('click', () => tourPanel.classList.add('hidden'))
recenterBtn.addEventListener('click', () => {
  const pos = manualPin || userLatLon
  if (!pos) return
  map.setView([pos.lat, pos.lon], map.getZoom())
  if (lastFetchCenter) {
    const d = distance(pos.lat, pos.lon, lastFetchCenter.lat, lastFetchCenter.lon)
    if (d > REFETCH_DISTANCE) { clearPOIs(); fetchPOIs(pos.lat, pos.lon) }
  }
})

function setManualPin(lat, lon) {
  manualPin = { lat, lon }
  const pinIcon = L.divIcon({
    className: '',
    html: `<div style="
      font-size:24px;line-height:1;
      filter:drop-shadow(0 2px 3px #00000080);
      transform:translateY(-100%);
    ">📍</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  })
  if (!manualPinMarker) {
    manualPinMarker = L.marker([lat, lon], { icon: pinIcon, zIndexOffset: 500 }).addTo(map)
  } else {
    manualPinMarker.setLatLng([lat, lon])
  }
  clearPinBtn.classList.remove('hidden')
  map.setView([lat, lon], Math.max(map.getZoom(), 16))
  clearPOIs()
  fetchPOIs(lat, lon)
  centered = true
  if (accuracyTimer) { clearTimeout(accuracyTimer); accuracyTimer = null }
}

function clearManualPin() {
  manualPin = null
  if (manualPinMarker) { manualPinMarker.remove(); manualPinMarker = null }
  clearPinBtn.classList.add('hidden')
  // If we have a real GPS position, jump back to it
  if (userLatLon) {
    map.setView([userLatLon.lat, userLatLon.lon], map.getZoom())
    clearPOIs()
    fetchPOIs(userLatLon.lat, userLatLon.lon)
  }
}

clearPinBtn.addEventListener('click', clearManualPin)

// Right-click on desktop
map.on('contextmenu', e => {
  setManualPin(e.latlng.lat, e.latlng.lng)
})

// Long-press on mobile (500ms)
let longPressTimer = null
map.on('mousedown touchstart', e => {
  const latlng = e.latlng
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    setManualPin(latlng.lat, latlng.lng)
  }, 500)
})
map.on('mouseup mousemove touchend touchmove', () => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
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
  statusText.textContent = 'Looking for nearby places…'
  try {
    const pois = await fetchNearbyPOIs(lat, lon, FETCH_RADIUS)
    for (const poi of pois) {
      if (!loadedPOIs.has(poi.id)) {
        loadedPOIs.set(poi.id, poi)
        addPOIMarker(poi)
      }
    }
    refreshDrawer()
    lastFetchCenter = { lat, lon }
    const n = loadedPOIs.size
    statusText.textContent = `${n} place${n !== 1 ? 's' : ''} nearby — tap any to learn more`
    setTimeout(() => { statusText.textContent = '' }, 5000)
  } catch (err) {
    statusText.textContent = 'Could not load nearby places'
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

let lastAutoAlertedIndex = -1

function checkTourProximity(lat, lon) {
  if (!tour.isAutoMode()) return
  const poi = tour.getCurrentPOI()
  if (!poi || poi.lat == null) return
  const idx = tour.getCurrentIndex()
  if (idx === lastAutoAlertedIndex) return
  const d = distance(lat, lon, poi.lat, poi.lon)
  if (d < PROXIMITY_ALERT) {
    lastAutoAlertedIndex = idx
    showCard(poi)
  }
}

// ── Location tracking ─────────────────────────────────────────────────────────

const ACCURACY_THRESHOLD = 100   // metres — ignore coarse fixes for initial centering
const ACCURACY_WAIT_MS = 8000    // fall back to best available after this long
const DESKTOP_HINT_ACCURACY = 500 // metres — show right-click hint if worse than this

statusText.textContent = 'Finding your location…'
let centered = false
let accuracyCircle = null
let bestAccuracy = Infinity
let accuracyTimer = null

function onPosition(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords
  userLatLon = { lat, lon }

  // Always update the dot marker
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

  // Show accuracy ring so the user can see fix quality
  const accRadius = Math.min(accuracy, 500)
  if (!accuracyCircle) {
    accuracyCircle = L.circle([lat, lon], {
      radius: accRadius,
      color: '#4a9eff',
      fillColor: '#4a9eff',
      fillOpacity: 0.10,
      weight: 1,
    }).addTo(map)
  } else {
    accuracyCircle.setLatLng([lat, lon])
    accuracyCircle.setRadius(accRadius)
  }

  // Track the best (smallest) accuracy we've seen
  if (accuracy < bestAccuracy) bestAccuracy = accuracy

  const goodEnough = accuracy <= ACCURACY_THRESHOLD

  if (!centered && goodEnough) {
    // Good GPS fix — use it
    if (accuracyTimer) { clearTimeout(accuracyTimer); accuracyTimer = null }
    _centerAndFetch(lat, lon)
  } else if (!centered) {
    if (accuracy > DESKTOP_HINT_ACCURACY) {
      statusText.textContent = `Poor location (±${Math.round(accuracy)}m) — right-click map to pin your position`
    } else {
      statusText.textContent = `Improving accuracy… (±${Math.round(accuracy)}m)`
    }
    // Start the fallback timer on the first position we receive
    if (!accuracyTimer) {
      accuracyTimer = setTimeout(() => {
        if (!centered && userLatLon) {
          if (bestAccuracy > DESKTOP_HINT_ACCURACY) {
            statusText.textContent = `Poor GPS — right-click map to pin your start position`
          } else {
            statusText.textContent = `Low accuracy (±${Math.round(bestAccuracy)}m) — using best available`
            setTimeout(() => { statusText.textContent = '' }, 4000)
            _centerAndFetch(userLatLon.lat, userLatLon.lon)
          }
        }
      }, ACCURACY_WAIT_MS)
    }
  }

  // When manually pinned, GPS still updates the dot but doesn't drive fetches/proximity
  if (manualPin) return

  const distFromLast = lastFetchCenter
    ? distance(lat, lon, lastFetchCenter.lat, lastFetchCenter.lon)
    : Infinity

  if (centered) {
    if (distFromLast > FETCH_RADIUS) {
      clearPOIs()
      fetchPOIs(lat, lon)
    } else if (distFromLast > REFETCH_DISTANCE) {
      fetchPOIs(lat, lon)
    }

    if (tour.isActive()) {
      checkTourProximity(lat, lon)
      if (routeLine) {
        const poi = tour.getCurrentPOI()
        if (poi?.lat != null) routeLine.setLatLngs([[lat, lon], [poi.lat, poi.lon]])
      }
    } else {
      checkProximity(lat, lon)
    }
  }
}

function _centerAndFetch(lat, lon) {
  centered = true
  map.setView([lat, lon], 16)
  statusText.textContent = 'Location found — loading nearby places…'
  setTimeout(() => { statusText.textContent = '' }, 4000)
  fetchPOIs(lat, lon)
}

watchPosition(
  onPosition,
  err => { console.warn('Geolocation watch error', err) }
)

// ── Tour integration ──────────────────────────────────────────────────────────

document.addEventListener('tour:started', () => {
  lastAutoAlertedIndex = -1
  for (const poi of tour.getPOIs()) {
    if (poi.lat && poi.lon) {
      loadedPOIs.set(poi.id, poi)
      addPOIMarker(poi)
    }
  }
  refreshDrawer()
  updateRouteLine()
})

document.addEventListener('tour:step', e => {
  lastAutoAlertedIndex = -1
  const { poi } = e.detail
  updateRouteLine()
  // Pan map to show both user and next POI
  if (poi?.lat != null && userLatLon) {
    const bounds = L.latLngBounds(
      [userLatLon.lat, userLatLon.lon],
      [poi.lat, poi.lon]
    )
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 })
  } else if (poi?.lat != null) {
    map.setView([poi.lat, poi.lon], 16)
  }
})

document.addEventListener('tour:stopped', () => {
  if (routeLine) { routeLine.remove(); routeLine = null }
})

function updateRouteLine() {
  const poi = tour.getCurrentPOI()
  if (routeLine) { routeLine.remove(); routeLine = null }
  if (!poi?.lat || !userLatLon) return
  routeLine = L.polyline(
    [[userLatLon.lat, userLatLon.lon], [poi.lat, poi.lon]],
    { color: 'var(--accent,#e94560)', weight: 2, dashArray: '6 6', opacity: 0.7 }
  ).addTo(map)
}

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

// ── TBS Guide integration ─────────────────────────────────────────────────────

// When launched from the WP guide-mode template, the parent page posts a config
// object via postMessage. We load the tour from it and wire autosave back to WP.
window.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'TBS_GUIDE_INIT') return
  const cfg = e.data.config
  if (!cfg || !cfg.stops) return

  // Store config so tour.js can reach it for autosave
  window._tbsGuide = cfg

  // Pre-load the tour, then auto-start it centered on stop 1
  setTimeout(() => {
    if (!cfg.stops.length) return
    tour.loadFromWP(cfg.tour_name, cfg.stops)
    tour.autoStart()
    const first = cfg.stops[0]
    if (first?.lat != null && first?.lon != null) {
      map.setView([first.lat, first.lon], 17)
      if (!centered) {
        centered = true
        if (accuracyTimer) { clearTimeout(accuracyTimer); accuracyTimer = null }
        fetchPOIs(first.lat, first.lon)
      }
    }
  }, 100)
})

// ── Service worker ────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/guided-tour/sw.js').catch(() => {})
  })
}
