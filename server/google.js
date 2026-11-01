'use strict';

// "Sign in with Google" for the admin panel (OAuth 2.0 authorization-code flow, no SDK).
// Client ID / secret and the list of allowed e-mails are set in the admin panel.
// It doubles as access recovery: an admin who forgot the password signs in with Google
// and sets a new password without entering the old one.

const crypto = require('node:crypto');
const config = require('./config');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'cf_gstate';

class GoogleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

const configured = (s) => Boolean(s.google.clientId && s.google.clientSecret && s.google.allowedEmails.length);
const redirectUri = (origin) => `${origin}/api/admin/google/callback`;

function stateCookie(value, maxAgeSec) {
  // Lax: the cookie must come back on the top-level redirect from accounts.google.com.
  const attrs = [`${STATE_COOKIE}=${value}`, 'Path=/api/admin/google', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

function startUrl(s, origin) {
  if (!configured(s)) throw new GoogleError('Вход через Google не настроен', 404);
  const state = crypto.randomBytes(18).toString('base64url');
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: s.google.clientId,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  })}`;
  return { url, cookie: stateCookie(state, 600), state };
}

// Exchanges the code for an ID token. The token comes straight from Google over TLS
// in response to our authenticated request, so its claims can be trusted without
// re-checking the signature (as permitted by Google's OpenID Connect docs).
async function finish(s, { code, state, cookieState, origin }) {
  if (!configured(s)) throw new GoogleError('Вход через Google не настроен', 404);
  if (!code || !state || !cookieState || state !== cookieState) throw new GoogleError('Сессия входа устарела. Попробуйте ещё раз.');
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: s.google.clientId, client_secret: s.google.clientSecret, redirect_uri: redirectUri(origin), grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new GoogleError(`Google недоступен: ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    const hint = data.error === 'invalid_client' ? 'Проверьте Client ID и Client Secret.' : data.error === 'redirect_uri_mismatch' ? `Добавьте в Google Cloud адрес ${redirectUri(origin)}` : (data.error_description || data.error || res.status);
    throw new GoogleError(`Google отклонил вход: ${hint}`);
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8')); } catch { throw new GoogleError('Некорректный ответ Google'); }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issOk || claims.aud !== s.google.clientId || !(claims.exp * 1000 > Date.now())) throw new GoogleError('Некорректный токен Google');
  const email = String(claims.email || '').toLowerCase();
  if (!claims.email_verified || !email) throw new GoogleError('У аккаунта Google не подтверждён e-mail');
  if (!s.google.allowedEmails.includes(email)) throw new GoogleError(`Аккаунт ${email} не допущен к админ-панели`, 403);
  return { email, name: claims.name || email };
}

module.exports = { configured, startUrl, finish, stateCookie, STATE_COOKIE, redirectUri, GoogleError };
