import { enrichFromWebSearch, reverseGeocode, fetchCommonsImage } from './websearch.js'

const card = document.getElementById('flashcard')
const fcName = document.getElementById('fc-name')
const fcType = document.getElementById('fc-type')
const fcDesc = document.getElementById('fc-desc')
const fcOsm = document.getElementById('fc-osm')
const fcOsmNote = document.getElementById('fc-osm-note')
const fcOsmInscription = document.getElementById('fc-osm-inscription')
const fcBasics = document.getElementById('fc-basics')
const fcBasicsList = document.getElementById('fc-basics-list')
const fcSheet = document.getElementById('fc-sheet')
const fcSheetYear = document.getElementById('fc-sheet-year')
const fcSheetPeople = document.getElementById('fc-sheet-people')
const fcFacts = document.getElementById('fc-facts')
const fcFactsList = document.getElementById('fc-facts-list')
const fcFaq = document.getElementById('fc-faq')
const fcFaqList = document.getElementById('fc-faq-list')
const fcFaqToggle = document.getElementById('fc-faq-toggle')
const fcWiki = document.getElementById('fc-wiki')
const fcWikiLoading = document.getElementById('fc-wiki-loading')
const fcImageWrap = document.getElementById('fc-image-wrap')
const fcWikiThumb = document.getElementById('fc-wiki-thumb')
const fcWikiCredit = document.getElementById('fc-wiki-credit')
const fcWikiExtract = document.getElementById('fc-wiki-extract')
const fcWikiLink = document.getElementById('fc-wiki-link')
const fcWebSearch = document.getElementById('fc-web-search')
const fcWsExtract = document.getElementById('fc-ws-extract')
const fcWsLink = document.getElementById('fc-ws-link')
const fcImgToggle = document.getElementById('fc-img-toggle')
const fcNotesDisplay = document.getElementById('fc-notes-display')
const fcNotesInput = document.getElementById('fc-notes-input')
const fcNotesSave = document.getElementById('fc-notes-save')
const fcNotesClear = document.getElementById('fc-notes-clear')
const closeBtn = document.getElementById('flashcard-close')

const NOTES_KEY = 'guided-tour-notes-v1'

let faqVisible = false
let imageVisible = false
let currentPoiId = null
const wikiCache = new Map()

// ── Notes storage ─────────────────────────────────────────────────────────────

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') } catch { return {} }
}

function saveNotes(notes) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)) } catch {}
}

function getNoteForPoi(id) {
  return loadNotes()[id] || ''
}

function setNoteForPoi(id, text) {
  const notes = loadNotes()
  if (text.trim()) notes[id] = text.trim()
  else delete notes[id]
  saveNotes(notes)
}

// ── Event listeners ───────────────────────────────────────────────────────────

closeBtn.addEventListener('click', hide)

fcFaqToggle.addEventListener('click', () => {
  faqVisible = !faqVisible
  fcFaq.classList.toggle('hidden', !faqVisible)
  fcFaqToggle.textContent = faqVisible ? 'Hide FAQ' : 'Show FAQ'
})

fcImgToggle.addEventListener('click', () => {
  imageVisible = !imageVisible
  fcImageWrap.classList.toggle('hidden', !imageVisible)
  fcImgToggle.classList.toggle('active', imageVisible)
})

fcNotesSave.addEventListener('click', () => {
  if (!currentPoiId) return
  const text = fcNotesInput.value
  setNoteForPoi(currentPoiId, text)
  renderNotes(text.trim())
})

fcNotesClear.addEventListener('click', () => {
  if (!currentPoiId) return
  setNoteForPoi(currentPoiId, '')
  fcNotesInput.value = ''
  renderNotes('')
})

function renderNotes(text) {
  if (text) {
    fcNotesDisplay.textContent = text
    fcNotesDisplay.classList.remove('hidden')
    fcNotesClear.classList.remove('hidden')
    fcNotesInput.value = text
  } else {
    fcNotesDisplay.classList.add('hidden')
    fcNotesClear.classList.add('hidden')
    fcNotesInput.value = ''
  }
}

