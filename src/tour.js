// Tour mode: ordered list of POIs, tracks progress

let pois = []
let currentIndex = 0
let active = false

const panel = document.getElementById('tour-panel')
const list = document.getElementById('tour-list')
const fileInput = document.getElementById('tour-file')
const startBtn = document.getElementById('tour-start')
const modeLabel = document.getElementById('mode-label')

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  try {
    pois = await parseFile(file)
    renderList()
    startBtn.disabled = false
    startBtn.classList.remove('disabled')
  } catch (err) {
    alert(`Could not parse file: ${err.message}`)
  }
})

startBtn.addEventListener('click', () => {
  if (!pois.length) return
  active = true
  currentIndex = 0
  modeLabel.textContent = 'Tour'
  renderList()
  panel.classList.add('hidden')
})

export function isActive() { return active }
export function getPOIs() { return pois }
export function getCurrentIndex() { return currentIndex }
export function getCurrentPOI() { return pois[currentIndex] ?? null }

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
  pois = []
  currentIndex = 0
  modeLabel.textContent = 'Free Roam'
  startBtn.disabled = true
  startBtn.classList.add('disabled')
  list.innerHTML = ''
  fileInput.value = ''
}

function renderList() {
  list.innerHTML = pois
    .map((p, i) => `<li data-index="${i}">${p.name || p.id}</li>`)
    .join('')
  highlightCurrent()
  ;[...list.children].forEach(li => {
    li.addEventListener('click', () => {
      const idx = Number(li.dataset.index)
      import('./flashcard.js').then(({ show }) => show(pois[idx]))
    })
  })
}

function highlightCurrent() {
  ;[...list.children].forEach((li, i) => li.classList.toggle('active', i === currentIndex))
}

async function parseFile(file) {
  const text = await file.text()
  if (file.name.endsWith('.json')) return parseJSON(text)
  return parseCSV(text)
}

function parseJSON(text) {
  const data = JSON.parse(text)
  const arr = Array.isArray(data) ? data : data.pois ?? data.features ?? []
  return arr.map(item => ({
    id: item.id ?? crypto.randomUUID(),
    name: item.name ?? item.properties?.name ?? '',
    lat: item.lat ?? item.geometry?.coordinates?.[1] ?? null,
    lon: item.lon ?? item.geometry?.coordinates?.[0] ?? null,
    type: item.type ?? item.properties?.type ?? 'poi',
    desc: item.desc ?? item.description ?? item.properties?.description ?? '',
    tags: item.tags ?? {},
  }))
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
      tags: {},
    }
  })
}
