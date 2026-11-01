'use strict';

// Admin features: Telegram bot integration, Google sign-in settings, design/sections,
// media (photo + video) uploads, order deletion, maintenance mode.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-features-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  SESSION_SECRET: 'features-secret-'.padEnd(48, 'x'),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'correct-horse-battery',
  EMAIL_MX_CHECK: 'false',
  ORDER_RATE_LIMIT: '1000',
  NODE_ENV: 'test',
});
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

// Fake Telegram Bot API: intercept only api.telegram.org, let local requests through.
const realFetch = globalThis.fetch;
const tgCalls = [];
const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw8';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const [, token, method] = u.match(/\/bot([^/]+)\/(\w+)$/);
  const body = opts.body ? JSON.parse(opts.body) : {};
  tgCalls.push({ token, method, body });
  const reply = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (token !== BOT_TOKEN) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 });
  if (method === 'getMe') return reply({ id: 123456789, is_bot: true, first_name: 'Orders Bot', username: 'orders_test_bot' });
  if (method === 'getChat') return reply({ id: Number(body.chat_id), type: 'private', first_name: 'Admin' });
  if (method === 'getUpdates') return reply([{ update_id: 1, message: { chat: { id: 555000111, type: 'private', first_name: 'Detected' }, text: 'hi' } }]);
  return reply(true);
};

const { createApp } = require('../server/index');
const { updateSettings } = require('../server/settings');

let server, base, store, cookie;
const json = (u, method = 'GET', body) => fetch(base + u, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

function agedToken(ageMs = 10_000) {
  const payload = `${Date.now() - ageMs}.${crypto.randomBytes(9).toString('base64url')}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`form:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}
async function createOrder() {
  const fd = new FormData();
  const fields = { project_name: 'Тест', description: 'Нужен сайт с личным кабинетом и оплатой.', deadline: '1-3m', budget: '3000-5000', name: 'Анна', email: 'anna@example.com', phone: '+49 151 2345678', telegram: '', contact_method: 'email', consent: 'true', form_token: agedToken() };
  fd.append('services', 'website');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api/orders`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  return store.listOrders({ limit: 1 }).then((r) => r.items[0]);
}

before(async () => {
  const created = createApp();
  store = await created.getStore();
  await new Promise((resolve) => { server = created.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise((r) => server.close(r));
  await store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('telegram: connect by token, link chats by ID / code / phone, notify with status buttons', async () => {
  const bad = await json('/api/admin/telegram/connect', 'POST', { token: 'nonsense' });
  assert.equal(bad.status, 400);
  const wrong = await json('/api/admin/telegram/connect', 'POST', { token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9' });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /Неверный токен/);

  const ok = await json('/api/admin/telegram/connect', 'POST', { token: BOT_TOKEN });
  assert.equal(ok.status, 200);
  const view = await ok.json();
  assert.equal(view.telegram.connected, true);
  assert.equal(view.telegram.botUsername, 'orders_test_bot');
  assert.match(view.telegram.linkUrl, /^https:\/\/t\.me\/orders_test_bot\?start=/);
  assert.ok(!JSON.stringify(view).includes(BOT_TOKEN), 'token is never sent back in full');

  // manual Telegram ID
  assert.equal((await json('/api/admin/telegram/chats', 'POST', { id: 'abc' })).status, 400);
  const added = await (await json('/api/admin/telegram/chats', 'POST', { id: '111222333' })).json();
  assert.deepEqual(added.telegram.chats.map((c) => c.id), ['111222333']);

  // local mode (no webhook): detect chats that wrote to the bot
  const det = await (await json('/api/admin/telegram/detect', 'POST', {})).json();
  assert.equal(det.detect.added, 1);

  // Webhook updates (simulate a public deployment with a webhook secret)
  const code = new URL(view.telegram.linkUrl).searchParams.get('start');
  await updateSettings(store, (s) => { s.telegram.webhookSecret = 'hook-secret'; s.telegram.webhookUrl = 'https://example.com/hook'; });
  const hook = (update, secret = 'hook-secret') => fetch(`${base}/api/telegram/webhook/hook-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update) });
  assert.equal((await hook({}, 'wrong')).status, 404);

  assert.equal((await hook({ message: { chat: { id: 777, type: 'private', first_name: 'Linked' }, from: { id: 777 }, text: `/start ${code}` } })).status, 200);
  // phone verification
  await json('/api/admin/telegram/phone', 'POST', { phone: '+7 (999) 123-45-67' });
  await hook({ message: { chat: { id: 888, type: 'private', first_name: 'Stranger' }, from: { id: 888 }, contact: { user_id: 888, phone_number: '+7 900 000 00 00' } } });
  await hook({ message: { chat: { id: 999, type: 'private', first_name: 'Phone' }, from: { id: 999 }, contact: { user_id: 999, phone_number: '89991234567' } } });
  const chats = (await (await json('/api/admin/integrations')).json()).telegram.chats.map((c) => c.id).sort();
  assert.deepEqual(chats, ['111222333', '555000111', '777', '999']);

  // new order → message to every linked chat with status buttons; a button press changes the status
  tgCalls.length = 0;
  const order = await createOrder();
  const sent = tgCalls.filter((c) => c.method === 'sendMessage');
  assert.equal(sent.length, 4);
  assert.match(sent[0].body.text, /Новая заявка/);
  const buttons = sent[0].body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
  assert.ok(buttons.includes(`st:${order.id}:in_progress`));

  await hook({ callback_query: { id: 'q1', data: `st:${order.id}:in_progress`, message: { message_id: 1, chat: { id: 888 } } } });
  assert.equal((await store.getOrder(order.id)).status, 'new', 'unlinked chats cannot change status');
  await hook({ callback_query: { id: 'q2', data: `st:${order.id}:in_progress`, message: { message_id: 1, chat: { id: 777 } } } });
  assert.equal((await store.getOrder(order.id)).status, 'in_progress');

  // /stop unlinks
  await hook({ message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '/stop' } });
  assert.ok(!(await (await json('/api/admin/integrations')).json()).telegram.chats.some((c) => c.id === '777'));

  const off = await (await json('/api/admin/telegram/disconnect', 'POST', {})).json();
  assert.equal(off.telegram.connected, false);
});