// ── Show ──────────────────────────────────────────────────────────────────────

export function show(poi) {
  const t = poi.tags || {}
  currentPoiId = poi.id || `${poi.lat},${poi.lon}`

  fcName.textContent = poi.name
  fcType.textContent = formatType(poi.type)

  const desc = poi.desc || t.description || t['description:en'] || descriptionFromTags(t)
  fcDesc.textContent = desc || ''

  if (!desc) {
    const [osmType, osmNumId] = (poi.id || '').split('/')
    const osmUrl = osmNumId ? `https://www.openstreetmap.org/${osmType}/${osmNumId}` : null
    reverseGeocode(poi.lat, poi.lon).then(addr => {
      const parts = []
      if (addr?.road) parts.push(addr.road)
      if (addr?.suburb) parts.push(addr.suburb)
      if (addr?.city) parts.push(addr.city)
      const addrStr = parts.join(', ')
      let html = 'No description available.'
      if (addrStr) html += ` Located at ${addrStr}.`
      if (osmUrl) html += ` <a href="${osmUrl}" target="_blank" rel="noopener">View on OpenStreetMap →</a>`
      fcDesc.innerHTML = html
    })
  }

  const note = t.note || t['note:en'] || ''
  const inscription = t.inscription || t['inscription:en'] || ''
  fcOsmNote.textContent = note ? `Note: ${note}` : ''
  fcOsmInscription.textContent = inscription ? `Inscription: ${inscription}` : ''
  fcOsm.classList.toggle('hidden', !note && !inscription)

  const basics = buildBasicFacts(t)
  if (basics.length) {
    fcBasicsList.innerHTML = basics
      .map(f => `<li><strong>${f.label}:</strong> ${f.value}</li>`)
      .join('')
    fcBasics.classList.remove('hidden')
  } else {
    fcBasics.classList.add('hidden')
  }

  // Reset async sections
  fcSheet.classList.add('hidden')
  fcSheetYear.innerHTML = ''
  fcSheetPeople.innerHTML = ''
  fcFacts.classList.add('hidden')
  fcFactsList.innerHTML = ''
  fcWiki.classList.add('hidden')
  fcWikiLoading.classList.remove('hidden')
  fcWebSearch.classList.add('hidden')
  fcWsExtract.textContent = ''

  // Reset image
  imageVisible = false
  fcImageWrap.classList.add('hidden')
  fcImgToggle.classList.remove('active', 'hidden')
  fcImgToggle.classList.add('hidden')
  fcWikiThumb.src = ''
  fcWikiCredit.textContent = ''
  fcWikiCredit.classList.add('hidden')

  // Notes
  const existingNote = getNoteForPoi(currentPoiId)
  renderNotes(existingNote)

  // FAQ
  const faqs = buildFAQ(poi)
  if (faqs.length) {
    fcFaqList.innerHTML = faqs
      .map(q => `<li><strong>${q.q}</strong><span>${q.a}</span></li>`)
      .join('')
    fcFaqToggle.classList.remove('hidden')
  } else {
    fcFaqToggle.classList.add('hidden')
  }
  faqVisible = false
  fcFaq.classList.add('hidden')
  fcFaqToggle.textContent = 'Show FAQ'

  resolveWikidataByName(poi).then(() => {
    const qid = poi.tags?.wikidata
    if (qid) {
      fetchWikidataFacts(qid).then(facts => {
        if (facts && facts.length) {
          fcFactsList.innerHTML = facts
            .map(f => `<li><strong>${f.label}:</strong> ${f.value}</li>`)
            .join('')
          fcFacts.classList.remove('hidden')
        }
      })

      buildFactSheet(qid).then(sheet => {
        let hasContent = false
        if (sheet.year) {
          fcSheetYear.innerHTML = `<strong>Year:</strong> ${sheet.year}`
          hasContent = true
        }
        if (sheet.people && sheet.people.length) {
          fcSheetPeople.innerHTML = sheet.people.map(p => {
            const datesStr = p.born && p.died
              ? `${p.born}–${p.died}`
              : p.born ? `b. ${p.born}` : p.died ? `d. ${p.died}` : ''
            return `<li>
              <span class="person-name">${p.name}</span>
              <span class="person-role">${p.role}</span>
              ${datesStr ? `<span class="person-dates">${datesStr}</span>` : ''}
            </li>`
          }).join('')
          hasContent = true
        }
        if (hasContent) fcSheet.classList.remove('hidden')
      })
    }

    enrichFromWiki(poi).then(summary => {
      fcWikiLoading.classList.add('hidden')
      if (summary && summary.extract) {
        fcWikiExtract.textContent = summary.extract
        fcWikiLink.href = summary.url
        fcWiki.classList.remove('hidden')
      }
      // Image handling — show toggle button when an image is available
      if (summary?.thumbnail) {
        setThumbImage(summary.thumbnail, null, null)
      } else if (poi.name) {
        fetchCommonsImage(poi.name).then(img => {
          if (img) setThumbImage(img.url, img.credit, img.license)
        })
      }
      return enrichFromWebSearch(poi, fcWikiLink.href)
    }).then(result => {
      if (result) {
        fcWsExtract.textContent = result.extract
        fcWsLink.href = result.url
        fcWebSearch.classList.remove('hidden')
      }
    })
  })

  card.classList.remove('hidden')
}

