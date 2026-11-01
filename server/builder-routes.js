'use strict';

// HTTP routes of the site builder: public wizard + API, client cabinet, admin management.

const express = require('express');
const sites = require('./sites');
const { renderSite, siteStatusPage } = require('./views/site');
const { renderBuilder } = require('./views/builder');
const { mediaUpload, persistMedia, UploadError } = require('./uploads');
const telegram = require('./telegram');
const config = require('./config');

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOUR = 60 * 60 * 1000;

function mountBuilder(app, api, d) {
  const { wrap, HttpError, needStore, siteContent, originOf, clientIp, limit, requireAdmin, sec, isAdmin } = d;
  const json = express.json({ limit: '256kb' });

  const builderOn = async () => {
    const c = await siteContent();
    if (!c.builder.enabled) throw new HttpError(404, 'Конструктор сайтов отключён');
    return c;
  };
  const cookieOf = (req) => sec.parseCookies(req.get('cookie'))[sites.SITE_COOKIE];
  const isOwner = (req, site) => sites.readSiteSession(cookieOf(req), site);
  const siteBySlug = async (store, slug) => {
    const s = String(slug || '').toLowerCase();
    return /^[a-z0-9-]{3,40}$/.test(s) ? store.getSiteBySlug(s) : null;
  };
  const editUrl = (origin, site, token) => `${origin}/s/${site.slug}/edit#key=${token}`;

  async function announce(store, site, origin) {
    const t = sites.TEMPLATES[site.template];
    const text = [
      `<b>🌐 Новый сайт из конструктора</b>`,
      '',
      `<b>${escHtml(site.data.title)}</b> — ${escHtml(t ? t.name : site.template)}`,
      `${origin}/s/${site.slug}`,
      `Статус: ${escHtml(sites.STATUSES[site.status])}`,
      '',
      `<b>Владелец:</b> ${escHtml(site.owner_name)}`,
      `<b>Email:</b> ${escHtml(site.owner_email)}`,
      site.owner_phone ? `<b>Телефон:</b> ${escHtml(site.owner_phone)}` : null,
    ].filter((l) => l !== null).join('\n');
    await telegram.notifyText(store, text).catch((err) => console.error('[builder] telegram:', err.message));
  }

  /* ---------- Public pages ---------- */
  app.get('/create', wrap(async (req, res, next) => {
    const c = await siteContent();
    if (!c.builder.enabled) return next();
    res.set('Cache-Control', 'no-cache').type('html').send(renderBuilder(c, { origin: originOf(req) }));
  }));

  app.get('/s/:slug', wrap(async (req, res, next) => {
    const store = await needStore();
    const site = await siteBySlug(store, req.params.slug);
    if (!site) return next();
    const c = await siteContent();
    const owner = isOwner(req, site);
    const admin = isAdmin(req);
    const origin = originOf(req);
    res.set('Cache-Control', 'no-store');
    if (site.status === 'suspended' && !owner && !admin) {
      return res.status(410).type('html').send(siteStatusPage({ title: 'Сайт отключён', text: 'Этот сайт временно недоступен.', origin, brand: c.brand.name }));
    }
    res.type('html').send(renderSite(site, { origin, brand: c.brand.name, preview: site.status !== 'active', canEdit: owner || admin }));
  }));

  app.get('/s/:slug/edit', wrap(async (req, res, next) => {
    const store = await needStore();
    const site = await siteBySlug(store, req.params.slug);
    if (!site) return next();
    const c = await siteContent();
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).type('html').send(renderBuilder(c, { origin: originOf(req), mode: 'edit', slug: site.slug }));
  }));

  /* ---------- Public API ---------- */
  app.get('/api/sites/check-slug', wrap(async (req, res) => {
    await builderOn();
    const store = await needStore();
    await limit(store, 'slug', sec.ipHash(clientIp(req)), 120, HOUR, 'Слишком много запросов. Попробуйте позже.');
    const slug = String(req.query.slug || '').toLowerCase();
    const err = sites.slugError(slug);
    if (err) return res.json({ ok: false, error: err });
    const taken = Boolean(await store.getSiteBySlug(slug));
    res.json({ ok: !taken, error: taken ? 'Этот адрес уже занят' : null });
  }));

  // Photos uploaded by clients while building their site (images only, rate limited).
  app.post('/api/sites/upload', wrap(async (req, res, next) => {
    await builderOn();
    const store = await needStore();
    await limit(store, 'site_upload', sec.ipHash(clientIp(req)), 40, HOUR, 'Слишком много загрузок. Попробуйте через час.');
    next();
  }), mediaUpload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw new UploadError('Выберите файл');
    if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(req.file.originalname)) throw new UploadError('Можно загружать только фото: JPG, PNG, WEBP');
    const saved = await persistMedia(req.file);
    res.status(201).json({ url: saved.url });
  }));

  app.post('/api/sites', json, wrap(async (req, res) => {
    const c = await builderOn();
    const store = await needStore();
    const b = req.body || {};
    if (b.company_site) return res.status(201).json({ ok: true, slug: 'ok', url: '/' }); // honeypot
    const token = sec.verifyFormToken(b.form_token);
    if (!token.ok) {
      throw new HttpError(400, token.reason === 'too_fast' ? 'Форма отправлена слишком быстро. Проверьте данные и попробуйте снова.' : 'Сессия формы устарела. Обновите страницу.');
    }
    await limit(store, 'site_create', sec.ipHash(clientIp(req)), 5, HOUR, 'Слишком много новых сайтов с вашего адреса. Попробуйте через час.');

    const template = sites.TEMPLATES[b.template] ? b.template : null;
    const data = sites.normalizeData(b.data);
    const fields = sites.validateData(data);
    const slug = String(b.slug || '').toLowerCase().trim();
    const slugErr = sites.slugError(slug);
    if (slugErr) fields.slug = slugErr;
    const owner = b.owner || {};
    const ownerName = String(owner.name || '').trim().slice(0, 100);
    const ownerEmail = String(owner.email || '').trim().toLowerCase().slice(0, 120);
    const ownerPhone = String(owner.phone || '').trim().slice(0, 40);
    if (ownerName.length < 2) fields.owner_name = 'Укажите имя';
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(ownerEmail)) fields.owner_email = 'Укажите корректный email — на него придёт ссылка на кабинет';
    if (b.consent !== true) fields.consent = 'Нужно согласие с условиями';
    if (!template) fields.template = 'Выберите шаблон';
    if (Object.keys(fields).length) throw new HttpError(422, 'Проверьте правильность заполнения', { fields });
    if (await store.getSiteBySlug(slug)) throw new HttpError(409, 'Этот адрес уже занят', { fields: { slug: 'Этот адрес уже занят' } });
    if (!(await store.consumeToken(token.nonce))) throw new HttpError(409, 'Этот сайт уже создан');

    const editToken = sites.newToken();
    let site;
    try {
      site = await store.createSite({
        slug, template, data,
        status: c.builder.publishImmediately ? 'active' : 'draft',
        owner_name: ownerName, owner_email: ownerEmail, owner_phone: ownerPhone,
        token_hash: sites.hashToken(editToken),
        ip_hash: sec.ipHash(clientIp(req)),
      });
    } catch (err) {
      await store.releaseToken(token.nonce).catch(() => {});
      if (/unique|constraint/i.test(err.message)) throw new HttpError(409, 'Этот адрес уже занят', { fields: { slug: 'Этот адрес уже занят' } });
      throw err;
    }
    const origin = originOf(req);
    await announce(store, site, origin);
    await d.sendSiteEmail(site, editUrl(origin, site, editToken), origin).catch((err) => console.error('[builder] email:', err.message));
    res.status(201).set('Set-Cookie', sites.siteCookie(cookieOf(req), site)).json({
      ok: true, slug: site.slug, status: site.status,
      url: `${origin}/s/${site.slug}`, editUrl: editUrl(origin, site, editToken),
      emailSent: Boolean(config.smtp.host && config.smtp.from),
    });
  }));

  // Exchange the secret link from the e-mail for a cabinet cookie.
  app.post('/api/sites/:slug/session', json, wrap(async (req, res) => {
    const store = await needStore();
    const key = sec.ipHash(clientIp(req));
    if ((await store.countEvents('site_key_fail', key, HOUR)) >= 20) throw new HttpError(429, 'Слишком много попыток. Попробуйте через час.');
    const site = await siteBySlug(store, req.params.slug);
    if (!site || !sites.tokenMatches(site, (req.body || {}).key)) {
      await store.addEvent('site_key_fail', key);
      throw new HttpError(401, 'Ссылка недействительна. Запросите новую у администратора.');
    }
    res.set('Set-Cookie', sites.siteCookie(cookieOf(req), site)).json({ ok: true });
  }));

  const ownSite = async (req) => {
    const store = await needStore();
    const site = await siteBySlug(store, req.params.slug);
    if (!site) throw new HttpError(404, 'Сайт не найден');
    if (!isOwner(req, site) && !isAdmin(req)) throw new HttpError(401, 'Откройте ссылку из письма, чтобы редактировать сайт.');
    return { store, site };
  };

  app.get('/api/sites/:slug', wrap(async (req, res) => {
    const { site } = await ownSite(req);
    res.set('Cache-Control', 'no-store').json({ site: sites.publicSite(site), statusLabel: sites.STATUSES[site.status] });
  }));

  app.put('/api/sites/:slug', json, wrap(async (req, res) => {
    const { store, site } = await ownSite(req);
    const b = req.body || {};
    const data = sites.normalizeData(b.data);
    const fields = sites.validateData(data);
    if (Object.keys(fields).length) throw new HttpError(422, 'Проверьте правильность заполнения', { fields });
    const template = sites.TEMPLATES[b.template] ? b.template : site.template;
    const updated = await store.updateSite(site.id, { data, template });
    res.json({ ok: true, site: sites.publicSite(updated) });
  }));

  /* ---------- Admin ---------- */
  api.get('/sites', requireAdmin, wrap(async (req, res) => {
    const list = await req.store.listSites();
    res.json({ items: list.map(sites.publicSite), statuses: sites.STATUSES, templates: Object.fromEntries(Object.entries(sites.TEMPLATES).map(([k, t]) => [k, t.name])) });
  }));

  const adminSite = async (req) => {
    const id = Number(req.params.id);
    const site = Number.isSafeInteger(id) && id > 0 ? await req.store.getSite(id) : null;
    if (!site) throw new HttpError(404, 'Сайт не найден');
    return site;
  };

  api.patch('/sites/:id', requireAdmin, wrap(async (req, res) => {
    const site = await adminSite(req);
    const status = (req.body || {}).status;
    if (!sites.STATUSES[status]) throw new HttpError(422, 'Некорректный статус');
    const patch = { status };
    if (status === 'active' && !site.paid_at && (req.body || {}).markPaid) patch.paid_at = new Date().toISOString();
    res.json({ ok: true, site: sites.publicSite(await req.store.updateSite(site.id, patch)) });
  }));

  api.post('/sites/:id/link', requireAdmin, wrap(async (req, res) => {
    const site = await adminSite(req);
    const token = sites.newToken();
    const updated = await req.store.updateSite(site.id, { token_hash: sites.hashToken(token) });
    res.json({ ok: true, editUrl: editUrl(originOf(req), updated, token) });
  }));

  api.delete('/sites/:id', requireAdmin, wrap(async (req, res) => {
    const site = await adminSite(req);
    await req.store.deleteSite(site.id);
    res.json({ ok: true });
  }));
}

module.exports = { mountBuilder };
