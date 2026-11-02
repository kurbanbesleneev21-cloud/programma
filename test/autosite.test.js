'use strict';

// An order for a website instantly gets its own draft site; Claude then fills it in.
// The Claude API is faked here (no network, no cost).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-autosite-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  SESSION_SECRET: 'autosite-secret-'.padEnd(48, 'x'),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'correct-horse-battery',
  EMAIL_MX_CHECK: 'false',
  ORDER_RATE_LIMIT: '1000',
  NODE_ENV: 'test',
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const geminiCalls = [];
let geminiReply = null, geminiStatus = 200;

const realFetch = globalThis.fetch;
const claudeCalls = [];
let claudeReply = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) {
    return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-002', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.0-flash-image', supportedGenerationMethods: ['generateContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls.push({ url: u, body: JSON.parse(opts.body), key: new Headers(opts.headers).get('x-goog-api-key') });
    if (/models\/gemini-1\.5-flash:/.test(u)) return new Response(JSON.stringify({ error: { code: 404, message: 'models/gemini-1.5-flash is not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    if (geminiStatus !== 200) return new Response(JSON.stringify({ error: { code: geminiStatus, message: 'quota exceeded' } }), { status: geminiStatus, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(geminiReply) }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (!u.startsWith('https://api.anthropic.com/')) return realFetch(url, opts);
  const body = JSON.parse(opts.body || (url instanceof Request ? await url.text() : '{}'));
  const headers = new Headers(opts.headers || (url instanceof Request ? url.headers : {}));
  claudeCalls.push({ url: u, body, headers });
  if (`${headers.get('x-api-key') || ''} ${headers.get('authorization') || ''}`.includes('sk-ant-bad-key-000000000000000000')) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: JSON.stringify(claudeReply) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 200 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { createApp } = require('../server/index');
let server, base, store, adminCookie;

function agedToken() {
  const payload = `${Date.now() - 10_000}.${crypto.randomBytes(9).toString('base64url')}`;
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`form:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}
async function order(services, overrides = {}) {
  const fd = new FormData();
  const fields = {
    project_name: 'Кофейня Зерно', description: 'Нужен сайт для нашей кофейни: меню с ценами, фото зала, адрес и кнопка позвонить.',
    features: 'Меню\nФотогалерея\nКонтакты', deadline: '1m', budget: '500-1000', name: 'Мария', email: 'maria@example.com',
    phone: '+7 999 111-22-33', telegram: 'zerno_cafe', contact_method: 'telegram', consent: 'true', form_token: agedToken(), ...overrides,
  };
  for (const s of services) fd.append('services', s);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api/orders`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  return { data: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const admin = (u, method = 'GET', body) => fetch(`${base}/api/admin${u}`, { method, headers: { cookie: adminCookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

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

test('a website order instantly gets a draft site built from the order (no AI key)', async () => {
  const { data, cookie } = await order(['website']);
  assert.ok(data.site, 'site returned with the order');
  assert.equal(data.site.ai, false);
  assert.equal(data.site.status, 'draft');
  assert.match(data.site.slug, /^kofeynya-zerno/);
  assert.match(data.site.editUrl, /#key=/);
  const html = await (await fetch(data.site.url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(html, /Кофейня Зерно/);
  assert.match(html, /sx--cafe/, 'template guessed from the description');
  assert.match(html, /Фотогалерея/);
  assert.match(html, /t\.me\/zerno_cafe/);
  assert.match(html, /Предпросмотр/);
  assert.equal((await fetch(`${base}/api/sites/${data.site.slug}`, { headers: { cookie } })).status, 200, 'client is logged into the site cabinet');

  // without a key generation explains what to do
  const gen = await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(gen.status, 400);
  assert.match((await gen.json()).error, /ключ Gemini \(бесплатно\) или Claude API/);

  // the admin sees the site in the order
  const o = (await (await admin('/orders?q=' + encodeURIComponent(data.number))).json()).items[0];
  const detail = await (await admin(`/orders/${o.id}`)).json();
  assert.equal(detail.site.slug, data.site.slug);
});

test('orders for apps do not create a site; the feature can be switched off', async () => {
  assert.equal((await order(['android'])).data.site, null);
  const { content } = await (await admin('/content')).json();
  content.builder.autoFromOrders = false;
  await admin('/content', 'PUT', { content });
  assert.equal((await order(['website'])).data.site, null);
  content.builder.autoFromOrders = true;
  await admin('/content', 'PUT', { content });
});

test('with a Claude key the site is written by Claude', async () => {
  assert.equal((await admin('/ai', 'POST', { apiKey: 'not-a-key' })).status, 422);
  const saved = await (await admin('/ai', 'POST', { apiKey: 'sk-ant-api03-test-key-1234567890abcdef' })).json();
  assert.equal(saved.ai.configured, true);
  assert.ok(!JSON.stringify(saved).includes('sk-ant-api03-test-key-1234567890abcdef'), 'key is never sent back');

  const { data, cookie } = await order(['website'], { project_name: 'Барбершоп Борода' });
  assert.equal(data.site.ai, true);
  claudeReply = {
    template: 'card', title: 'Барбершоп «Борода»', tagline: 'Мужские стрижки и бритьё <b>в центре</b>',
    about: 'Первый абзац.\n\nВторой абзац.', cta: 'Записаться',
    items: [{ title: 'Мужская стрижка', text: 'Мытьё, стрижка, укладка.', price: '1 500 ₽' }, { title: 'Бритьё', text: 'Опасной бритвой.', price: '' }],
    theme: 'light', accent: '#B45309',
  };
  claudeCalls.length = 0;
  const gen = await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(gen.status, 200);
  const call = claudeCalls[0];
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.output_config.effort, 'low');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.match(call.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.match(call.body.messages[0].content, /Барбершоп Борода/);

  const html = await (await fetch(`${base}/s/${data.site.slug}`)).text();
  assert.match(html, /sx--card/);
  assert.match(html, /data-theme="light"/);
  assert.match(html, /--accent:#b45309/);
  assert.match(html, /Мужские стрижки и бритьё &lt;b&gt;/, 'Claude output is escaped');
  assert.match(html, /1 500 ₽/);
  assert.match(html, /\+7 999 111-22-33/, 'contacts from the order are kept');

  // strangers can't trigger generation; the limit protects the API budget
  assert.equal((await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  for (let i = 0; i < 2; i++) await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 429);

  // admin can regenerate; a bad key gives a clear message
  const site = (await (await admin('/sites')).json()).items.find((x) => x.slug === data.site.slug);
  assert.equal(site.order_number, data.number);
  assert.equal((await admin(`/sites/${site.id}/generate`, 'POST')).status, 200);
  await admin('/ai', 'POST', { apiKey: 'sk-ant-bad-key-000000000000000000' });
  const bad = await admin(`/sites/${site.id}/generate`, 'POST');
  assert.equal(bad.status, 502);
  assert.match((await bad.json()).error, /Неверный ключ Claude API/);
});

test('free Gemini writes the site when its key is set (preferred over Claude)', async () => {
  assert.equal((await admin('/ai', 'POST', { geminiKey: 'short' })).status, 422);
  assert.equal((await admin('/ai', 'POST', { geminiKey: 'AQ.test-not-a-real-key-000000000000' })).status, 200, 'new-style AQ. keys are accepted');
  // the user typed an old model name that Google has since removed
  const saved = await (await admin('/ai', 'POST', { provider: 'gemini', geminiKey: 'AIza-test-not-a-real-key-000000000000', geminiModel: 'gemini-1.5-flash' })).json();
  assert.equal(saved.ai.provider, 'gemini');
  assert.equal(saved.ai.configured, true);
  assert.ok(!JSON.stringify(saved).includes('AIza-test-not-a-real-key-000000000000'));

  const { data, cookie } = await order(['website'], { project_name: 'Йога Студия Лотос', description: 'Сайт для студии йоги: расписание, тренеры, цены на абонементы.' });
  assert.equal(data.site.ai, true);
  geminiReply = { template: 'business', title: 'Студия йоги «Лотос»', tagline: 'Йога для начинающих и практикующих', about: 'Абзац.', cta: 'Записаться',
    items: [{ title: 'Хатха-йога', text: 'Спокойная практика.', price: '800 ₽' }], theme: 'light', accent: '#16a34a' };
  geminiCalls.length = 0;
  const before = claudeCalls.length;
  const gen = await fetch(`${base}/api/sites/${data.site.slug}/generate`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(gen.status, 200);
  assert.equal(claudeCalls.length, before, 'Claude is not called when Gemini is selected');
  assert.match(geminiCalls[0].url, /models\/gemini-1\.5-flash:generateContent$/, 'tries the saved model first');
  const call = geminiCalls[1];
  assert.match(call.url, /models\/gemini-3\.0-flash:generateContent$/, 'falls back to the best model Google lists (stable flash, not preview/image)');
  assert.equal((await (await admin('/integrations')).json()).ai.geminiModel, 'gemini-3.0-flash', 'the working model is remembered');
  const listed = await (await admin('/ai/gemini-models', 'POST', {})).json();
  assert.deepEqual(listed.models.map((m) => m.id), ['gemini-3.0-flash', 'gemini-3.0-pro', 'gemini-3.5-flash-preview']);
  assert.equal(listed.recommended, 'gemini-3.0-flash');
  assert.equal(call.key, 'AIza-test-not-a-real-key-000000000000');
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.match(call.body.contents[0].parts[0].text, /Йога Студия Лотос/);
  const html = await (await fetch(`${base}/s/${data.site.slug}`)).text();
  assert.match(html, /Студия йоги «Лотос»/);
  assert.match(html, /--accent:#16a34a/);

  // quota errors are explained; malformed output is rejected
  geminiStatus = 429;
  const site = (await (await admin('/sites')).json()).items.find((x) => x.slug === data.site.slug);
  const q = await admin(`/sites/${site.id}/generate`, 'POST');
  assert.equal(q.status, 502);
  assert.match((await q.json()).error, /лимит Gemini/);
  geminiStatus = 200;
  geminiReply = { nope: true };
  assert.match((await (await admin(`/sites/${site.id}/generate`, 'POST')).json()).error, /не по схеме/);
});
