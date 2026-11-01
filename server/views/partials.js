'use strict';

// Shared page chrome (head, navigation, footer) rendered from editable content.

const { asset } = require('../assets');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only allow harmless URL schemes in admin-edited links/images.
function safeUrl(u, { allowMailTel = true } = {}) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (s.startsWith('#')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (allowMailTel && /^(mailto|tel):/i.test(s)) return s;
  return '';
}
const absUrl = (origin, u) => (u && u.startsWith('/') ? origin + u : u);

const ARROW = '<svg class="btn__arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg class="btn__arrow btn__arrow--down" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v11m-5-4 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LINK_ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SOCIAL_ICONS = {
  telegram: { label: 'Telegram', path: 'M21.5 4.5 2.8 11.7c-.9.4-.9 1.6.1 1.9l4.7 1.5 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.5 4.9 3.6c.6.4 1.4.1 1.6-.6l3.2-15.3c.2-1-.8-1.8-1.8-1.7zM9.6 14.6l8.6-7.4-6.7 8.6-.4 3.3z' },
  github: { label: 'GitHub', path: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z' },
  linkedin: { label: 'LinkedIn', path: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.2c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21h-4z' },
  dribbble: { label: 'Dribbble', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.6 4.6a8.4 8.4 0 0 1 1.9 5.2c-2.7-.5-5.2-.5-7.4 0l-.6-1.4c2.5-1 4.6-2.3 6.1-3.8zM12 3.6c2 0 3.9.7 5.4 2-1.4 1.4-3.3 2.6-5.6 3.5A40 40 0 0 0 8.9 4.2 8.4 8.4 0 0 1 12 3.6zM7.3 5a38 38 0 0 1 3 4.8c-2.6.8-5.4 1.2-6.6 1.2A8.4 8.4 0 0 1 7.3 5zM3.6 12.6c1.8 0 5-.4 7.6-1.4l.6 1.3c-3.2 1.1-5.7 3.2-7.1 5.8a8.4 8.4 0 0 1-1.1-5.7zM12 20.4a8.3 8.3 0 0 1-5.2-1.8c1.2-2.4 3.5-4.4 6.6-5.4a35 35 0 0 1 1.8 6.6c-1 .4-2.1.6-3.2.6zm4.8-1.5a37 37 0 0 0-1.7-6.1c2-.3 4-.2 5.2.1a8.4 8.4 0 0 1-3.5 6z' },
  instagram: { label: 'Instagram', path: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 5.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z' },
  youtube: { label: 'YouTube', path: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z' },
  behance: { label: 'Behance', path: 'M2 6h6.5c2 0 3.5 1 3.5 3 0 1.2-.7 2-1.6 2.4 1.3.3 2.1 1.4 2.1 2.8 0 2.3-1.8 3.8-4.2 3.8H2zm3 2.4v2.5h3c.8 0 1.3-.5 1.3-1.3S8.8 8.4 8 8.4zm0 4.8v2.7h3.3c.9 0 1.5-.5 1.5-1.4s-.6-1.3-1.5-1.3zM15 7h5v1.3h-5zm2.6 2.5c2.7 0 4.2 1.9 4 4.8h-6c.1 1.3.9 2 2.1 2 .9 0 1.5-.4 1.8-1h2c-.5 1.8-2 2.9-3.9 2.9-2.5 0-4.2-1.8-4.2-4.3s1.7-4.4 4.2-4.4zm-2 3.5h3.9c-.1-1.1-.8-1.8-1.9-1.8s-1.8.7-2 1.8z' },
  x: { label: 'X', path: 'M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z' },
  vk: { label: 'VK', path: 'M12.8 18c-6.1 0-9.6-4.2-9.8-11.2h3.1c.1 5.1 2.4 7.3 4.2 7.7V6.8h2.9v4.4c1.8-.2 3.7-2.2 4.3-4.4h2.9c-.5 2.7-2.5 4.7-3.9 5.5 1.4.7 3.7 2.4 4.5 5.7h-3.2c-.7-2.2-2.4-3.9-4.6-4.1V18z' },
  whatsapp: { label: 'WhatsApp', path: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z' },
};

function head({ c, origin, title, description, canonical, ogTitle, ogDescription, ogImage, jsonLd, noindex, scripts = [] }) {
  const url = origin + canonical;
  const img = absUrl(origin, safeUrl(ogImage || c.seo.ogImage) || '/assets/img/og-image.png');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#050505">
  <meta name="color-scheme" content="dark">
  ${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(c.brand.name)}">
  <meta property="og:title" content="${esc(ogTitle || title)}">
  <meta property="og:description" content="${esc(ogDescription || description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(img)}">
  <meta property="og:locale" content="ru_RU">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="${asset('/assets/css/main.css')}">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
  ${['/assets/js/main.js', ...scripts].map((s) => `<script src="${asset(s)}" defer></script>`).join('\n  ')}
  ${c.analytics && (c.analytics.yandexMetrika || c.analytics.googleAnalytics) ? '<script src="/analytics.js" defer></script>' : ''}
</head>`;
}

/* ---------- Page chrome shared by every public page ---------- */
const flag = (b) => (b ? '1' : '0');

function backgroundLayer(c) {
  const d = c.design;
  const img = d.background === 'image' && safeUrl(d.bgImage, { allowMailTel: false });
  const vid = d.background === 'video' && safeUrl(d.bgVideo, { allowMailTel: false });
  const poster = vid && safeUrl(d.bgImage, { allowMailTel: false });
  const aurora = d.background === 'aurora';
  const particles = ['aurora', 'particles'].includes(d.background);
  const grid = ['aurora', 'grid'].includes(d.background);
  return `
  <div class="bgfx" aria-hidden="true">
    ${img ? `<img class="bgfx__media" src="${esc(img)}" alt="" decoding="async">` : ''}
    ${vid ? `<video class="bgfx__media" src="${esc(vid)}"${poster ? ` poster="${esc(poster)}"` : ''} autoplay muted loop playsinline preload="auto"></video>` : ''}
    ${aurora ? '<div class="bgfx__aurora"><i></i><i></i><i></i></div>' : ''}
    ${grid ? '<div class="bgfx__grid"></div>' : ''}
    ${particles ? '<canvas class="bg-particles"></canvas>' : ''}
    ${img || vid ? '<div class="bgfx__dim"></div>' : ''}
    <div class="bgfx__vignette"></div>
  </div>`;
}

function bodyOpen(c, { home = false } = {}) {
  const d = c.design;
  const a = c.announcement;
  const showAnn = a.enabled && a.text;
  const annLink = showAnn && a.link && a.linkLabel ? safeUrl(a.link) : '';
  const attrs = [
    `data-bg="${esc(d.background)}"`,
    `data-fx="${flag(d.animations)}"`,
    `data-hero-fixed="${flag(d.heroFixed)}"`,
    `data-text-reveal="${flag(d.animations && d.textReveal)}"`,
    `data-tilt="${flag(d.animations && d.tilt)}"`,
    `data-cursor="${flag(d.cursor)}"`,
    `style="--c1:${d.color1};--c2:${d.color2};--c3:${d.color3};--bg-dim:${(d.bgDim / 100).toFixed(2)};--marquee-speed:${c.marquee.speed}s"`,
  ];
  return `
<body ${attrs.join(' ')}${showAnn ? ' class="has-announce"' : ''}>
  <a class="skip-link" href="#main">Перейти к содержимому</a>
  ${d.animations && d.preloader && home ? `<div class="preloader" aria-hidden="true"><div class="preloader__inner"><span class="logo__mark"><svg viewBox="0 0 32 32"><path d="M11 9 4 16l7 7M21 9l7 7-7 7M18 6l-4 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="preloader__name">${esc(c.brand.name)}</span><span class="preloader__bar"><i></i></span></div></div>` : ''}
  ${d.scrollProgress ? '<div class="scroll-progress" aria-hidden="true"><i></i></div>' : ''}
  ${backgroundLayer(c)}
  <div class="cursor" aria-hidden="true"><span class="cursor__dot"></span><span class="cursor__ring"></span></div>
  ${showAnn ? `<div class="announce" role="region" aria-label="Объявление"><p><span class="pulse-dot" aria-hidden="true"></span><span>${esc(a.text)}</span>${annLink ? `<a href="${esc(annLink)}"${home && annLink === '#order' ? ' data-order-link' : ''}>${esc(a.linkLabel)} →</a>` : ''}</p><button type="button" class="announce__close" aria-label="Скрыть объявление" data-announce-close>✕</button></div>` : ''}
${nav(c, { home })}`;
}

function floatingContacts(c) {
  if (!c.widgets.floatingContacts) return '';
  const items = [];
  if (c.contacts.telegram) items.push(['telegram', `https://t.me/${encodeURIComponent(c.contacts.telegram)}`, 'Написать в Telegram']);
  const wa = c.socials.find((s) => s.type === 'whatsapp' && safeUrl(s.url, { allowMailTel: false }));
  if (wa) items.push(['whatsapp', safeUrl(wa.url, { allowMailTel: false }), 'Написать в WhatsApp']);
  if (c.contacts.phone) items.push(['phone', `tel:${c.contacts.phone.replace(/[^\d+]/g, '')}`, 'Позвонить']);
  if (!items.length && c.contacts.email) items.push(['mail', `mailto:${c.contacts.email}`, 'Написать на почту']);
  if (!items.length) return '';
  const ico = {
    telegram: `<path d="${SOCIAL_ICONS.telegram.path}"/>`,
    whatsapp: `<path d="${SOCIAL_ICONS.whatsapp.path}"/>`,
    phone: '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
    mail: '<path d="M3 5h18v14H3zm2 2v.5l7 4.5 7-4.5V7zm14 3-7 4.5L5 10v7h14z"/>',
  };
  return `
  <div class="fab" data-fab>
    <div class="fab__list">${items.map(([k, href, label]) => `<a class="fab__item fab__item--${k}" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''} aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${ico[k]}</svg></a>`).join('')}</div>
    <button type="button" class="fab__toggle" aria-expanded="false" aria-label="Связаться с нами"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H7l-3 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
  </div>`;
}

function bodyClose(c, { home = false } = {}) {
  const w = c.widgets;
  return `
${footer(c, { home })}
  ${floatingContacts(c)}
  ${c.design.backToTop ? '<button type="button" class="to-top" aria-label="Наверх" data-to-top><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V5m-5 4 5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : ''}
  ${w.cookieBanner && w.cookieText ? `<div class="cookie" data-cookie hidden role="dialog" aria-label="Cookie"><p>${esc(w.cookieText)} <a href="/privacy">Подробнее</a></p><button type="button" class="btn btn--primary btn--sm" data-cookie-ok><span>Понятно</span></button></div>` : ''}
  <div class="toast" data-toast role="status" aria-live="polite" hidden></div>
</body>
</html>`;
}

const logo = (c, href) => `<a class="logo" href="${href}" aria-label="${esc(c.brand.name)} — на главную"><span class="logo__mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M11 9 4 16l7 7M21 9l7 7-7 7M18 6l-4 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="logo__text">${esc(c.brand.name)}</span></a>`;

function navLinks(c, home) {
  const p = home ? '' : '/';
  const links = [['top', 'Главная', home ? '#top' : '/']];
  if (c.services.enabled) links.push(['services', 'Услуги', `${p}#services`]);
  if (c.projects.enabled && c.projects.items.some((x) => x.published)) links.push(['projects', 'Проекты', `${p}#projects`]);
  if (c.about.enabled) links.push(['about', 'О нас', `${p}#about`]);
  if (c.pricing && c.pricing.enabled && c.pricing.items.length) links.push(['pricing', 'Цены', `${p}#pricing`]);
  links.push(['contacts', 'Контакты', '#contacts']);
  return links;
}

function nav(c, { home = false } = {}) {
  const links = navLinks(c, home);
  const order = home ? '#order' : '/#order';
  return `
  <header class="nav${home ? '' : ' is-scrolled'}" id="nav">
    <div class="nav__inner container">
      ${logo(c, home ? '#top' : '/')}
      <nav class="nav__links" aria-label="Основная навигация">
        ${links.map(([id, label, href]) => `<a href="${href}"${home ? ` data-spy="${id}"` : ''}>${label}</a>`).join('')}
      </nav>
      <div class="nav__actions">
        <a class="btn btn--primary btn--sm nav__cta" href="${order}"${home ? ' data-order-link' : ''}><span>${esc(c.nav.ctaLabel)}</span>${ARROW}</a>
        <button class="burger" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Открыть меню"><span></span><span></span></button>
      </div>
    </div>
  </header>
  <div class="mobile-menu" id="mobile-menu" hidden>
      <nav class="mobile-menu__links" aria-label="Мобильная навигация">
        ${links.map(([, label, href], i) => `<a href="${href}"><span>${String(i + 1).padStart(2, '0')}</span>${label}</a>`).join('')}
      </nav>
      <a class="btn btn--primary btn--block" href="${order}"><span>${esc(c.nav.ctaLabel)}</span>${ARROW}</a>
      <p class="mobile-menu__meta">${esc([c.contacts.email, c.contacts.responseNote].filter(Boolean).join(' · '))}</p>
  </div>`;
}

function socials(c) {
  const items = c.socials.map((s) => ({ ...s, url: safeUrl(s.url, { allowMailTel: false }) })).filter((s) => s.url && SOCIAL_ICONS[s.type]);
  if (!items.length) return '';
  return `<div class="socials">${items.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" aria-label="${SOCIAL_ICONS[s.type].label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SOCIAL_ICONS[s.type].path}"/></svg></a>`).join('')}</div>`;
}

function footer(c, { home = false } = {}) {
  const p = home ? '' : '/';
  const links = navLinks(c, home).filter(([id]) => id !== 'contacts');
  if (c.faq.enabled) links.push(['faq', 'FAQ', `${p}#faq`]);
  const svc = c.services.enabled ? c.services.items : [];
  const tg = c.contacts.telegram;
  return `
  <footer class="footer" id="contacts">
    <div class="container footer__grid">
      <div class="footer__brand">${logo(c, home ? '#top' : '/')}<p>${esc(c.brand.tagline)}</p></div>
      <nav class="footer__col" aria-label="Навигация в подвале">
        <h2 class="footer__title">Навигация</h2>
        ${links.map(([, label, href]) => `<a href="${href}">${label}</a>`).join('')}
      </nav>
      ${svc.length ? `<div class="footer__col"><h2 class="footer__title">Услуги</h2>${svc.map((s) => `<a href="${p}#order"${home ? ` data-pick-service="${esc(s.service)}"` : ''}>${esc(s.title)}</a>`).join('')}</div>` : ''}
      <div class="footer__col">
        <h2 class="footer__title">Контакты</h2>
        ${c.contacts.email ? `<a href="mailto:${esc(c.contacts.email)}">${esc(c.contacts.email)}</a>` : ''}
        ${c.contacts.phone ? `<a href="tel:${esc(c.contacts.phone.replace(/[^\d+]/g, ''))}">${esc(c.contacts.phone)}</a>` : ''}
        ${tg ? `<a href="https://t.me/${esc(encodeURIComponent(tg))}" target="_blank" rel="noopener">Telegram: @${esc(tg)}</a>` : ''}
        <p class="footer__muted">${[c.contacts.hours, c.contacts.note].filter(Boolean).map(esc).join('<br>')}</p>
        ${socials(c)}
      </div>
    </div>
    <div class="container footer__bottom">
      <p>${esc(c.footer.copyright)}</p>
      <nav aria-label="Правовая информация"><a href="/privacy">Политика конфиденциальности</a><a href="/terms">Пользовательское соглашение</a></nav>
    </div>
  </footer>`;
}

module.exports = { esc, safeUrl, absUrl, head, nav, footer, logo, bodyOpen, bodyClose, ARROW, ARROW_DOWN, LINK_ARROW, SOCIAL_ICONS };
