'use strict';

// Cache-busting for CSS/JS: "/assets/css/main.css" -> "/assets/css/main.css?v=<content hash>".
// Phones keep stylesheets for days; a new URL after every change forces the fresh file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const PUBLIC_DIR = path.join(config.ROOT, 'public');
const cache = new Map();
// If the function bundle can't read the file, the deployment id still changes on every deploy.
const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '').replace(/\W/g, '').slice(0, 10);

function asset(url) {
  if (config.isProd && cache.has(url)) return cache.get(url);
  let out = url;
  try {
    const file = path.join(PUBLIC_DIR, url.replace(/^\/+/, ''));
    if (file.startsWith(PUBLIC_DIR)) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
      out = `${url}?v=${hash}`;
    }
  } catch {
    if (BUILD) out = `${url}?v=${BUILD}`;
  }
  cache.set(url, out);
  return out;
}

module.exports = { asset };
