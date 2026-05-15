const card = document.getElementById('flashcard')
const fcName = document.getElementById('fc-name')
const fcType = document.getElementById('fc-type')
const fcDesc = document.getElementById('fc-desc')
const fcFaq = document.getElementById('fc-faq')
const fcFaqList = document.getElementById('fc-faq-list')
const fcFaqToggle = document.getElementById('fc-faq-toggle')
const closeBtn = document.getElementById('flashcard-close')

let faqVisible = false

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
  card.classList.remove('hidden')
}

export function hide() {
  card.classList.add('hidden')
}

function formatType(type) {
  return type.replace(/_/g, ' ')
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
