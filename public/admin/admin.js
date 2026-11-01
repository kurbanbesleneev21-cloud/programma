/* CODEFORGE admin panel — vanilla SPA over /api/admin */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1048576).toFixed(1)} МБ`);

  const filesWord = (n) => { const m10 = n % 10, m100 = n % 100; return `${n} ${m10 === 1 && m100 !== 11 ? 'файл' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'файла' : 'файлов'}`; };
  let META = null;
  let ME = null;
  const state = { q: '', status: '', service: '', budget: '', sort: 'newest', page: 1, per_page: 20 };

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { showLogin(); throw Object.assign(new Error('unauthorized'), { silent: true }); }
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    return data;
  }

  /* ---------- Toast ---------- */
  const toastEl = $('[data-toast]');
  let tt;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
    clearTimeout(tt);
    tt = setTimeout(() => { toastEl.classList.remove('is-visible'); setTimeout(() => (toastEl.hidden = true), 400); }, 2400);
  }
  const fail = (err) => { if (!err.silent) toast(err.message || 'Ошибка'); };

  /* ---------- Views ---------- */
  const loginView = $('[data-view="login"]');
  const appView = $('[data-view="app"]');
  function showLogin() {
    appView.hidden = true; loginView.hidden = false;
    $('#l-user').focus();
    fetch('/api/admin/auth-options', { credentials: 'same-origin' }).then((r) => r.json()).then((o) => { $('[data-google-login]').hidden = !o.google; }).catch(() => {});
  }
  // Errors from the Google sign-in redirect arrive as ?error=…
  const qsError = new URLSearchParams(location.search).get('error');
  if (qsError) { $('[data-login-error]').textContent = qsError; history.replaceState(null, '', location.pathname + location.hash); }
  async function showApp(me) {
    ME = typeof me === 'string' ? { user: me } : me;
    loginView.hidden = true; appView.hidden = false;
    $('[data-user]').textContent = ME.email ? `${ME.user} · ${ME.email}` : ME.user;
    if (!META) { META = await api('/meta'); fillSelects(); }
    route();
  }

  /* ---------- Login ---------- */
  const loginForm = $('[data-login]');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    const errBox = $('[data-login-error]');
    errBox.textContent = '';
    btn.classList.add('is-loading');
    try {
      await api('/login', { method: 'POST', body: { username: loginForm.username.value, password: loginForm.password.value } });
      loginForm.reset();
      await showApp(await api('/me'));
    } catch (err) {
      errBox.textContent = err.message;
    } finally {
      btn.classList.remove('is-loading');
    }
  });

  $('[data-logout]').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    showLogin();
  });

  /* ---------- Filters ---------- */
  function fillSelects() {
    const add = (sel, obj) => Object.entries(obj).forEach(([k, v]) => sel.append(new Option(v, k)));
    add($('#f-status'), META.STATUSES);
    add($('#f-service'), META.SERVICES);
    add($('#f-budget'), META.BUDGETS);
  }
  const filters = $('[data-filters]');
  let qTimer;
  filters.addEventListener('input', (e) => {
    if (e.target.name === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => applyFilters(), 300); }
  });
  filters.addEventListener('change', (e) => { if (e.target.name !== 'q') applyFilters(); });
  filters.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
  filters.addEventListener('reset', () => setTimeout(applyFilters, 0));
  function applyFilters() {
    const fd = new FormData(filters);
    Object.assign(state, { q: fd.get('q').trim(), status: fd.get('status'), service: fd.get('service'), budget: fd.get('budget'), sort: fd.get('sort'), page: 1 });
    loadList();
  }
  $$('[data-filter-status]').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.filterStatus;
    $('#f-status').value = state.status === s ? '' : s;
    applyFilters();
  }));
  $('[data-refresh]').addEventListener('click', () => { loadStats(); loadList(); });

  $('[data-export]').addEventListener('click', (e) => {
    const p = new URLSearchParams(Object.entries({ q: state.q, status: state.status, service: state.service, budget: state.budget, sort: state.sort }).filter(([, v]) => v));
    e.currentTarget.href = `/api/admin/export.csv${p.toString() ? `?${p}` : ''}`;
  });

  /* ---------- Stats ---------- */
  async function loadStats() {
    try {
      const s = await api('/stats');
      $('[data-kpi="total"]').textContent = s.total;
      $('[data-kpi="new"]').textContent = s.new;
      $('[data-kpi="in_progress"]').textContent = s.in_progress;
      $('[data-kpi="done"]').textContent = s.done;
      $('[data-kpi="lastWeek"]').textContent = `+${s.lastWeek} за 7 дней`;
      if (s.views) {
        const max = Math.max(1, ...s.views.map((v) => v.n));
        const total = s.views.reduce((a, v) => a + v.n, 0);
        const week = s.views.slice(-7).reduce((a, v) => a + v.n, 0);
        $('[data-views]').innerHTML = `
          <div class="views__head"><span class="kpi__label">Посещения сайта</span><b>${week}</b><span class="kpi__hint">за 7 дней · ${total} за 14 дней</span></div>
          <div class="views__bars">${s.views.map((v) => `<span style="--h:${(v.n / max * 100).toFixed(1)}%" title="${new Date(v.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}: ${v.n}"><i></i></span>`).join('')}</div>`;
      }
    } catch (err) { fail(err); }
  }

  /* ---------- List ---------- */
  const statusBadge = (s) => `<span class="status status--${esc(s)}">${esc(META.STATUSES[s] || s)}</span>`;
  async function loadList() {
    $$('[data-filter-status]').forEach((b) => b.classList.toggle('is-active', b.dataset.filterStatus === state.status));
    const p = new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null));
    let data;
    try { data = await api(`/orders?${p}`); } catch (err) { fail(err); return; }
    const rows = $('[data-rows]');
    rows.innerHTML = data.items.map((o) => `
      <tr data-id="${o.id}">
        <td data-col="number"><a class="row-link" href="#/orders/${o.id}">${esc(o.number)}</a></td>
        <td data-col="date" class="muted">${esc(fmtDate(o.created_at))}</td>
        <td data-col="client" class="cell-client"><b>${esc(o.name)}</b><span class="muted">${esc(o.email)}</span></td>
        <td data-col="project" class="cell-project"><b>${esc(o.project_name)}</b><span class="muted">${o.files_count ? `📎 ${filesWord(o.files_count)}` : ''}</span></td>
        <td data-col="services"><div class="tags">${o.services.map((s) => `<span class="tag">${esc(META.SERVICES[s])}</span>`).join('')}</div></td>
        <td data-col="budget" class="muted">${esc(META.BUDGETS[o.budget])}</td>
        <td data-col="status">${statusBadge(o.status)}</td>
      </tr>`).join('');
    $('[data-empty]').hidden = data.items.length > 0;
    renderPager(data.total);
  }
  $('[data-rows]').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('a')) location.hash = `#/orders/${tr.dataset.id}`;
  });

  function renderPager(total) {
    const pages = Math.max(1, Math.ceil(total / state.per_page));
    const pager = $('[data-pager]');
    const btn = (label, page, opts = {}) => `<button type="button" data-page="${page}" ${opts.disabled ? 'disabled' : ''} ${opts.current ? 'aria-current="page"' : ''} ${opts.aria ? `aria-label="${opts.aria}"` : ''}>${label}</button>`;
    let html = btn('←', state.page - 1, { disabled: state.page <= 1, aria: 'Предыдущая страница' });
    const from = Math.max(1, state.page - 2), to = Math.min(pages, state.page + 2);
    for (let i = from; i <= to; i++) html += btn(i, i, { current: i === state.page });
    html += btn('→', state.page + 1, { disabled: state.page >= pages, aria: 'Следующая страница' });
    html += `<span class="pager__info">Найдено: ${total}</span>`;
    pager.innerHTML = html;
  }
  $('[data-pager]').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    loadList();
    scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- Detail ---------- */
  async function loadDetail(id) {
    const box = $('[data-detail]');
    box.innerHTML = '<p class="muted">Загрузка…</p>';
    let o;
    try { o = await api(`/orders/${encodeURIComponent(id)}`); } catch (err) { box.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const tg = o.telegram ? `<a href="https://t.me/${encodeURIComponent(o.telegram)}" target="_blank" rel="noopener noreferrer">@${esc(o.telegram)}</a>` : '—';
    const phoneHref = o.phone.replace(/[^\d+]/g, '');
    box.innerHTML = `
      <header class="detail-head">
        <div>
          <p class="num">${esc(o.number)} · ${esc(fmtDate(o.created_at))}</p>
          <h1>${esc(o.project_name)}</h1>
        </div>
        <div class="status-picker">
          <label class="sr-only" for="d-status">Статус заявки</label>
          <select class="input select" id="d-status">${Object.entries(META.STATUSES).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        </div>
      </header>
      <div class="detail-grid">
        <div>
          <section class="panel-card">
            <h2>Проект</h2>
            <dl class="kv">
              <dt>Услуги</dt><dd><div class="tags">${o.services.map((s) => `<span class="tag">${esc(META.SERVICES[s])}</span>`).join('')}</div></dd>
              <dt>Бюджет</dt><dd>${esc(META.BUDGETS[o.budget])}</dd>
              <dt>Сроки</dt><dd>${esc(META.DEADLINES[o.deadline])}</dd>
            </dl>
          </section>
          <section class="panel-card">
            <h2>Описание идеи</h2>
            <p class="text-block">${esc(o.description)}</p>
            ${o.features ? `<h2>Функции</h2><p class="text-block">${esc(o.features)}</p>` : ''}
            ${o.references_text ? `<h2>Примеры</h2><p class="text-block">${esc(o.references_text)}</p>` : ''}
          </section>
          <section class="panel-card">
            <h2>Файлы (${o.files.length})</h2>
            ${o.files.length ? `<div class="files">${o.files.map((f) => `
              <a href="/api/admin/orders/${o.id}/files/${f.id}" download>
                <span class="ext">${esc((f.original_name.split('.').pop() || '').slice(0, 4))}</span>
                <span class="fname">${esc(f.original_name)}</span>
                <span class="fsize">${fmtSize(f.size)}</span>
              </a>`).join('')}</div>` : '<p class="muted">Клиент не прикрепил файлы.</p>'}
          </section>
        </div>
        <div>
          <section class="panel-card">
            <h2>Клиент</h2>
            <dl class="kv">
              <dt>Имя</dt><dd>${esc(o.name)}</dd>
              <dt>Email</dt><dd><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></dd>
              <dt>Телефон</dt><dd><a href="tel:${esc(phoneHref)}">${esc(o.phone)}</a></dd>
              <dt>Telegram</dt><dd>${tg}</dd>
              <dt>Связь</dt><dd><b>${esc(META.CONTACT_METHODS[o.contact_method])}</b></dd>
            </dl>
            <div class="contact-actions">
              <a class="btn btn--primary btn--sm" href="mailto:${esc(o.email)}?subject=${encodeURIComponent(`Заявка ${o.number}`)}"><span>Написать</span></a>
              <a class="btn btn--ghost btn--sm" href="tel:${esc(phoneHref)}"><span>Позвонить</span></a>
              ${o.telegram ? `<a class="btn btn--ghost btn--sm" href="https://t.me/${encodeURIComponent(o.telegram)}" target="_blank" rel="noopener"><span>Telegram</span></a>` : ''}
              ${o.contact_method === 'whatsapp' || phoneHref ? `<a class="btn btn--ghost btn--sm" href="https://wa.me/${esc(phoneHref.replace(/\D/g, ''))}" target="_blank" rel="noopener"><span>WhatsApp</span></a>` : ''}
            </div>
          </section>
          ${o.site ? `<section class="panel-card">
            <h2>Сайт клиента</h2>
            <p>Система собрала сайт по этой заявке: <b>${esc(o.site.title)}</b></p>
            <div class="contact-actions"><a class="btn btn--primary btn--sm" href="/s/${esc(o.site.slug)}" target="_blank" rel="noopener"><span>Открыть сайт ↗</span></a><a class="btn btn--ghost btn--sm" href="#/sites"><span>Управлять</span></a></div>
          </section>` : ''}
          <section class="panel-card">
            <h2>Заметка менеджера</h2>
            <label class="sr-only" for="d-note">Заметка</label>
            <textarea class="input input--area note-area" id="d-note" maxlength="5000" placeholder="Внутренние заметки: договорённости, следующий шаг…">${esc(o.admin_note)}</textarea>
            <div class="note-actions"><button type="button" class="btn btn--ghost btn--sm" data-save-note><span>Сохранить заметку</span></button></div>
          </section>
          <section class="panel-card">
            <h2>Удаление</h2>
            <p class="cms-hint">Заявка и прикреплённые файлы будут удалены безвозвратно (например, спам).</p>
            <button type="button" class="btn btn--ghost btn--sm btn--danger" data-delete-order><span>Удалить заявку</span></button>
          </section>
          <section class="panel-card">
            <h2>История</h2>
            <ul class="history">${o.history.slice().reverse().map((h) => `<li>${h.from_status ? `${esc(META.STATUSES[h.from_status])} → ` : 'Создана · '}<b>${esc(META.STATUSES[h.to_status])}</b><time>${esc(fmtDate(h.changed_at))}</time></li>`).join('')}</ul>
          </section>
        </div>
      </div>`;

    $('#d-status').addEventListener('change', async (e) => {
      try { await api(`/orders/${o.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Статус обновлён'); loadDetail(o.id); loadStats(); }
      catch (err) { fail(err); }
    });
    $('[data-delete-order]').addEventListener('click', async () => {
      if (!confirm(`Удалить заявку ${o.number} безвозвратно?`)) return;
      try { await api(`/orders/${o.id}`, { method: 'DELETE' }); toast('Заявка удалена'); location.hash = '#/orders'; }
      catch (err) { fail(err); }
    });
    $('[data-save-note]').addEventListener('click', async () => {
      try { await api(`/orders/${o.id}`, { method: 'PATCH', body: { admin_note: $('#d-note').value } }); toast('Заметка сохранена'); }
      catch (err) { fail(err); }
    });
  }

  /* ---------- Router ---------- */
  let lastHash = location.hash;
  function route() {
    const h = location.hash || '#/orders';
    const m = h.match(/^#\/orders\/(\d+)/);
    const cms = /^#\/(content|projects|media|settings|integrations|sites)/.test(h);
    $('[data-page="list"]').hidden = !!m || cms;
    $('[data-page="detail"]').hidden = !m;
    $('[data-page="cms"]').hidden = !cms;
    const isDesign = h.startsWith('#/content/design');
    $$('.sidebar__nav a[data-nav]').forEach((a) => {
      const href = a.getAttribute('href');
      const on = href === '#/content/design' ? isDesign
        : href.startsWith('#/content') ? h.startsWith('#/content') && !isDesign
          : h.startsWith(href.split('/').slice(0, 2).join('/'));
      a.classList.toggle('is-active', on);
    });
    if (cms) window.CMS.render(h);
    else if (m) loadDetail(m[1]);
    else { loadStats(); loadList(); }
    scrollTo(0, 0);
    lastHash = location.hash;
  }
  addEventListener('hashchange', () => {
    if (appView.hidden) return;
    if (window.CMS && window.CMS.isDirty() && !confirm('Есть несохранённые изменения. Уйти без сохранения?')) {
      history.replaceState(null, '', lastHash || '#/content');
      return;
    }
    if (window.CMS) window.CMS.discard();
    route();
  });
  addEventListener('beforeunload', (e) => { if (window.CMS && window.CMS.hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });

  window.ADMIN = { api, toast, fail, esc, fmtDate, fmtSize, meta: () => META, me: () => ME };

  /* ---------- Boot ---------- */
  api('/me').then((me) => showApp(me)).catch((err) => { if (!err.silent) showLogin(); });
})();
