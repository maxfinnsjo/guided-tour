// Tour mode: ordered POI list with localStorage persistence

const LS_KEY = 'guided-tour:tours'

let pois = []
let currentIndex = 0
let active = false
let currentTourName = null
let pickModeHandler = null

const panel = document.getElementById('tour-panel')
const list = document.getElementById('tour-list')
const fileInput = document.getElementById('tour-file')
const startBtn = document.getElementById('tour-start')
const modeLabel = document.getElementById('mode-label')
const nameInput = document.getElementById('tour-name-input')
const saveBtn = document.getElementById('tour-save-btn')
const savedSelect = document.getElementById('tour-saved-select')
const deleteBtn = document.getElementById('tour-delete-btn')
const exportBtn = document.getElementById('tour-export-btn')
const importJson = document.getElementById('tour-import-json')
const addForm = document.getElementById('tour-add-form')
const addName = document.getElementById('add-poi-name')
const addLat = document.getElementById('add-poi-lat')
const addLon = document.getElementById('add-poi-lon')
const addPickBtn = document.getElementById('add-poi-pick')
const addType = document.getElementById('add-poi-type')
const addDesc = document.getElementById('add-poi-desc')
const addWiki = document.getElementById('add-poi-wiki')

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadSavedTours() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}

function saveTours(tours) {
  localStorage.setItem(LS_KEY, JSON.stringify(tours))
}

function saveTourState() {
  if (!currentTourName) return
  const tours = loadSavedTours()
  const idx = tours.findIndex(t => t.name === currentTourName)
  const entry = { name: currentTourName, updatedAt: Date.now(), pois }
  if (idx >= 0) {
    entry.createdAt = tours[idx].createdAt
    tours[idx] = entry
  } else {
    entry.createdAt = Date.now()
    tours.push(entry)
  }
  saveTours(tours)
  refreshSavedSelect()
}

function refreshSavedSelect() {
  const tours = loadSavedTours()
  savedSelect.innerHTML = '<option value="">— open a saved tour —</option>' +
    tours.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('')
  if (currentTourName) savedSelect.value = currentTourName
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function isActive() { return active }
export function getPOIs() { return pois }
export function getCurrentIndex() { return currentIndex }
export function getCurrentPOI() { return pois[currentIndex] ?? null }

export function listSavedTours() { return loadSavedTours() }

export function loadTour(name) {
  const tours = loadSavedTours()
  const found = tours.find(t => t.name === name)
  if (!found) return false
  pois = found.pois
  currentTourName = name
  nameInput.value = name
  renderList()
  enableStart()
  // Notify main.js so markers appear immediately
  pois.forEach(poi =>
    document.dispatchEvent(new CustomEvent('tour:poi-added', { detail: poi }))
  )
  return true
}

export function saveCurrentTour(name) {
  if (!name) return
  currentTourName = name
  saveTourState()
}

export function deleteTour(name) {
  const tours = loadSavedTours().filter(t => t.name !== name)
  saveTours(tours)
  if (currentTourName === name) currentTourName = null
  refreshSavedSelect()
}

export function exportTourJSON() {
  const data = { name: currentTourName || 'tour', pois }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${currentTourName || 'tour'}.json`,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

export function addPOI(poi) {
  pois.push(poi)
  renderList()
  enableStart()
  saveTourState()
  document.dispatchEvent(new CustomEvent('tour:poi-added', { detail: poi }))
}

export function updatePOI(id, patch) {
  const i = pois.findIndex(p => p.id === id)
  if (i < 0) return
  pois[i] = { ...pois[i], ...patch }
  renderList()
  saveTourState()
}

export function removePOI(id) {
  pois = pois.filter(p => p.id !== id)
  renderList()
  saveTourState()
}

export function setPickModeHandler(fn) { pickModeHandler = fn }

export function markVisited(index) {
  const li = list.children[index]
  if (li) li.classList.add('visited')
  if (index === currentIndex) {
    currentIndex = Math.min(currentIndex + 1, pois.length)
    highlightCurrent()
  }
}

export function stop() {
  active = false
  modeLabel.textContent = 'Exploring'
  enableStart()
}

// ── UI event wiring ───────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const name = nameInput.value.trim()
  if (!name) { nameInput.focus(); return }
  saveCurrentTour(name)
})

savedSelect.addEventListener('change', () => {
  const name = savedSelect.value
  if (name) loadTour(name)
})

deleteBtn.addEventListener('click', () => {
  const name = savedSelect.value || currentTourName
  if (!name) return
  if (!confirm(`Delete "${name}"? This can't be undone.`)) return
  deleteTour(name)
  if (currentTourName === null) { pois = []; renderList(); disableStart() }
})

exportBtn.addEventListener('click', exportTourJSON)

importJson.addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    const imported = Array.isArray(data) ? data : data.pois ?? []
    pois = imported.map(normalizeImportedPOI)
    if (data.name && !currentTourName) {
      currentTourName = data.name
      nameInput.value = data.name
    }
    renderList()
    enableStart()
    saveTourState()
    pois.forEach(poi => document.dispatchEvent(new CustomEvent('tour:poi-added', { detail: poi })))
  } catch (err) {
    alert(`Could not import: ${err.message}`)
  }
  importJson.value = ''
})

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  try {
    pois = await parseFile(file)
    renderList()
    enableStart()
    saveTourState()
    pois.forEach(poi => document.dispatchEvent(new CustomEvent('tour:poi-added', { detail: poi })))
  } catch (err) {
    alert(`Could not parse file: ${err.message}`)
  }
})

