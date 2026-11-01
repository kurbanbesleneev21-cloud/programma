'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');

const config = require('./config');
const constants = require('./constants');
const { createStore } = require('./db');
const sec = require('./security');
const { orderSchema, adminUpdateSchema, listQuerySchema, formatZodError, emailDomainAccepts } = require('./validation');
const { upload, mediaUpload, persistFiles, persistMedia, describeMedia, verifyDirectUpload, removeFiles, readStoredFile, UploadError, MEDIA_LIMITS } = require('./uploads');
const { storage } = require('./storage');
const { notifyNewOrder, sendSiteEmail } = require('./notify');
const { mountBuilder } = require('./builder-routes');
const sitesLib = require('./sites');
const aiSite = require('./ai-site');
const { DEFAULTS, normalize, getContent, saveContent, invalidateContent } = require('./content');
const { getSettings, updateSettings, publicView, aiKey } = require('./settings');
const telegram = require('./telegram');
const google = require('./google');
const { ICONS } = require('./views/icons');
const { SOCIAL_ICONS } = require('./views/partials');
const { renderHome } = require('./views/home');
const { renderProjectPage, contentPage, maintenancePage } = require('./render');

const PUBLIC_DIR = path.join(config.ROOT, 'public');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.expose = true; Object.assign(this, extra); }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const HOUR = 60 * 60 * 1000;
// Yandex Metrika / Google Analytics (loaded only when their IDs are set in the admin panel).
const ANALYTICS_HOSTS = 'https://mc.yandex.ru https://mc.yandex.com https://yastatic.net https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com';
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|vercel|lighthouse|headless/i;
const PAGE_CACHE = 'public, max-age=0, s-maxage=10, stale-while-revalidate=60';