test('google sign-in: settings validation, login button, state check', async () => {
  assert.equal((await (await fetch(`${base}/api/admin/auth-options`)).json()).google, false);
  assert.equal((await json('/api/admin/google', 'POST', { clientId: 'bad', allowedEmails: 'me@gmail.com' })).status, 422);
  assert.equal((await json('/api/admin/google', 'POST', { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', allowedEmails: 'not-an-email' })).status, 422);
  assert.equal((await json('/api/admin/google', 'POST', { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', allowedEmails: '' })).status, 422, 'at least one Gmail is required');
  const nogo = await fetch(`${base}/api/admin/google/start`, { redirect: 'manual' });
  assert.equal(nogo.status, 302);
  assert.match(decodeURIComponent(nogo.headers.get('location')), /\/admin\/\?error=Вход через Google не настроен/);
  const saved = await (await json('/api/admin/google', 'POST', { clientId: '42-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-value', allowedEmails: 'Owner@Gmail.com, ops@example.com' })).json();
  assert.equal(saved.google.configured, true);
  assert.deepEqual(saved.google.allowedEmails, ['owner@gmail.com', 'ops@example.com']);
  assert.ok(!JSON.stringify(saved).includes('GOCSPX-secret-value'));
  assert.equal((await (await fetch(`${base}/api/admin/auth-options`)).json()).google, true);

  const start = await fetch(`${base}/api/admin/google/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('client_id'), '42-abc.apps.googleusercontent.com');
  assert.match(start.headers.get('set-cookie'), /cf_gstate=.+HttpOnly/);

  // a callback without the matching state cookie is rejected
  const cb = await fetch(`${base}/api/admin/google/callback?code=x&state=forged`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.match(decodeURIComponent(cb.headers.get('location')), /error=Сессия входа устарела/);
  assert.ok(!/cf_admin=[^;]/.test(cb.headers.get('set-cookie') || ''));
});

test('design, new sections and section order are rendered', async () => {
  const { content } = await (await json('/api/admin/content')).json();
  Object.assign(content.design, { background: 'video', bgVideo: 'https://cdn.example.com/bg.mp4', color1: '#ff0000', animations: true });
  content.pricing.enabled = true;
  content.testimonials.enabled = true;
  content.testimonials.items[0].text = 'Отличная <b>команда</b>';
  content.announcement.enabled = true;
  content.layout.order = ['faq', 'pricing', 'services'];
  content.analytics.yandexMetrika = '12345678';
  assert.equal((await json('/api/admin/content', 'PUT', { content })).status, 200);

  const html = await (await fetch(base)).text();
  assert.match(html, /data-bg="video"/);
  assert.match(html, /<video class="bgfx__media" src="https:\/\/cdn\.example\.com\/bg\.mp4"/);
  assert.match(html, /--c1:#ff0000/);
  assert.match(html, /class="announce"/);
  assert.match(html, /Отличная &lt;b&gt;команда&lt;\/b&gt;/);
  assert.ok(html.indexOf('id="faq"') < html.indexOf('id="pricing"') && html.indexOf('id="pricing"') < html.indexOf('id="services"'));
  assert.match(html, /<script src="\/analytics.js" defer>/);
  assert.match(await (await fetch(`${base}/analytics.js`)).text(), /ym\(12345678,'init'/);
  // mobile menu lives outside the header (backdrop-filter would trap position:fixed)
  assert.ok(html.indexOf('id="mobile-menu"') > html.indexOf('</header>'));
});

test('media: photos and videos upload with signature checks', async () => {
  const up = (name, type, data) => { const fd = new FormData(); fd.append('file', new Blob([data], { type }), name); return fetch(`${base}/api/admin/media`, { method: 'POST', headers: { cookie }, body: fd }); };
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
  const res = await up('ролик.mp4', 'video/mp4', mp4);
  assert.equal(res.status, 201);
  const m = await res.json();
  assert.equal(m.mime, 'video/mp4');
  assert.equal(m.original_name, 'ролик.mp4');
  assert.equal((await fetch(base + m.url)).status, 200);
  assert.equal((await up('fake.mp4', 'video/mp4', Buffer.from('not a video at all'))).status, 400);
  assert.equal((await up('x.exe', 'application/octet-stream', Buffer.from('MZ'))).status, 400);
  // without Supabase the browser is told to upload through the server
  assert.deepEqual(await (await json('/api/admin/media/sign', 'POST', { name: 'big.mov', size: 30 * 1048576 })).json(), { direct: false });
  assert.equal((await json('/api/admin/media/sign', 'POST', { name: 'huge.mp4', size: 80 * 1048576 })).status, 400);
});

test('orders can be deleted; page views are counted; maintenance mode hides the site', async () => {
  const order = await createOrder();
  assert.equal((await json(`/api/admin/orders/${order.id}`, 'DELETE')).status, 200);
  assert.equal((await json(`/api/admin/orders/${order.id}`)).status, 404);
  assert.equal((await json(`/api/admin/orders/${order.id}`, 'DELETE')).status, 404);

  await fetch(base, { headers: { 'user-agent': 'Mozilla/5.0 Test' } });
  await new Promise((r) => setTimeout(r, 50));
  const stats = await (await json('/api/admin/stats')).json();
  assert.equal(stats.views.length, 14);
  assert.ok(stats.views.at(-1).n >= 1);

  const { content } = await (await json('/api/admin/content')).json();
  content.maintenance.enabled = true;
  await json('/api/admin/content', 'PUT', { content });
  const visitor = await fetch(base);
  assert.equal(visitor.status, 503);
  assert.match(await visitor.text(), /техническом обслуживании/);
  assert.equal((await fetch(base, { headers: { cookie } })).status, 200, 'admin still sees the site');
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'API keeps working');
  content.maintenance.enabled = false;
  await json('/api/admin/content', 'PUT', { content });
  assert.equal((await fetch(base)).status, 200);
});
