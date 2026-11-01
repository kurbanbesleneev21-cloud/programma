'use strict';

// Renders a client site built with the site builder (/s/<slug>).

const { esc } = require('./partials');
const { TEMPLATES } = require('../sites');
const { asset } = require('../assets');

const ICON = {
  phone: '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
  telegram: '<path d="M21.5 4.5 2.8 11.7c-.9.4-.9 1.6.1 1.9l4.7 1.5 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.5 4.9 3.6c.6.4 1.4.1 1.6-.6l3.2-15.3c.2-1-.8-1.8-1.8-1.7zM9.6 14.6l8.6-7.4-6.7 8.6-.4 3.3z"/>',
  whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/>',
  mail: '<path d="M3 5h18v14H3zm2 2v.5l7 4.5 7-4.5V7zm14 3-7 4.5L5 10v7h14z"/>',
  instagram: '<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 5.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
  vk: '<path d="M12.8 18c-6.1 0-9.6-4.2-9.8-11.2h3.1c.1 5.1 2.4 7.3 4.2 7.7V6.8h2.9v4.4c1.8-.2 3.7-2.2 4.3-4.4h2.9c-.5 2.7-2.5 4.7-3.9 5.5 1.4.7 3.7 2.4 4.5 5.7h-3.2c-.7-2.2-2.4-3.9-4.6-4.1V18z"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-.8 1.3L11 13V6h2z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

function contactLinks(c) {
  const out = [];
  if (c.phone) out.push(['phone', `tel:${c.phone.replace(/[^\d+]/g, '')}`, c.phone]);
  if (c.whatsapp) out.push(['whatsapp', `https://wa.me/${c.whatsapp.replace(/\D/g, '')}`, 'WhatsApp']);
  if (c.telegram) out.push(['telegram', `https://t.me/${encodeURIComponent(c.telegram)}`, `@${c.telegram}`]);
  if (c.email) out.push(['mail', `mailto:${c.email}`, c.email]);
  if (c.instagram) out.push(['instagram', `https://instagram.com/${encodeURIComponent(c.instagram)}`, 'Instagram']);
  if (c.vk) out.push(['vk', `https://vk.com/${encodeURIComponent(c.vk)}`, 'ВКонтакте']);
  return out;
}
const link = ([k, href, label], cls = 'sx-contact') => `<a class="${cls} ${cls}--${k}" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${svg(k)}<span>${esc(label)}</span></a>`;

function renderSite(site, { origin, brand = 'CODEFORGE', preview = false, canEdit = false } = {}) {
  const d = site.data;
  const t = TEMPLATES[site.template] || TEMPLATES.business;
  const c = d.contacts;
  const links = contactLinks(c);
  const primary = links[0];
  const url = `${origin}/s/${site.slug}`;
  const initials = esc(d.title.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  const ld = {
    '@context': 'https://schema.org',
    '@type': site.template === 'cafe' ? 'Restaurant' : site.template === 'card' ? 'Person' : 'LocalBusiness',
    name: d.title, description: d.tagline, url,
    ...(c.phone ? { telephone: c.phone } : {}), ...(c.email ? { email: c.email } : {}), ...(c.address ? { address: c.address } : {}),
    ...(d.hero || d.logo ? { image: d.hero || d.logo } : {}),
  };

  const items = d.items.length ? `
    <section class="sx-section" id="items">
      <div class="sx-wrap">
        <h2 class="sx-h2" data-sx-reveal>${esc(t.itemsLabel)}</h2>
        <div class="sx-items sx-items--${esc(site.template)}">
          ${d.items.map((it) => `
          <article class="sx-item" data-sx-reveal>
            ${t.itemImages && it.image ? `<img class="sx-item__img" src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" decoding="async">` : ''}
            <div class="sx-item__body">
              <div class="sx-item__top"><h3>${esc(it.title)}</h3>${it.price ? `<span class="sx-price">${esc(it.price)}</span>` : ''}</div>
              ${it.text ? `<p>${esc(it.text)}</p>` : ''}
            </div>
          </article>`).join('')}
        </div>
      </div>
    </section>` : '';

  const about = d.about ? `
    <section class="sx-section sx-section--alt" id="about">
      <div class="sx-wrap sx-about" data-sx-reveal>
        <h2 class="sx-h2">${site.template === 'card' ? 'Обо мне' : 'О нас'}</h2>
        <div class="sx-text">${esc(d.about).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>
      </div>
    </section>` : '';

  const gallery = d.gallery.length ? `
    <section class="sx-section" id="gallery">
      <div class="sx-wrap">
        <h2 class="sx-h2" data-sx-reveal>Фото</h2>
        <div class="sx-gallery">${d.gallery.map((g, i) => `<a href="${esc(g)}" target="_blank" rel="noopener" data-sx-reveal><img src="${esc(g)}" alt="Фото ${i + 1}" loading="lazy" decoding="async"></a>`).join('')}</div>
      </div>
    </section>` : '';

  const contacts = `
    <section class="sx-section sx-section--alt" id="contacts">
      <div class="sx-wrap" data-sx-reveal>
        <h2 class="sx-h2">Контакты</h2>
        <div class="sx-contacts">${links.map((l) => link(l)).join('')}</div>
        ${c.address || c.hours ? `<div class="sx-where">${c.address ? `<p>${svg('pin')}<span>${esc(c.address)}</span></p>` : ''}${c.hours ? `<p>${svg('clock')}<span>${esc(c.hours)}</span></p>` : ''}</div>` : ''}
      </div>
    </section>`;

  const hero = site.template === 'card' ? `
    <header class="sx-hero sx-hero--card">
      <div class="sx-wrap">
        <div class="sx-avatar">${d.hero || d.logo ? `<img src="${esc(d.hero || d.logo)}" alt="${esc(d.title)}">` : `<span>${initials}</span>`}</div>
        <h1 class="sx-h1">${esc(d.title)}</h1>
        <p class="sx-lead">${esc(d.tagline)}</p>
        ${primary ? `<a class="sx-btn" href="${esc(primary[1])}"${primary[1].startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(d.cta)}</a>` : ''}
        <div class="sx-quick">${links.slice(0, 4).map((l) => `<a href="${esc(l[1])}" aria-label="${esc(l[2])}"${l[1].startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${svg(l[0])}</a>`).join('')}</div>
      </div>
    </header>` : `
    <header class="sx-hero${d.hero ? ' sx-hero--img' : ''}">
      ${d.hero ? `<img class="sx-hero__bg" src="${esc(d.hero)}" alt="" decoding="async" fetchpriority="high">` : '<div class="sx-hero__glow" aria-hidden="true"></div>'}
      <div class="sx-wrap sx-hero__inner">
        <h1 class="sx-h1">${esc(d.title)}</h1>
        <p class="sx-lead">${esc(d.tagline)}</p>
        <div class="sx-actions">
          ${primary ? `<a class="sx-btn" href="${esc(primary[1])}"${primary[1].startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(d.cta)}</a>` : ''}
          ${d.items.length ? `<a class="sx-btn sx-btn--ghost" href="#items">${esc(t.itemsLabel)}</a>` : ''}
        </div>
      </div>
    </header>`;

  const order = site.template === 'card' ? [items, about, gallery, contacts]
    : site.template === 'portfolio' ? [items, about, contacts]
      : site.template === 'cafe' ? [items, gallery, about, contacts]
        : [items, about, gallery, contacts];

  return `<!DOCTYPE html>
<html lang="ru" data-theme="${esc(d.style.theme)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(d.title)}${d.tagline ? ` — ${esc(d.tagline.slice(0, 80))}` : ''}</title>
  <meta name="description" content="${esc(d.tagline)}">
  ${preview ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${esc(url)}">`}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(d.title)}">
  <meta property="og:description" content="${esc(d.tagline)}">
  <meta property="og:url" content="${esc(url)}">
  ${d.hero || d.logo ? `<meta property="og:image" content="${esc(d.hero || d.logo)}">` : ''}
  <meta name="theme-color" content="${d.style.theme === 'light' ? '#ffffff' : '#0a0a0a'}">
  ${d.logo ? `<link rel="icon" href="${esc(d.logo)}">` : '<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">'}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="${asset('/assets/css/site.css')}">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
  <script src="${asset('/assets/js/site.js')}" defer></script>
</head>
<body class="sx sx--${esc(site.template)}" style="--accent:${d.style.accent}">
  ${preview ? `<div class="sx-preview" role="status"><b>Предпросмотр.</b> Сайт будет опубликован после оплаты.${canEdit ? ` <a href="/s/${esc(site.slug)}/edit">Редактировать</a>` : ''}</div>` : ''}
  ${canEdit && !preview ? `<a class="sx-editlink" href="/s/${esc(site.slug)}/edit">✎ Редактировать сайт</a>` : ''}
  <nav class="sx-nav"><div class="sx-wrap">
    <a class="sx-brand" href="#top">${d.logo ? `<img src="${esc(d.logo)}" alt="">` : ''}<span>${esc(d.title)}</span></a>
    ${primary ? `<a class="sx-btn sx-btn--sm" href="${esc(primary[1])}"${primary[1].startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(d.cta)}</a>` : ''}
  </div></nav>
  <main id="top">
${hero}
${order.join('\n')}
  </main>
  <footer class="sx-footer"><div class="sx-wrap">
    <span>© ${new Date().getFullYear()} ${esc(d.title)}</span>
    <a href="${esc(origin)}/" target="_blank" rel="noopener">Сайт создан в ${esc(brand)}</a>
  </div></footer>
  ${primary ? `<a class="sx-fab" href="${esc(primary[1])}" aria-label="${esc(d.cta)}"${primary[1].startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${svg(primary[0])}</a>` : ''}
</body>
</html>`;
}

function siteStatusPage({ title, text, origin, brand = 'CODEFORGE' }) {
  return `<!DOCTYPE html><html lang="ru" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="${asset('/assets/css/site.css')}"></head>
<body class="sx" style="--accent:#6d5dfc"><main class="sx-status"><h1 class="sx-h1">${esc(title)}</h1><p class="sx-lead">${esc(text)}</p><a class="sx-btn" href="${esc(origin)}/">${esc(brand)}</a></main></body></html>`;
}

module.exports = { renderSite, siteStatusPage };
