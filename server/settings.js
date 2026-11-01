'use strict';

// Private settings edited from the admin panel (bot token, Google OAuth keys…).
// Stored in the kv table under a separate key: never part of the public site content
// and never sent back to the browser in full (secrets are masked).

const crypto = require('node:crypto');

const KEY = 'secure_settings';

const DEFAULTS = {
  telegram: {
    token: '',
    botUsername: '',
    botName: '',
    webhookSecret: '',
    webhookUrl: '',
    linkCode: '',
    phone: '',          // admin phone: sharing this contact with the bot links the chat
    chats: [],          // [{ id, title, addedAt }]
    statusButtons: true,
  },
  google: {
    clientId: '',
    clientSecret: '',
    allowedEmails: [],
  },
  ai: {
    provider: 'gemini',  // 'gemini' (free tier) | 'claude'
    apiKey: '',          // Claude API key
    geminiKey: '',       // Google AI Studio key
    geminiModel: 'gemini-2.5-flash',
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function conform(raw) {
  const s = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return s;
  for (const group of Object.keys(DEFAULTS)) {
    const src = raw[group] && typeof raw[group] === 'object' ? raw[group] : {};
    for (const [k, def] of Object.entries(DEFAULTS[group])) {
      if (!(k in src)) continue;
      if (Array.isArray(def)) s[group][k] = Array.isArray(src[k]) ? src[k].slice(0, 50) : def;
      else if (typeof def === 'boolean') s[group][k] = src[k] === true;
      else s[group][k] = String(src[k] ?? '').slice(0, 2000);
    }
  }
  s.telegram.chats = s.telegram.chats
    .filter((c) => c && /^-?\d{1,20}$/.test(String(c.id)))
    .map((c) => ({ id: String(c.id), title: String(c.title || '').slice(0, 120), addedAt: String(c.addedAt || '') }));
  if (!['gemini', 'claude'].includes(s.ai.provider)) s.ai.provider = 'gemini';
  if (!/^[\w.-]{3,80}$/.test(s.ai.geminiModel)) s.ai.geminiModel = 'gemini-2.5-flash';
  s.google.allowedEmails = s.google.allowedEmails.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
  return s;
}

let cache = { at: 0, data: null };
const CACHE_MS = 5_000;

async function getSettings(store) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  let data;
  try { data = conform(JSON.parse((await store.getKv(KEY)) || 'null')); } catch { data = conform(null); }
  cache = { at: Date.now(), data };
  return data;
}

// Applies `mutate(settings)` and persists the result.
async function updateSettings(store, mutate) {
  cache = { at: 0, data: null };
  const current = clone(await getSettings(store));
  await mutate(current);
  const next = conform(current);
  await store.setKv(KEY, JSON.stringify(next));
  cache = { at: Date.now(), data: next };
  return next;
}

const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '');
const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

// What the admin UI may see.
function publicView(s, { origin } = {}) {
  return {
    telegram: {
      connected: Boolean(s.telegram.token),
      tokenMasked: mask(s.telegram.token),
      botUsername: s.telegram.botUsername,
      botName: s.telegram.botName,
      webhook: Boolean(s.telegram.webhookUrl),
      linkUrl: s.telegram.botUsername && s.telegram.linkCode ? `https://t.me/${s.telegram.botUsername}?start=${s.telegram.linkCode}` : '',
      phone: s.telegram.phone,
      chats: s.telegram.chats,
      statusButtons: s.telegram.statusButtons,
    },
    google: {
      configured: Boolean(s.google.clientId && s.google.clientSecret),
      clientId: s.google.clientId,
      clientSecretMasked: mask(s.google.clientSecret),
      allowedEmails: s.google.allowedEmails,
      redirectUri: origin ? `${origin}/api/admin/google/callback` : '',
    },
    ai: {
      provider: s.ai.provider,
      configured: Boolean(aiConfig(s)),
      keyMasked: mask(s.ai.apiKey),
      fromEnv: !s.ai.apiKey && Boolean(process.env.ANTHROPIC_API_KEY),
      geminiKeyMasked: mask(s.ai.geminiKey),
      geminiFromEnv: !s.ai.geminiKey && Boolean(process.env.GEMINI_API_KEY),
      geminiModel: s.ai.geminiModel || 'gemini-2.5-flash',
    },
  };
}

// Which AI writes client sites. Admin panel keys first, env vars as fallback.
function aiConfig(s) {
  const claude = s.ai.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const gemini = s.ai.geminiKey || process.env.GEMINI_API_KEY || '';
  const model = s.ai.geminiModel || 'gemini-2.5-flash';
  if (s.ai.provider === 'claude') return claude ? { provider: 'claude', key: claude } : gemini ? { provider: 'gemini', key: gemini, model } : null;
  return gemini ? { provider: 'gemini', key: gemini, model } : claude ? { provider: 'claude', key: claude } : null;
}
const aiKey = (s) => Boolean(aiConfig(s));

const invalidateSettings = () => { cache = { at: 0, data: null }; };

module.exports = { getSettings, updateSettings, publicView, randomToken, invalidateSettings, aiKey, aiConfig };