function createApp({ store: injected } = {}) {
  /* ---------- Lazy store: pages render (with defaults) even if the DB is unreachable ---------- */
  let storePromise = injected ? Promise.resolve(injected) : null;
  const getStore = () => {
    if (!storePromise) {
      storePromise = createStore().catch((err) => { storePromise = null; throw err; });
    }
    return storePromise;
  };
  const needStore = async () => {
    try { return await getStore(); } catch (err) {
      console.error('[db]', err.message);
      throw new HttpError(503, config.isVercel && !config.databaseUrl
        ? 'База данных не подключена: добавьте DATABASE_URL в настройках проекта Vercel.'
        : 'База данных временно недоступна. Попробуйте позже.');
    }
  };
  const siteContent = async () => getContent(await getStore().catch(() => null));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || config.isVercel ? 1 : false);

  /* ---------- Security headers ---------- */
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        `script-src 'self' ${ANALYTICS_HOSTS}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' https:",
        `connect-src 'self' ${[config.supabase.url, ANALYTICS_HOSTS].filter(Boolean).join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  const originOf = (req) => (process.env.SITE_URL ? config.siteUrl : `${req.protocol}://${req.get('host')}`);

  // Reject cross-site state-changing requests (CSRF defence in depth on top of SameSite cookies).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = ''; }
      if (host !== req.get('host')) return next(new HttpError(403, 'Запрос с другого домена отклонён'));
    }
    next();
  });

  const clientIp = (req) => req.ip || req.socket.remoteAddress || 'unknown';

  // Rate limits live in the database so they hold across serverless instances.
  async function limit(store, kind, key, max, windowMs, message) {
    if ((await store.countEvents(kind, key, windowMs)) >= max) throw new HttpError(429, message);
    await store.addEvent(kind, key);
  }

  /* ---------- Public API ---------- */

  app.get('/api/health', wrap(async (req, res) => {
    let db = 'unavailable';
    try { db = (await getStore()).kind; } catch { /* reported below */ }
    res.json({ ok: db !== 'unavailable', db, storage: storage.kind, vercel: config.isVercel, sessionSecret: Boolean(config.sessionSecret) });
  }));

  // Telegram → bot updates. The secret is in the path and in the header Telegram sends back.
  app.post('/api/telegram/webhook/:secret', express.json({ limit: '1mb' }), wrap(async (req, res) => {
    const store = await needStore();
    const st = await getSettings(store);
    const secretOk = st.telegram.webhookSecret
      && sec.safeEqual(req.params.secret, st.telegram.webhookSecret)
      && sec.safeEqual(String(req.get('x-telegram-bot-api-secret-token') || ''), st.telegram.webhookSecret);
    if (!secretOk) throw new HttpError(404, 'Not found');
    try {
      await telegram.handleUpdate(store, req.body || {}, { origin: originOf(req) });
    } catch (err) {
      console.error('[telegram] update failed:', err.message); // always 200, or Telegram retries forever
    }
    res.json({ ok: true });
  }));

  app.get('/api/form-token', wrap(async (req, res) => {
    const store = await needStore();
    await limit(store, 'token', sec.ipHash(clientIp(req)), 60, 10 * 60 * 1000, 'Слишком много запросов. Попробуйте позже.');
    res.set('Cache-Control', 'no-store').json({ token: sec.issueFormToken() });
  }));

  app.post(
    '/api/orders',
    wrap(async (req, res, next) => {
      const store = await needStore();
      const c = await getContent(store);
      if (!c.order.acceptingOrders) throw new HttpError(403, c.order.closedMessage || 'Приём заявок временно закрыт.');
      await limit(store, 'order', sec.ipHash(clientIp(req)), config.orderRateLimit, HOUR,
        'Слишком много заявок с вашего адреса. Попробуйте через час или напишите нам на почту.');
      req.store = store;
      req.siteContent = c;
      next();
    }),
    upload.array('files', config.uploads.maxFiles),
    wrap(async (req, res) => {
      const { store } = req;
      const body = req.body || {};

      // Honeypot: real users never see this field. Answer like a success so bots learn nothing.
      if (body.company_site) {
        return res.status(201).json({ ok: true, number: sec.generateOrderNumber(), created_at: new Date().toISOString() });
      }

      const token = sec.verifyFormToken(body.form_token);
      if (!token.ok) {
        const msg = token.reason === 'too_fast'
          ? 'Форма отправлена слишком быстро. Пожалуйста, проверьте данные и отправьте ещё раз.'
          : 'Сессия формы устарела. Обновите страницу и попробуйте снова.';
        throw new HttpError(400, msg, { code: `token_${token.reason}` });
      }

      let services = body.services;
      if (typeof services === 'string') { try { services = JSON.parse(services); } catch { /* comma list */ } }
      const parsed = orderSchema.safeParse({ ...body, services });
      if (!parsed.success) {
        const fields = formatZodError(parsed.error);
        // object-level rules don't run while other fields are invalid — report them together
        if (body.contact_method === 'telegram' && !String(body.telegram || '').trim() && !fields.telegram) {
          fields.telegram = 'Укажите Telegram или выберите другой способ связи';
        }
        throw new HttpError(422, 'Проверьте правильность заполнения полей', { fields });
      }
      const data = parsed.data;

      if (config.emailMxCheck && !(await emailDomainAccepts(data.email))) {
        throw new HttpError(422, 'Проверьте правильность заполнения полей', {
          fields: { email: 'Домен этого адреса не принимает почту. Проверьте адрес.' },
        });
      }

      if (!(await store.consumeToken(token.nonce))) throw new HttpError(409, 'Эта заявка уже была отправлена.', { code: 'duplicate' });

      let files;
      try {
        files = await persistFiles(req.files);
      } catch (err) {
        await store.releaseToken(token.nonce); // let the client fix the file and resend with the same token
        throw err;
      }
      try {
        let number;
        for (let i = 0; i < 5; i++) {
          number = sec.generateOrderNumber();
          if (!(await store.numberExists(number))) break;
        }
        const order = {
          ...data,
          number,
          search_text: [number, data.project_name, data.name, data.email, data.phone, data.telegram, data.description]
            .join(' ').toLowerCase(),
          ip_hash: sec.ipHash(clientIp(req)),
          user_agent: String(req.get('user-agent') || '').slice(0, 300),
        };
        const saved = await store.createOrder(order, files);
        const n = req.siteContent.notifications;
        // On serverless the function may freeze right after responding, so notifications are awaited (with timeouts).
        await notifyNewOrder({ ...order, id: saved.id }, files.length, { origin: originOf(req), settings: n, store });

        // A website/shop order instantly gets its own draft site; Claude then fills it in (separate request).
        let site = null;
        if (req.siteContent.builder.autoFromOrders && aiSite.wantsSite(order)) {
          try {
            const editToken = sitesLib.newToken();
            const draft = aiSite.draftFromOrder(order);
            const created = await store.createSite({
              slug: await aiSite.uniqueSlug(store, order.project_name),
              template: aiSite.guessTemplate(`${order.project_name} ${order.description}`),
              data: draft,
              status: req.siteContent.builder.publishImmediately ? 'active' : 'draft',
              owner_name: order.name, owner_email: order.email, owner_phone: order.phone,
              token_hash: sitesLib.hashToken(editToken),
              ip_hash: order.ip_hash,
              order_number: saved.number,
            });
            const st = await getSettings(store);
            const origin = originOf(req);
            site = {
              slug: created.slug,
              url: `${origin}/s/${created.slug}`,
              editUrl: `${origin}/s/${created.slug}/edit#key=${editToken}`,
              status: created.status,
              ai: Boolean(aiKey(st)),
            };
            res.set('Set-Cookie', sitesLib.siteCookie(sec.parseCookies(req.get('cookie'))[sitesLib.SITE_COOKIE], created));
          } catch (err) {
            console.error('[order] auto site failed:', err.message); // the order itself is already saved
          }
        }

        res.status(201).json({
          ok: true,
          number: saved.number,
          created_at: saved.created_at,
          confirmation_sent: Boolean(config.smtp.host && config.smtp.from && n.clientConfirmation),
          site,
        });
      } catch (err) {
        await removeFiles(files.map((f) => f.storedName));
        await store.releaseToken(token.nonce).catch(() => {});
        throw err;
      }
    })
  );

  /* ---------- Admin API ---------- */

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/content', express.json({ limit: '1mb' }));
  api.use(express.json({ limit: '32kb' }));

  api.post('/login', wrap(async (req, res) => {
    const store = await needStore();
    const key = sec.ipHash(clientIp(req));
    if ((await store.countEvents('login_fail', key, 15 * 60 * 1000)) >= 8) {
      throw new HttpError(429, 'Слишком много попыток входа. Повторите через 15 минут.');
    }
    const dbHash = await store.getKv('admin_password_hash');
    if (!sec.adminConfigured(dbHash)) {
      throw new HttpError(503, 'Администратор не настроен: задайте ADMIN_PASSWORD_HASH (или ADMIN_PASSWORD) в переменных окружения.');
    }
    const { username, password } = req.body || {};
    if (!sec.checkAdminCredentials(username, password, dbHash)) {
      await store.addEvent('login_fail', key);
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    await store.clearEvents('login_fail', key);
    res.set('Set-Cookie', sec.sessionCookie(sec.createSession(config.admin.user), sec.SESSION_TTL_MS));
    res.json({ ok: true, user: config.admin.user });
  }));

  // Login screen asks which sign-in methods are available.
  api.get('/auth-options', wrap(async (req, res) => {
    let googleOn = false;
    try { googleOn = google.configured(await getSettings(await getStore())); } catch { /* db down */ }
    res.json({ google: googleOn });
  }));

  api.get('/google/start', wrap(async (req, res) => {
    const st = await getSettings(await needStore());
    const { url, cookie } = google.startUrl(st, originOf(req));
    res.set('Set-Cookie', cookie).redirect(302, url);
  }));

  api.get('/google/callback', async (req, res) => {
    const back = (msg) => res.set('Set-Cookie', google.stateCookie('', 0)).redirect(302, `/admin/${msg ? `?error=${encodeURIComponent(msg)}` : ''}`);
    try {
      if (req.query.error) return back(req.query.error === 'access_denied' ? 'Вход через Google отменён' : `Google: ${req.query.error}`);
      const store = await needStore();
      const key = sec.ipHash(clientIp(req));
      if ((await store.countEvents('login_fail', key, 15 * 60 * 1000)) >= 8) return back('Слишком много попыток входа. Повторите через 15 минут.');
      const st = await getSettings(store);
      const cookieState = sec.parseCookies(req.get('cookie'))[google.STATE_COOKIE];
      let who;
      try {
        who = await google.finish(st, { code: String(req.query.code || ''), state: String(req.query.state || ''), cookieState, origin: originOf(req) });
      } catch (err) {
        if (err.status === 403) await store.addEvent('login_fail', key);
        throw err;
      }
      res.append('Set-Cookie', sec.sessionCookie(sec.createSession(config.admin.user, { method: 'google', email: who.email }), sec.SESSION_TTL_MS));
      return back('');
    } catch (err) {
      if (!err.expose) console.error('[google]', err);
      return back(err.expose ? err.message : 'Не удалось войти через Google');
    }
  });

  const sessionFrom = (req) => sec.readSession(sec.parseCookies(req.get('cookie'))[sec.SESSION_COOKIE]);

  const requireAdmin = wrap(async (req, res, next) => {
    const session = sessionFrom(req);
    if (!session) throw new HttpError(401, 'Требуется авторизация');
    const store = await needStore();
    const epoch = Number(await store.getKv('admin_session_epoch')) || 0;
    if (session.iat < epoch || (await store.countEvents('revoke', session.sid, sec.SESSION_TTL_MS)) > 0) {
      throw new HttpError(401, 'Сессия завершена. Войдите снова.');
    }
    req.admin = session;
    req.store = store;
    next();
  });

  api.post('/logout', wrap(async (req, res) => {
    const session = sessionFrom(req);
    if (session) await (await needStore()).addEvent('revoke', session.sid);
    res.set('Set-Cookie', sec.sessionCookie('', 0)).json({ ok: true });
  }));

  api.get('/me', requireAdmin, (req, res) => res.json({ user: req.admin.u, expires: req.admin.exp, method: req.admin.m || 'password', email: req.admin.e || '' }));

  api.get('/meta', requireAdmin, wrap(async (req, res, next) => { req.settings = await getSettings(req.store); next(); }), (req, res) => res.json({
    ...constants,
    ICONS: Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.label])),
    SOCIALS: Object.fromEntries(Object.entries(SOCIAL_ICONS).map(([k, v]) => [k, v.label])),
    environment: {
      vercel: config.isVercel,
      db: req.store.kind,
      storage: storage.kind,
      telegramBot: Boolean(config.telegram.token) || Boolean(req.settings && req.settings.telegram.token),
      smtp: Boolean(config.smtp.host && config.smtp.from),
      maxUpload: config.uploads.maxFileSize,
      directUpload: storage.kind === 'supabase',
      mediaLimits: MEDIA_LIMITS,
    },
  }));

  /* ---- orders ---- */
  api.get('/stats', requireAdmin, wrap(async (req, res) => {
    const { byStatus, lastWeek } = await req.store.stats();
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
    const counters = await req.store.getCounters(days.map((d) => `pv:${d}`));
    const views = days.map((d) => ({ day: d, n: counters[`pv:${d}`] || 0 }));
    res.json({ total, lastWeek, byStatus, new: byStatus.new || 0, in_progress: byStatus.in_progress || 0, done: byStatus.done || 0, views });
  }));

  api.get('/orders', requireAdmin, wrap(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const { total, items } = await req.store.listOrders({ ...q, limit: q.per_page, offset: (q.page - 1) * q.per_page });
    res.json({ total, page: q.page, per_page: q.per_page, items });
  }));

  const idParam = (v, what = 'Заявка не найдена') => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, what);
    return n;
  };

  api.get('/orders/:id', requireAdmin, wrap(async (req, res) => {
    const order = await req.store.getOrder(idParam(req.params.id));
    if (!order) throw new HttpError(404, 'Заявка не найдена');
    const site = await req.store.getSiteByOrder(order.number);
    res.json({ ...order, site: site ? { id: site.id, slug: site.slug, status: site.status, title: site.data.title } : null });
  }));

  api.patch('/orders/:id', requireAdmin, wrap(async (req, res) => {
    const parsed = adminUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) throw new HttpError(422, 'Некорректные данные', { fields: formatZodError(parsed.error) });
    const order = await req.store.updateOrder(idParam(req.params.id), parsed.data);
    if (!order) throw new HttpError(404, 'Заявка не найдена');
    res.json(order);
  }));

  api.delete('/orders/:id', requireAdmin, wrap(async (req, res) => {
    const files = await req.store.deleteOrder(idParam(req.params.id));
    if (!files) throw new HttpError(404, 'Заявка не найдена');
    await removeFiles(files);
    res.json({ ok: true });
  }));

  api.get('/orders/:id/files/:fileId', requireAdmin, wrap(async (req, res) => {
    const file = await req.store.getFile(idParam(req.params.id), idParam(req.params.fileId, 'Файл не найден'));
    const buf = file && (await readStoredFile(file.stored_name));
    if (!buf) throw new HttpError(404, 'Файл не найден');
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="file${path.extname(file.stored_name)}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(buf);
  }));

  api.get('/export.csv', requireAdmin, wrap(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const { items } = await req.store.listOrders({ ...q, limit: 10000, offset: 0 });
    const cols = ['number', 'created_at', 'status', 'project_name', 'services', 'budget', 'deadline', 'name', 'email', 'phone', 'telegram', 'contact_method'];
    const cell = (v) => {
      let s = Array.isArray(v) ? v.map((x) => constants.SERVICES[x]).join(', ') : String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV formula injection guard
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [cols.join(';'), ...items.map((o) => cols.map((c) => cell(
      c === 'status' ? constants.STATUSES[o.status] : c === 'budget' ? constants.BUDGETS[o.budget]
        : c === 'deadline' ? constants.DEADLINES[o.deadline] : c === 'contact_method' ? constants.CONTACT_METHODS[o.contact_method] : o[c]
    )).join(';'))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"' });
    res.send(`﻿${lines.join('\r\n')}`);
  }));

  /* ---- site content ---- */
  api.get('/content', requireAdmin, wrap(async (req, res) => {
    invalidateContent();
    res.json({ content: await getContent(req.store), defaults: normalize(DEFAULTS) });
  }));

  api.put('/content', requireAdmin, wrap(async (req, res) => {
    if (!req.body || typeof req.body.content !== 'object') throw new HttpError(400, 'Нет данных контента');
    const saved = await saveContent(req.store, req.body.content);
    res.json({ ok: true, content: saved });
  }));

  api.get('/content/versions', requireAdmin, wrap(async (req, res) => {
    res.json({ items: await req.store.listContentVersions() });
  }));

  api.post('/content/versions/:id/restore', requireAdmin, wrap(async (req, res) => {
    const raw = await req.store.getContentVersion(idParam(req.params.id, 'Версия не найдена'));
    if (!raw) throw new HttpError(404, 'Версия не найдена');
    res.json({ ok: true, content: await saveContent(req.store, JSON.parse(raw)) });
  }));

  api.post('/content/reset', requireAdmin, wrap(async (req, res) => {
    res.json({ ok: true, content: await saveContent(req.store, DEFAULTS) });
  }));

  /* ---- media library ---- */
  api.get('/media', requireAdmin, wrap(async (req, res) => res.json({ items: await req.store.listMedia() })));

  // Small files (and everything in local mode) go through the server.
  api.post('/media', requireAdmin, mediaUpload.single('file'), wrap(async (req, res) => {
    const saved = await persistMedia(req.file);
    res.status(201).json(await req.store.addMedia(saved));
  }));

  // Large photos/videos: the browser uploads straight to Supabase Storage with a signed URL.
  api.post('/media/sign', requireAdmin, wrap(async (req, res) => {
    const { name, size } = req.body || {};
    const d = describeMedia(name, size);
    const signed = await storage.signUpload('public', d.path);
    if (!signed) return res.json({ direct: false });
    res.json({ direct: true, path: d.path, uploadUrl: signed.uploadUrl, mime: d.type.mime });
  }));

  api.post('/media/complete', requireAdmin, wrap(async (req, res) => {
    const { path: p, name } = req.body || {};
    const meta = await verifyDirectUpload(String(p || ''), String(name || 'file'));
    const url = `${config.supabase.url}/storage/v1/object/public/${config.supabase.publicBucket}/${meta.path}`;
    res.status(201).json(await req.store.addMedia({ ...meta, url }));
  }));

  api.delete('/media/:id', requireAdmin, wrap(async (req, res) => {
    const m = await req.store.getMedia(idParam(req.params.id, 'Файл не найден'));
    if (!m) throw new HttpError(404, 'Файл не найден');
    await storage.remove('public', m.path);
    await req.store.deleteMedia(m.id);
    res.json({ ok: true });
  }));

  /* ---- admin password ---- */
  api.post('/password', requireAdmin, wrap(async (req, res) => {
    const { current, next: pw } = req.body || {};
    const dbHash = await req.store.getKv('admin_password_hash');
    const viaGoogle = req.admin.m === 'google'; // access recovery: signed in with Google, old password not needed
    if (!viaGoogle && !sec.checkAdminCredentials(config.admin.user, current, dbHash)) throw new HttpError(400, 'Текущий пароль указан неверно', { fields: { current: 'Неверный пароль' } });
    if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(422, 'Новый пароль должен быть не короче 10 символов', { fields: { next: 'Минимум 10 символов' } });
    await req.store.setKv('admin_password_hash', sec.hashPassword(pw));
    // Invalidate all other sessions, keep the current one alive with a fresh cookie.
    await req.store.setKv('admin_session_epoch', String(Date.now()));
    await new Promise((r) => setTimeout(r, 5));
    res.set('Set-Cookie', sec.sessionCookie(sec.createSession(config.admin.user, { method: req.admin.m, email: req.admin.e }), sec.SESSION_TTL_MS));
    res.json({ ok: true });
  }));

  /* ---- integrations: Telegram bot, Google sign-in ---- */
  const integrations = async (req) => publicView(await getSettings(req.store), { origin: originOf(req) });
  api.get('/integrations', requireAdmin, wrap(async (req, res) => res.json(await integrations(req))));

  api.post('/telegram/connect', requireAdmin, wrap(async (req, res) => {
    await telegram.connectBot(req.store, (req.body || {}).token, originOf(req));
    res.json(await integrations(req));
  }));
  api.post('/telegram/disconnect', requireAdmin, wrap(async (req, res) => { await telegram.disconnectBot(req.store); res.json(await integrations(req)); }));
  api.post('/telegram/relink', requireAdmin, wrap(async (req, res) => { await telegram.regenerateLink(req.store); res.json(await integrations(req)); }));
  api.post('/telegram/phone', requireAdmin, wrap(async (req, res) => { await telegram.setPhone(req.store, (req.body || {}).phone); res.json(await integrations(req)); }));
  api.post('/telegram/buttons', requireAdmin, wrap(async (req, res) => { await telegram.setStatusButtons(req.store, (req.body || {}).on); res.json(await integrations(req)); }));
  api.post('/telegram/chats', requireAdmin, wrap(async (req, res) => { await telegram.addChatById(req.store, (req.body || {}).id); res.json(await integrations(req)); }));
  api.delete('/telegram/chats/:id', requireAdmin, wrap(async (req, res) => { await telegram.removeChat(req.store, req.params.id); res.json(await integrations(req)); }));
  api.post('/telegram/detect', requireAdmin, wrap(async (req, res) => {
    const r = await telegram.detectChats(req.store);
    res.json({ ...(await integrations(req)), detect: r });
  }));
  api.post('/telegram/test', requireAdmin, wrap(async (req, res) => res.json(await telegram.sendTest(req.store, originOf(req)))));

  api.post('/google', requireAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const emails = (Array.isArray(b.allowedEmails) ? b.allowedEmails : String(b.allowedEmails || '').split(/[\s,;]+/))
      .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) throw new HttpError(422, `Некорректный e-mail: ${bad}`);
    const clientId = String(b.clientId || '').trim();
    if (clientId && !/\.apps\.googleusercontent\.com$/.test(clientId)) throw new HttpError(422, 'Client ID должен заканчиваться на .apps.googleusercontent.com');
    await updateSettings(req.store, (st) => {
      st.google.clientId = clientId;
      if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) st.google.clientSecret = b.clientSecret.trim();
      if (!clientId) st.google.clientSecret = '';
      st.google.allowedEmails = emails;
    });
    res.json(await integrations(req));
  }));

  /* ---- site builder (public wizard, client cabinet, admin management) ---- */
  mountBuilder(app, api, {
    wrap, HttpError, needStore, siteContent, originOf, clientIp, limit, requireAdmin, sec, sendSiteEmail,
    isAdmin: (req) => Boolean(sessionFrom(req)),
  });

  app.use('/api/admin', api);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

  /* ---------- Pages ---------- */

  // Maintenance mode: visitors see a holding page; a signed-in admin still sees the site.
  const PAGE_PATHS = /^\/(?:$|index\.html$|projects\/|privacy$|terms$)/;
  app.use(wrap(async (req, res, next) => {
    if (req.method !== 'GET' || !PAGE_PATHS.test(req.path)) return next();
    const c = await siteContent();
    if (c.maintenance.enabled && !sessionFrom(req)) {
      return res.status(503).set({ 'Retry-After': '3600', 'Cache-Control': 'no-store' }).type('html').send(maintenancePage(c, { origin: originOf(req) }));
    }
    // Page views per day for the admin dashboard (bots and prefetches excluded).
    if (!BOT_UA.test(String(req.get('user-agent') || '')) && req.get('purpose') !== 'prefetch' && req.get('sec-purpose') == null) {
      getStore().then((st) => st.bumpCounter(`pv:${new Date().toISOString().slice(0, 10)}`)).catch(() => {});
    }
    if (c.maintenance.enabled) res.set('Cache-Control', 'no-store');
    next();
  }));

  // Analytics bootstrap (no inline scripts: CSP stays strict).
  app.get('/analytics.js', wrap(async (req, res) => {
    const { yandexMetrika: ym, googleAnalytics: ga } = (await siteContent()).analytics;
    const js = [];
    if (ym) js.push(`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${Number(ym)},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:false});`);
    if (ga) js.push(`(function(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${ga}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments);};gtag('js',new Date());gtag('config','${ga}');})();`);
    res.set('Cache-Control', 'public, max-age=300').type('application/javascript').send(js.join('\n'));
  }));

  app.get(['/', '/index.html'], wrap(async (req, res) => {
    const c = await siteContent();
    res.set('Cache-Control', PAGE_CACHE).type('html').send(renderHome(c, { origin: originOf(req) }));
  }));

  app.get('/projects/:slug', wrap(async (req, res, next) => {
    const c = await siteContent();
    const project = c.projects.enabled && c.projects.items.find((p) => p.slug === req.params.slug && p.published);
    if (!project) return next();
    res.set('Cache-Control', PAGE_CACHE).type('html').send(renderProjectPage(c, project, { origin: originOf(req) }));
  }));

  app.get('/privacy', wrap(async (req, res) => res.set('Cache-Control', PAGE_CACHE).type('html').send(contentPage(await siteContent(), 'privacy', {
    origin: originOf(req),
    title: 'Политика конфиденциальности — CODEFORGE',
    description: 'Как мы собираем, используем и защищаем персональные данные клиентов.',
    canonical: '/privacy',
  }))));
  app.get('/terms', wrap(async (req, res) => res.set('Cache-Control', PAGE_CACHE).type('html').send(contentPage(await siteContent(), 'terms', {
    origin: originOf(req),
    title: 'Пользовательское соглашение — CODEFORGE',
    description: 'Условия использования сайта и отправки заявок на разработку.',
    canonical: '/terms',
  }))));

  app.get('/sitemap.xml', wrap(async (req, res) => {
    const c = await siteContent();
    const origin = originOf(req);
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      ['/', '1.0', 'weekly'],
      ...(c.projects.enabled ? c.projects.items.filter((p) => p.published).map((p) => [`/projects/${p.slug}`, '0.7', 'monthly']) : []),
      ['/privacy', '0.3', 'yearly'],
      ['/terms', '0.3', 'yearly'],
    ];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map(([u, p, f]) => `  <url><loc>${origin}${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`)
        .join('\n')}\n</urlset>\n`
    );
  }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${originOf(req)}/sitemap.xml\n`);
  });

  app.use('/admin', (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

  // Images uploaded through the admin when running with local storage (dev).
  if (storage.kind === 'local') app.use('/media', express.static(storage.localPublicDir, { maxAge: '7d' }));

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    index: false,
    setHeaders(res, filePath) {
      if (/\.(css|js|svg|png|jpg|webp|woff2|mp4|webm)$/.test(filePath)) {
        res.set('Cache-Control', config.isProd ? 'public, max-age=604800' : 'no-cache');
      }
    },
  }));
  app.get('/admin', (req, res) => {
    if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/admin/');
    res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
  });

  app.use(wrap(async (req, res) => {
    res.status(404).type('html').send(contentPage(await siteContent(), '404', {
      origin: originOf(req),
      title: 'Страница не найдена — CODEFORGE',
      description: 'Запрошенная страница не найдена.',
      canonical: req.path,
      noindex: true,
    }));
  }));

  /* ---------- Errors ---------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const mb = Math.round(config.uploads.maxFileSize / 1048576);
      const messages = {
        LIMIT_FILE_SIZE: `Файл слишком большой. Максимум ${mb} МБ.`,
        LIMIT_FILE_COUNT: `Можно прикрепить не более ${config.uploads.maxFiles} файлов.`,
        LIMIT_UNEXPECTED_FILE: `Можно прикрепить не более ${config.uploads.maxFiles} файлов.`,
      };
      err = new HttpError(400, messages[err.code] || 'Ошибка загрузки файлов', { fields: { files: messages[err.code] || 'Ошибка загрузки' } });
    } else if (err instanceof UploadError) {
      err = new HttpError(400, err.message, { fields: { files: err.message } });
    } else if (err.type === 'entity.parse.failed') {
      err = new HttpError(400, 'Некорректный JSON');
    } else if (err.type === 'entity.too.large') {
      err = new HttpError(413, 'Слишком большой запрос');
    }
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
    if (res.headersSent) return res.end();
    res.status(status).json({
      ok: false,
      error: err.expose ? err.message : 'Внутренняя ошибка сервера. Попробуйте позже.',
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.code && err.expose ? { code: err.code } : {}),
    });
  });

  return { app, getStore };
}

if (require.main === module) {
  const { app, getStore } = createApp();
  getStore().then(
    (store) => console.log(`DB: ${store.kind}, storage: ${storage.kind}`),
    (err) => console.error('DB unavailable:', err.message)
  );
  app.listen(config.port, () => {
    console.log(`CODEFORGE running on http://localhost:${config.port}`);
    if (!sec.adminConfigured()) console.warn('⚠  Admin password is not set. Run `npm run hash-password` and put ADMIN_PASSWORD_HASH into .env');
  });
}

module.exports = { createApp };
