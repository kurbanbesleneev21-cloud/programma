'use strict';

// Server-side rendering for secondary pages (project case studies, legal pages, 404).

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { esc, safeUrl, head, bodyOpen, bodyClose, ARROW } = require('./views/partials');
const { projectCard } = require('./views/home');

function layout(c, { origin, title, description, canonical, body, ogImage, jsonLd, noindex = false }) {
  return `${head({ c, origin, title, description, canonical, ogImage, jsonLd, noindex })}
${bodyOpen(c)}
  <main id="main">
${body}
  </main>
${bodyClose(c)}`;
}

// Shown to visitors while maintenance mode is on (the admin panel keeps working).
function maintenancePage(c, { origin }) {
  const m = c.maintenance;
  return `${head({ c, origin, title: `${m.title} — ${c.brand.name}`, description: m.text, canonical: '/', noindex: true })}
<body data-bg="${esc(c.design.background === 'none' ? 'aurora' : c.design.background)}" data-fx="1" style="--c1:${c.design.color1};--c2:${c.design.color2};--c3:${c.design.color3}">
  <div class="bgfx" aria-hidden="true"><div class="bgfx__aurora"><i></i><i></i><i></i></div><div class="bgfx__grid"></div><div class="bgfx__vignette"></div></div>
  <main class="maintenance">
    <span class="logo__mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M11 9 4 16l7 7M21 9l7 7-7 7M18 6l-4 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <h1 class="page-title">${esc(m.title)}</h1>
    <p class="page-lead">${esc(m.text)}</p>
    <p class="maintenance__links">${c.contacts.email ? `<a class="btn btn--primary" href="mailto:${esc(c.contacts.email)}"><span>${esc(c.contacts.email)}</span></a>` : ''}${c.contacts.telegram ? `<a class="btn btn--ghost" href="https://t.me/${esc(encodeURIComponent(c.contacts.telegram))}" target="_blank" rel="noopener"><span>Telegram</span></a>` : ''}</p>
  </main>
</body>
</html>`;
}

function renderProjectPage(c, p, { origin }) {
  const others = c.projects.items.filter((x) => x.published && x.slug !== p.slug).slice(0, 3);
  const img = safeUrl(p.preview, { allowMailTel: false });
  const body = `
    <section class="page-hero">
      <div class="container">
        <nav class="breadcrumbs" aria-label="Хлебные крошки"><a href="/">Главная</a><span aria-hidden="true">/</span><a href="/#projects">Проекты</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.title)}</span></nav>
        <p class="eyebrow page-eyebrow">${p.year ? `<span class="eyebrow__num">${esc(p.year)}</span>` : ''}${esc(p.type)}</p>
        <h1 class="page-title">${esc(p.title)}</h1>
        <p class="page-lead">${esc(p.summary)}</p>
        ${p.isDemo ? `<p class="demo-note"><span aria-hidden="true">ⓘ</span><span><b>Демонстрационный концепт.</b> Этот проект создан студией как пример подхода к дизайну и архитектуре. Он не является реальным заказом клиента, а названия и данные вымышлены.</span></p>` : ''}
        ${img ? `<figure class="project-cover"><img src="${esc(img)}" alt="Превью проекта ${esc(p.title)}" width="1600" height="1120" decoding="async"></figure>` : ''}
        ${p.metrics.filter((m) => m.value).length ? `<div class="metrics">${p.metrics.filter((m) => m.value).map((m) => `<div><b>${esc(m.value)}</b><span>${esc(m.label)}</span></div>`).join('')}</div>` : ''}
      </div>
    </section>
    <section class="container project-layout">
      <div class="prose">
        ${p.challenge ? `<h2>Задача</h2><p>${esc(p.challenge)}</p>` : ''}
        ${p.solution.filter(Boolean).length ? `<h2>Решение</h2><ul>${p.solution.filter(Boolean).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        <h2>Хотите похожий продукт?</h2>
        <p>Расскажите о своей задаче — мы предложим архитектуру, сроки и смету под ваш бюджет.</p>
        <p class="prose-cta"><a class="btn btn--primary" href="/#order"><span>Обсудить проект</span>${ARROW}</a></p>
      </div>
      <aside class="aside-card" aria-label="Параметры проекта">
        <dl><dt>Тип</dt><dd>${esc(p.type)}</dd></dl>
        ${p.isDemo ? '<dl><dt>Статус</dt><dd>Демонстрационный концепт</dd></dl>' : ''}
        ${p.stack.filter(Boolean).length ? `<dl><dt>Технологии</dt><dd class="stack-tags">${p.stack.filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join('')}</dd></dl>` : ''}
      </aside>
    </section>
    ${others.length ? `<section class="container more-projects" aria-labelledby="more-title">
      <h2 id="more-title">Другие проекты</h2>
      <div class="projects-grid">${others.map(projectCard).join('')}</div>
    </section>` : ''}`;

  return layout(c, {
    origin,
    title: `${p.title} — ${p.type}${p.isDemo ? ' | Демо-концепт' : ''} | ${c.brand.name}`,
    description: p.summary,
    canonical: `/projects/${p.slug}`,
    ogImage: img || undefined,
    body,
    jsonLd: { '@context': 'https://schema.org', '@type': 'CreativeWork', name: p.title, description: p.summary, genre: p.type, creator: { '@type': 'Organization', name: c.brand.name }, keywords: p.stack.join(', ') },
  });
}

const CONTENT_DIR = path.join(__dirname, 'content');
const fileCache = new Map();
function contentPage(c, name, opts) {
  if (!fileCache.has(name) || !config.isProd) fileCache.set(name, fs.readFileSync(path.join(CONTENT_DIR, `${name}.html`), 'utf8'));
  const email = c.contacts.email || 'hello@codeforge.dev';
  const body = fileCache.get(name).replaceAll('hello@codeforge.dev', esc(email)).replaceAll('CODEFORGE', esc(c.brand.name));
  return layout(c, { ...opts, title: opts.title.replaceAll('CODEFORGE', c.brand.name), body });
}

module.exports = { renderProjectPage, contentPage, layout, maintenancePage };