function setThumbImage(url, credit, license) {
  fcWikiThumb.src = url
  if (credit || license) {
    fcWikiCredit.textContent = [credit, license].filter(Boolean).join(' · ')
    fcWikiCredit.classList.remove('hidden')
  }
  fcImgToggle.classList.remove('hidden')
}

export function hide() {
  card.classList.add('hidden')
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────────

async function resolveWikidataByName(poi) {
  if (poi.tags?.wikidata) return
  const name = poi.name?.trim()
  if (!name) return

  const cacheKey = `name-search:${name}`
  if (wikiCache.has(cacheKey)) {
    const qid = wikiCache.get(cacheKey)
    if (qid) poi.tags.wikidata = qid
    return
  }

  try {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
      `&search=${encodeURIComponent(name)}&language=en&format=json&origin=*`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) { wikiCache.set(cacheKey, null); return }
    const data = await res.json()
    const results = data.search || []
    if (!results.length) { wikiCache.set(cacheKey, null); return }

    const type = (poi.type || '').toLowerCase()
    const notName = r => {
      const desc = (r.description || '').toLowerCase()
      return !desc.includes('given name') && !desc.includes('surname') &&
             !desc.includes('family name') && !desc.includes('disambiguation')
    }
    let best = results.find(r =>
      notName(r) && type && type !== 'poi' && (r.description || '').toLowerCase().includes(type)
    )
    if (!best) best = results.find(notName)
    if (!best?.id) { wikiCache.set(cacheKey, null); return }

    const qid = best.id
    if (poi.lat != null && poi.lon != null) {
      try {
        const entity = await fetchWikidataEntity(qid)
        const coordClaim = entity?.claims?.P625?.[0]
        const coordVal = coordClaim?.mainsnak?.datavalue?.value
        if (coordVal) {
          const dLat = (coordVal.latitude - poi.lat) * Math.PI / 180
          const dLon = (coordVal.longitude - poi.lon) * Math.PI / 180
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(poi.lat * Math.PI / 180) * Math.cos(coordVal.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2
          const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
          if (dist > 50000) { wikiCache.set(cacheKey, null); return }
        }
      } catch {}
    }

    wikiCache.set(cacheKey, qid)
    poi.tags.wikidata = qid
  } catch {
    wikiCache.set(cacheKey, null)
  }
}

async function enrichFromWiki(poi) {
  const result = await resolveWikiTitle(poi)
  if (!result) return null
  const cacheKey = `${result.lang}:${result.title}`
  if (wikiCache.has(cacheKey)) return wikiCache.get(cacheKey)
  const summary = await fetchWikiSummary(result.title, result.lang)
  wikiCache.set(cacheKey, summary)
  return summary
}

async function resolveWikiTitle(poi) {
  const wp = poi.tags?.wikipedia
  if (wp) {
    const title = wp.includes(':') ? wp.split(':').slice(1).join(':') : wp
    const lang = wp.includes(':') ? wp.split(':')[0] : 'en'
    return { title, lang }
  }
  const qid = poi.tags?.wikidata
  if (qid) {
    const result = await resolveWikidataSitelink(qid)
    if (result) return result
  }
  return poi.name?.trim() ? { title: poi.name.trim(), lang: 'en' } : null
}

async function resolveWikidataSitelink(qid) {
  try {
    const entity = await fetchWikidataEntity(qid)
    if (!entity?.sitelinks) return null
    const sl = entity.sitelinks
    const preferred = ['enwiki', 'svwiki', 'dewiki', 'frwiki', 'nowiki', 'dawiki', 'fiwiki']
    for (const key of preferred) {
      if (sl[key]?.title) return { title: sl[key].title, lang: key.replace('wiki', '') }
    }
    const anyWiki = Object.entries(sl).find(([k, v]) => k.endsWith('wiki') && !k.includes('common') && v?.title)
    if (anyWiki) {
      const [key, val] = anyWiki
      return { title: val.title, lang: key.replace('wiki', '') }
    }
    return null
  } catch {
    return null
  }
}

async function fetchWikiSummary(title, lang = 'en') {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const d = await res.json()
    if (d.type === 'disambiguation') return null
    const t = (d.title || '').toLowerCase()
    if (/\((name|given name|surname|forename)\)/.test(t)) return null
    return {
      extract: d.extract || '',
      thumbnail: d.thumbnail?.source ?? null,
      url: d.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encoded}`,
    }
  } catch {
    return null
  }
}

// ── Wikidata facts ────────────────────────────────────────────────────────────

const WIKIDATA_PROPS = {
  P84:   'Architect',
  P571:  'Founded',
  P576:  'Dissolved',
  P149:  'Architectural style',
  P2048: 'Height',
  P18:   null,
  P856:  'Website',
  P1082: 'Population',
  P127:  'Owned by',
  P466:  'Occupant',
}

const PEOPLE_PROPS = {
  P84:  'Architect',
  P112: 'Founder',
  P170: 'Creator',
  P547: 'Commemorates',
  P138: 'Named after',
  P127: 'Owned by',
}

async function fetchPersonDates(qid) {
  const entity = await fetchWikidataEntity(qid)
  if (!entity) return null
  const claims = entity.claims || {}
  const label = entity.labels?.en?.value || null
  const extractYear = entries => entries?.length ? extractClaimValue(entries[0]) : null
  return { name: label, born: extractYear(claims.P569), died: extractYear(claims.P570) }
}

async function buildPeopleSheet(claims) {
  const seen = new Set()
  const tasks = []
  for (const [pid, role] of Object.entries(PEOPLE_PROPS)) {
    const entries = claims[pid]
    if (!entries) continue
    for (const entry of entries) {
      const personQid = entry?.mainsnak?.datavalue?.value?.id
      if (!personQid || seen.has(personQid)) continue
      seen.add(personQid)
      tasks.push({ qid: personQid, role })
    }
  }
  if (!tasks.length) return []
  const results = await Promise.all(
    tasks.map(t => fetchPersonDates(t.qid).then(p => p ? { ...p, role: t.role } : null))
  )
  return results.filter(p => p && p.name)
}

async function buildFactSheet(qid) {
  const entity = await fetchWikidataEntity(qid)
  if (!entity) return { year: null, people: [] }
  const claims = entity.claims || {}
  const yearEntry = claims.P571 || claims.P1319 || null
  const year = yearEntry ? extractClaimValue(yearEntry[0]) : null
  const people = await buildPeopleSheet(claims)
  return { year, people }
}

async function fetchWikidataFacts(qid) {
  if (!qid) return null
  const cacheKey = `wikidata:${qid}`
  if (wikiCache.has(cacheKey)) return wikiCache.get(cacheKey)
  try {
    const data = await fetchWikidataEntity(qid)
    if (!data) { wikiCache.set(cacheKey, null); return null }
    const facts = []
    const claims = data.claims || {}
    for (const [pid, label] of Object.entries(WIKIDATA_PROPS)) {
      if (!label) continue
      const entries = claims[pid]
      if (!entries?.length) continue
      const val = extractClaimValue(entries[0])
      if (val) facts.push({ label, value: val })
    }
    wikiCache.set(cacheKey, facts.length ? facts : null)
    return facts.length ? facts : null
  } catch {
    wikiCache.set(cacheKey, null)
    return null
  }
}

async function fetchWikidataEntity(qid) {
  const cacheKey = `entity:${qid}`
  if (wikiCache.has(cacheKey)) return wikiCache.get(cacheKey)
  try {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}` +
      `&props=claims|sitelinks|labels&languages=en&format=json&origin=*`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) { wikiCache.set(cacheKey, null); return null }
    const data = await res.json()
    const entity = data.entities?.[qid]
    wikiCache.set(cacheKey, entity ?? null)
    return entity ?? null
  } catch {
    wikiCache.set(cacheKey, null)
    return null
  }
}

