/* Site builder wizard (/create) and client site editor (/s/<slug>/edit) */
(() => {
  'use strict';

  const root = document.querySelector('[data-builder]');
  if (!root) return;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (window.CF && window.CF.toast ? window.CF.toast(m) : alert(m));

  const MODE = root.dataset.mode;
  const EDIT = MODE === 'edit';
  const SLUG = root.dataset.slug;
  const TPL = JSON.parse(root.dataset.templates);
  const form = $('[data-bld-form]');
  const steps = $$('[data-step]');
  const stateBox = $('[data-state]');
  const MAX_ITEMS = 24, MAX_GALLERY = 12;
  const scrollToEl = (el) => {
    const top = el.getBoundingClientRect().top + scrollY - ((document.getElementById('nav') || {}).offsetHeight || 70) - 16;
    scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const model = { items: [], gallery: [], logo: '', hero: '' };
  let step = 1;
  let formToken = null;

  /* ---------- Helpers ---------- */
  const template = () => (form.querySelector('input[name=template]:checked') || {}).value || 'business';
  const val = (name) => (form.elements[name] ? String(form.elements[name].value || '').trim() : '');
  const setErr = (key, msg) => { const el = $(`[data-err="${key}"]`); if (el) el.textContent = msg || ''; };
  const clearErrs = () => $$('[data-err]').forEach((e) => (e.textContent = ''));

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Ошибка ${res.status}`), { status: res.status, fields: data.fields });
    return data;
  }

  const translit = (s) => s.toLowerCase().trim()
    .replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

  /* ---------- Uploads (photos from the phone gallery) ---------- */
  const uploadBar = $('[data-upload]');
  function upload(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)) { reject(new Error('Можно загружать только фото')); return; }
      if (file.size > 4 * 1024 * 1024) { reject(new Error(`«${file.name}» больше 4 МБ — выберите фото поменьше`)); return; }
      const fd = new FormData();
      fd.append('file', file, file.name);
      const x = new XMLHttpRequest();
      x.open('POST', '/api/sites/upload');
      uploadBar.hidden = false;
      x.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        uploadBar.querySelector('i').style.width = `${p}%`;
        uploadBar.querySelector('span').textContent = `${file.name} — ${p}%`;
      };
      x.onload = () => {
        uploadBar.hidden = true;
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* */ }
        if (x.status >= 200 && x.status < 300 && d.url) resolve(d.url);
        else reject(new Error(d.error || 'Не удалось загрузить фото'));
      };
      x.onerror = () => { uploadBar.hidden = true; reject(new Error('Нет соединения')); };
      x.send(fd);
    });
  }

  /* ---------- Single photos: logo / hero ---------- */
  function drawPhoto(key) {
    const box = $(`[data-photo="${key}"]`);
    box.querySelector('.bld-photo__pv').innerHTML = model[key] ? `<img src="${esc(model[key])}" alt="">` : '<span>нет</span>';
    box.querySelector('[data-clear]').hidden = !model[key];
  }
  ['logo', 'hero'].forEach((key) => {
    const box = $(`[data-photo="${key}"]`);
    box.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { model[key] = await upload(f); drawPhoto(key); } catch (err) { toast(err.message); }
    });
    box.querySelector('[data-clear]').addEventListener('click', () => { model[key] = ''; drawPhoto(key); });
    drawPhoto(key);
  });

  /* ---------- Gallery ---------- */
  const galleryBox = $('[data-gallery]');
  function drawGallery() {
    galleryBox.innerHTML = model.gallery.map((u, i) => `<figure><img src="${esc(u)}" alt=""><button type="button" class="bld-x" data-del-g="${i}" aria-label="Удалить">✕</button></figure>`).join('') || '<p class="bld-hint">Пока нет фото.</p>';
    $$('[data-del-g]', galleryBox).forEach((b) => b.addEventListener('click', () => { model.gallery.splice(Number(b.dataset.delG), 1); drawGallery(); }));
  }
  $('[data-gallery-input]').addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, MAX_GALLERY - model.gallery.length); e.target.value = '';
    if (!files.length) { toast(`Максимум ${MAX_GALLERY} фото`); return; }
    for (const f of files) {
      try { model.gallery.push(await upload(f)); drawGallery(); } catch (err) { toast(err.message); }
    }
  });

  /* ---------- Items (services / menu / works) ---------- */
  const itemsBox = $('[data-items]');
  function drawItems() {
    const t = TPL[template()];
    $('[data-items-title]').textContent = t.itemsLabel;
    $('[data-hero-label]').textContent = template() === 'card' ? 'Ваше фото' : 'Главное фото';
    const ph = t.sample.items;
    itemsBox.innerHTML = model.items.map((it, i) => `
      <div class="bld-item" data-i="${i}">
        <span class="bld-item__n">${i + 1}</span>
        <div class="bld-item__fields">
          <input class="input" data-k="title" maxlength="120" placeholder="${esc((ph[i % ph.length] || {}).title || t.itemLabel)}" value="${esc(it.title)}">
          <input class="input bld-item__price" data-k="price" maxlength="40" placeholder="${esc((ph[i % ph.length] || {}).price || 'Цена (необязательно)')}" value="${esc(it.price)}">
          <textarea class="input input--area" data-k="text" rows="2" maxlength="600" placeholder="${esc((ph[i % ph.length] || {}).text || 'Описание')}">${esc(it.text)}</textarea>
          ${t.itemImages ? `<div class="bld-item__img">${it.image ? `<img src="${esc(it.image)}" alt="">` : ''}<label class="btn btn--ghost btn--sm"><input type="file" accept="image/*" hidden data-item-img><span>${it.image ? 'Заменить фото' : '+ Фото'}</span></label></div>` : ''}
        </div>
        <div class="bld-item__tools">
          <button type="button" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
          <button type="button" data-mv="1" ${i === model.items.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
          <button type="button" data-del aria-label="Удалить">✕</button>
        </div>
      </div>`).join('');
    $$('.bld-item', itemsBox).forEach((row) => {
      const i = Number(row.dataset.i);
      $$('[data-k]', row).forEach((inp) => inp.addEventListener('input', () => { model.items[i][inp.dataset.k] = inp.value; }));
      row.querySelector('[data-del]').addEventListener('click', () => { model.items.splice(i, 1); drawItems(); });
      $$('[data-mv]', row).forEach((b) => b.addEventListener('click', () => {
        const j = i + Number(b.dataset.mv);
        [model.items[i], model.items[j]] = [model.items[j], model.items[i]];
        drawItems();
      }));
      const fi = row.querySelector('[data-item-img]');
      fi && fi.addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try { model.items[i].image = await upload(f); drawItems(); } catch (err) { toast(err.message); }
      });
    });
    $('[data-add-item]').hidden = model.items.length >= MAX_ITEMS;
  }
  const addItem = () => { model.items.push({ title: '', text: '', price: '', image: '' }); drawItems(); };
  $('[data-add-item]').addEventListener('click', () => { addItem(); const last = itemsBox.lastElementChild; last && last.querySelector('input').focus(); });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'template') {
      drawItems();
      const s = TPL[template()].sample;
      if (form.elements.title) form.elements.title.placeholder = `Например: ${s.title}`;
      if (form.elements.tagline) form.elements.tagline.placeholder = s.tagline;
      if (form.elements.cta) form.elements.cta.placeholder = s.cta;
    }
    if (e.target.name === 'accentCustom') { $$('input[name=accent]').forEach((r) => (r.checked = false)); }
    if (e.target.name === 'accent') { form.elements.accentCustom.value = e.target.value; }
  });

  /* ---------- Slug: auto from the title, live availability check ---------- */
  const slugInput = form.elements.slug;
  let slugTouched = false, slugTimer, slugOk = false;
  async function checkSlug() {
    const s = slugInput.value.trim().toLowerCase();
    const status = $('[data-slug-status]');
    slugOk = false;
    if (!s) { status.textContent = ''; return; }
    status.textContent = 'Проверяем…';
    try {
      const r = await api(`/api/sites/check-slug?slug=${encodeURIComponent(s)}`);
      slugOk = r.ok;
      status.textContent = r.ok ? '✓ Адрес свободен' : r.error;
      status.classList.toggle('is-bad', !r.ok);
    } catch (err) { status.textContent = err.message; }
  }
  if (slugInput) {
    slugInput.addEventListener('input', () => { slugTouched = true; slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 400); });
    form.elements.title.addEventListener('input', () => {
      if (slugTouched) return;
      slugInput.value = translit(form.elements.title.value);
      clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 500);
    });
  }

  /* ---------- Collect / fill ---------- */
  function collect() {
    const custom = form.elements.accentCustom.value;
    const picked = form.querySelector('input[name=accent]:checked');
    return {
      template: template(),
      slug: slugInput ? slugInput.value.trim().toLowerCase() : SLUG,
      data: {
        title: val('title'), tagline: val('tagline'), about: val('about'), cta: val('cta'),
        logo: model.logo, hero: model.hero, gallery: model.gallery,
        items: model.items.filter((it) => it.title.trim()),
        contacts: Object.fromEntries(['phone', 'whatsapp', 'telegram', 'email', 'instagram', 'vk', 'address', 'hours'].map((k) => [k, val(`c.${k}`)])),
        style: { theme: (form.querySelector('input[name=theme]:checked') || {}).value || 'dark', accent: picked ? picked.value : custom },
      },
      owner: EDIT ? undefined : { name: val('o.name'), email: val('o.email'), phone: val('o.phone') },
      consent: EDIT ? undefined : form.elements.consent.checked,
    };
  }

  function fill(site) {
    const d = site.data;
    const radio = form.querySelector(`input[name=template][value="${site.template}"]`);
    if (radio) radio.checked = true;
    for (const k of ['title', 'tagline', 'about', 'cta']) form.elements[k].value = d[k] || '';
    for (const [k, v] of Object.entries(d.contacts || {})) if (form.elements[`c.${k}`]) form.elements[`c.${k}`].value = v || '';
    const theme = form.querySelector(`input[name=theme][value="${d.style.theme}"]`);
    if (theme) theme.checked = true;
    const acc = form.querySelector(`input[name=accent][value="${d.style.accent}"]`);
    $$('input[name=accent]').forEach((r) => (r.checked = r === acc));
    form.elements.accentCustom.value = d.style.accent;
    Object.assign(model, { logo: d.logo, hero: d.hero, gallery: [...d.gallery], items: d.items.map((it) => ({ ...it })) });
    drawPhoto('logo'); drawPhoto('hero'); drawGallery(); drawItems();
  }

  /* ---------- Steps ---------- */
  function validateStep(n) {
    clearErrs();
    const d = collect();
    if (n === 2) {
      let ok = true;
      if (d.data.title.length < 2) { setErr('title', 'Укажите название'); ok = false; }
      if (!d.data.tagline) { setErr('tagline', 'Добавьте короткое описание'); ok = false; }
      if (slugInput && !slugOk) {
        const st = $('[data-slug-status]').textContent;
        setErr('slug', st && !/свободен|Проверяем/.test(st) ? st : 'Выберите свободный адрес сайта');
        ok = false;
      }
      return ok;
    }
    if (n === 5) {
      const c = d.data.contacts;
      let ok = true;
      if (!c.phone && !c.email && !c.telegram && !c.whatsapp) { setErr('contacts', 'Укажите хотя бы один способ связи: телефон, WhatsApp, Telegram или email'); ok = false; }
      if (!EDIT) {
        if (d.owner.name.length < 2) { setErr('owner_name', 'Укажите имя'); ok = false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.owner.email)) { setErr('owner_email', 'Укажите email — на него придёт ссылка на кабинет'); ok = false; }
        if (!d.consent) { setErr('consent', 'Нужно согласие'); ok = false; }
      }
      return ok;
    }
    return true;
  }
  function go(n) {
    step = Math.max(1, Math.min(steps.length, n));
    steps.forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
    $$('[data-progress]').forEach((li) => { const k = Number(li.dataset.progress); li.classList.toggle('is-active', k === step); li.classList.toggle('is-done', k < step); });
    $('[data-prev]').hidden = step === 1;
    $('[data-next]').hidden = step === steps.length;
    $('[data-submit]').hidden = step !== steps.length;
    scrollToEl(form);
  }
  $('[data-next]').addEventListener('click', async () => {
    if (step === 2 && slugInput && !slugOk && slugInput.value) { clearTimeout(slugTimer); await checkSlug(); }
    if (validateStep(step)) go(step + 1);
  });
  $('[data-prev]').addEventListener('click', () => go(step - 1));
  $$('[data-progress]').forEach((li) => li.addEventListener('click', () => {
    const k = Number(li.dataset.progress);
    if (EDIT || k < step || (k === step + 1 && validateStep(step))) go(k);
  }));

  /* ---------- Submit ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(5) || (!EDIT && !validateStep(2))) { if (!EDIT && !validateStep(2)) go(2); return; }
    const btn = $('[data-submit]');
    btn.classList.add('is-loading');
    setErr('form', '');
    const body = collect();
    try {
      if (EDIT) {
        await api(`/api/sites/${encodeURIComponent(SLUG)}`, { method: 'PUT', body });
        toast('Сохранено — изменения уже на сайте');
      } else {
        const r = await api('/api/sites', { method: 'POST', body: { ...body, form_token: formToken, company_site: form.elements.company_site.value } });
        try { localStorage.removeItem('cf-builder-draft'); } catch { /* */ }
        showCreated(r);
      }
    } catch (err) {
      if (err.fields) {
        for (const [k, m] of Object.entries(err.fields)) setErr(k, m);
        if (err.fields.slug || err.fields.title || err.fields.tagline) go(2);
      }
      setErr('form', err.message);
      if (/устарела|быстро/.test(err.message)) getToken();
    } finally { btn.classList.remove('is-loading'); }
  });

  function showCreated(r) {
    form.hidden = true;
    stateBox.hidden = false;
    stateBox.innerHTML = `
      <div class="bld-done glass">
        <div class="bld-done__icon" aria-hidden="true">✓</div>
        <h2>Сайт создан!</h2>
        <p>${r.status === 'active' ? 'Сайт уже опубликован.' : 'Сайт открыт в режиме предпросмотра и будет опубликован после оплаты — мы свяжемся с вами.'}</p>
        <a class="btn btn--primary btn--lg" href="${esc(r.url)}" target="_blank" rel="noopener"><span>Открыть мой сайт</span></a>
        <div class="bld-done__key">
          <b>Ссылка для редактирования — сохраните её!</b>
          <p>${r.emailSent ? 'Мы также отправили её на вашу почту.' : 'Это единственный способ вернуться к редактированию сайта.'}</p>
          <div class="bld-done__row"><input class="input" readonly value="${esc(r.editUrl)}"><button type="button" class="btn btn--ghost btn--sm" data-copy><span>Копировать</span></button></div>
          <a href="${esc(r.editUrl)}">Перейти к редактированию →</a>
        </div>
      </div>`;
    stateBox.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(r.editUrl); toast('Ссылка скопирована'); } catch { stateBox.querySelector('input').select(); }
    });
    requestAnimationFrame(() => scrollToEl(stateBox));
  }

  /* ---------- Draft autosave (create mode) ---------- */
  function saveDraft() {
    if (EDIT) return;
    try { const d = collect(); delete d.consent; localStorage.setItem('cf-builder-draft', JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* */ }
  }
  function restoreDraft() {
    let d;
    try { d = JSON.parse(localStorage.getItem('cf-builder-draft') || 'null'); } catch { d = null; }
    if (!d || Date.now() - d.savedAt > 7 * 864e5) return;
    fill({ template: d.template, data: { ...d.data, contacts: d.data.contacts || {}, style: d.data.style || { theme: 'dark', accent: '#6d5dfc' } } });
    if (d.slug) { slugInput.value = d.slug; slugTouched = true; checkSlug(); }
    if (d.owner) for (const k of ['name', 'email', 'phone']) form.elements[`o.${k}`].value = d.owner[k] || '';
  }
  let draftTimer;
  form.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 600); });
  form.addEventListener('change', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 600); });

  async function getToken() {
    try { formToken = (await api('/api/form-token')).token; } catch (err) { setErr('form', err.message); }
  }

  /* ---------- Boot ---------- */
  async function bootEdit() {
    $$('[data-step]').forEach((s) => (s.hidden = false));
    $('.bld-progress').hidden = true;
    $('[data-next]').hidden = true; $('[data-prev]').hidden = true; $('[data-submit]').hidden = false;
    const view = $('[data-view]');
    if (view) view.href = `/s/${SLUG}`;
    const m = location.hash.match(/key=([\w-]+)/);
    if (m) {
      try { await api(`/api/sites/${encodeURIComponent(SLUG)}/session`, { method: 'POST', body: { key: m[1] } }); }
      catch (err) { showNoAccess(err.message); return; }
      history.replaceState(null, '', location.pathname); // don't keep the secret in the address bar
    }
    try {
      const r = await api(`/api/sites/${encodeURIComponent(SLUG)}`);
      fill(r.site);
      const st = document.createElement('p');
      st.className = `bld-status bld-status--${r.site.status}`;
      st.textContent = `Статус: ${r.statusLabel}`;
      form.prepend(st);
    } catch (err) { showNoAccess(err.message); }
  }
  function showNoAccess(msg) {
    form.hidden = true;
    stateBox.hidden = false;
    stateBox.innerHTML = `<div class="bld-done glass"><h2>Нет доступа</h2><p>${esc(msg)}</p><p class="bld-hint">Откройте ссылку для редактирования из письма или со страницы создания сайта.</p><a class="btn btn--primary" href="/s/${esc(SLUG)}"><span>Посмотреть сайт</span></a></div>`;
  }

  if (EDIT) bootEdit();
  else {
    model.items = [{ title: '', text: '', price: '', image: '' }, { title: '', text: '', price: '', image: '' }];
    drawItems(); drawGallery();
    restoreDraft();
    getToken();
  }
})();
