const card = document.getElementById('flashcard')
const fcName = document.getElementById('fc-name')
const fcType = document.getElementById('fc-type')
const fcDesc = document.getElementById('fc-desc')
const fcOsm = document.getElementById('fc-osm')
const fcOsmNote = document.getElementById('fc-osm-note')
const fcOsmInscription = document.getElementById('fc-osm-inscription')
const fcFacts = document.getElementById('fc-facts')
const fcFactsList = document.getElementById('fc-facts-list')
const fcFaq = document.getElementById('fc-faq')
const fcFaqList = document.getElementById('fc-faq-list')
const fcFaqToggle = document.getElementById('fc-faq-toggle')
const fcWiki = document.getElementById('fc-wiki')
const fcWikiLoading = document.getElementById('fc-wiki-loading')
const fcWikiThumb = document.getElementById('fc-wiki-thumb')
const fcWikiExtract = document.getElementById('fc-wiki-extract')
const fcWikiLink = document.getElementById('fc-wiki-link')
const closeBtn = document.getElementById('flashcard-close')

let faqVisible = false
const wikiCache = new Map()  // keyed by wiki title or `wikidata:QID`

closeBtn.addEventListener('click', hide)
fcFaqToggle.addEventListener('click', () => {
  faqVisible = !faqVisible
  fcFaq.classList.toggle('hidden', !faqVisible)
  fcFaqToggle.textContent = faqVisible ? 'Hide FAQ' : 'Show FAQ'
})

export function show(poi) {
  const t = poi.tags || {}

  fcName.textContent = poi.name
  fcType.textContent = formatType(poi.type)

  // Best available description: explicit desc > OSM description tag > tag-derived
  const desc = poi.desc
    || t.description || t['description:en']
    || descriptionFromTags(t)
  fcDesc.textContent = desc

  // OSM note / inscription (synchronous — shown immediately)
  const note = t.note || t['note:en'] || ''
  const inscription = t.inscription || t['inscription:en'] || ''
  fcOsmNote.textContent = note ? `Note: ${note}` : ''
  fcOsmInscription.textContent = inscription ? `Inscription: ${inscription}` : ''
  fcOsm.classList.toggle('hidden', !note && !inscription)

  // Reset async sections
  fcFacts.classList.add('hidden')
  fcFactsList.innerHTML = ''
  fcWiki.classList.add('hidden')
  fcWikiThumb.classList.add('hidden')
  fcWikiLoading.classList.remove('hidden')

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

  // Kick off async enrichment in parallel
  const qid = t.wikidata
  if (qid) {
    fetchWikidataFacts(qid).then(facts => {
      if (facts && facts.length) {
        fcFactsList.innerHTML = facts
          .map(f => `<li><strong>${f.label}:</strong> ${f.value}</li>`)
          .join('')
        fcFacts.classList.remove('hidden')
      }
    })
  }

  enrichFromWiki(poi).then(summary => {
    fcWikiLoading.classList.add('hidden')
    if (summary && summary.extract) {
      fcWikiExtract.textContent = summary.extract
      fcWikiLink.href = summary.url
      if (summary.thumbnail) {
        fcWikiThumb.src = summary.thumbnail
        fcWikiThumb.classList.remove('hidden')
      }
      fcWiki.classList.remove('hidden')
    }
  })

  card.classList.remove('hidden')
}

