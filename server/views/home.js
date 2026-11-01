'use strict';

// Home page, rendered on the server from the editable site content.

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { icon } = require('./icons');
const { esc, safeUrl, head, bodyOpen, bodyClose, ARROW, ARROW_DOWN, LINK_ARROW } = require('./partials');
const { SERVICES } = require('../constants');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let partials = null;
const getPartials = () => {
  if (!partials || !config.isProd) partials = { scene: read('hero-scene.html'), order: read('order-form.html') };
  return partials;
};

const sectionHead = (num, eyebrow, title, subtitle, id, mod = '') => `
        <header class="section-head${mod}" data-reveal>
          <p class="eyebrow"><span class="eyebrow__num">${String(num).padStart(2, '0')}</span>${esc(eyebrow)}</p>
          <h2 class="section-title" id="${id}">${esc(title)}</h2>
          ${subtitle ? `<p class="section-subtitle">${esc(subtitle)}</p>` : ''}
        </header>`;

function renderHome(c, { origin }) {
  const P = getPartials();
  let n = 0;
  const num = () => ++n;
  const h = c.hero;
  const videoAttrs = [['data-video-mp4', h.videoMp4], ['data-video-webm', h.videoWebm], ['data-video-mobile', h.videoMobile], ['data-poster', h.videoPoster]]
    .map(([k, v]) => [k, safeUrl(v, { allowMailTel: false })]).filter(([, v]) => v)
    .map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

  const projects = c.projects.items.filter((p) => p.published);
  const out = [];

  out.push(head({
    c, origin,
    title: c.seo.title,
    description: c.seo.description,
    canonical: '/',
    ogTitle: c.seo.ogTitle,
    ogDescription: c.seo.ogDescription,
    scripts: ['/assets/js/hero-scene.js', '/assets/js/order-form.js'],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ProfessionalService',
      name: c.brand.name,
      description: c.seo.description,
      url: `${origin}/`,
      ...(c.contacts.email ? { email: c.contacts.email } : {}),
      ...(c.contacts.phone ? { telephone: c.contacts.phone } : {}),
      areaServed: 'Worldwide',
      makesOffer: c.services.items.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title } })),
    },
  }));

  out.push(`${bodyOpen(c, { home: true })}
  <main id="main">
    <section class="hero" id="top" aria-labelledby="hero-title">
      <div class="hero__media" aria-hidden="true"${videoAttrs}>
${P.scene}
      <div class="hero__content container">
        ${h.eyebrow ? `<p class="eyebrow hero__eyebrow" data-hero-in><span class="pulse-dot"></span>${esc(h.eyebrow)}</p>` : ''}
        <h1 class="hero__title" id="hero-title">
          <span class="line" data-hero-in>${esc(h.line1)}</span>
          ${h.line2 ? `<span class="line" data-hero-in>${esc(h.line2)}</span>` : ''}
          ${h.line3 ? `<span class="line line--muted" data-hero-in>${esc(h.line3)}</span>` : ''}
        </h1>
        <p class="hero__subtitle" data-hero-in>${esc(h.subtitle)}</p>
        <div class="hero__actions" data-hero-in>
          <a class="btn btn--primary btn--lg" href="#order" data-order-link><span>${esc(h.primaryCta)}</span>${ARROW}</a>
          ${c.services.enabled && h.secondaryCta ? `<a class="btn btn--ghost btn--lg" href="#services"><span>${esc(h.secondaryCta)}</span>${ARROW_DOWN}</a>` : ''}
        </div>
      </div>
      ${h.scrollHint ? `<a class="scroll-hint" href="${c.services.enabled ? '#services' : '#order'}" aria-label="Прокрутить вниз"><span>${esc(h.scrollHint)}</span><span class="scroll-hint__line" aria-hidden="true"></span><span aria-hidden="true">↓</span></a>` : ''}
    </section>`);

  if (c.marquee.enabled && c.marquee.items.length) {
    const row = c.marquee.items.map((t) => `<span>${esc(t)}</span><i aria-hidden="true">✦</i>`).join('');
    out.push(`
    <div class="marquee" aria-label="Технологии">
      <div class="marquee__track"><div class="marquee__row">${row}</div><div class="marquee__row" aria-hidden="true">${row}</div></div>
    </div>`);
  }

  const blocks = {};

  blocks.services = () => {
    if (!c.services.enabled) return '';
    const s = c.services;
    return (`
    <section class="section" id="services" aria-labelledby="services-title">
      <div class="container">${sectionHead(num(), s.eyebrow, s.title, s.subtitle, 'services-title')}
        <div class="services-grid">
          ${s.items.map((it, i) => `
          <article class="service-card" data-reveal data-spotlight data-tilt-card>
            <div class="service-card__icon" aria-hidden="true">${icon(it.icon)}</div>
            <span class="service-card__index">${String(i + 1).padStart(2, '0')}</span>
            <h3 class="service-card__title">${esc(it.title)}</h3>
            <p class="service-card__text">${esc(it.text)}</p>
            ${it.tags.filter(Boolean).length ? `<ul class="service-card__tags">${it.tags.filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
            ${it.button ? `<button class="btn btn--line" type="button" data-pick-service="${esc(SERVICES[it.service] ? it.service : 'other')}"><span>${esc(it.button)}</span>${ARROW}</button>` : ''}
          </article>`).join('')}
        </div>
      </div>
    </section>`);
  };

  blocks.about = () => {
    if (!c.about.enabled) return '';
    const a = c.about;
    return (`
    <section class="section section--alt" id="about" aria-labelledby="about-title">
      <div class="container about">
        <div class="about__text" data-reveal>
          <p class="eyebrow"><span class="eyebrow__num">${String(num()).padStart(2, '0')}</span>${esc(a.eyebrow)}</p>
          <h2 class="section-title" id="about-title">${esc(a.title)}</h2>
          <p class="section-subtitle">${esc(a.text)}</p>
          ${a.bullets.filter(Boolean).length ? `<ul class="about__list">${a.bullets.filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        </div>
        ${a.stats.length ? `<div class="stats" data-reveal>${a.stats.map((st) => `
          <div class="stat">
            <span class="stat__value"><span data-count="${Number(st.value) || 0}">0</span>${st.suffix ? `<small>${esc(st.suffix)}</small>` : ''}</span>
            <span class="stat__label">${esc(st.label)}</span>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </section>`);
  };

  blocks.process = () => {
    if (!(c.process.enabled && c.process.steps.length)) return '';
    const pr = c.process;
    return (`
    <section class="section" id="process" aria-labelledby="process-title">
      <div class="container">${sectionHead(num(), pr.eyebrow, pr.title, pr.subtitle, 'process-title')}
        <ol class="timeline" data-timeline style="--steps:${pr.steps.length}">
          <li class="timeline__track" aria-hidden="true"><span class="timeline__fill"></span></li>
          ${pr.steps.map((st, i) => `
          <li class="step" data-reveal>
            <span class="step__node"><span>${String(i + 1).padStart(2, '0')}</span></span>
            <h3 class="step__title">${esc(st.title)}</h3>
            <p class="step__text">${esc(st.text)}</p>
          </li>`).join('')}
        </ol>
      </div>
    </section>`);
  };

  blocks.order = () => {
  const o = c.order;
  const orderBody = o.acceptingOrders
    ? P.order.replaceAll('{{MAX_FILES}}', String(config.uploads.maxFiles)).replaceAll('{{MAX_MB}}', String(Math.round(config.uploads.maxTotal / 1048576)))
    : `<div class="order glass order--closed" data-reveal><p class="section-subtitle">${esc(o.closedMessage)}</p>${c.contacts.email ? `<a class="btn btn--primary" href="mailto:${esc(c.contacts.email)}"><span>${esc(c.contacts.email)}</span>${ARROW}</a>` : ''}</div>
      </div>`;
  return (`
    <section class="section section--order" id="order" aria-labelledby="order-title" data-contact-email="${esc(c.contacts.email)}" data-max-files="${config.uploads.maxFiles}" data-max-size="${config.uploads.maxFileSize}" data-max-total="${config.uploads.maxTotal}">
      <div class="container">${sectionHead(num(), o.eyebrow, o.title, o.subtitle, 'order-title', ' section-head--center')}
${orderBody}
    </section>`);
  };

  blocks.projects = () => {
    if (!(c.projects.enabled && projects.length)) return '';
    const pj = c.projects;
    return (`
    <section class="section section--alt" id="projects" aria-labelledby="projects-title">
      <div class="container">
        <header class="section-head section-head--split" data-reveal>
          <div>
            <p class="eyebrow"><span class="eyebrow__num">${String(num()).padStart(2, '0')}</span>${esc(pj.eyebrow)}</p>
            <h2 class="section-title" id="projects-title">${esc(pj.title)}</h2>
          </div>
          ${pj.subtitle ? `<p class="section-subtitle">${esc(pj.subtitle)}</p>` : ''}
        </header>
        <div class="projects-grid">${projects.map(projectCard).join('')}</div>
      </div>
    </section>`);
  };

  blocks.advantages = () => {
    if (!(c.advantages.enabled && c.advantages.items.length)) return '';
    const ad = c.advantages;
    return (`
    <section class="section" id="advantages" aria-labelledby="adv-title">
      <div class="container">${sectionHead(num(), ad.eyebrow, ad.title, '', 'adv-title')}
        <div class="adv-grid">
          ${ad.items.map((it, i) => `
          <article class="adv-card" data-reveal data-spotlight data-tilt-card>
            <span class="adv-card__num">${String(i + 1).padStart(2, '0')}</span>
            ${icon(it.icon, 'adv-card__icon')}
            <h3 class="adv-card__title">${esc(it.title)}</h3>
            <p class="adv-card__text">${esc(it.text)}</p>
          </article>`).join('')}
        </div>
      </div>
    </section>`);
  };

  blocks.faq = () => {
    if (!(c.faq.enabled && c.faq.items.length)) return '';
    const f = c.faq;
    return (`
    <section class="section section--alt" id="faq" aria-labelledby="faq-title">
      <div class="container faq">${sectionHead(num(), f.eyebrow, f.title, f.subtitle, 'faq-title')}
        <div class="accordion" data-accordion data-reveal>
          ${f.items.map((it, i) => `
          <div class="acc">
            <h3 class="acc__head"><button type="button" class="acc__btn" aria-expanded="false" aria-controls="faq-${i + 1}" id="faq-${i + 1}-btn">${esc(it.q)}<span class="acc__icon" aria-hidden="true"></span></button></h3>
            <div class="acc__panel" id="faq-${i + 1}" role="region" aria-labelledby="faq-${i + 1}-btn"><div class="acc__inner"><p>${esc(it.a)}</p></div></div>
          </div>`).join('')}
        </div>
      </div>
    </section>`);
  };

  blocks.cta = () => {
    if (!c.cta.enabled) return '';
    return (`
    <section class="cta" aria-labelledby="cta-title">
      <div class="cta__lines" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="container cta__inner" data-reveal>
        <h2 class="cta__title" id="cta-title">${esc(c.cta.title)}</h2>
        ${c.cta.text ? `<p class="cta__text">${esc(c.cta.text)}</p>` : ''}
        <a class="btn btn--primary btn--lg btn--glow" href="#order" data-order-link><span>${esc(c.cta.button)}</span>${ARROW}</a>
      </div>
    </section>`);
  };

  blocks.pricing = () => {
    const pr = c.pricing;
    if (!(pr.enabled && pr.items.length)) return '';
    return `
    <section class="section" id="pricing" aria-labelledby="pricing-title">
      <div class="container">${sectionHead(num(), pr.eyebrow, pr.title, pr.subtitle, 'pricing-title', ' section-head--center')}
        <div class="price-grid">
          ${pr.items.map((it) => `
          <article class="price-card${it.highlighted ? ' price-card--hl' : ''}" data-reveal data-spotlight data-tilt-card>
            ${it.highlighted ? '<span class="price-card__badge">Популярный выбор</span>' : ''}
            <h3 class="price-card__name">${esc(it.name)}</h3>
            <p class="price-card__price">${esc(it.price)}</p>
            ${it.period ? `<p class="price-card__period">${esc(it.period)}</p>` : ''}
            ${it.features.filter(Boolean).length ? `<ul class="price-card__list">${it.features.filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
            ${it.button ? `<button class="btn ${it.highlighted ? 'btn--primary' : 'btn--ghost'} btn--block" type="button" data-pick-service="${esc(SERVICES[it.service] ? it.service : 'other')}"><span>${esc(it.button)}</span>${ARROW}</button>` : ''}
          </article>`).join('')}
        </div>
      </div>
    </section>`;
  };

  blocks.testimonials = () => {
    const t = c.testimonials;
    if (!(t.enabled && t.items.length)) return '';
    return `
    <section class="section section--alt" id="testimonials" aria-labelledby="testimonials-title">
      <div class="container">${sectionHead(num(), t.eyebrow, t.title, '', 'testimonials-title')}
        <div class="reviews">
          ${t.items.map((it) => {
            const av = safeUrl(it.avatar, { allowMailTel: false });
            const initials = esc(String(it.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
            return `
          <figure class="review" data-reveal data-spotlight>
            ${it.rating ? `<div class="review__stars" aria-label="Оценка ${it.rating} из 5">${'★'.repeat(it.rating)}<span>${'★'.repeat(5 - it.rating)}</span></div>` : ''}
            <blockquote class="review__text">${esc(it.text)}</blockquote>
            <figcaption class="review__author">
              <span class="review__avatar">${av ? `<img src="${esc(av)}" alt="" width="48" height="48" loading="lazy">` : initials}</span>
              <span><b>${esc(it.name)}</b>${it.role ? `<small>${esc(it.role)}</small>` : ''}</span>
            </figcaption>
          </figure>`;
          }).join('')}
        </div>
      </div>
    </section>`;
  };

  for (const id of c.layout.order) if (blocks[id]) out.push(blocks[id]());

  out.push(`
  </main>
${bodyClose(c, { home: true })}`);
  return out.join('\n');
}

function projectCard(p) {
  const img = safeUrl(p.preview, { allowMailTel: false });
  return `
          <article class="project-card" data-reveal data-tilt-card>
            <a class="project-card__media" href="/projects/${esc(p.slug)}" tabindex="-1" aria-hidden="true">
              ${img ? `<img src="${esc(img)}" alt="" width="800" height="560" loading="lazy" decoding="async">` : ''}
              ${p.isDemo ? '<span class="badge">Демо-концепт</span>' : ''}
            </a>
            <div class="project-card__body">
              <p class="project-card__type">${esc(p.type)}</p>
              <h3 class="project-card__title">${esc(p.title)}</h3>
              <p class="project-card__text">${esc(p.summary)}</p>
              <a class="link-arrow" href="/projects/${esc(p.slug)}">Подробнее <span class="sr-only">о проекте ${esc(p.title)}</span>${LINK_ARROW}</a>
            </div>
          </article>`;
}

module.exports = { renderHome, projectCard };
