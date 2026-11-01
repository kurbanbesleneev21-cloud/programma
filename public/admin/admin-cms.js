/* CODEFORGE admin — site content management (content, portfolio, media, settings) */
(() => {
  'use strict';

  const A = () => window.ADMIN;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let content = null;   // working copy being edited
  let saved = '';       // JSON of the last saved state
  let defaults = null;
  const root = () => $('[data-cms]');

  /* ---------- Editor schema: what the admin can edit, section by section ---------- */
  const SECTIONS = [
    { id: 'hero', title: 'Главный экран', anchor: '#top', fields: [
      { key: 'hero.eyebrow', label: 'Надпись над заголовком' },
      { key: 'hero.line1', label: 'Заголовок — строка 1' },
      { key: 'hero.line2', label: 'Заголовок — строка 2' },
      { key: 'hero.line3', label: 'Заголовок — строка 3 (серая)' },
      { key: 'hero.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'hero.primaryCta', label: 'Кнопка «заказать»' },
      { key: 'hero.secondaryCta', label: 'Вторая кнопка (пусто — скрыть)' },
      { key: 'hero.scrollHint', label: 'Надпись внизу экрана (пусто — скрыть)' },
      { group: 'Видео на главном экране (необязательно)', hint: 'Видео заменит анимированную сцену программиста. Загрузите его из галереи телефона или вставьте ссылку. Подойдут MP4 и MOV до 50 МБ.' },
      { key: 'hero.videoMp4', label: 'Видео (MP4 / MOV)', type: 'video' },
      { key: 'hero.videoWebm', label: 'Видео WebM (необязательно)', type: 'video' },
      { key: 'hero.videoMobile', label: 'Облегчённое видео для телефонов (необязательно)', type: 'video' },
      { key: 'hero.videoPoster', label: 'Картинка-заставка, пока видео грузится', type: 'image' },
    ] },
    { id: 'services', title: 'Услуги', anchor: '#services', toggle: 'services.enabled', fields: [
      { key: 'services.eyebrow', label: 'Метка раздела' },
      { key: 'services.title', label: 'Заголовок' },
      { key: 'services.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'services.items', label: 'Карточки услуг', type: 'list', itemTitle: (it) => it.title, fields: [
        { key: 'icon', label: 'Иконка', type: 'select', options: () => A().meta().ICONS },
        { key: 'title', label: 'Название' },
        { key: 'text', label: 'Описание', type: 'textarea' },
        { key: 'tags', label: 'Теги (через запятую)', type: 'tags' },
        { key: 'button', label: 'Текст кнопки (пусто — без кнопки)' },
        { key: 'service', label: 'Какую услугу отмечать в форме заказа', type: 'select', options: () => A().meta().SERVICES },
      ] },
    ] },
    { id: 'about', title: 'О нас', anchor: '#about', toggle: 'about.enabled', fields: [
      { key: 'about.eyebrow', label: 'Метка раздела' },
      { key: 'about.title', label: 'Заголовок' },
      { key: 'about.text', label: 'Текст', type: 'textarea' },
      { key: 'about.bullets', label: 'Пункты списка (каждый с новой строки)', type: 'lines' },
      { key: 'about.stats', label: 'Счётчики', type: 'list', itemTitle: (it) => `${it.value}${it.suffix ? ' ' + it.suffix : ''} — ${it.label}`, fields: [
        { key: 'value', label: 'Число', type: 'number' },
        { key: 'suffix', label: 'Единица (ч, %, мес…)' },
        { key: 'label', label: 'Подпись' },
      ] },
    ] },
    { id: 'process', title: 'Как мы работаем', anchor: '#process', toggle: 'process.enabled', fields: [
      { key: 'process.eyebrow', label: 'Метка раздела' },
      { key: 'process.title', label: 'Заголовок' },
      { key: 'process.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'process.steps', label: 'Этапы', type: 'list', itemTitle: (it) => it.title, fields: [
        { key: 'title', label: 'Название этапа' },
        { key: 'text', label: 'Описание', type: 'textarea' },
      ] },
    ] },
    { id: 'order', title: 'Форма заказа', anchor: '#order', fields: [
      { key: 'order.acceptingOrders', label: 'Принимать заявки', type: 'bool', hint: 'Если выключить, вместо формы будет показано сообщение ниже.' },
      { key: 'order.closedMessage', label: 'Сообщение, когда приём закрыт', type: 'textarea' },
      { key: 'order.eyebrow', label: 'Метка раздела' },
      { key: 'order.title', label: 'Заголовок' },
      { key: 'order.subtitle', label: 'Подзаголовок', type: 'textarea' },
    ] },
    { id: 'projects', title: 'Портфолио — тексты', anchor: '#projects', toggle: 'projects.enabled', fields: [
      { key: 'projects.eyebrow', label: 'Метка раздела' },
      { key: 'projects.title', label: 'Заголовок' },
      { key: 'projects.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { group: 'Сами проекты', hint: 'Проекты добавляются и редактируются в разделе «Портфолио» в меню слева.' },
    ] },
    { id: 'advantages', title: 'Преимущества', anchor: '#advantages', toggle: 'advantages.enabled', fields: [
      { key: 'advantages.eyebrow', label: 'Метка раздела' },
      { key: 'advantages.title', label: 'Заголовок' },
      { key: 'advantages.items', label: 'Преимущества', type: 'list', itemTitle: (it) => it.title, fields: [
        { key: 'icon', label: 'Иконка', type: 'select', options: () => A().meta().ICONS },
        { key: 'title', label: 'Заголовок' },
        { key: 'text', label: 'Текст', type: 'textarea' },
      ] },
    ] },
    { id: 'faq', title: 'FAQ', anchor: '#faq', toggle: 'faq.enabled', fields: [
      { key: 'faq.eyebrow', label: 'Метка раздела' },
      { key: 'faq.title', label: 'Заголовок' },
      { key: 'faq.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'faq.items', label: 'Вопросы и ответы', type: 'list', itemTitle: (it) => it.q, fields: [
        { key: 'q', label: 'Вопрос' },
        { key: 'a', label: 'Ответ', type: 'textarea' },
      ] },
    ] },
    { id: 'cta', title: 'Призыв к действию', anchor: '#order', toggle: 'cta.enabled', fields: [
      { key: 'cta.title', label: 'Заголовок', type: 'textarea' },
      { key: 'cta.text', label: 'Текст', type: 'textarea' },
      { key: 'cta.button', label: 'Текст кнопки' },
    ] },
    { id: 'contacts', title: 'Контакты и подвал', anchor: '#contacts', fields: [
      { key: 'brand.name', label: 'Название компании' },
      { key: 'brand.tagline', label: 'Описание компании в подвале', type: 'textarea' },
      { key: 'nav.ctaLabel', label: 'Кнопка в шапке' },
      { key: 'contacts.email', label: 'Электронная почта', type: 'email' },
      { key: 'contacts.phone', label: 'Телефон (необязательно)' },
      { key: 'contacts.telegram', label: 'Telegram (имя пользователя без @)' },
      { key: 'contacts.hours', label: 'Часы работы' },
      { key: 'contacts.note', label: 'Примечание под контактами' },
      { key: 'contacts.responseNote', label: 'Строка в мобильном меню (время ответа)' },
      { key: 'socials', label: 'Социальные сети', type: 'list', itemTitle: (it) => `${(A().meta().SOCIALS || {})[it.type] || it.type}: ${it.url}`, fields: [
        { key: 'type', label: 'Сеть', type: 'select', options: () => A().meta().SOCIALS },
        { key: 'url', label: 'Ссылка', type: 'url' },
      ] },
      { key: 'footer.copyright', label: 'Копирайт' },
    ] },
    { id: 'design', title: '🎨 Дизайн и анимации', fields: [
      { group: 'Фон сайта', hint: 'Фон стоит на месте, а текст и блоки прокручиваются поверх него.' },
      { key: 'design.background', label: 'Тип фона', type: 'select', options: () => ({ aurora: 'Северное сияние + сетка + частицы (анимированный)', particles: 'Звёздные частицы', grid: 'Движущаяся сетка', image: 'Своя картинка', video: 'Своё видео', none: 'Однотонный чёрный' }) },
      { key: 'design.bgImage', label: 'Картинка для фона (и заставка для видео)', type: 'image' },
      { key: 'design.bgVideo', label: 'Видео для фона', type: 'video', hint: 'Короткое зацикленное видео без звука (5–20 сек). На телефоне можно выбрать прямо из галереи.' },
      { key: 'design.bgDim', label: 'Затемнение картинки/видео, %', type: 'range', min: 0, max: 90 },
      { group: 'Цвета подсветки', hint: 'Используются в анимированном фоне, полосе прокрутки, ценах и кнопках.' },
      { key: 'design.color1', label: 'Цвет 1', type: 'color' },
      { key: 'design.color2', label: 'Цвет 2', type: 'color' },
      { key: 'design.color3', label: 'Цвет 3', type: 'color' },
      { group: 'Анимации' },
      { key: 'design.animations', label: 'Анимации на сайте', type: 'bool', hint: 'Главный выключатель: появление блоков, движение фона, переливы.' },
      { key: 'design.heroFixed', label: 'Главный экран стоит на месте, текст уезжает вверх', type: 'bool' },
      { key: 'design.textReveal', label: 'Заголовки появляются по словам', type: 'bool' },
      { key: 'design.tilt', label: '3D-наклон карточек за курсором', type: 'bool' },
      { key: 'design.preloader', label: 'Заставка при загрузке', type: 'bool' },
      { key: 'design.scrollProgress', label: 'Полоса прогресса прокрутки вверху', type: 'bool' },
      { key: 'design.cursor', label: 'Фирменный курсор (на компьютере)', type: 'bool' },
      { key: 'design.backToTop', label: 'Кнопка «Наверх»', type: 'bool' },
    ] },
    { id: 'layout', title: '↕ Порядок разделов', fields: [
      { group: 'Порядок блоков на главной', hint: 'Перетаскивайте стрелками. Скрыть или показать раздел можно в его вкладке.' },
      { key: 'layout.order', label: 'Разделы', type: 'order' },
    ] },
    { id: 'announcement', title: 'Объявление вверху', toggle: 'announcement.enabled', fields: [
      { key: 'announcement.text', label: 'Текст объявления' },
      { key: 'announcement.linkLabel', label: 'Текст ссылки (пусто — без ссылки)' },
      { key: 'announcement.link', label: 'Куда ведёт ссылка', hint: '#order — к форме заказа, или полный адрес https://…' },
    ] },
    { id: 'marquee', title: 'Бегущая строка', toggle: 'marquee.enabled', fields: [
      { key: 'marquee.items', label: 'Слова (каждое с новой строки)', type: 'lines' },
      { key: 'marquee.speed', label: 'Время одного круга, сек (меньше — быстрее)', type: 'range', min: 10, max: 120 },
    ] },
    { id: 'pricing', title: 'Цены', anchor: '#pricing', toggle: 'pricing.enabled', fields: [
      { key: 'pricing.eyebrow', label: 'Метка раздела' },
      { key: 'pricing.title', label: 'Заголовок' },
      { key: 'pricing.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'pricing.items', label: 'Тарифы', type: 'list', itemTitle: (it) => `${it.name} — ${it.price}`, fields: [
        { key: 'name', label: 'Название' },
        { key: 'price', label: 'Цена (например «от 900 €»)' },
        { key: 'period', label: 'Срок' },
        { key: 'features', label: 'Что входит (каждый пункт с новой строки)', type: 'lines' },
        { key: 'button', label: 'Текст кнопки' },
        { key: 'service', label: 'Какую услугу отмечать в форме заказа', type: 'select', options: () => A().meta().SERVICES },
        { key: 'highlighted', label: 'Выделить как популярный', type: 'bool' },
      ] },
    ] },
    { id: 'testimonials', title: 'Отзывы', anchor: '#testimonials', toggle: 'testimonials.enabled', fields: [
      { key: 'testimonials.eyebrow', label: 'Метка раздела' },
      { key: 'testimonials.title', label: 'Заголовок' },
      { key: 'testimonials.items', label: 'Отзывы', type: 'list', itemTitle: (it) => it.name, fields: [
        { key: 'name', label: 'Имя' },
        { key: 'role', label: 'Должность / компания' },
        { key: 'text', label: 'Текст отзыва', type: 'textarea' },
        { key: 'avatar', label: 'Фото', type: 'image' },
        { key: 'rating', label: 'Оценка (0–5 звёзд)', type: 'range', min: 0, max: 5 },
      ] },
    ] },
    { id: 'widgets', title: 'Кнопки и виджеты', fields: [
      { key: 'widgets.floatingContacts', label: 'Плавающая кнопка «Связаться» (Telegram, WhatsApp, телефон)', type: 'bool', hint: 'Берёт контакты из вкладки «Контакты и подвал».' },
      { key: 'widgets.cookieBanner', label: 'Уведомление о cookie', type: 'bool' },
      { key: 'widgets.cookieText', label: 'Текст уведомления о cookie', type: 'textarea' },
    ] },
    { id: 'analytics', title: 'Счётчики и аналитика', fields: [
      { key: 'analytics.yandexMetrika', label: 'Яндекс Метрика — номер счётчика', hint: 'Только цифры, например 98765432.' },
      { key: 'analytics.googleAnalytics', label: 'Google Analytics 4 — Measurement ID', hint: 'Вида G-XXXXXXXXXX.' },
    ] },
    { id: 'maintenance', title: 'Режим обслуживания', fields: [
      { key: 'maintenance.enabled', label: 'Закрыть сайт на обслуживание', type: 'bool', hint: 'Посетители увидят заглушку. Вы (вошедший администратор) продолжите видеть сайт как обычно.' },
      { key: 'maintenance.title', label: 'Заголовок заглушки' },
      { key: 'maintenance.text', label: 'Текст заглушки', type: 'textarea' },
    ] },
    { id: 'builder', title: '🌐 Конструктор сайтов', anchor: 'create', fields: [
      { key: 'builder.enabled', label: 'Конструктор сайтов включён (страница /create)', type: 'bool' },
      { key: 'builder.navLabel', label: 'Пункт в меню сайта (пусто — не показывать)' },
      { key: 'builder.title', label: 'Заголовок страницы конструктора' },
      { key: 'builder.subtitle', label: 'Подзаголовок', type: 'textarea' },
      { key: 'builder.priceNote', label: 'Текст об оплате перед кнопкой «Создать сайт»', type: 'textarea' },
      { key: 'builder.publishImmediately', label: 'Публиковать сайты сразу, без оплаты', type: 'bool', hint: 'Выключено: новый сайт — черновик с плашкой «предпросмотр», вы публикуете его в разделе «Сайты клиентов». После подключения оплаты публикация будет автоматической.' },
      { group: 'Сайты клиентов', link: ['#/sites', 'Открыть список сайтов →'] },
    ] },
    { id: 'seo', title: 'SEO и соцсети', fields: [
      { key: 'seo.title', label: 'Meta Title главной страницы', hint: 'Оптимально 50–60 символов.', counter: 60 },
      { key: 'seo.description', label: 'Meta Description', type: 'textarea', hint: 'Оптимально 140–160 символов.', counter: 160 },
      { key: 'seo.ogTitle', label: 'Заголовок для превью в соцсетях (Open Graph)' },
      { key: 'seo.ogDescription', label: 'Описание для превью в соцсетях', type: 'textarea' },
      { key: 'seo.ogImage', label: 'Картинка превью (1200×630)', type: 'image' },
    ] },
    { id: 'notifications', title: 'Уведомления', fields: [
      { group: 'Telegram', hint: 'Бот подключается в разделе «Интеграции»: вставьте токен — и подключите свой чат по ссылке, по номеру телефона или по Telegram ID.', link: ['#/integrations', 'Открыть «Интеграции» →'] },
      { group: 'Почта' },
      { key: 'notifications.notifyEmail', label: 'E-mail для уведомлений', type: 'email' },
      { key: 'notifications.clientConfirmation', label: 'Отправлять клиенту письмо-подтверждение', type: 'bool' },
    ] },
  ];

  /* ---------- Path helpers ---------- */
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const set = (obj, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], obj)[last] = v; };

  /* ---------- Load / save ---------- */
  async function load(force = false) {
    if (content && !force) return;
    const data = await A().api('/content');
    content = data.content;
    defaults = data.defaults;
    saved = JSON.stringify(content);
  }
  const isDirty = () => content !== null && JSON.stringify(content) !== saved;
  function markDirty() {
    const bar = $('[data-savebar]');
    if (bar) bar.hidden = !isDirty();
  }
  async function save() {
    const btn = $('[data-save]');
    btn && btn.classList.add('is-loading');
    try {
      const data = await A().api('/content', { method: 'PUT', body: { content } });
      content = data.content;
      saved = JSON.stringify(content);
      A().toast('Сохранено. На сайте изменения появятся в течение ~10 секунд');
      rerender();
    } catch (err) { A().fail(err); } finally { btn && btn.classList.remove('is-loading'); markDirty(); }
  }
  function discard() { if (content) content = JSON.parse(saved); }

  let currentHash = '';
  const rerender = () => render(currentHash, { keepScroll: true });

  /* ---------- Generic field renderer ---------- */
  let uid = 0;
  function fieldEl(field, obj, key) {
    const id = `f${++uid}`;
    const wrap = document.createElement('div');
    wrap.className = 'cms-field' + (field.type === 'bool' ? ' cms-field--bool' : '');
    const value = obj[key];
    const label = `<label class="field__label" for="${id}">${esc(field.label)}</label>`;
    const hint = field.hint ? `<p class="cms-hint">${esc(field.hint)}</p>` : '';
    const onChange = (v) => { obj[key] = v; markDirty(); };

    if (field.type === 'bool') {
      wrap.innerHTML = `<label class="switch"><input type="checkbox" id="${id}" ${value ? 'checked' : ''}><span class="switch__track" aria-hidden="true"></span><span>${esc(field.label)}</span></label>${hint}`;
      wrap.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
      return wrap;
    }
    if (field.type === 'select') {
      const opts = field.options() || {};
      wrap.innerHTML = `${label}<select class="input select" id="${id}">${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${hint}`;
      wrap.querySelector('select').addEventListener('change', (e) => onChange(e.target.value));
      return wrap;
    }
    if (field.type === 'textarea' || field.type === 'lines') {
      const v = field.type === 'lines' ? (value || []).join('\n') : value;
      wrap.innerHTML = `${label}<textarea class="input input--area" id="${id}" rows="${field.type === 'lines' ? 4 : 3}">${esc(v)}</textarea>${hint}${field.counter ? `<span class="cms-counter" data-counter></span>` : ''}`;
      const ta = wrap.querySelector('textarea');
      const count = () => { const c = wrap.querySelector('[data-counter]'); if (c) { c.textContent = `${ta.value.length} / ${field.counter}`; c.classList.toggle('is-over', ta.value.length > field.counter); } };
      ta.addEventListener('input', () => { onChange(field.type === 'lines' ? ta.value.split('\n').map((s) => s.trim()).filter(Boolean) : ta.value); count(); });
      count();
      return wrap;
    }
    if (field.type === 'tags') {
      wrap.innerHTML = `${label}<input class="input" id="${id}" value="${esc((value || []).join(', '))}">${hint}`;
      wrap.querySelector('input').addEventListener('input', (e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)));
      return wrap;
    }
    if (field.type === 'image' || field.type === 'video') {
      const kind = field.type;
      const preview = (v) => (!v ? '<span>нет</span>' : kind === 'video' ? `<video src="${esc(v)}" muted playsinline loop autoplay preload="metadata"></video>` : `<img src="${esc(v)}" alt="">`);
      wrap.innerHTML = `${label}<div class="cms-image">
          <div class="cms-image__preview">${preview(value)}</div>
          <div class="cms-image__ctrl"><input class="input" id="${id}" value="${esc(value)}" placeholder="https://… или выберите файл">
          <div class="cms-image__btns">
            <label class="btn btn--primary btn--sm cms-quick-upload"><input type="file" accept="${kind === 'video' ? 'video/*' : 'image/*'}" hidden><span>📱 ${kind === 'video' ? 'Видео из галереи' : 'Фото из галереи'}</span></label>
            <button type="button" class="btn btn--ghost btn--sm" data-pick><span>Медиатека</span></button>
            <button type="button" class="btn btn--ghost btn--sm" data-clear ${value ? '' : 'hidden'}><span>Убрать</span></button>
          </div>
          <div class="cms-progress" hidden><i></i><span></span></div></div>
        </div>${hint}`;
      const input = wrap.querySelector('input.input');
      const clr = wrap.querySelector('[data-clear]');
      const update = (v) => { onChange(v); input.value = v; wrap.querySelector('.cms-image__preview').innerHTML = preview(v); clr.hidden = !v; };
      input.addEventListener('change', () => update(input.value.trim()));
      wrap.querySelector('[data-pick]').addEventListener('click', () => pickMedia(update, kind));
      clr.addEventListener('click', () => update(''));
      wrap.querySelector('.cms-quick-upload input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const bar = wrap.querySelector('.cms-progress');
        try {
          const m = await uploadMedia(file, (pct) => showProgress(bar, pct, file.name));
          update(m.url);
          A().toast('Файл загружен — не забудьте сохранить изменения');
        } catch (err) { A().fail(err); } finally { bar.hidden = true; }
      });
      return wrap;
    }
    if (field.type === 'color') {
      wrap.innerHTML = `${label}<div class="cms-color"><input type="color" id="${id}" value="${esc(value || '#ffffff')}"><input class="input" value="${esc(value)}" maxlength="7" aria-label="${esc(field.label)} — код цвета"></div>${hint}`;
      const [picker, text] = wrap.querySelectorAll('input');
      picker.addEventListener('input', () => { text.value = picker.value; onChange(picker.value); });
      text.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) { picker.value = text.value.trim(); onChange(text.value.trim()); } else text.value = picker.value; });
      return wrap;
    }
    if (field.type === 'range') {
      wrap.innerHTML = `${label}<div class="cms-range"><input type="range" id="${id}" min="${field.min}" max="${field.max}" step="1" value="${Number(value) || 0}"><output>${Number(value) || 0}</output></div>${hint}`;
      const r = wrap.querySelector('input'), out = wrap.querySelector('output');
      r.addEventListener('input', () => { out.textContent = r.value; onChange(Number(r.value)); });
      return wrap;
    }
    if (field.type === 'order') {
      const names = { services: 'Услуги', about: 'О нас', process: 'Как мы работаем', order: 'Форма заказа', projects: 'Портфолио', pricing: 'Цены', testimonials: 'Отзывы', advantages: 'Преимущества', faq: 'FAQ', cta: 'Призыв к действию' };
      const toggles = { services: 'services.enabled', about: 'about.enabled', process: 'process.enabled', projects: 'projects.enabled', pricing: 'pricing.enabled', testimonials: 'testimonials.enabled', advantages: 'advantages.enabled', faq: 'faq.enabled', cta: 'cta.enabled' };
      const arr = value;
      const draw = () => {
        wrap.innerHTML = `<ol class="cms-order">${arr.map((sid, i) => {
          const on = !toggles[sid] || get(content, toggles[sid]);
          return `<li class="${on ? '' : 'is-off'}"><span class="cms-item__num">${i + 1}</span><span class="cms-order__name">${esc(names[sid] || sid)}</span>
            <label class="switch switch--sm" title="Показывать">${toggles[sid] ? `<input type="checkbox" data-toggle="${sid}" ${on ? 'checked' : ''}><span class="switch__track" aria-hidden="true"></span>` : '<span class="cms-muted">всегда</span>'}</label>
            <span class="cms-item__tools"><button type="button" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button><button type="button" data-mv="${i}:1" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button></span></li>`;
        }).join('')}</ol>`;
        wrap.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
          const [i, d] = b.dataset.mv.split(':').map(Number);
          [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
          markDirty(); draw();
        }));
        wrap.querySelectorAll('[data-toggle]').forEach((cb) => cb.addEventListener('change', () => { set(content, toggles[cb.dataset.toggle], cb.checked); markDirty(); draw(); }));
      };
      draw();
      return wrap;
    }
    const type = field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text';
    wrap.innerHTML = `${label}<input class="input" id="${id}" type="${type}" value="${esc(value)}">${hint}${field.counter ? `<span class="cms-counter" data-counter></span>` : ''}`;
    const inp = wrap.querySelector('input');
    const count = () => { const c = wrap.querySelector('[data-counter]'); if (c) { c.textContent = `${inp.value.length} / ${field.counter}`; c.classList.toggle('is-over', inp.value.length > field.counter); } };
    inp.addEventListener('input', () => { onChange(type === 'number' ? Number(inp.value) : inp.value); count(); });
    count();
    return wrap;
  }

  function emptyLike(tpl) {
    if (Array.isArray(tpl)) return [];
    if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, emptyLike(v)]));
    if (typeof tpl === 'boolean') return tpl;
    if (typeof tpl === 'number') return 0;
    return '';
  }

  function listEl(field, arr, defaultsArr) {
    const wrap = document.createElement('div');
    wrap.className = 'cms-list';
    const draw = () => {
      wrap.innerHTML = `<div class="cms-list__head"><span class="field__label">${esc(field.label)} <span class="cms-muted">(${arr.length})</span></span></div>`;
      arr.forEach((item, i) => {
        const card = document.createElement('details');
        card.className = 'cms-item';
        if (item.__open) card.open = true;
        card.innerHTML = `<summary><span class="cms-item__num">${i + 1}</span><span class="cms-item__title">${esc(field.itemTitle ? field.itemTitle(item) : `Элемент ${i + 1}`) || '<i>без названия</i>'}</span>
          <span class="cms-item__tools">
            <button type="button" data-up ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
            <button type="button" data-down ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
            <button type="button" data-del aria-label="Удалить">✕</button>
          </span></summary><div class="cms-item__body"></div>`;
        const body = card.querySelector('.cms-item__body');
        field.fields.forEach((f) => body.append(fieldEl(f, item, f.key)));
        card.addEventListener('toggle', () => { Object.defineProperty(item, '__open', { value: card.open, enumerable: false, configurable: true, writable: true }); });
        card.querySelector('[data-up]').addEventListener('click', (e) => { e.preventDefault(); [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); draw(); });
        card.querySelector('[data-down]').addEventListener('click', (e) => { e.preventDefault(); [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; markDirty(); draw(); });
        card.querySelector('[data-del]').addEventListener('click', (e) => { e.preventDefault(); if (confirm('Удалить этот элемент?')) { arr.splice(i, 1); markDirty(); draw(); } });
        body.addEventListener('input', () => { const t = card.querySelector('.cms-item__title'); if (field.itemTitle) t.textContent = field.itemTitle(item) || 'без названия'; });
        wrap.append(card);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn--ghost btn--sm cms-add';
      add.innerHTML = '<span>+ Добавить</span>';
      add.addEventListener('click', () => {
        const item = emptyLike((defaultsArr && defaultsArr[0]) || {});
        Object.defineProperty(item, '__open', { value: true, enumerable: false, configurable: true, writable: true });
        if ('icon' in item && !item.icon) item.icon = 'code';
        if ('service' in item && !item.service) item.service = 'other';
        if ('type' in item && !item.type && field.key === 'socials') item.type = 'telegram';
        arr.push(item); markDirty(); draw();
      });
      wrap.append(add);
    };
    draw();
    return wrap;
  }

  function renderFields(container, fields) {
    for (const f of fields) {
      if (f.group) {
        const g = document.createElement('div');
        g.className = 'cms-group';
        g.innerHTML = `<h3>${esc(f.group)}</h3>${f.hint ? `<p class="cms-hint">${esc(f.hint)}</p>` : ''}${f.link ? `<a class="btn btn--ghost btn--sm" href="${esc(f.link[0])}"><span>${esc(f.link[1])}</span></a>` : ''}`;
        container.append(g);
        continue;
      }
      if (f.type === 'list') { container.append(listEl(f, get(content, f.key), get(defaults, f.key))); continue; }
      const ks = f.key.split('.');
      const last = ks.pop();
      container.append(fieldEl(f, ks.length ? get(content, ks.join('.')) : content, last));
    }
  }

  const saveBar = () => `
    <div class="cms-savebar" data-savebar hidden>
      <span>Есть несохранённые изменения</span>
      <button type="button" class="btn btn--ghost btn--sm" data-discard><span>Отменить</span></button>
      <button type="button" class="btn btn--primary btn--sm" data-save><span class="btn__label">Сохранить</span><span class="btn__spinner" aria-hidden="true"></span></button>
    </div>`;
  function bindSaveBar() {
    $('[data-save]').addEventListener('click', save);
    $('[data-discard]').addEventListener('click', () => { discard(); rerender(); markDirty(); });
    markDirty();
  }

  /* ---------- Pages ---------- */
  function contentPage(sectionId) {
    const sec = SECTIONS.find((s) => s.id === sectionId) || SECTIONS[0];
    const r = root();
    r.innerHTML = `
      <header class="ws-head"><div><p class="eyebrow">Контент сайта</p><h1 class="ws-title">${esc(sec.title)}</h1></div>
        <a class="btn btn--ghost btn--sm" href="/${sec.anchor || ''}" target="_blank" rel="noopener"><span>Открыть на сайте ↗</span></a></header>
      <div class="cms-layout">
        <nav class="cms-tabs" aria-label="Разделы сайта">${SECTIONS.map((s) => `<a href="#/content/${s.id}" class="${s.id === sec.id ? 'is-active' : ''}">${esc(s.title)}${s.toggle && !get(content, s.toggle) ? ' <span class="cms-off">скрыт</span>' : ''}</a>`).join('')}</nav>
        <div class="cms-panel panel-card" data-fields></div>
      </div>${saveBar()}`;
    const box = $('[data-fields]', r);
    if (sec.toggle) renderFields(box, [{ key: sec.toggle, label: 'Показывать этот раздел на сайте', type: 'bool' }]);
    renderFields(box, sec.fields);
    bindSaveBar();
  }

  const PROJECT_FIELDS = [
    { key: 'published', label: 'Опубликован на сайте', type: 'bool' },
    { key: 'isDemo', label: 'Пометка «Демо-концепт»', type: 'bool', hint: 'Включайте для примеров, которые не являются реальными заказами клиентов.' },
    { key: 'title', label: 'Название' },
    { key: 'slug', label: 'Адрес страницы (/projects/…)', hint: 'Латиница, цифры и дефисы. Если оставить пустым — создастся из названия.' },
    { key: 'type', label: 'Тип разработки' },
    { key: 'year', label: 'Год' },
    { key: 'summary', label: 'Краткое описание (в карточке)', type: 'textarea' },
    { key: 'preview', label: 'Изображение / превью', type: 'image' },
    { key: 'challenge', label: 'Задача', type: 'textarea' },
    { key: 'solution', label: 'Решение — пункты (каждый с новой строки)', type: 'lines' },
    { key: 'stack', label: 'Технологии (через запятую)', type: 'tags' },
  ];

  function projectsPage(editIndex) {
    const items = content.projects.items;
    const r = root();
    if (editIndex !== null && items[editIndex]) {
      const p = items[editIndex];
      r.innerHTML = `
        <a class="back-link" href="#/projects">← Все проекты</a>
        <header class="ws-head"><div><p class="eyebrow">Портфолио</p><h1 class="ws-title">${esc(p.title || 'Новый проект')}</h1></div>
          ${p.slug && saved.includes(`"slug":"${p.slug}"`) ? `<a class="btn btn--ghost btn--sm" href="/projects/${esc(p.slug)}" target="_blank" rel="noopener"><span>Страница проекта ↗</span></a>` : ''}</header>
        <div class="panel-card cms-panel" data-fields></div>${saveBar()}`;
      const box = $('[data-fields]', r);
      PROJECT_FIELDS.forEach((f) => box.append(fieldEl(f, p, f.key)));
      box.append(listEl({ key: 'metrics', label: 'Показатели (до 3 на странице)', itemTitle: (m) => `${m.value} — ${m.label}`, fields: [{ key: 'value', label: 'Значение' }, { key: 'label', label: 'Подпись' }] }, p.metrics, defaults.projects.items[0].metrics));
      bindSaveBar();
      return;
    }
    r.innerHTML = `
      <header class="ws-head"><div><p class="eyebrow">Портфолио</p><h1 class="ws-title">Проекты</h1></div>
        <button type="button" class="btn btn--primary btn--sm" data-add><span>+ Новый проект</span></button></header>
      <div class="cms-projects">${items.map((p, i) => `
        <article class="cms-project panel-card">
          <div class="cms-project__img">${p.preview ? `<img src="${esc(p.preview)}" alt="">` : ''}</div>
          <div class="cms-project__body">
            <p class="cms-muted">${esc(p.type)}${p.isDemo ? ' · демо' : ''}</p>
            <h3>${esc(p.title || 'Без названия')}</h3>
            <span class="status ${p.published ? 'status--in_progress' : 'status--off'}">${p.published ? 'Опубликован' : 'Скрыт'}</span>
          </div>
          <div class="cms-project__tools">
            <a class="btn btn--ghost btn--sm" href="#/projects/${i}"><span>Редактировать</span></a>
            <button type="button" data-move="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
            <button type="button" data-move="${i}:1" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
            <button type="button" data-del="${i}" aria-label="Удалить">✕</button>
          </div>
        </article>`).join('') || '<p class="empty">Проектов пока нет.</p>'}</div>${saveBar()}`;
    r.querySelector('[data-add]').addEventListener('click', () => {
      const p = emptyLike(defaults.projects.items[0]);
      Object.assign(p, { published: false, isDemo: false, year: String(new Date().getFullYear()), metrics: [] });
      items.unshift(p);
      markDirty();
      location.hash = '#/projects/0';
    });
    r.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.dataset.move.split(':').map(Number);
      [items[i], items[i + d]] = [items[i + d], items[i]];
      markDirty(); projectsPage(null);
    }));
    r.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.del);
      if (confirm(`Удалить проект «${items[i].title}»? Изменение применится после сохранения.`)) { items.splice(i, 1); markDirty(); projectsPage(null); }
    }));
    bindSaveBar();
  }

  /* ---------- Media: photos & videos from the phone gallery or computer ---------- */
  const isVideo = (m) => /^video\//.test(m.mime || '') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(m.url || '');
  const fmtMb = (b) => `${Math.round(b / 1048576)} МБ`;

  // XHR instead of fetch: upload progress events.
  function xhr(method, url, body, onProgress, headers = {}) {
    return new Promise((resolve, reject) => {
      const r = new XMLHttpRequest();
      r.open(method, url);
      for (const [k, v] of Object.entries(headers)) r.setRequestHeader(k, v);
      r.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      r.onload = () => {
        let data = {};
        try { data = JSON.parse(r.responseText || '{}'); } catch { /* not json */ }
        if (r.status >= 200 && r.status < 300) resolve(data);
        else reject(new Error(data.error || data.message || `Ошибка загрузки (${r.status})`));
      };
      r.onerror = () => reject(new Error('Нет соединения. Проверьте интернет и попробуйте снова.'));
      r.send(body);
    });
  }

  async function uploadMedia(file, onProgress) {
    const env = A().meta().environment || {};
    const limits = env.mediaLimits || { image: 15728640, video: 52428800 };
    const video = /^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    const max = video ? limits.video : limits.image;
    if (file.size > max) throw new Error(`«${file.name}» больше ${fmtMb(max)}. Сожмите файл и попробуйте снова.`);
    // Small files go through the server; big ones straight to Supabase Storage.
    const viaServer = !env.directUpload || file.size <= (env.maxUpload || 4194304) * 0.9;
    if (!viaServer) {
      const sign = await A().api('/media/sign', { method: 'POST', body: { name: file.name, size: file.size, type: file.type } });
      if (sign.direct) {
        const fd = new FormData();
        fd.append('cacheControl', '31536000');
        fd.append('', file, file.name);
        await xhr('PUT', sign.uploadUrl, fd, onProgress, { 'x-upsert': 'false' });
        return A().api('/media/complete', { method: 'POST', body: { path: sign.path, name: file.name } });
      }
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    return xhr('POST', '/api/admin/media', fd, onProgress);
  }

  function showProgress(bar, pct, name) {
    bar.hidden = false;
    bar.querySelector('i').style.width = `${pct}%`;
    bar.querySelector('span').textContent = `${name} — ${pct}%`;
  }

  async function mediaGrid(container, { onPick, kind } = {}) {
    container.innerHTML = '<p class="cms-muted">Загрузка…</p>';
    let items;
    try { items = (await A().api('/media')).items; } catch (err) { container.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const env = A().meta().environment || {};
    const limits = env.mediaLimits || { image: 15728640, video: 52428800 };
    let filter = kind || 'all';
    const accept = kind === 'video' ? 'video/*' : kind === 'image' ? 'image/*' : 'image/*,video/*';
    container.innerHTML = `
      <label class="cms-upload">
        <input type="file" accept="${accept}" multiple>
        <span class="cms-upload__icon" aria-hidden="true">⬆</span>
        <span><b>${kind === 'video' ? 'Загрузить видео' : kind === 'image' ? 'Загрузить фото' : 'Загрузить фото или видео'}</b> — с телефона откроется галерея.<br>
        <small>Фото JPG, PNG, WEBP, GIF до ${fmtMb(limits.image)} · Видео MP4, MOV, WEBM до ${fmtMb(limits.video)}</small></span>
      </label>
      <div class="cms-progress" hidden><i></i><span></span></div>
      ${kind ? '' : `<div class="cms-filter" role="tablist">${[['all', 'Все'], ['image', 'Фото'], ['video', 'Видео']].map(([k, l]) => `<button type="button" data-filter="${k}" class="${k === filter ? 'is-active' : ''}">${l}</button>`).join('')}</div>`}
      <div class="cms-media" data-items></div>`;
    const list = container.querySelector('[data-items]');
    const draw = () => {
      const shown = items.filter((m) => filter === 'all' || (filter === 'video' ? isVideo(m) : !isVideo(m)));
      list.innerHTML = shown.map((m) => `
        <figure class="cms-media__item" data-id="${m.id}">
          ${isVideo(m) ? `<video src="${esc(m.url)}" muted playsinline preload="metadata"></video><span class="cms-media__badge">видео</span>` : `<img src="${esc(m.url)}" alt="" loading="lazy">`}
          <figcaption title="${esc(m.original_name)}">${esc(m.original_name)} <small>${A().fmtSize(m.size)}</small></figcaption>
          <div class="cms-media__tools">
            ${onPick ? `<button type="button" class="btn btn--primary btn--sm" data-use="${esc(m.url)}"><span>Выбрать</span></button>` : `<button type="button" class="btn btn--ghost btn--sm" data-copy="${esc(m.url)}"><span>Ссылка</span></button>`}
            ${onPick ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-remove="${m.id}"><span>Удалить</span></button>`}
          </div>
        </figure>`).join('') || `<p class="empty">${filter === 'video' ? 'Видео пока нет.' : filter === 'image' ? 'Фото пока нет.' : 'Пока ничего не загружено.'}</p>`;
      list.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.use)));
      list.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
        const url = new URL(b.dataset.copy, location.origin).href;
        try { await navigator.clipboard.writeText(url); A().toast('Ссылка скопирована'); } catch { prompt('Ссылка:', url); }
      }));
      list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Удалить файл? Если он используется на сайте, там он перестанет отображаться.')) return;
        try { await A().api(`/media/${b.dataset.remove}`, { method: 'DELETE' }); items = items.filter((m) => String(m.id) !== b.dataset.remove); draw(); } catch (err) { A().fail(err); }
      }));
      list.querySelectorAll('video').forEach((v) => {
        v.addEventListener('mouseenter', () => v.play().catch(() => {}));
        v.addEventListener('mouseleave', () => v.pause());
      });
    };
    draw();
    container.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      container.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('is-active', x === b));
      draw();
    }));
    const bar = container.querySelector('.cms-progress');
    container.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      let last = null;
      for (const [i, f] of files.entries()) {
        try {
          last = await uploadMedia(f, (pct) => showProgress(bar, pct, `${files.length > 1 ? `${i + 1}/${files.length} · ` : ''}${f.name}`));
          items.unshift(last);
          A().toast(`Загружено: ${f.name}`);
        } catch (err) { A().fail(err); }
      }
      bar.hidden = true;
      if (onPick && files.length === 1 && last) { onPick(last.url); return; }
      draw();
    });
  }

  function pickMedia(onPick, kind) {
    const dlg = document.createElement('dialog');
    dlg.className = 'cms-dialog';
    dlg.innerHTML = `<div class="cms-dialog__head"><h2>${kind === 'video' ? 'Выберите видео' : 'Выберите изображение'}</h2><button type="button" class="btn btn--ghost btn--sm" data-close><span>Закрыть</span></button></div><div data-grid></div>`;
    document.body.append(dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('[data-close]').addEventListener('click', close);
    dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
    dlg.showModal();
    mediaGrid(dlg.querySelector('[data-grid]'), { onPick: (url) => { onPick(url); close(); }, kind });
  }

  function mediaPage() {
    root().innerHTML = '<header class="ws-head"><div><p class="eyebrow">Файлы сайта</p><h1 class="ws-title">Фото и видео</h1></div></header><div data-grid></div>';
    mediaGrid($('[data-grid]', root()));
  }

  /* ---------- Client sites (site builder) ---------- */
  async function sitesPage() {
    const r = root();
    r.innerHTML = '<p class="cms-muted">Загрузка…</p>';
    let data;
    try { data = await A().api('/sites'); } catch (err) { r.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const st = { draft: 'status--review', active: 'status--in_progress', suspended: 'status--off' };
    const counts = data.items.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {});
    r.innerHTML = `
      <header class="ws-head"><div><p class="eyebrow">Конструктор</p><h1 class="ws-title">Сайты клиентов</h1></div>
        <div class="cms-inline"><a class="btn btn--ghost btn--sm" href="#/content/builder"><span>Настройки</span></a><a class="btn btn--primary btn--sm" href="/create" target="_blank" rel="noopener"><span>Открыть конструктор ↗</span></a></div></header>
      <div class="kpis">
        <div class="kpi"><span class="kpi__label">Всего сайтов</span><b class="kpi__value">${data.items.length}</b></div>
        <div class="kpi"><span class="kpi__label">Ждут оплаты</span><b class="kpi__value">${counts.draft || 0}</b><span class="kpi__hint">черновики</span></div>
        <div class="kpi"><span class="kpi__label">Опубликованы</span><b class="kpi__value">${counts.active || 0}</b></div>
        <div class="kpi"><span class="kpi__label">Отключены</span><b class="kpi__value">${counts.suspended || 0}</b></div>
      </div>
      <div class="sites">${data.items.map((x) => `
        <article class="site-card panel-card" data-id="${x.id}">
          <div class="site-card__pv" style="--accent:${esc(x.data.style.accent)}">${x.data.hero || x.data.logo ? `<img src="${esc(x.data.hero || x.data.logo)}" alt="" loading="lazy">` : `<span>${esc((x.data.title || '?').slice(0, 1))}</span>`}</div>
          <div class="site-card__body">
            <div class="site-card__top"><h3>${esc(x.data.title)}</h3><span class="status ${st[x.status]}">${esc(data.statuses[x.status])}</span></div>
            <a class="site-card__url" href="/s/${esc(x.slug)}" target="_blank" rel="noopener">/s/${esc(x.slug)} ↗</a>
            <p class="cms-muted">${esc(data.templates[x.template] || x.template)} · создан ${esc(A().fmtDate(x.created_at))}${x.paid_at ? ` · оплачен ${esc(A().fmtDate(x.paid_at))}` : ''}</p>
            <p class="site-card__owner"><b>${esc(x.owner_name)}</b> · <a href="mailto:${esc(x.owner_email)}">${esc(x.owner_email)}</a>${x.owner_phone ? ` · <a href="tel:${esc(x.owner_phone.replace(/[^\d+]/g, ''))}">${esc(x.owner_phone)}</a>` : ''}</p>
            <div class="cms-inline">
              ${x.status !== 'active' ? `<button type="button" class="btn btn--primary btn--sm" data-act="publish"><span>Опубликовать</span></button>` : ''}
              ${x.status === 'active' ? `<button type="button" class="btn btn--ghost btn--sm" data-act="draft"><span>В черновик</span></button>` : ''}
              ${x.status !== 'suspended' ? `<button type="button" class="btn btn--ghost btn--sm" data-act="suspend"><span>Отключить</span></button>` : ''}
              <a class="btn btn--ghost btn--sm" href="/s/${esc(x.slug)}/edit" target="_blank" rel="noopener"><span>Редактировать</span></a>
              <button type="button" class="btn btn--ghost btn--sm" data-act="link"><span>Ссылка для клиента</span></button>
              <button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="delete"><span>Удалить</span></button>
            </div>
          </div>
        </article>`).join('') || '<p class="empty">Пока никто не создал сайт. Поделитесь ссылкой на конструктор: <a href="/create" target="_blank">/create</a></p>'}</div>`;

    r.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const card = b.closest('[data-id]');
      const id = card.dataset.id;
      const item = data.items.find((x) => String(x.id) === id);
      const act = b.dataset.act;
      try {
        if (act === 'publish') {
          const paid = confirm(`Опубликовать «${item.data.title}»?\n\nОК — отметить как оплаченный и опубликовать.\nОтмена — ничего не делать.`);
          if (!paid) return;
          await A().api(`/sites/${id}`, { method: 'PATCH', body: { status: 'active', markPaid: true } });
          A().toast('Сайт опубликован');
        } else if (act === 'draft') {
          await A().api(`/sites/${id}`, { method: 'PATCH', body: { status: 'draft' } }); A().toast('Сайт снова в режиме предпросмотра');
        } else if (act === 'suspend') {
          if (!confirm('Отключить сайт? Посетители увидят «Сайт отключён».')) return;
          await A().api(`/sites/${id}`, { method: 'PATCH', body: { status: 'suspended' } }); A().toast('Сайт отключён');
        } else if (act === 'link') {
          if (!confirm('Создать новую ссылку для редактирования? Старая ссылка клиента перестанет работать.')) return;
          const { editUrl } = await A().api(`/sites/${id}/link`, { method: 'POST' });
          try { await navigator.clipboard.writeText(editUrl); A().toast('Ссылка скопирована — отправьте её клиенту'); } catch { prompt('Ссылка для клиента:', editUrl); }
          return;
        } else if (act === 'delete') {
          if (!confirm(`Удалить сайт «${item.data.title}» безвозвратно?`)) return;
          await A().api(`/sites/${id}`, { method: 'DELETE' }); A().toast('Сайт удалён');
        }
        sitesPage();
      } catch (err) { A().fail(err); }
    }));
  }

  /* ---------- Integrations: Telegram bot + Google sign-in ---------- */
  async function integrationsPage() {
    const r = root();
    r.innerHTML = '<p class="cms-muted">Загрузка…</p>';
    let data;
    try { data = await A().api('/integrations'); } catch (err) { r.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    drawIntegrations(data);
  }

  function drawIntegrations(data) {
    const t = data.telegram, g = data.google;
    const r = root();
    r.innerHTML = `
      <header class="ws-head"><div><p class="eyebrow">Подключения</p><h1 class="ws-title">Интеграции</h1></div></header>
      <div class="detail-grid">
        <div>
          <section class="panel-card integ">
            <div class="integ__head"><span class="integ__logo integ__logo--tg" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21.5 4.5 2.8 11.7c-.9.4-.9 1.6.1 1.9l4.7 1.5 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.5 4.9 3.6c.6.4 1.4.1 1.6-.6l3.2-15.3c.2-1-.8-1.8-1.8-1.7z"/></svg></span>
              <div><h2>Telegram-бот</h2><p class="cms-muted">Заявки с сайта приходят в Telegram, статус меняется кнопками прямо в чате.</p></div>
              <span class="status ${t.connected ? 'status--in_progress' : 'status--off'}">${t.connected ? 'подключён' : 'не подключён'}</span></div>

            <ol class="integ__steps">
              <li class="${t.connected ? 'is-done' : ''}">
                <b>Шаг 1. Токен бота</b>
                ${t.connected ? `<p>Бот <a href="https://t.me/${esc(t.botUsername)}" target="_blank" rel="noopener">@${esc(t.botUsername)}</a> (${esc(t.botName)}) · токен ${esc(t.tokenMasked)} ${t.webhook ? '· <span class="ok-dot">вебхук активен</span>' : '· <span class="warn-dot">без вебхука (локальный режим)</span>'}</p>` : `<p class="cms-hint">Откройте <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> → /newbot → придумайте имя → скопируйте токен вида <code>123456789:AAH…</code> и вставьте сюда.</p>`}
                <form class="cms-inline" data-tg-token>
                  <input class="input" name="token" placeholder="${t.connected ? 'Новый токен (чтобы сменить бота)' : '123456789:AAH…'}" autocomplete="off" spellcheck="false" required>
                  <button class="btn btn--primary btn--sm" type="submit"><span class="btn__label">${t.connected ? 'Сменить' : 'Подключить'}</span><span class="btn__spinner" aria-hidden="true"></span></button>
                </form>
              </li>
              <li class="${t.chats.length ? 'is-done' : ''} ${t.connected ? '' : 'is-locked'}">
                <b>Шаг 2. Подключите свой Telegram — любым способом</b>
                <div class="integ__ways">
                  <div class="integ__way">
                    <h3>🔗 По ссылке (проще всего)</h3>
                    <p class="cms-hint">Откройте ссылку на телефоне с Telegram и нажмите «Start» — чат подключится сам.</p>
                    ${t.linkUrl ? `<div class="cms-inline"><a class="btn btn--primary btn--sm" href="${esc(t.linkUrl)}" target="_blank" rel="noopener"><span>Открыть бота</span></a><button type="button" class="btn btn--ghost btn--sm" data-copy-link><span>Копировать ссылку</span></button><button type="button" class="btn btn--ghost btn--sm" data-relink title="Старая ссылка перестанет работать"><span>Новая ссылка</span></button></div>` : '<p class="cms-muted">Появится после подключения бота.</p>'}
                  </div>
                  <div class="integ__way">
                    <h3>📱 По номеру телефона</h3>
                    <p class="cms-hint">Укажите свой номер. Затем напишите боту /start и нажмите «Отправить мой номер» — если номер совпадёт, чат подключится.</p>
                    <form class="cms-inline" data-tg-phone><input class="input" name="phone" type="tel" inputmode="tel" placeholder="+7 999 123-45-67" value="${esc(t.phone)}"><button class="btn btn--ghost btn--sm" type="submit"><span>Сохранить</span></button></form>
                  </div>
                  <div class="integ__way">
                    <h3>🆔 По Telegram ID</h3>
                    <p class="cms-hint">Напишите боту <code>/id</code> — он пришлёт число. Вставьте его сюда. Подходит и для групп (ID начинается с минуса).</p>
                    <form class="cms-inline" data-tg-chat><input class="input" name="id" inputmode="numeric" placeholder="123456789"><button class="btn btn--ghost btn--sm" type="submit"><span class="btn__label">Добавить</span><span class="btn__spinner" aria-hidden="true"></span></button></form>
                  </div>
                </div>
                ${t.connected && !t.webhook ? '<button type="button" class="btn btn--ghost btn--sm" data-tg-detect><span>Найти чаты, которые писали боту</span></button>' : ''}
              </li>
              <li class="${t.connected ? '' : 'is-locked'}">
                <b>Подключённые чаты (${t.chats.length})</b>
                ${t.chats.length ? `<ul class="integ__chats">${t.chats.map((c) => `<li><span><b>${esc(c.title)}</b><small>ID ${esc(c.id)}</small></span><button type="button" class="btn btn--ghost btn--sm" data-chat-del="${esc(c.id)}"><span>Отключить</span></button></li>`).join('')}</ul>` : '<p class="cms-muted">Пока ни одного — используйте любой способ из шага 2.</p>'}
                <label class="switch"><input type="checkbox" data-tg-buttons ${t.statusButtons ? 'checked' : ''}><span class="switch__track" aria-hidden="true"></span><span>Кнопки смены статуса под заявкой в Telegram</span></label>
                <div class="cms-inline">
                  <button type="button" class="btn btn--ghost btn--sm" data-tg-test ${t.chats.length ? '' : 'disabled'}><span>Отправить тестовое сообщение</span></button>
                  ${t.connected ? '<button type="button" class="btn btn--ghost btn--sm btn--danger" data-tg-off><span>Отключить бота</span></button>' : ''}
                </div>
                <p class="cms-hint">Команды бота: /orders — последние заявки, /stats — статистика, /id — ваш ID, /stop — отписаться.</p>
              </li>
            </ol>
          </section>
        </div>
        <div>
          <section class="panel-card integ">
            <div class="integ__head"><span class="integ__logo integ__logo--g" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg></span>
              <div><h2>Вход через Google</h2><p class="cms-muted">Вход в админку одной кнопкой и восстановление доступа, если забыли пароль.</p></div>
              <span class="status ${g.configured ? 'status--in_progress' : 'status--off'}">${g.configured ? 'включён' : 'выключен'}</span></div>
            <details class="integ__help" ${g.configured ? '' : 'open'}><summary>Как получить ключи (5 минут)</summary>
              <ol>
                <li>Откройте <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud → Credentials</a>, при необходимости создайте проект.</li>
                <li>Если просит — настройте «OAuth consent screen»: тип External, укажите название и свою почту.</li>
                <li><b>Create credentials → OAuth client ID</b> → тип <b>Web application</b>.</li>
                <li>В «Authorized redirect URIs» добавьте адрес:<div class="cms-inline"><code class="integ__uri">${esc(g.redirectUri)}</code><button type="button" class="btn btn--ghost btn--sm" data-copy-uri><span>Копировать</span></button></div></li>
                <li>Скопируйте Client ID и Client Secret в поля ниже и укажите свою почту Gmail.</li>
              </ol></details>
            <form class="cms-form" data-google>
              <div class="cms-field"><label class="field__label" for="g-id">Client ID</label><input class="input" id="g-id" name="clientId" value="${esc(g.clientId)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></div>
              <div class="cms-field"><label class="field__label" for="g-secret">Client Secret</label><input class="input" id="g-secret" name="clientSecret" placeholder="${g.clientSecretMasked ? `сохранён: ${esc(g.clientSecretMasked)} — оставьте пустым, чтобы не менять` : 'GOCSPX-…'}" autocomplete="off" spellcheck="false"></div>
              <div class="cms-field"><label class="field__label" for="g-emails">Кому разрешён вход (Gmail, через запятую)</label><input class="input" id="g-emails" name="allowedEmails" value="${esc(g.allowedEmails.join(', '))}" placeholder="you@gmail.com"></div>
              <div class="cms-inline"><button class="btn btn--primary btn--sm" type="submit"><span class="btn__label">Сохранить</span><span class="btn__spinner" aria-hidden="true"></span></button>
              ${g.configured ? '<a class="btn btn--ghost btn--sm" href="/api/admin/google/start"><span>Проверить вход</span></a>' : ''}</div>
            </form>
          </section>
        </div>
      </div>`;

    const busy = async (btn, fn) => { btn && btn.classList.add('is-loading'); try { return await fn(); } finally { btn && btn.classList.remove('is-loading'); } };
    const act = async (path, body, btn, okMsg) => {
      try {
        const res = await busy(btn, () => A().api(path, { method: body === null ? 'DELETE' : 'POST', body: body || undefined }));
        if (okMsg) A().toast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
        if (res && res.telegram) drawIntegrations(res);
        return res;
      } catch (err) { A().fail(err); return null; }
    };
    $('[data-tg-token]', r).addEventListener('submit', (e) => { e.preventDefault(); act('/telegram/connect', { token: e.target.token.value }, e.submitter, 'Бот подключён'); });
    $('[data-tg-phone]', r).addEventListener('submit', (e) => { e.preventDefault(); act('/telegram/phone', { phone: e.target.phone.value }, e.submitter, e.target.phone.value ? 'Номер сохранён. Напишите боту /start' : 'Номер удалён'); });
    $('[data-tg-chat]', r).addEventListener('submit', (e) => { e.preventDefault(); act('/telegram/chats', { id: e.target.id.value }, e.submitter, 'Чат подключён'); });
    r.querySelectorAll('[data-chat-del]').forEach((b) => b.addEventListener('click', () => { if (confirm('Отключить уведомления в этот чат?')) act(`/telegram/chats/${encodeURIComponent(b.dataset.chatDel)}`, null, b, 'Чат отключён'); }));
    $('[data-tg-buttons]', r).addEventListener('change', (e) => act('/telegram/buttons', { on: e.target.checked }, null, 'Сохранено'));
    $('[data-tg-test]', r).addEventListener('click', (e) => act('/telegram/test', {}, e.currentTarget, (res) => `Отправлено: ${res.sent}${res.failed ? `, ошибок: ${res.failed}` : ''}`));
    const off = $('[data-tg-off]', r);
    off && off.addEventListener('click', () => { if (confirm('Отключить бота? Уведомления перестанут приходить.')) act('/telegram/disconnect', {}, off, 'Бот отключён'); });
    const relink = $('[data-relink]', r);
    relink && relink.addEventListener('click', () => { if (confirm('Создать новую ссылку? Старая перестанет работать (уже подключённые чаты останутся).')) act('/telegram/relink', {}, relink, 'Новая ссылка создана'); });
    const detect = $('[data-tg-detect]', r);
    detect && detect.addEventListener('click', () => act('/telegram/detect', {}, detect, (res) => (res.detect.note || `Найдено чатов: ${res.detect.found}, добавлено: ${res.detect.added}`)));
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); A().toast('Скопировано'); } catch { prompt('Скопируйте:', text); } };
    const cl = $('[data-copy-link]', r); cl && cl.addEventListener('click', () => copy(t.linkUrl));
    $('[data-copy-uri]', r).addEventListener('click', () => copy(g.redirectUri));
    $('[data-google]', r).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      act('/google', { clientId: f.clientId.value, clientSecret: f.clientSecret.value, allowedEmails: f.allowedEmails.value }, e.submitter, 'Настройки Google сохранены').then(() => {});
    });
  }

  /* ---------- Settings ---------- */
  async function settingsPage() {
    const env = A().meta().environment || {};
    const me = A().me() || {};
    const viaGoogle = me.method === 'google';
    const ok = (b, yes, no) => `<span class="status ${b ? 'status--in_progress' : 'status--off'}">${b ? yes : no}</span>`;
    root().innerHTML = `
      <header class="ws-head"><div><p class="eyebrow">Администрирование</p><h1 class="ws-title">Настройки</h1></div></header>
      <div class="detail-grid">
        <div>
          <section class="panel-card">
            <h2>${viaGoogle ? 'Новый пароль администратора' : 'Смена пароля администратора'}</h2>
            ${viaGoogle ? `<p class="cms-hint cms-ok">Вы вошли через Google (${esc(me.email)}) — старый пароль вводить не нужно. Так можно восстановить доступ, если пароль забыт.</p>` : ''}
            <form class="cms-form" data-password novalidate>
              <div class="cms-field" ${viaGoogle ? 'hidden' : ''}><label class="field__label" for="pw-cur">Текущий пароль</label><input class="input" id="pw-cur" type="password" autocomplete="current-password" ${viaGoogle ? '' : 'required'}></div>
              <div class="cms-field"><label class="field__label" for="pw-new">Новый пароль (от 10 символов)</label><input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="10" required></div>
              <div class="cms-field"><label class="field__label" for="pw-rep">Повторите новый пароль</label><input class="input" id="pw-rep" type="password" autocomplete="new-password" required></div>
              <p class="field__error" data-pw-error role="alert"></p>
              <button class="btn btn--primary btn--sm" type="submit"><span>Сменить пароль</span></button>
              <p class="cms-hint">После смены все остальные сеансы входа будут завершены.</p>
            </form>
          </section>
          <section class="panel-card">
            <h2>История версий контента</h2>
            <p class="cms-hint">Каждое сохранение создаёт версию. Хранятся последние 30.</p>
            <ul class="cms-versions" data-versions><li class="cms-muted">Загрузка…</li></ul>
          </section>
        </div>
        <div>
          <section class="panel-card">
            <h2>Состояние сервера</h2>
            <dl class="kv">
              <dt>База данных</dt><dd>${ok(env.db === 'postgres', 'PostgreSQL / Supabase', env.db === 'sqlite' ? 'SQLite (локально)' : 'не подключена')}</dd>
              <dt>Хранилище файлов</dt><dd>${ok(env.storage === 'supabase', 'Supabase Storage', 'локальный диск')}</dd>
              <dt>Telegram-бот</dt><dd>${ok(env.telegramBot, 'настроен', 'не настроен')} <a href="#/integrations" class="cms-link">настроить</a></dd>
              <dt>Загрузка видео</dt><dd>${ok(env.directUpload, 'до 50 МБ напрямую в хранилище', `до ${Math.round((env.maxUpload || 0) / 1048576)} МБ`)}</dd>
              <dt>Почта (SMTP)</dt><dd>${ok(env.smtp, 'настроена', 'не настроена')}</dd>
            </dl>
            ${env.vercel && env.storage !== 'supabase' ? '<p class="cms-hint cms-warn">На Vercel без Supabase Storage загруженные файлы пропадают. Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.</p>' : ''}
          </section>
          <section class="panel-card">
            <h2>Резервная копия</h2>
            <p class="cms-hint">Скачайте все тексты, разделы, цены и настройки дизайна одним файлом. Его можно загрузить обратно — например, после экспериментов.</p>
            <div class="cms-inline">
              <button type="button" class="btn btn--ghost btn--sm" data-backup><span>Скачать копию (.json)</span></button>
              <label class="btn btn--ghost btn--sm"><input type="file" accept="application/json,.json" hidden data-restore-file><span>Загрузить из файла</span></label>
            </div>
          </section>
          <section class="panel-card">
            <h2>Сброс контента</h2>
            <p class="cms-hint">Вернуть все тексты, услуги, проекты и контакты к исходному варианту. Текущая версия останется в истории.</p>
            <button type="button" class="btn btn--ghost btn--sm" data-reset><span>Сбросить к исходному</span></button>
          </section>
        </div>
      </div>`;
    const form = $('[data-password]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('[data-pw-error]');
      err.textContent = '';
      const cur = $('#pw-cur').value, nw = $('#pw-new').value, rep = $('#pw-rep').value;
      if (!viaGoogle && !cur) { err.textContent = 'Введите текущий пароль'; return; }
      if (nw.length < 10) { err.textContent = 'Новый пароль должен быть не короче 10 символов'; return; }
      if (nw !== rep) { err.textContent = 'Пароли не совпадают'; return; }
      try { await A().api('/password', { method: 'POST', body: { current: cur, next: nw } }); form.reset(); A().toast('Пароль изменён'); }
      catch (e2) { err.textContent = e2.message; }
    });
    $('[data-backup]').addEventListener('click', async () => {
      try {
        const { content: c } = await A().api('/content');
        const blob = new Blob([JSON.stringify({ format: 'codeforge-content', version: 1, exportedAt: new Date().toISOString(), content: c }, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `site-content-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (e) { A().fail(e); }
    });
    $('[data-restore-file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const c = parsed && parsed.content ? parsed.content : parsed;
        if (!c || typeof c !== 'object' || !c.hero) throw new Error('Это не файл резервной копии сайта');
        if (!confirm('Заменить текущий контент сайта содержимым файла? Текущая версия останется в истории.')) return;
        const d = await A().api('/content', { method: 'PUT', body: { content: c } });
        content = d.content; saved = JSON.stringify(content);
        A().toast('Копия восстановлена'); settingsPage();
      } catch (err) { A().fail(err.name === 'SyntaxError' ? new Error('Файл повреждён (не JSON)') : err); }
    });
    $('[data-reset]').addEventListener('click', async () => {
      if (!confirm('Сбросить весь контент сайта к исходному варианту?')) return;
      try { const d = await A().api('/content/reset', { method: 'POST' }); content = d.content; saved = JSON.stringify(content); A().toast('Контент сброшен'); settingsPage(); }
      catch (e) { A().fail(e); }
    });
    try {
      const { items } = await A().api('/content/versions');
      const list = $('[data-versions]');
      list.innerHTML = items.map((v, i) => `<li><span>${esc(A().fmtDate(v.created_at))}${i === 0 ? ' <b>(текущая)</b>' : ''}</span>${i === 0 ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-restore="${v.id}"><span>Восстановить</span></button>`}</li>`).join('') || '<li class="cms-muted">Сохранений пока не было — сайт показывает исходный контент.</li>';
      list.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Восстановить эту версию? Текущая останется в истории.')) return;
        try { const d = await A().api(`/content/versions/${b.dataset.restore}/restore`, { method: 'POST' }); content = d.content; saved = JSON.stringify(content); A().toast('Версия восстановлена'); settingsPage(); }
        catch (e) { A().fail(e); }
      }));
    } catch (e) { A().fail(e); }
  }

  /* ---------- Router entry ---------- */
  async function render(hash, { keepScroll = false } = {}) {
    currentHash = hash;
    const y = scrollY;
    try { await load(); } catch (err) { root().innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    let m;
    if ((m = hash.match(/^#\/content\/?([\w-]*)/))) contentPage(m[1] || 'hero');
    else if ((m = hash.match(/^#\/projects\/(\d+)/))) projectsPage(Number(m[1]));
    else if (hash.startsWith('#/projects')) projectsPage(null);
    else if (hash.startsWith('#/media')) mediaPage();
    else if (hash.startsWith('#/settings')) settingsPage();
    else if (hash.startsWith('#/integrations')) integrationsPage();
    else if (hash.startsWith('#/sites')) sitesPage();
    if (keepScroll) scrollTo(0, y);
  }

  // Moving between content tabs / project editor keeps unsaved edits in memory.
  window.CMS = {
    render,
    hasUnsaved: () => isDirty(),
    isDirty: () => {
      // edits are shared across CMS pages; only warn when leaving the CMS entirely
      const h = location.hash;
      return /^#\/(content|projects)/.test(h) ? false : isDirty();
    },
    discard: () => { if (!/^#\/(content|projects)/.test(location.hash)) discard(); },
  };
})();
