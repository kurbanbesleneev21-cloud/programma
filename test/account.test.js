'use strict';

// Client accounts: sign up / sign in with Google, see own orders and sites, edit own site.
// Google's token endpoint is faked (no network).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-account-'));
Object.assign(process.env, {
  DATA_DIR: tmp, SESSION_SECRET: 'account-secret-'.padEnd(48, 'x'), ADMIN_USER: 'admin', ADMIN_PASSWORD: 'correct-horse-battery',
  EMAIL_MX_CHECK: 'false', ORDER_RATE_LIMIT: '1000', NODE_ENV: 'test',
});

const CLIENT_ID = '42-test.apps.googleusercontent.com';
let googleUser = { email: 'Olga@Example.com', name: 'Ольга Петрова', email_verified: true };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) !== 'https://oauth2.googleapis.com/token') return realFetch(url, opts);
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, picture: 'https://lh3.googleusercontent.com/a/x', ...googleUser };
  const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  return new Response(JSON.stringify({ id_token: idToken, access_token: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { createApp } = require('../server/index');
let server, base, store, adminCookie;
const cookieVal = (res, name) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`)) || '';

function agedToken() {
  const payload = `${Date.now() - 10_000}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${payload}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`form:${payload}`).digest('base64url')}`;
}
async function order(email) {
  const fd = new FormData();
  const f = { project_name: 'Цветочный магазин', description: 'Нужен сайт для цветочного магазина с каталогом букетов и доставкой.', deadline: '1m', budget: '500-1000', name: 'Ольга', email, phone: '+7 900 000-00-01', telegram: '', contact_method: 'email', consent: 'true', form_token: agedToken() };
  fd.append('services', 'website');
  for (const [k, v] of Object.entries(f)) fd.append(k, v);
  const res = await fetch(`${base}/api/orders`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  return res.json();
}
async function signIn() {
  const start = await fetch(`${base}/api/admin/google/start?mode=client`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const stateCookie = cookieVal(start, 'cf_gstate');
  const cb = await fetch(`${base}/api/admin/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { cookie: stateCookie } });
  return cb;
}

before(async () => {
  const created = createApp();
  store = await created.getStore();
  await new Promise((resolve) => { server = created.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }) });
  adminCookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  await new Promise((r) => server.close(r));
  await store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('account page invites to sign in; the header has a login button', async () => {
  const home = await (await fetch(base)).text();
  assert.match(home, /href="\/account"/);
  const page = await (await fetch(`${base}/account`)).text();
  assert.match(page, /Личный кабинет/);
  assert.match(page, /Вход через Google скоро заработает/);
  const noKeys = await fetch(`${base}/api/admin/google/start?mode=client`, { redirect: 'manual' });
  assert.match(decodeURIComponent(noKeys.headers.get('location')), /^\/account\?error=/);
});

test('clients sign up with Google (no admin allow-list needed) and see their orders and sites', async () => {
  // only OAuth keys, no admin e-mails
  const saved = await fetch(`${base}/api/admin/google`, { method: 'POST', headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: 'secret', allowedEmails: '' }) });
  assert.equal(saved.status, 200);
  assert.match(await (await fetch(`${base}/account`)).text(), /Войти через Google/);

  const placed = await order('olga@example.com');
  await order('someone.else@example.com');

  const cb = await signIn();
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/account');
  const client = cookieVal(cb, 'cf_client');
  assert.ok(client.length > 20, 'client session cookie set');
  assert.equal(cookieVal(cb, 'cf_admin'), '', 'a client never gets an admin session');

  const page = await (await fetch(`${base}/account`, { headers: { cookie: client } })).text();
  assert.match(page, /Ольга Петрова/);
  assert.match(page, new RegExp(placed.number));
  assert.match(page, /Новая/);
  assert.doesNotMatch(page, /someone\.else/);
  assert.match(page, new RegExp(`/s/${placed.site.slug}/edit`), 'the site built from the order is listed');

  // the account can edit its own site without the secret link
  const own = await fetch(`${base}/api/sites/${placed.site.slug}`, { headers: { cookie: client } });
  assert.equal(own.status, 200);
  // ...but not someone else's
  const other = (await (await fetch(`${base}/api/admin/sites`, { headers: { cookie: adminCookie } })).json()).items.find((x) => x.owner_email === 'someone.else@example.com');
  assert.equal((await fetch(`${base}/api/sites/${other.slug}`, { headers: { cookie: client } })).status, 401);

  assert.deepEqual((await (await fetch(`${base}/api/account/me`, { headers: { cookie: client } })).json()).client.email, 'olga@example.com');
  const clients = (await (await fetch(`${base}/api/admin/clients`, { headers: { cookie: adminCookie } })).json()).items;
  assert.equal(clients[0].email, 'olga@example.com');

  // tampered cookie is ignored; logout clears the session
  assert.equal((await (await fetch(`${base}/api/account/me`, { headers: { cookie: `${client}x` } })).json()).client, null);
  const out = await fetch(`${base}/api/account/logout`, { method: 'POST', redirect: 'manual', headers: { cookie: client } });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /cf_client=;/);
});

test('admin sign-in still requires the allow-list; unverified Google e-mails are refused', async () => {
  const admin = await fetch(`${base}/api/admin/google/start`, { redirect: 'manual' });
  assert.match(decodeURIComponent(admin.headers.get('location')), /добавьте ваш Gmail/);
  googleUser = { email: 'x@example.com', name: 'X', email_verified: false };
  const cb = await signIn();
  assert.match(decodeURIComponent(cb.headers.get('location')), /^\/account\?error=.*не подтверждён/);
});
