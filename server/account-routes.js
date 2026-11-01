'use strict';

// Client accounts: /account page (sign in with Google, orders, sites), small JSON API,
// and the admin list of registered clients.

const { readClient, clientCookie, COOKIE } = require('./clients');
const { getSettings } = require('./settings');
const google = require('./google');
const { STATUSES, SERVICES } = require('./constants');
const sitesLib = require('./sites');
const { esc, head, bodyOpen, bodyClose, ARROW } = require('./views/partials');

const fmtDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const G_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';

function mountAccount(app, api, d) {
  const { wrap, needStore, siteContent, originOf, requireAdmin, sec, HttpError } = d;
  const clientOf = (req) => readClient(sec.parseCookies(req.get('cookie'))[COOKIE]);

  app.get('/account', wrap(async (req, res) => {
    const c = await siteContent();
    const origin = originOf(req);
    const store = await needStore();
    const st = await getSettings(store);
    const me = clientOf(req);
    const error = typeof req.query.error === 'string' ? req.query.error.slice(0, 300) : '';
    let body;

    if (!me) {
      body = `
    <section class="cab">
      <div class="container cab__inner">
        <div class="cab-card glass cab-login">
          <span class="cab-login__icon" aria-hidden="true">${G_ICON}</span>
          <h1 class="section-title">Личный кабинет</h1>
          <p class="section-subtitle">Войдите через Google — без паролей и подтверждений. В кабинете будут ваши заявки, их статусы и ваши сайты.</p>
          ${error ? `<p class="cab-error" role="alert">${esc(error)}</p>` : ''}
          ${google.keysSet(st)
            ? `<a class="btn btn--primary btn--lg cab-google" href="/api/admin/google/start?mode=client">${G_ICON}<span>Войти через Google</span></a>`
            : '<p class="cab-error">Вход через Google скоро заработает.</p>'}
          <a class="cab-link" href="/#order">Оформить заказ без регистрации →</a>
        </div>
      </div>
    </section>`;
    } else {
      const [orders, sites] = await Promise.all([store.ordersByEmail(me.email), store.sitesByEmail(me.email)]);
      const initials = esc((me.name || me.email).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
      body = `
    <section class="cab">
      <div class="container cab__inner">
        <header class="cab-head glass">
          <span class="cab-avatar">${me.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : initials}</span>
          <div class="cab-head__who"><p class="eyebrow">Личный кабинет</p><h1>${esc(me.name || me.email)}</h1><p>${esc(me.email)}</p></div>
          <form method="post" action="/api/account/logout" class="cab-head__out"><button class="btn btn--ghost btn--sm" type="submit"><span>Выйти</span></button></form>
        </header>

        <div class="cab-grid">
          <section class="cab-card glass">
            <div class="cab-card__head"><h2>Мои заявки</h2><a class="btn btn--primary btn--sm" href="/#order"><span>Новая заявка</span>${ARROW}</a></div>
            ${orders.length ? `<ul class="cab-orders">${orders.map((o) => `
              <li>
                <div><b>${esc(o.project_name)}</b><small>${esc(o.number)} · ${esc(fmtDate(o.created_at))}</small><small>${esc((o.services || []).map((s) => SERVICES[s] || s).join(', '))}</small></div>
                <span class="cab-status cab-status--${esc(o.status)}">${esc(STATUSES[o.status] || o.status)}</span>
              </li>`).join('')}</ul>`
            : '<p class="cab-empty">Заявок пока нет. Оформите первую — она сразу появится здесь.</p>'}
          </section>

          <section class="cab-card glass">
            <div class="cab-card__head"><h2>Мои сайты</h2></div>
            ${sites.length ? `<ul class="cab-sites">${sites.map((s) => `
              <li>
                <span class="cab-sites__pv" style="--accent:${esc(s.data.style.accent)}">${s.data.hero || s.data.logo ? `<img src="${esc(s.data.hero || s.data.logo)}" alt="" loading="lazy">` : esc((s.data.title || '?').slice(0, 1))}</span>
                <div><b>${esc(s.data.title)}</b><small>${esc(sitesLib.STATUSES[s.status] || s.status)}</small>
                  <span class="cab-sites__btns"><a class="btn btn--ghost btn--sm" href="/s/${esc(s.slug)}" target="_blank" rel="noopener"><span>Открыть</span></a><a class="btn btn--primary btn--sm" href="/s/${esc(s.slug)}/edit"><span>Редактировать</span></a></span></div>
              </li>`).join('')}</ul>`
            : '<p class="cab-empty">Когда вы закажете сайт, система сразу соберёт его по вашему описанию — он появится здесь.</p>'}
          </section>
        </div>
      </div>
    </section>`;
    }

    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).type('html').send(`${head({ c, origin, title: `Личный кабинет — ${c.brand.name}`, description: 'Заявки и сайты клиента', canonical: '/account', noindex: true })}
${bodyOpen(c)}
  <main id="main">${body}
  </main>
${bodyClose(c)}`);
  }));

  app.get('/api/account/me', wrap(async (req, res) => {
    const me = clientOf(req);
    let googleOn = false;
    try { googleOn = google.keysSet(await getSettings(await needStore())); } catch { /* db down */ }
    res.set('Cache-Control', 'no-store').json({ client: me, google: googleOn });
  }));

  // Plain form POST from the account page (same-origin check is done by the /api middleware).
  app.post('/api/account/logout', (req, res) => {
    res.set('Set-Cookie', clientCookie(null, 0)).redirect(303, '/account');
  });

  api.get('/clients', requireAdmin, wrap(async (req, res) => {
    const list = await req.store.listClients();
    res.json({ items: list });
  }));

  return { clientOf };
}

module.exports = { mountAccount };
