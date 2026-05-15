const card = document.getElementById('flashcard')
const fcName = document.getElementById('fc-name')
const fcType = document.getElementById('fc-type')
const fcDesc = document.getElementById('fc-desc')
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
const wikiCache = new Map()

closeBtn.addEventListener('click', hide)
fcFaqToggle.addEventListener('click', () => {
  faqVisible = !faqVisible
  fcFaq.classList.toggle('hidden', !faqVisible)
  fcFaqToggle.textContent = faqVisible ? 'Hide FAQ' : 'Show FAQ'
})

export function show(poi) {
  fcName.textContent = poi.name
  fcType.textContent = formatType(poi.type)
  fcDesc.textContent = poi.desc || descriptionFromTags(poi.tags)

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

  // Reset wiki section, kick off async enrichment
  fcWiki.classList.add('hidden')
  fcWikiThumb.classList.add('hidden')
  fcWikiLoading.classList.remove('hidden')

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
    const res = await fetch(
      `https://www.wikidata.org/w/rest.php/wikibase/v0/entities/items/${qid}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.sitelinks?.enwiki ?? null
  } catch {
    return null
  }
}

async function fetchWikiSummary(title) {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'))
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      extract: data.extract || '',
      thumbnail: data.thumbnail?.source ?? null,
      url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encoded}`,
    }
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatType(type) {
  return (type || '').replace(/_/g, ' ')
}

function descriptionFromTags(tags = {}) {
  const parts = []
  if (tags.opening_hours) parts.push(`Open: ${tags.opening_hours}`)
  if (tags.website) parts.push(`Website: ${tags.website}`)
  if (tags.phone) parts.push(`Phone: ${tags.phone}`)
  if (tags.wheelchair) parts.push(`Wheelchair: ${tags.wheelchair}`)
  return parts.join(' · ') || 'No description available.'
}

function buildFAQ(poi) {
  const t = poi.tags || {}
  const faqs = []

  if (poi.type === 'museum' || poi.type === 'gallery')
    faqs.push({ q: 'Is there an admission fee?', a: t.fee ? `${t.fee}` : 'Check locally — fees may apply.' })

  if (t.opening_hours)
    faqs.push({ q: 'What are the opening hours?', a: t.opening_hours })

  if (t.wheelchair)
    faqs.push({ q: 'Is it wheelchair accessible?', a: t.wheelchair === 'yes' ? 'Yes' : t.wheelchair === 'no' ? 'No' : 'Limited accessibility.' })

  if (t.website)
    faqs.push({ q: 'Is there a website?', a: t.website })

  return faqs
}