function extractClaimValue(claim) {
  const sv = claim?.mainsnak?.datavalue?.value
  if (sv == null) return null
  if (typeof sv === 'string') return sv
  if (typeof sv === 'number') return String(sv)
  if (sv.time) {
    const m = sv.time.match(/[+-](\d{4})/)
    return m ? m[1] : null
  }
  if (sv.amount != null) return sv.amount.replace(/^\+/, '')
  if (sv.id) return sv.id
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  attraction:          'Attraction',
  museum:              'Museum',
  artwork:             'Public Artwork',
  viewpoint:           'Viewpoint',
  monument:            'Monument',
  gallery:             'Gallery',
  zoo:                 'Zoo',
  theme_park:          'Theme Park',
  memorial:            'Memorial',
  castle:              'Castle',
  ruins:               'Ruins',
  building:            'Historic Building',
  archaeological_site: 'Archaeological Site',
  church:              'Church',
  place_of_worship:    'Place of Worship',
  library:             'Library',
  theatre:             'Theatre',
  cinema:              'Cinema',
}

function formatType(type) {
  return TYPE_LABELS[type] || (type || '').replace(/_/g, ' ')
}

function descriptionFromTags(tags = {}) {
  const parts = []
  if (tags.opening_hours) parts.push(`Open: ${tags.opening_hours}`)
  if (tags.website) parts.push(`Website: ${tags.website}`)
  if (tags.phone) parts.push(`Phone: ${tags.phone}`)
  if (tags.wheelchair) parts.push(`Wheelchair: ${tags.wheelchair}`)
  return parts.join(' · ') || ''
}

function buildBasicFacts(tags = {}) {
  const facts = []
  const add = (label, value) => { if (value) facts.push({ label, value }) }
  add('Year built',   tags.start_date || tags.year_of_construction || tags.construction_date)
  add('Opened',       tags.opening_date)
  add('Architect',    tags.architect)
  add('Artist',       tags.artist_name)
  add('Operator',     tags.operator)
  add('Denomination', tags.denomination)
  add('Heritage',     tags.heritage_operator || tags['heritage:operator'])
  return facts
}

function buildFAQ(poi) {
  const t = poi.tags || {}
  const faqs = []
  if (poi.type === 'museum' || poi.type === 'gallery')
    faqs.push({ q: 'Is there an admission fee?', a: t.fee || 'Check locally — fees may apply.' })
  if (t.opening_hours)
    faqs.push({ q: 'Opening hours', a: t.opening_hours })
  if (t.wheelchair)
    faqs.push({ q: 'Wheelchair accessible?', a: t.wheelchair === 'yes' ? 'Yes' : t.wheelchair === 'no' ? 'No' : 'Limited.' })
  if (t.website)
    faqs.push({ q: 'Website', a: t.website })
  return faqs
}