export function hide() {
  card.classList.add('hidden')
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────────

async function enrichFromWiki(poi) {
  const title = await resolveWikiTitle(poi)
  if (!title) return null
  if (wikiCache.has(title)) return wikiCache.get(title)
  const summary = await fetchWikiSummary(title)
  wikiCache.set(title, summary)
  return summary
}

async function resolveWikiTitle(poi) {
  const wp = poi.tags?.wikipedia
  if (wp) return wp.includes(':') ? wp.split(':').slice(1).join(':') : wp
  const qid = poi.tags?.wikidata
  if (qid) return resolveWikidataSitelink(qid)
  return null
}

async function resolveWikidataSitelink(qid) {
  try {
    const data = await fetchWikidataEntity(qid)
    return data?.sitelinks?.enwiki ?? null
  } catch {
    return null
  }
}

async function fetchWikiSummary(title) {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    // Use mobile-sections-lead for a fuller lead section than /summary
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/mobile-sections-lead/${encoded}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) {
      // Fallback to summary endpoint
      const res2 = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
        { headers: { Accept: 'application/json' } }
      )
      if (!res2.ok) return null
      const d = await res2.json()
      return {
        extract: d.extract || '',
        thumbnail: d.thumbnail?.source ?? null,
        url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encoded}`,
      }
    }
    const data = await res.json()
    // Strip HTML tags from the lead section text
    const rawHtml = data.sections?.[0]?.text || ''
    const extract = stripHtml(rawHtml).trim().slice(0, 800) || data.description || ''
    const thumbnail = data.image?.urls?.['640'] ?? data.thumb?.url ?? null
    const url = `https://en.wikipedia.org/wiki/${encoded}`
    return { extract, thumbnail, url }
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
  P18:   null,     // image — used for thumbnail fallback, not shown as fact
  P856:  'Website',
  P1082: 'Population',
  P127:  'Owned by',
  P466:  'Occupant',
}

async function fetchWikidataFacts(qid) {
  if (!qid) return null
  const cacheKey = `wikidata:${qid}`
  if (wikiCache.has(cacheKey)) return wikiCache.get(cacheKey)

  try {
    const data = await fetchWikidataEntity(qid)
    if (!data) { wikiCache.set(cacheKey, null); return null }

    const facts = []
    const claims = data.claims || data.statements || {}

    for (const [pid, label] of Object.entries(WIKIDATA_PROPS)) {
      if (!label) continue
      const entries = claims[pid]
      if (!entries || !entries.length) continue
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
    const res = await fetch(
      `https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/${qid}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) { wikiCache.set(cacheKey, null); return null }
    const data = await res.json()
    wikiCache.set(cacheKey, data)
    return data
  } catch {
    wikiCache.set(cacheKey, null)
    return null
  }
}

function extractClaimValue(claim) {
  // Wikidata REST API v0 format
  const sv = claim?.value?.content ?? claim?.mainsnak?.datavalue?.value
  if (sv == null) return null
  if (typeof sv === 'string') return sv
  if (typeof sv === 'number') return String(sv)
  // Time value: {time: '+1882-00-00T00:00:00Z', ...}
  if (sv.time) {
    const m = sv.time.match(/[+-](\d{4})/)
    return m ? m[1] : null
  }
  // Quantity: {amount: '+96', unit: ...}
  if (sv.amount != null) return sv.amount.replace(/^\+/, '') + (sv.unit && sv.unit !== '1' ? '' : '')
  // Entity id reference (e.g. architect is a person entity)
  if (sv.id) return sv.id  // best effort — ideally we'd label-resolve but that's another fetch
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatType(type) {
  return (type || '').replace(/_/g, ' ')
}

function descriptionFromTags(tags = {}) {
  const parts = []
  if (tags.opening_hours) parts.push(`Open: ${tags.opening_hours}`)
  if (tags.website) parts.push(`Website: ${tags.website}`)
  if (tags.phone) parts.push(`Phone: ${tags.phone}`)
  if (tags.wheelchair) parts.push(`Wheelchair: ${tags.wheelchair}`)
  return parts.join(' · ') || ''
}

function buildFAQ(poi) {
  const t = poi.tags || {}
  const faqs = []
  if (poi.type === 'museum' || poi.type === 'gallery')
    faqs.push({ q: 'Is there an admission fee?', a: t.fee || 'Check locally — fees may apply.' })
  if (t.opening_hours)
    faqs.push({ q: 'What are the opening hours?', a: t.opening_hours })
  if (t.wheelchair)
    faqs.push({ q: 'Is it wheelchair accessible?', a: t.wheelchair === 'yes' ? 'Yes' : t.wheelchair === 'no' ? 'No' : 'Limited accessibility.' })
  if (t.website)
    faqs.push({ q: 'Is there a website?', a: t.website })
  return faqs
}
