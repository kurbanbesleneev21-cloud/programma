'use strict';

// Site builder: create from the wizard, client cabinet access, editing, admin publish/suspend.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-builder-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  SESSION_SECRET: 'builder-secret-'.padEnd(48, 'x'),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'correct-horse-battery',
  EMAIL_MX_CHECK: 'false',
  NODE_ENV: 'test',
});

const { createApp } = require('../server/index');
let server, base, store, adminCookie;

function agedToken(ageMs = 10_000) {
  const payload = `${Date.now() - ageMs}.${crypto.randomBytes(9).toString('base64url')}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`form:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}
const post = (u, body, cookie = '') => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

function siteBody(overrides = {}) {
  return {
    template: 'cafe',
    slug: 'zerno-coffee',
    form_token: agedToken(),
    consent: true,
    owner: { name: 'Иван', email: 'ivan@example.com', phone: '+7 999 000-00-00' },
    data: {
      title: 'Кофейня «Зерно»',
      tagline: 'Свежая обжарка <script>alert(1)</script>',
      about: 'Работаем с 2015 года.\n\nВторой абзац.',
      cta: 'Позвонить',
      hero: 'javascript:alert(1)',
      items: [{ title: 'Капучино', text: '300 мл', price: '220 ₽' }, { title: '', text: 'пустая позиция отбрасывается' }],
      gallery: ['https://images.example.com/1.jpg', 'data:image/png;base64,xx'],
      contacts: { phone: '+7 999 123-45-67', telegram: '@zerno', address: 'Москва, ул. Пушкина, 10' },
      style: { theme: 'light', accent: '#22c55e' },
    },
    ...overrides,
  };
}

before(async () => {
  const created = createApp();
  store = await created.getStore();
  await new Promise((resolve) => { server = created.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await post('/api/admin/login', { username: 'admin', password: 'correct-horse-battery' });
  adminCookie = cookieOf(login);
  // the separate /create wizard is off by default — switch it on for these tests
  const { content } = await (await fetch(`${base}/api/admin/content`, { headers: { cookie: adminCookie } })).json();
  content.builder.enabled = true;
  await fetch(`${base}/api/admin/content`, { method: 'PUT', headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
});

after(async () => {
  await new Promise((r) => server.close(r));
  await store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('wizard page and slug checks', async () => {
  const page = await fetch(`${base}/create`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-builder/);
  assert.doesNotMatch(await (await fetch(base)).text(), /href="\/create"/, 'the menu stays as before');
  assert.deepEqual(await (await fetch(`${base}/api/sites/check-slug?slug=admin`)).json(), { ok: false, error: 'Этот адрес зарезервирован, выберите другой' });
  assert.equal((await (await fetch(`${base}/api/sites/check-slug?slug=a`)).json()).ok, false);
  assert.equal((await (await fetch(`${base}/api/sites/check-slug?slug=my-new-site`)).json()).ok, true);
});

test('creating a site: validation, sanitising, draft preview, owner cabinet', async () => {
  const bad = await post('/api/sites', siteBody({ slug: 'Bad Slug!', consent: false, owner: { name: '', email: 'x' }, data: { title: '', tagline: '', contacts: {} } }));
  assert.equal(bad.status, 422);
  const { fields } = await bad.json();
  for (const k of ['slug', 'consent', 'owner_name', 'owner_email', 'title', 'tagline', 'contacts']) assert.ok(fields[k], k);

  assert.equal((await post('/api/sites', siteBody({ form_token: agedToken(500) }))).status, 400, 'too-fast submissions rejected');

  const res = await post('/api/sites', siteBody());
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.status, 'draft');
  assert.match(created.editUrl, /\/s\/zerno-coffee\/edit#key=[\w-]{20,}$/);
  const ownerCookie = cookieOf(res);
  assert.match(ownerCookie, /^cf_site=/);

  assert.equal((await post('/api/sites', siteBody())).status, 409, 'slug is unique');

  const html = await (await fetch(`${base}/s/zerno-coffee`)).text();
  assert.match(html, /Предпросмотр/);
  assert.match(html, /noindex/);
  assert.match(html, /data-theme="light"/);
  assert.match(html, /--accent:#22c55e/);
  assert.match(html, /Свежая обжарка &lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:alert|data:image/);
  assert.match(html, /images\.example\.com\/1\.jpg/);
  assert.match(html, /Капучино/);
  assert.doesNotMatch(html, /пустая позиция/);
  assert.match(html, /https:\/\/t\.me\/zerno/);
  assert.equal((await fetch(`${base}/s/nope-site`)).status, 404);

  // the creator is logged in right away; a stranger is not
  assert.equal((await fetch(`${base}/api/sites/zerno-coffee`)).status, 401);
  const own = await fetch(`${base}/api/sites/zerno-coffee`, { headers: { cookie: ownerCookie } });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).site.data.title, 'Кофейня «Зерно»');

  // the secret link from the e-mail grants access on another device
  const key = created.editUrl.split('#key=')[1];
  assert.equal((await post('/api/sites/zerno-coffee/session', { key: 'wrong' })).status, 401);
  const sess = await post('/api/sites/zerno-coffee/session', { key });
  assert.equal(sess.status, 200);
  const cookie2 = cookieOf(sess);

  const site = (await (await fetch(`${base}/api/sites/zerno-coffee`, { headers: { cookie: cookie2 } })).json()).site;
  site.data.title = 'Кофейня «Зерно» — обновлено';
  const put = await fetch(`${base}/api/sites/zerno-coffee`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: cookie2 }, body: JSON.stringify({ template: 'business', data: site.data }) });
  assert.equal(put.status, 200);
  const after = await (await fetch(`${base}/s/zerno-coffee`)).text();
  assert.match(after, /обновлено/);
  assert.match(after, /sx--business/);
  assert.equal((await fetch(`${base}/api/sites/zerno-coffee`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: site.data }) })).status, 401);
});

