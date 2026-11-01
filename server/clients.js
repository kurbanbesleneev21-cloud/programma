'use strict';

// Client accounts: visitors sign in with Google; their session lives in a signed cookie.
// A signed-in client sees their orders and sites (matched by e-mail) and can edit their sites.

const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'cf_client';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sign = (payload) => crypto.createHmac('sha256', config.sessionSecret).update(`client:${payload}`).digest('base64url');

function clientCookie(client, maxAgeMs = TTL_MS) {
  let value = '';
  if (client) {
    const payload = Buffer.from(JSON.stringify({ e: client.email, n: client.name || '', p: client.picture || '', exp: Date.now() + TTL_MS })).toString('base64url');
    value = `${payload}.${sign(payload)}`;
  }
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

function readClient(value) {
  if (!value || !config.sessionSecret) return null;
  const [payload, sig] = String(value).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!(d.exp > Date.now()) || !d.e) return null;
    return { email: String(d.e).toLowerCase(), name: d.n || '', picture: d.p || '' };
  } catch { return null; }
}

module.exports = { COOKIE, clientCookie, readClient };
