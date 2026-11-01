'use strict';

// Site builder wizard (/create) and the client's site editor (/s/<slug>/edit).
// Both are the same form driven by /assets/js/builder.js.

const { esc, head, bodyOpen, bodyClose } = require('./partials');
const { TEMPLATES } = require('../sites');

const PREVIEW = {
  business: '<i class="pv-hero pv-hero--img"></i><i class="pv-row"><b></b><b></b><b></b></i><i class="pv-line"></i>',
  card: '<i class="pv-avatar"></i><i class="pv-line pv-line--c"></i><i class="pv-list"><b></b><b></b><b></b></i>',
  portfolio: '<i class="pv-line"></i><i class="pv-grid"><b></b><b></b><b></b><b></b></i>',
  cafe: '<i class="pv-hero pv-hero--img"></i><i class="pv-list pv-list--price"><b></b><b></b><b></b></i>',
};

function renderBuilder(c, { origin, mode = 'create', slug = '' }) {
  const b = c.builder;
  const edit = mode === 'edit';
  const step = (n, title, body, extra = '') => `
        <section class="bld-step" data-step="${n}"${n === 1 ? '' : ' hidden'}${extra}>
          <h2 class="bld-step__title"><span>${n}</span>${title}</h2>
          ${body}
        </section>`;

  const templates = Object.entries(TEMPLATES).map(([id, t], i) => `
            <label class="bld-tpl">
              <input type="radio" name="template" value="${id}"${i === 0 ? ' checked' : ''}>
              <span class="bld-tpl__pv" aria-hidden="true">${PREVIEW[id]}</span>
              <span class="bld-tpl__name">${esc(t.name)}</span>
              <span class="bld-tpl__desc">${esc(t.desc)}</span>
            </label>`).join('');

  const body = `
  <main id="main" class="bld" data-builder data-mode="${edit ? 'edit' : 'create'}" data-slug="${esc(slug)}" data-origin="${esc(origin)}"
    data-templates='${esc(JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { itemsLabel: t.itemsLabel, itemLabel: t.itemLabel, itemImages: t.itemImages, sample: t.sample }]))))}'>
    <div class="container bld__inner">
      <header class="section-head section-head--center bld__head">
        <p class="eyebrow">${edit ? 'Личный кабинет' : 'Конструктор сайтов'}</p>
        <h1 class="section-title">${esc(edit ? 'Редактирование сайта' : b.title)}</h1>
        <p class="section-subtitle">${esc(edit ? 'Измените тексты, фото и контакты — изменения появятся на сайте сразу после сохранения.' : b.subtitle)}</p>
      </header>

      <div class="bld-state" data-state hidden></div>

      <form class="bld-form glass" data-bld-form novalidate>
        <ol class="bld-progress" aria-hidden="true">${['Шаблон', 'Основное', 'Содержание', 'Фото', 'Контакты'].map((t, i) => `<li data-progress="${i + 1}"${i === 0 ? ' class="is-active"' : ''}><span>${i + 1}</span>${t}</li>`).join('')}</ol>
        <input type="text" name="company_site" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
${step(1, 'Выберите шаблон', `<div class="bld-tpls">${templates}</div>
          <p class="bld-hint">Шаблон можно поменять позже — тексты и фото сохранятся.</p>`)}
${step(2, 'Основное', `
          <div class="bld-field"><label for="b-title">Название или имя *</label><input class="input" id="b-title" name="title" maxlength="120" required placeholder="Например: Кофейня «Зерно»"><p class="bld-err" data-err="title"></p></div>
          <div class="bld-field"><label for="b-tagline">Коротко, чем вы занимаетесь *</label><input class="input" id="b-tagline" name="tagline" maxlength="300" required placeholder="Одно предложение — оно будет крупно на первом экране"><p class="bld-err" data-err="tagline"></p></div>
          ${edit ? '' : `<div class="bld-field"><label for="b-slug">Адрес сайта *</label>
            <div class="bld-slug"><span>${esc(origin.replace(/^https?:\/\//, ''))}/s/</span><input class="input" id="b-slug" name="slug" maxlength="40" required autocapitalize="off" spellcheck="false" placeholder="zerno-coffee"></div>
            <p class="bld-hint" data-slug-status></p><p class="bld-err" data-err="slug"></p></div>`}
          <div class="bld-field"><label for="b-about">О вас / о компании</label><textarea class="input input--area" id="b-about" name="about" rows="5" maxlength="3000" placeholder="Расскажите, почему стоит выбрать вас: опыт, подход, гарантии."></textarea></div>
          <div class="bld-field"><label for="b-cta">Текст главной кнопки</label><input class="input" id="b-cta" name="cta" maxlength="40" placeholder="Записаться"></div>`)}
${step(3, '<span data-items-title>Услуги</span>', `
          <p class="bld-hint">Добавьте позиции — названия, описания и цены. Пустые строки не попадут на сайт.</p>
          <div class="bld-items" data-items></div>
          <button type="button" class="btn btn--ghost btn--sm" data-add-item><span>+ Добавить</span></button>`)}
${step(4, 'Фото', `
          <p class="bld-hint">Можно выбрать прямо из галереи телефона. JPG, PNG или WEBP до 4 МБ каждое.</p>
          <div class="bld-photos">
            <div class="bld-photo" data-photo="logo"><span class="bld-photo__label">Логотип</span><div class="bld-photo__pv"></div><label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" hidden><span>Выбрать</span></label><button type="button" class="bld-x" data-clear hidden aria-label="Убрать">✕</button></div>
            <div class="bld-photo bld-photo--wide" data-photo="hero"><span class="bld-photo__label" data-hero-label>Главное фото</span><div class="bld-photo__pv"></div><label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" hidden><span>Выбрать</span></label><button type="button" class="bld-x" data-clear hidden aria-label="Убрать">✕</button></div>
          </div>
          <div class="bld-field"><span class="bld-label">Галерея (до 12 фото)</span>
            <div class="bld-gallery" data-gallery></div>
            <label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" multiple hidden data-gallery-input><span>+ Добавить фото</span></label>
          </div>
          <div class="bld-upload" data-upload hidden><i></i><span></span></div>`)}
${step(5, 'Контакты и стиль', `
          <div class="bld-grid">
            <div class="bld-field"><label for="b-phone">Телефон</label><input class="input" id="b-phone" name="c.phone" type="tel" inputmode="tel" placeholder="+7 999 123-45-67"></div>
            <div class="bld-field"><label for="b-wa">WhatsApp (номер)</label><input class="input" id="b-wa" name="c.whatsapp" type="tel" inputmode="tel" placeholder="+7 999 123-45-67"></div>
            <div class="bld-field"><label for="b-tg">Telegram</label><input class="input" id="b-tg" name="c.telegram" placeholder="@username"></div>
            <div class="bld-field"><label for="b-email">Email</label><input class="input" id="b-email" name="c.email" type="email" placeholder="hello@mail.ru"></div>
            <div class="bld-field"><label for="b-ig">Instagram</label><input class="input" id="b-ig" name="c.instagram" placeholder="username"></div>
            <div class="bld-field"><label for="b-vk">ВКонтакте</label><input class="input" id="b-vk" name="c.vk" placeholder="club123 или имя"></div>
            <div class="bld-field"><label for="b-addr">Адрес</label><input class="input" id="b-addr" name="c.address" placeholder="Москва, ул. Пушкина, 10"></div>
            <div class="bld-field"><label for="b-hours">Часы работы</label><input class="input" id="b-hours" name="c.hours" placeholder="Ежедневно 9:00–21:00"></div>
          </div>
          <p class="bld-err" data-err="contacts"></p>
          <div class="bld-grid bld-grid--style">
            <div class="bld-field"><span class="bld-label">Тема</span><div class="bld-seg"><label><input type="radio" name="theme" value="dark" checked><span>Тёмная</span></label><label><input type="radio" name="theme" value="light"><span>Светлая</span></label></div></div>
            <div class="bld-field"><span class="bld-label">Фирменный цвет</span><div class="bld-colors">${['#6d5dfc', '#22c55e', '#f97316', '#ef4444', '#0ea5e9', '#d946ef', '#eab308', '#14b8a6'].map((col, i) => `<label style="--c:${col}"><input type="radio" name="accent" value="${col}"${i === 0 ? ' checked' : ''}><span></span></label>`).join('')}<label class="bld-colors__custom" title="Свой цвет"><input type="color" name="accentCustom" value="#6d5dfc"></label></div></div>
          </div>
          ${edit ? '' : `<fieldset class="bld-owner">
            <legend>Ваши данные (для доступа к сайту и связи с вами)</legend>
            <div class="bld-grid">
              <div class="bld-field"><label for="o-name">Имя *</label><input class="input" id="o-name" name="o.name" autocomplete="name" required><p class="bld-err" data-err="owner_name"></p></div>
              <div class="bld-field"><label for="o-email">Email *</label><input class="input" id="o-email" name="o.email" type="email" autocomplete="email" required><p class="bld-err" data-err="owner_email"></p></div>
              <div class="bld-field"><label for="o-phone">Телефон</label><input class="input" id="o-phone" name="o.phone" type="tel" autocomplete="tel"></div>
            </div>
            <label class="bld-check"><input type="checkbox" name="consent" required><span>Согласен с <a href="/terms" target="_blank">условиями</a> и <a href="/privacy" target="_blank">политикой конфиденциальности</a></span></label>
            <p class="bld-err" data-err="consent"></p>
            ${b.priceNote ? `<p class="bld-price">${esc(b.priceNote)}</p>` : ''}
          </fieldset>`}`)}
        <p class="bld-err bld-err--form" data-err="form" role="alert"></p>
        <div class="bld-nav">
          <button type="button" class="btn btn--ghost" data-prev hidden><span>Назад</span></button>
          ${edit ? '<a class="btn btn--ghost" data-view target="_blank" rel="noopener"><span>Мой сайт ↗</span></a>' : ''}
          <button type="button" class="btn btn--primary" data-next><span>Далее</span></button>
          <button type="submit" class="btn btn--primary" data-submit hidden><span class="btn__label">${edit ? 'Сохранить' : 'Создать сайт'}</span><span class="btn__spinner" aria-hidden="true"></span></button>
        </div>
      </form>
    </div>
  </main>`;

  return `${head({
    c, origin,
    title: edit ? `Редактирование сайта — ${c.brand.name}` : `${b.title} — ${c.brand.name}`,
    description: b.subtitle,
    canonical: edit ? `/s/${slug}/edit` : '/create',
    noindex: edit,
    scripts: ['/assets/js/builder.js'],
  })}
${bodyOpen(c)}
${body}
${bodyClose(c)}`;
}

module.exports = { renderBuilder };
