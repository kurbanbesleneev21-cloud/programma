/* CODEFORGE — multi-step order form with client validation, file uploads,
   draft autosave and real submission to /api/orders. */
(() => {
  'use strict';

  const form = document.getElementById('order-form');
  if (!form) return;
  const root = form.closest('.order');
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TOTAL = 5;
  const LABELS = {
    services: { website: 'Разработка сайта', android: 'Android-приложение', ios: 'iOS-приложение', webapp: 'Веб-приложение', ecommerce: 'Интернет-магазин', crm: 'CRM-система', other: 'Другое' },
    budget: { 'lt-500': 'До 500 €', '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', '3000-5000': '3 000–5 000 €', '5000-10000': '5 000–10 000 €', 'gt-10000': 'Более 10 000 €', undecided: 'Пока не определился' },
    deadline: { asap: 'Как можно скорее', '1m': 'До 1 месяца', '1-3m': '1–3 месяца', '3-6m': '3–6 месяцев', flexible: 'Сроки гибкие' },
    contact_method: { email: 'Электронная почта', phone: 'Телефонный звонок', telegram: 'Telegram', whatsapp: 'WhatsApp' },
  };
  const STEP_FIELDS = {
    1: ['services'],
    2: ['project_name', 'description', 'features', 'references_text', 'deadline', 'files'],
    3: ['budget'],
    4: ['name', 'email', 'phone', 'telegram', 'contact_method', 'consent'],
    5: [],
  };
  const FIELD_STEP = Object.fromEntries(Object.entries(STEP_FIELDS).flatMap(([s, fs]) => fs.map((f) => [f, Number(s)])));
  const FILE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.docx', '.xlsx', '.pptx', '.txt'];
  const section = document.getElementById('order');
  const ds = (section && section.dataset) || {};
  const MAX_FILES = Number(ds.maxFiles) || 5;
  const MAX_SIZE = Number(ds.maxSize) || 10 * 1024 * 1024;
  const MAX_TOTAL = Number(ds.maxTotal) || 25 * 1024 * 1024;
  const CONTACT_EMAIL = ds.contactEmail || '';
  const MB = (b) => Math.round(b / 1048576);
  const DRAFT_KEY = 'cf-order-draft-v1';

  const panels = $$('.panel', form);
  const stepBtns = $$('[data-goto]');
  const progress = $('.order__progress span');
  const btnPrev = $('[data-prev]'), btnNext = $('[data-next]'), btnSubmit = $('[data-submit]');
  const alertBox = $('[data-form-alert]');
  const success = $('[data-success]');
  const autosaveEl = $('[data-autosave]');
  let step = 1, maxReached = 1, files = [], token = null, tokenPromise = null, submitting = false;

  /* ---------- Helpers ---------- */
  const val = (name) => {
    const els = form.elements[name];
    if (!els) return '';
    if (els instanceof RadioNodeList) {
      if (els[0] && els[0].type === 'checkbox') return [...els].filter((e) => e.checked).map((e) => e.value);
      return els.value || '';
    }
    if (els.type === 'checkbox') return els.checked;
    return els.value.trim();
  };
  const errEl = (name) => form.querySelector(`[data-error="${name}"]`);
  const inputsOf = (name) => [...form.querySelectorAll(`[name="${name}"]`)];
  function setError(name, msg) {
    const el = errEl(name);
    if (el) el.textContent = msg || '';
    inputsOf(name).forEach((i) => {
      if (i.type === 'radio' || i.type === 'checkbox') return;
      if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid');
    });
  }
  const fmtSize = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1024 / 1024).toFixed(1)} МБ`);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normTelegram = (s) => s.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');

  /* ---------- Validation (mirrors server-side Zod schema) ---------- */
  const RULES = {
    services: () => (val('services').length ? '' : 'Выберите хотя бы одну услугу'),
    project_name: () => { const v = val('project_name'); return v.length < 2 ? 'Укажите название проекта (минимум 2 символа)' : ''; },
    description: () => { const v = val('description'); return v.length < 20 ? `Опишите идею подробнее — минимум 20 символов (сейчас ${v.length})` : ''; },
    features: () => '',
    references_text: () => '',
    deadline: () => (val('deadline') ? '' : 'Выберите желаемые сроки'),
    files: () => '',
    budget: () => (val('budget') ? '' : 'Выберите вариант бюджета'),
    name: () => (val('name').length < 2 ? 'Укажите ваше имя' : ''),
    email: () => {
      const v = val('email');
      if (!v) return 'Укажите электронную почту';
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Введите корректный адрес, например name@company.com';
    },
    phone: () => {
      const v = val('phone');
      if (!v) return 'Укажите номер телефона';
      return /^\+?[0-9\s\-()]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7 ? '' : 'Введите номер в международном формате, например +49 151 234 56 78';
    },
    telegram: () => {
      const v = normTelegram(val('telegram'));
      if (!v) return val('contact_method') === 'telegram' ? 'Укажите Telegram или выберите другой способ связи' : '';
      return /^[A-Za-z0-9_]{5,32}$/.test(v) ? '' : 'Имя пользователя: 5–32 символа, латиница, цифры и _';
    },
    contact_method: () => (val('contact_method') ? '' : 'Выберите удобный способ связи'),
    consent: () => (val('consent') ? '' : 'Необходимо согласие на обработку данных'),
  };
  const touched = new Set();
  function validateField(name) {
    const msg = RULES[name] ? RULES[name]() : '';
    setError(name, msg);
    return !msg;
  }
  function validateStep(s) {
    let firstBad = null;
    for (const name of STEP_FIELDS[s]) {
      touched.add(name);
      if (!validateField(name) && !firstBad) firstBad = name;
    }
    if (firstBad) focusField(firstBad);
    return !firstBad;
  }
  function focusField(name) {
    const el = inputsOf(name)[0];
    if (el) el.focus({ preventScroll: false });
  }

  form.addEventListener('focusout', (e) => {
    const n = e.target.name;
    if (n && RULES[n] && e.target.type !== 'radio' && e.target.type !== 'checkbox' && e.target.value) { touched.add(n); validateField(n); }
  });
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n && touched.has(n)) validateField(n);
    if (n === 'contact_method' && touched.has('telegram')) validateField('telegram');
    updateCounters();
    dirty = true;
    scheduleSave();
  });
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n && (e.target.type === 'radio' || e.target.type === 'checkbox')) { if (touched.has(n) || errEl(n)?.textContent) validateField(n); }
    if (n === 'contact_method' && (touched.has('telegram') || val('contact_method') === 'telegram')) validateField('telegram');
    dirty = true;
    scheduleSave();
  });

  /* ---------- Character counters ---------- */
  function updateCounters() {
    $$('[data-counter-for]').forEach((c) => {
      const t = document.getElementById(c.dataset.counterFor);
      if (t) c.textContent = `${t.value.length} / ${t.maxLength}`;
    });
  }

  /* ---------- Step navigation ---------- */
  function goTo(target, { focus = true } = {}) {
    if (target < 1 || target > TOTAL || target === step) return;
    const back = target < step;
    if (target === TOTAL) renderSummary();
    panels.forEach((p) => {
      const on = Number(p.dataset.step) === target;
      p.hidden = !on;
      if (on) { p.classList.toggle('is-back', back); p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
    });
    step = target;
    maxReached = Math.max(maxReached, step);
    stepBtns.forEach((b) => {
      const n = Number(b.dataset.goto);
      b.disabled = n > maxReached;
      b.classList.toggle('is-done', n < step || (n <= maxReached && n !== step));
      if (n === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    progress.style.transform = `scaleX(${step / TOTAL})`;
    btnPrev.hidden = step === 1;
    btnNext.hidden = step === TOTAL;
    btnSubmit.hidden = step !== TOTAL;
    hideAlert();
    if (focus) {
      const legend = panels[step - 1].querySelector('legend');
      legend.setAttribute('tabindex', '-1');
      legend.focus({ preventScroll: true });
      const top = root.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.4) root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
    scheduleSave();
  }

  btnNext.addEventListener('click', () => { if (validateStep(step)) goTo(step + 1); });
  btnPrev.addEventListener('click', () => goTo(step - 1));
  stepBtns.forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.goto);
    if (n > step) { for (let s = step; s < n; s++) if (!validateStep(s)) { if (s !== step) goTo(s); return; } }
    goTo(n);
  }));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && step < TOTAL) {
      e.preventDefault();
      btnNext.click();
    }
  });

  /* ---------- Service preselect from cards ---------- */
  document.addEventListener('cf:pick-service', (e) => {
    const box = form.querySelector(`input[name="services"][value="${CSS.escape(e.detail)}"]`);
    if (!box) return;
    box.checked = true;
    setError('services', '');
    if (success.hidden && step !== 1) goTo(1, { focus: false });
    dirty = true;
    scheduleSave();
    window.CF && CF.toast && CF.toast(`Добавлено в заявку: ${LABELS.services[e.detail]}`);
  });

  /* ---------- Files ---------- */
  const dropzone = $('[data-dropzone]');
  const fileInput = $('#f-files');
  const fileList = $('[data-file-list]');
  function addFiles(list) {
    const errors = [];
    for (const f of list) {
      const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (!FILE_EXT.includes(ext)) { errors.push(`«${f.name}»: недопустимый формат`); continue; }
      if (f.size > MAX_SIZE) { errors.push(`«${f.name}»: больше ${MB(MAX_SIZE)} МБ`); continue; }
      if (files.reduce((n, x) => n + x.size, 0) + f.size > MAX_TOTAL) { errors.push(`Общий размер файлов — не больше ${MB(MAX_TOTAL)} МБ`); continue; }
      if (f.size === 0) { errors.push(`«${f.name}»: пустой файл`); continue; }
      if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (files.length >= MAX_FILES) { errors.push(`Можно прикрепить не более ${MAX_FILES} файлов`); break; }
      files.push(f);
    }
    setError('files', errors.join('. '));
    renderFiles();
  }
  function renderFiles() {
    fileList.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
    fileList.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      const isImg = /^image\/(png|jpeg|webp|gif)$/.test(f.type);
      let thumb;
      if (isImg) { thumb = document.createElement('img'); thumb.src = URL.createObjectURL(f); thumb.alt = ''; }
      else { thumb = document.createElement('span'); thumb.textContent = (f.name.split('.').pop() || '').slice(0, 4); }
      thumb.className = 'file-list__thumb';
      const name = Object.assign(document.createElement('span'), { className: 'file-list__name', textContent: f.name });
      const size = Object.assign(document.createElement('span'), { className: 'file-list__size', textContent: fmtSize(f.size) });
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'file-list__remove'; rm.setAttribute('aria-label', `Удалить файл ${f.name}`);
      rm.innerHTML = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      rm.addEventListener('click', () => { files.splice(i, 1); renderFiles(); setError('files', ''); fileInput.focus(); });
      li.append(thumb, name, size, rm);
      fileList.append(li);
    });
  }
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
  ['dragleave', 'dragend', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    if (ev === 'dragleave' && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove('is-drag');
  }));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  /* ---------- Summary ---------- */
  function renderSummary() {
    const box = $('[data-summary]');
    const services = val('services').map((s) => `<span>${escapeHtml(LABELS.services[s])}</span>`).join('');
    const tg = normTelegram(val('telegram'));
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>` : '');
    box.innerHTML = `
      <section class="summary__block">
        <div class="summary__head"><h3>Выбранные услуги</h3><button type="button" class="summary__edit" data-edit="1">Изменить</button></div>
        <div class="summary__tags">${services}</div>
      </section>
      <section class="summary__block">
        <div class="summary__head"><h3>Описание проекта</h3><button type="button" class="summary__edit" data-edit="2">Изменить</button></div>
        <dl>
          ${row('Название', val('project_name'))}
          ${row('Идея', val('description'))}
          ${row('Функции', val('features'))}
          ${row('Примеры', val('references_text'))}
          ${row('Сроки', LABELS.deadline[val('deadline')])}
          ${row('Файлы', files.length ? files.map((f) => f.name).join(', ') : 'не прикреплены')}
        </dl>
      </section>
      <section class="summary__block">
        <div class="summary__head"><h3>Бюджет</h3><button type="button" class="summary__edit" data-edit="3">Изменить</button></div>
        <dl>${row('Бюджет', LABELS.budget[val('budget')])}</dl>
      </section>
      <section class="summary__block">
        <div class="summary__head"><h3>Контактные данные</h3><button type="button" class="summary__edit" data-edit="4">Изменить</button></div>
        <dl>
          ${row('Имя', val('name'))}
          ${row('Почта', val('email'))}
          ${row('Телефон', val('phone'))}
          ${row('Telegram', tg ? '@' + tg : '')}
          ${row('Способ связи', LABELS.contact_method[val('contact_method')])}
        </dl>
      </section>`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.edit))));
  }

  /* ---------- Draft autosave (per-browser convenience only) ---------- */
  let saveTimer, dirty = false;
  const DRAFT_FIELDS = ['project_name', 'description', 'features', 'references_text', 'deadline', 'budget', 'name', 'email', 'phone', 'telegram', 'contact_method'];
  function scheduleSave() {
    if (!dirty) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const data = { services: val('services'), step, maxReached };
        DRAFT_FIELDS.forEach((f) => (data[f] = val(f)));
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        autosaveEl.textContent = 'Черновик сохранён';
      } catch { /* storage unavailable */ }
    }, 600);
  }
  function restoreDraft() {
    let data;
    try { data = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { data = null; }
    if (!data) return;
    (data.services || []).forEach((s) => { const b = form.querySelector(`input[name="services"][value="${CSS.escape(s)}"]`); if (b) b.checked = true; });
    DRAFT_FIELDS.forEach((f) => {
      const v = data[f];
      if (!v) return;
      const els = form.elements[f];
      if (els instanceof RadioNodeList) { const r = [...els].find((e) => e.value === v); if (r) r.checked = true; }
      else if (els) els.value = v;
    });
    updateCounters();
    autosaveEl.textContent = 'Черновик восстановлен';
  }
  const clearDraft = () => { clearTimeout(saveTimer); dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  /* ---------- Anti-spam token ---------- */
  function fetchToken() {
    tokenPromise = fetch('/api/form-token', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => { token = d.token; return token; })
      .catch(() => { token = null; tokenPromise = null; return null; });
    return tokenPromise;
  }
  const ensureToken = () => (token ? Promise.resolve(token) : tokenPromise || fetchToken());
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { ensureToken(); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(root);
  } else ensureToken();
  form.addEventListener('focusin', () => ensureToken(), { once: true });

  /* ---------- Alerts ---------- */
  function showAlert(html) { alertBox.innerHTML = html; alertBox.hidden = false; alertBox.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }
  function hideAlert() { alertBox.hidden = true; alertBox.textContent = ''; }

  /* ---------- Submit ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    for (let s = 1; s < TOTAL; s++) {
      if (!validateStep(s)) { goTo(s); return; }
    }
    submitting = true;
    btnSubmit.classList.add('is-loading');
    btnSubmit.setAttribute('aria-busy', 'true');
    hideAlert();
    try {
      await send(false);
    } finally {
      submitting = false;
      btnSubmit.classList.remove('is-loading');
      btnSubmit.removeAttribute('aria-busy');
    }
  });

  async function send(isRetry) {
    const t = await ensureToken();
    if (!t) {
      showAlert(`Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.${CONTACT_EMAIL ? ` Если ошибка повторяется — напишите нам на <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>.` : ''}`);
      return;
    }
    const fd = new FormData();
    val('services').forEach((s) => fd.append('services', s));
    ['project_name', 'description', 'features', 'references_text', 'deadline', 'budget', 'name', 'email', 'phone', 'contact_method'].forEach((f) => fd.append(f, val(f)));
    fd.append('telegram', normTelegram(val('telegram')));
    fd.append('consent', val('consent') ? 'true' : 'false');
    fd.append('company_site', form.elements.company_site.value);
    fd.append('form_token', t);
    files.forEach((f) => fd.append('files', f, f.name));

    let res, data;
    try {
      res = await fetch('/api/orders', { method: 'POST', body: fd, credentials: 'same-origin' });
      data = await res.json().catch(() => ({}));
    } catch {
      showAlert('Нет соединения с сервером. Ваши данные сохранены в форме — попробуйте отправить ещё раз через минуту.');
      return;
    }

    if (res.ok && data.ok) { onSuccess(data); return; }

    token = null; tokenPromise = null; // a token is single-use
    if (data.code && /^token_/.test(data.code) && !isRetry) {
      // session expired (e.g. tab left open for hours): get a fresh token and retry once
      await fetchToken();
      await new Promise((r) => setTimeout(r, 4300));
      return send(true);
    }
    if (res.status === 422 && data.fields) {
      let first = null;
      for (const [name, msg] of Object.entries(data.fields)) {
        setError(name, msg); touched.add(name);
        const s = FIELD_STEP[name];
        if (s && (first === null || s < first)) first = s;
      }
      if (first) {
        goTo(first);
        const name = STEP_FIELDS[first].find((n) => data.fields[n]);
        name && setTimeout(() => focusField(name), 50);
      }
      showAlert(escapeHtml(data.error || 'Проверьте правильность заполнения полей'));
      return;
    }
    if (data.fields && data.fields.files) { setError('files', data.fields.files); goTo(2); }
    showAlert(escapeHtml(data.error || 'Не удалось отправить заявку. Попробуйте ещё раз.'));
    fetchToken();
  }

  function onSuccess(data) {
    clearDraft();
    const email = val('email');
    form.hidden = true;
    $('.stepper').hidden = true;
    $('.order__progress').hidden = true;
    success.hidden = false;
    success.querySelector('[data-order-number]').textContent = data.number;
    const note = success.querySelector('.success__note');
    note.innerHTML = data.confirmation_sent
      ? `Мы отправили подтверждение на <b>${escapeHtml(email)}</b>. Сохраните номер — он пригодится при общении с менеджером.`
      : `Менеджер свяжется с вами: ${escapeHtml(LABELS.contact_method[val('contact_method')].toLowerCase())}. Сохраните номер — он пригодится при общении.`;
    success.focus({ preventScroll: true });
    root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (!reduceMotion) burst();
    showAutoSite(data.site);
  }

  /* ---------- The site the system builds from the order ---------- */
  const autosite = success.querySelector('[data-autosite]');
  function siteReady(site) {
    autosite.innerHTML = `
      <div class="autosite__icon" aria-hidden="true">✦</div>
      <h4>Ваш сайт готов!</h4>
      <p>${site.status === 'active' ? 'Сайт уже опубликован.' : 'Это черновик-предпросмотр. Менеджер доработает его с вами и опубликует после оплаты.'}</p>
      <a class="btn btn--primary" href="${escapeHtml(site.url)}" target="_blank" rel="noopener"><span>Открыть мой сайт</span></a>
      <div class="autosite__key">
        <b>Ссылка, чтобы самому менять тексты и фото — сохраните её:</b>
        <div class="autosite__row"><input class="input" readonly value="${escapeHtml(site.editUrl)}"><button type="button" class="btn btn--ghost btn--sm" data-copy-edit><span>Копировать</span></button></div>
      </div>`;
    autosite.querySelector('[data-copy-edit]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(site.editUrl); CF.toast && CF.toast('Ссылка скопирована'); }
      catch { autosite.querySelector('input').select(); }
    });
  }
  async function showAutoSite(site) {
    if (!site) { autosite.hidden = true; return; }
    autosite.hidden = false;
    if (!site.ai) { siteReady(site); return; }
    autosite.innerHTML = `
      <div class="autosite__loader" aria-hidden="true"><i></i><i></i><i></i></div>
      <h4>Создаём ваш сайт…</h4>
      <p data-autosite-step>Читаем ваше описание</p>`;
    const stepsTxt = ['Читаем ваше описание', 'Подбираем шаблон и цвета', 'Пишем тексты', 'Собираем услуги и цены', 'Почти готово…'];
    let k = 0;
    const timer = setInterval(() => { k = Math.min(k + 1, stepsTxt.length - 1); const el = autosite.querySelector('[data-autosite-step]'); if (el) el.textContent = stepsTxt[k]; }, 3500);
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(site.slug)}/generate`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error();
    } catch { /* the instant draft is still there — show it anyway */ }
    clearInterval(timer);
    siteReady(site);
  }

  function burst() {
    const wrap = document.createElement('div');
    wrap.className = 'success-burst';
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('i');
      const a = (i / 28) * Math.PI * 2, d = 90 + Math.random() * 140;
      p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      p.style.animationDelay = `${0.9 + Math.random() * 0.2}s`;
      wrap.append(p);
    }
    root.append(wrap);
    setTimeout(() => wrap.remove(), 3000);
  }

  success.querySelector('[data-copy-number]').addEventListener('click', async () => {
    const n = success.querySelector('[data-order-number]').textContent;
    try { await navigator.clipboard.writeText(n); CF.toast && CF.toast('Номер заявки скопирован'); }
    catch { CF.toast && CF.toast(`Номер заявки: ${n}`); }
  });

  success.querySelector('[data-new-order]').addEventListener('click', () => {
    form.reset();
    files = []; renderFiles();
    $$('[data-error]').forEach((e) => (e.textContent = ''));
    $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
    touched.clear();
    success.hidden = true;
    autosite.hidden = true; autosite.innerHTML = '';
    form.hidden = false;
    $('.stepper').hidden = false;
    $('.order__progress').hidden = false;
    maxReached = 1;
    step = 0; goTo(1);
    updateCounters();
    autosaveEl.textContent = '';
    fetchToken();
  });

  /* ---------- Init ---------- */
  restoreDraft();
  updateCounters();
  step = 0; goTo(1, { focus: false });
  // reopen draft at the step where the user left, as long as earlier steps are valid
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && d.step > 1) {
      let s = 1;
      while (s < Math.min(d.step, 4) && STEP_FIELDS[s].every((f) => !RULES[f]())) s++;
      if (s > 1) goTo(s, { focus: false });
    }
  } catch { /* ignore */ }
})();
