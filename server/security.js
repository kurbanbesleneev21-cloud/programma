'use strict';

const crypto = require('node:crypto');
const config = require('./config');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function secret() {
  if (!config.sessionSecret) {
    throw Object.assign(new Error('Сервер не настроен: задайте переменную SESSION_SECRET (минимум 32 символа).'), { status: 503, expose: true });
  }
  return config.sessionSecret;
}
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/* ---------- Rate limiting (in-memory, fixed window) ---------- */

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60_000)).unref();

  return {
    // Returns { ok, retryAfter } and counts the hit.
    hit(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return { ok: entry.count <= max, retryAfter: Math.ceil((entry.reset - now) / 1000) };
    },
    reset(key) { hits.delete(key); },
  };
}

/* ---------- Anti-spam form token ----------
   The client fetches a signed timestamp when the form becomes visible.
   Submissions faster than MIN_FILL_MS (bots) or older than MAX_AGE_MS are rejected. */

const MIN_FILL_MS = 4000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function issueFormToken() {
  const payload = `${Date.now()}.${b64url(crypto.randomBytes(9))}`;
  return `${payload}.${hmac(`form:${payload}`)}`;
}

function verifyFormToken(token) {
  if (typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(hmac(`form:${payload}`), parts[2])) return { ok: false, reason: 'signature' };
  const age = Date.now() - Number(parts[0]);
  if (!(age >= MIN_FILL_MS)) return { ok: false, reason: 'too_fast' };
  if (age > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true, nonce: parts[1] };
}

// Replay protection for form tokens (each token may submit once).
const usedNonces = new Map();
setInterval(() => {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [k, t] of usedNonces) if (t < cutoff) usedNonces.delete(k);
}, 10 * 60_000).unref();

function consumeNonce(nonce) {
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, Date.now());
  return true;
}

/* ---------- Admin password (scrypt) ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltB64, keyB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

// A password set from the admin panel (stored hashed in the DB) takes precedence over env vars.
function checkAdminCredentials(user, password, dbHash) {
  const { admin } = config;
  const userOk = safeEqual(String(user || ''), admin.user);
  let passOk = false;
  if (dbHash) passOk = verifyPassword(password || '', dbHash);
  else if (admin.passwordHash) passOk = verifyPassword(password || '', admin.passwordHash);
  else if (admin.password) passOk = safeEqual(String(password || ''), admin.password);
  return userOk && passOk;
}

const adminConfigured = (dbHash) => Boolean(dbHash || config.admin.passwordHash || config.admin.password);

/* ---------- Admin session (signed, httpOnly cookie) ---------- */

const SESSION_COOKIE = 'cf_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const revoked = new Map(); // sid -> expiry; logout revokes immediately

// `m` records how the admin signed in ('password' | 'google'); `e` is the Google e-mail.
function createSession(user, { method = 'password', email = '' } = {}) {
  const sid = b64url(crypto.randomBytes(18));
  const now = Date.now();
  const payload = b64url(JSON.stringify({ u: user, sid, iat: now, exp: now + SESSION_TTL_MS, m: method, ...(email ? { e: email } : {}) }));
  return `${payload}.${hmac(`session:${payload}`)}`;
}

function readSession(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(hmac(`session:${payload}`), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now() || revoked.has(data.sid)) return null;
    return data;
  } catch {
    return null;
  }
}

function revokeSession(session) {
  if (session) revoked.set(session.sid, session.exp);
  const now = Date.now();
  for (const [k, exp] of revoked) if (exp < now) revoked.delete(k);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(value, maxAgeMs) {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

const ipHash = (ip) => crypto.createHash('sha256').update(`${secret()}:${ip}`).digest('hex').slice(0, 32);

/* ---------- Unique human-friendly order number: CF-YYMMDD-XXXXX ---------- */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
function generateOrderNumber(date = new Date()) {
  const ymd = date.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(5);
  let suffix = '';
  for (const b of bytes) suffix += ALPHABET[b % ALPHABET.length];
  return `CF-${ymd}-${suffix}`;
}

function releaseNonce(nonce) { usedNonces.delete(nonce); }

module.exports = {
  createRateLimiter,
  releaseNonce,
  issueFormToken,
  verifyFormToken,
  consumeNonce,
  hashPassword,
  verifyPassword,
  checkAdminCredentials,
  adminConfigured,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  readSession,
  revokeSession,
  parseCookies,
  sessionCookie,
  ipHash,
  generateOrderNumber,
  safeEqual,
};