startBtn.addEventListener('click', () => {
  if (!pois.length) return
  active = true
  currentIndex = 0
  modeLabel.textContent = 'On Tour'
  renderList()
  panel.classList.add('hidden')
  document.dispatchEvent(new CustomEvent('tour:started'))
})

addForm.addEventListener('submit', e => {
  e.preventDefault()
  const name = addName.value.trim()
  if (!name) return
  const lat = parseFloat(addLat.value) || null
  const lon = parseFloat(addLon.value) || null
  const wiki = addWiki.value.trim()
  addPOI({
    id: crypto.randomUUID(),
    name,
    lat,
    lon,
    type: addType.value.trim() || 'poi',
    desc: addDesc.value.trim(),
    tags: wiki ? { wikipedia: wiki } : {},
  })
  addForm.reset()
  document.getElementById('tour-add-section').open = false
})

addPickBtn.addEventListener('click', () => {
  if (!pickModeHandler) return
  panel.classList.add('hidden')
  pickModeHandler((lat, lon) => {
    addLat.value = lat.toFixed(6)
    addLon.value = lon.toFixed(6)
    panel.classList.remove('hidden')
  })
})

// ── Render ────────────────────────────────────────────────────────────────────

function renderList() {
  list.innerHTML = ''
  pois.forEach((p, i) => {
    const li = document.createElement('li')
    li.dataset.index = i
    li.innerHTML = buildPoiRow(p, i)
    li.querySelector('.poi-name-btn').addEventListener('click', () => {
      import('./flashcard.js').then(({ show }) => show(p))
    })
    li.querySelector('.poi-edit-btn').addEventListener('click', e => {
      e.stopPropagation()
      openEditForm(li, p)
    })
    li.querySelector('.poi-remove-btn').addEventListener('click', e => {
      e.stopPropagation()
      removePOI(p.id)
    })
    list.appendChild(li)
  })
  highlightCurrent()
}

function buildPoiRow(p, i) {
  return `
    <span class="poi-name-btn">${escHtml(p.name || p.id)}</span>
    <span class="poi-actions">
      <button class="poi-edit-btn" title="Edit">✏</button>
      <button class="poi-remove-btn danger" title="Remove">✕</button>
    </span>
  `
}

function openEditForm(li, p) {
  li.innerHTML = `
    <form class="poi-edit-form">
      <input class="ef-name" type="text" value="${escHtml(p.name)}" placeholder="Stop name" required />
      <textarea class="ef-desc" rows="2" placeholder="Your notes about this stop">${escHtml(p.desc || '')}</textarea>
      <input class="ef-wiki" type="text" value="${escHtml(p.tags?.wikipedia || '')}" placeholder="Wikipedia page title (optional)" />
      <div class="ef-actions">
        <button type="submit">Save</button>
        <button type="button" class="ef-cancel">Cancel</button>
      </div>
    </form>
  `
  li.querySelector('.poi-edit-form').addEventListener('submit', e => {
    e.preventDefault()
    const name = li.querySelector('.ef-name').value.trim()
    if (!name) return
    const wiki = li.querySelector('.ef-wiki').value.trim()
    updatePOI(p.id, {
      name,
      desc: li.querySelector('.ef-desc').value.trim(),
      tags: { ...p.tags, wikipedia: wiki || undefined },
    })
  })
  li.querySelector('.ef-cancel').addEventListener('click', () => renderList())
}

function highlightCurrent() {
  ;[...list.children].forEach((li, i) => li.classList.toggle('active', i === currentIndex))
}

function enableStart() {
  if (pois.length) {
    startBtn.disabled = false
    startBtn.classList.remove('disabled')
  }
}

function disableStart() {
  startBtn.disabled = true
  startBtn.classList.add('disabled')
}

// ── File parsing ──────────────────────────────────────────────────────────────

async function parseFile(file) {
  const text = await file.text()
  if (file.name.endsWith('.json')) return parseJSON(text)
  return parseCSV(text)
}

function normalizeImportedPOI(item) {
  return {
    id: item.id ?? crypto.randomUUID(),
    name: item.name ?? item.properties?.name ?? '',
    lat: item.lat ?? item.geometry?.coordinates?.[1] ?? null,
    lon: item.lon ?? item.geometry?.coordinates?.[0] ?? null,
    type: item.type ?? item.properties?.type ?? 'poi',
    desc: item.desc ?? item.description ?? item.properties?.description ?? '',
    tags: item.tags ?? {},
  }
}

function parseJSON(text) {
  const data = JSON.parse(text)
  const arr = Array.isArray(data) ? data : data.pois ?? data.features ?? []
  return arr.map(normalizeImportedPOI)
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim())
    const obj = Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
    return {
      id: obj.id ?? crypto.randomUUID(),
      name: obj.name ?? '',
      lat: parseFloat(obj.lat) || null,
      lon: parseFloat(obj.lon) || null,
      type: obj.type ?? 'poi',
      desc: obj.desc ?? obj.description ?? '',
      tags: obj.wikipedia ? { wikipedia: obj.wikipedia } : {},
    }
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────

refreshSavedSelect()

// Auto-load the most recently updated saved tour after main.js listeners are ready
const _saved = loadSavedTours()
if (_saved.length) {
  const _last = _saved.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  setTimeout(() => loadTour(_last.name), 0)
}
