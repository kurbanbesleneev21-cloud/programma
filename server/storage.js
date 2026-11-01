'use strict';

// File storage. Two "buckets":
//   private — files attached to orders (served only through the admin API)
//   public  — images used on the site (project covers, OG image, video posters)
// Backend: Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
// otherwise the local disk (DATA_DIR/uploads and DATA_DIR/media).

const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const config = require('./config');

const SAFE_PATH = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/;

/* ---------------- Local disk ---------------- */
function localStore() {
  const roots = { private: config.uploadDir, public: path.join(config.dataDir, 'media') };
  fss.mkdirSync(roots.public, { recursive: true });
  const full = (bucket, p) => {
    if (!SAFE_PATH.test(p) || p.includes('..')) throw new Error('bad storage path');
    return path.join(roots[bucket], p);
  };
  return {
    kind: 'local',
    async put(bucket, p, buffer) {
      const f = full(bucket, p);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, buffer, { flag: 'wx', mode: 0o600 });
      return { path: p, url: bucket === 'public' ? `/media/${p}` : null };
    },
    async get(bucket, p) {
      try { return await fs.readFile(full(bucket, p)); } catch { return null; }
    },
    async remove(bucket, p) { await fs.unlink(full(bucket, p)).catch(() => {}); },
    // Direct browser uploads are only possible with Supabase; locally files go through the server.
    async signUpload() { return null; },
    async head(bucket, p, n = 32) {
      try {
        const fh = await fs.open(full(bucket, p), 'r');
        try {
          const { size } = await fh.stat();
          const buf = Buffer.alloc(Math.min(n, size));
          await fh.read(buf, 0, buf.length, 0);
          return { size, bytes: buf };
        } finally { await fh.close(); }
      } catch { return null; }
    },
    localPublicDir: roots.public,
  };
}

/* ---------------- Supabase Storage (REST API, no SDK) ---------------- */
function supabaseStore() {
  const { url, serviceKey, privateBucket, publicBucket } = config.supabase;
  const names = { private: privateBucket, public: publicBucket };
  const headers = (extra = {}) => ({ Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...extra });
  let ready = null;

  async function ensureBuckets() {
    for (const [kind, name] of Object.entries(names)) {
      const res = await fetch(`${url}/storage/v1/bucket/${name}`, { headers: headers() });
      if (res.ok) continue;
      const create = await fetch(`${url}/storage/v1/bucket`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: name, name, public: kind === 'public' }),
      });
      if (!create.ok && create.status !== 409) {
        const text = await create.text();
        if (!/already exists/i.test(text)) throw new Error(`Supabase: cannot create bucket ${name}: ${create.status} ${text}`);
      }
    }
  }
  const init = () => (ready = ready || ensureBuckets().catch((e) => { ready = null; throw e; }));

  return {
    kind: 'supabase',
    async put(bucket, p, buffer, mime) {
      if (!SAFE_PATH.test(p)) throw new Error('bad storage path');
      await init();
      const res = await fetch(`${url}/storage/v1/object/${names[bucket]}/${p}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '31536000' }),
        body: buffer,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Supabase upload failed: ${res.status} ${await res.text()}`);
      return { path: p, url: bucket === 'public' ? `${url}/storage/v1/object/public/${names.public}/${p}` : null };
    },
    async get(bucket, p) {
      if (!SAFE_PATH.test(p)) return null;
      const res = await fetch(`${url}/storage/v1/object/${names[bucket]}/${p}`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },
    // Signed upload URL: the browser PUTs the file straight to Supabase (no 4.5 MB Vercel body limit).
    async signUpload(bucket, p) {
      if (!SAFE_PATH.test(p)) throw new Error('bad storage path');
      await init();
      const res = await fetch(`${url}/storage/v1/object/upload/sign/${names[bucket]}/${p}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Supabase sign failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const signed = String(data.url || data.signedURL || '');
      const token = new URL(signed, url).searchParams.get('token');
      if (!token) throw new Error('Supabase sign: no token');
      return {
        uploadUrl: `${url}/storage/v1/object/upload/sign/${names[bucket]}/${p}?token=${encodeURIComponent(token)}`,
        publicUrl: bucket === 'public' ? `${url}/storage/v1/object/public/${names.public}/${p}` : null,
      };
    },
    // First bytes + total size of an uploaded object (to validate direct uploads).
    async head(bucket, p, n = 32) {
      if (!SAFE_PATH.test(p)) return null;
      const res = await fetch(`${url}/storage/v1/object/${names[bucket]}/${p}`, {
        headers: headers({ Range: `bytes=0-${n - 1}` }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer()).subarray(0, n);
      const range = res.headers.get('content-range');
      const size = range && /\/(\d+)$/.test(range) ? Number(range.match(/\/(\d+)$/)[1]) : Number(res.headers.get('content-length')) || bytes.length;
      return { size, bytes };
    },
    async remove(bucket, p) {
      await fetch(`${url}/storage/v1/object/${names[bucket]}`, {
        method: 'DELETE',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [p] }),
      }).catch(() => {});
    },
  };
}

const storage = config.supabase.url && config.supabase.serviceKey ? supabaseStore() : localStore();

if (config.isVercel && storage.kind === 'local') {
  console.warn('[storage] Running on Vercel without Supabase Storage: uploaded files will be lost. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

module.exports = { storage };