test('admin: list, publish (paid), new link revokes old sessions, suspend, delete', async () => {
  const admin = (u, method = 'GET', body) => fetch(`${base}/api/admin${u}`, { method, headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const list = await (await admin('/sites')).json();
  const s = list.items.find((x) => x.slug === 'zerno-coffee');
  assert.ok(s);
  assert.equal(s.token_hash, undefined, 'token hash never leaves the server');

  const pub = await (await admin(`/sites/${s.id}`, 'PATCH', { status: 'active', markPaid: true })).json();
  assert.equal(pub.site.status, 'active');
  assert.ok(pub.site.paid_at);
  const live = await (await fetch(`${base}/s/zerno-coffee`)).text();
  assert.doesNotMatch(live, /Предпросмотр/);
  assert.match(live, /rel="canonical"/);

  // re-issuing the link logs out the old cookie
  const created = await post('/api/sites', siteBody({ slug: 'second-site' }));
  const oldCookie = cookieOf(created);
  const second = (await (await admin('/sites')).json()).items.find((x) => x.slug === 'second-site');
  const { editUrl } = await (await admin(`/sites/${second.id}/link`, 'POST')).json();
  assert.match(editUrl, /second-site\/edit#key=/);
  assert.equal((await fetch(`${base}/api/sites/second-site`, { headers: { cookie: oldCookie } })).status, 401);
  assert.equal((await post('/api/sites/second-site/session', { key: editUrl.split('#key=')[1] })).status, 200);

  await admin(`/sites/${s.id}`, 'PATCH', { status: 'suspended' });
  assert.equal((await fetch(`${base}/s/zerno-coffee`)).status, 410);
  assert.equal((await fetch(`${base}/s/zerno-coffee`, { headers: { cookie: adminCookie } })).status, 200, 'admin still sees it');
  assert.equal((await admin(`/sites/${s.id}`, 'PATCH', { status: 'bogus' })).status, 422);
  assert.equal((await admin(`/sites/${s.id}`, 'DELETE')).status, 200);
  assert.equal((await fetch(`${base}/s/zerno-coffee`)).status, 404);
  assert.equal((await fetch(`${base}/api/admin/sites`)).status, 401);
});

test('builder can be switched off and sites can publish immediately', async () => {
  const admin = (u, method = 'GET', body) => fetch(`${base}/api/admin${u}`, { method, headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const { content } = await (await admin('/content')).json();
  content.builder.publishImmediately = true;
  await admin('/content', 'PUT', { content });
  const r = await (await post('/api/sites', siteBody({ slug: 'instant-site' }))).json();
  assert.equal(r.status, 'active');

  content.builder.enabled = false;
  await admin('/content', 'PUT', { content });
  assert.equal((await fetch(`${base}/create`)).status, 404);
  assert.equal((await post('/api/sites', siteBody({ slug: 'blocked-site' }))).status, 404);
  assert.doesNotMatch(await (await fetch(base)).text(), /href="\/create"/);
  assert.equal((await fetch(`${base}/s/instant-site`)).status, 200, 'existing sites keep working');
});

test('client photo upload accepts images only', async () => {
  const up = (name, type, data) => { const fd = new FormData(); fd.append('file', new Blob([data], { type }), name); return fetch(`${base}/api/sites/upload`, { method: 'POST', body: fd }); };
  const { content } = await (await fetch(`${base}/api/admin/content`, { headers: { cookie: adminCookie } })).json();
  content.builder.enabled = true;
  await fetch(`${base}/api/admin/content`, { method: 'PUT', headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const ok = await up('photo.png', 'image/png', png);
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).url, /^\/media\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
  assert.equal((await up('clip.mp4', 'video/mp4', mp4)).status, 400);
  assert.equal((await up('fake.png', 'image/png', Buffer.from('nope'))).status, 400);
});
