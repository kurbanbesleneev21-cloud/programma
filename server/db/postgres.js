'use strict';

// PostgreSQL / Supabase adapter. Same interface as the SQLite store.
// Supabase: use the project's Postgres connection string as DATABASE_URL.

const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id              BIGSERIAL PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'new',
  services        JSONB NOT NULL,
  project_name    TEXT NOT NULL,
  description     TEXT NOT NULL,
  features        TEXT NOT NULL DEFAULT '',
  references_text TEXT NOT NULL DEFAULT '',
  deadline        TEXT NOT NULL,
  budget          TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  telegram        TEXT NOT NULL DEFAULT '',
  contact_method  TEXT NOT NULL,
  admin_note      TEXT NOT NULL DEFAULT '',
  search_text     TEXT NOT NULL DEFAULT '',
  ip_hash         TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_files (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_order ON order_files(order_id);

CREATE TABLE IF NOT EXISTS order_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_order ON order_history(order_id);

CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_versions (
  id         BIGSERIAL PRIMARY KEY,
  data       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media (
  id            BIGSERIAL PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  url           TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id   BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events ON events(kind, key, at);
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n   BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS used_tokens (
  nonce TEXT PRIMARY KEY,
  at    BIGINT NOT NULL
);
`;

const ORDER_COLUMNS = [
  'number', 'services', 'project_name', 'description', 'features', 'references_text',
  'deadline', 'budget', 'name', 'email', 'phone', 'telegram', 'contact_method',
  'search_text', 'ip_hash', 'user_agent',
];

const SORTS = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
};

const iso = (v) => (v instanceof Date ? v.toISOString() : v);

function rowToOrder(row) {
  if (!row) return null;
  const { search_text, ip_hash, user_agent, ...rest } = row;
  return {
    ...rest,
    id: Number(row.id),
    files_count: row.files_count !== undefined ? Number(row.files_count) : undefined,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

// Query params such as sslmode=require (strict cert check in node-pg) or Supabase's
// `supa=base-pooler.x` break connections, so they are stripped and SSL is set explicitly.
function prepareConnection(connectionString) {
  let u;
  try { u = new URL(connectionString); } catch { return { url: connectionString, ssl: undefined }; }
  const mode = (u.searchParams.get('sslmode') || '').toLowerCase();
  const local = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(u.hostname);
  const wantSsl = mode ? mode !== 'disable' : !local;
  u.search = '';
  return { url: u.toString(), ssl: wantSsl ? { rejectUnauthorized: false } : undefined };
}

async function createPostgresStore(connectionString) {
  const { url, ssl } = prepareConnection(connectionString);
  const pool = new Pool({
    connectionString: url,
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
  // An idle client dropped by the server (pooler restart, paused project) must not crash the function.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  // Serialise schema creation (several serverless instances may cold-start at once).
  // A transaction-scoped lock is safe behind Supabase's transaction-mode pooler.
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7240117)');
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end().catch(() => {});
    throw err;
  }
  client.release();

  function buildWhere({ q, status, service, budget }) {
    const clauses = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (q) clauses.push(`search_text LIKE ${p(`%${q.toLowerCase()}%`)}`);
    if (status) clauses.push(`status = ${p(status)}`);
    if (service) clauses.push(`services ? ${p(service)}`);
    if (budget) clauses.push(`budget = ${p(budget)}`);
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  return {
    kind: 'postgres',

    async createOrder(order, files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const values = ORDER_COLUMNS.map((c) => (c === 'services' ? JSON.stringify(order.services) : order[c] ?? ''));
        const { rows } = await client.query(
          `INSERT INTO orders (${ORDER_COLUMNS.join(', ')})
           VALUES (${ORDER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING id, number, created_at`,
          values
        );
        const id = rows[0].id;
        for (const f of files) {
          await client.query(
            'INSERT INTO order_files (order_id, stored_name, original_name, mime, size) VALUES ($1, $2, $3, $4, $5)',
            [id, f.storedName, f.originalName, f.mime, f.size]
          );
        }
        await client.query('INSERT INTO order_history (order_id, from_status, to_status) VALUES ($1, NULL, $2)', [id, 'new']);
        await client.query('COMMIT');
        return { id: Number(id), number: rows[0].number, created_at: iso(rows[0].created_at) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async numberExists(number) {
      const { rowCount } = await pool.query('SELECT 1 FROM orders WHERE number = $1', [number]);
      return rowCount > 0;
    },

    async listOrders({ q, status, service, budget, sort = 'newest', limit = 20, offset = 0 }) {
      const { where, params } = buildWhere({ q, status, service, budget });
      const total = await pool.query(`SELECT COUNT(*)::int AS n FROM orders ${where}`, params);
      const { rows } = await pool.query(
        `SELECT o.*, (SELECT COUNT(*) FROM order_files f WHERE f.order_id = o.id)::int AS files_count
         FROM orders o ${where} ORDER BY ${SORTS[sort] || SORTS.newest}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      return { total: total.rows[0].n, items: rows.map(rowToOrder) };
    },

    async getOrder(id) {
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      const order = rowToOrder(rows[0]);
      if (!order) return null;
      const files = await pool.query(
        'SELECT id, original_name, mime, size, created_at FROM order_files WHERE order_id = $1 ORDER BY id', [id]
      );
      const history = await pool.query(
        'SELECT from_status, to_status, changed_at FROM order_history WHERE order_id = $1 ORDER BY id', [id]
      );
      order.files = files.rows.map((f) => ({ ...f, id: Number(f.id), created_at: iso(f.created_at) }));
      order.history = history.rows.map((h) => ({ ...h, changed_at: iso(h.changed_at) }));
      return order;
    },

    async updateOrder(id, { status, admin_note }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
        if (!cur.rowCount) { await client.query('ROLLBACK'); return null; }
        if (status && status !== cur.rows[0].status) {
          await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
          await client.query(
            'INSERT INTO order_history (order_id, from_status, to_status) VALUES ($1, $2, $3)',
            [id, cur.rows[0].status, status]
          );
        }
        if (typeof admin_note === 'string') {
          await client.query('UPDATE orders SET admin_note = $1, updated_at = now() WHERE id = $2', [admin_note, id]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return this.getOrder(id);
    },

    async getFile(orderId, fileId) {
      const { rows } = await pool.query('SELECT * FROM order_files WHERE id = $1 AND order_id = $2', [fileId, orderId]);
      return rows[0] || null;
    },

    async stats() {
      const { rows } = await pool.query('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status');
      const week = await pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE created_at >= now() - interval '7 days'");
      return { byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])), lastWeek: week.rows[0].n };
    },

    async getKv(key) {
      const { rows } = await pool.query('SELECT value FROM kv WHERE key = $1', [key]);
      return rows[0] ? rows[0].value : null;
    },
    async setKv(key, value) {
      await pool.query('INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, value]);
    },

    async addContentVersion(data) {
      await pool.query('INSERT INTO content_versions (data) VALUES ($1)', [data]);
      await pool.query('DELETE FROM content_versions WHERE id NOT IN (SELECT id FROM content_versions ORDER BY id DESC LIMIT 30)');
    },
    async listContentVersions() {
      const { rows } = await pool.query('SELECT id, created_at, length(data) AS size FROM content_versions ORDER BY id DESC');
      return rows.map((r) => ({ id: Number(r.id), created_at: iso(r.created_at), size: Number(r.size) }));
    },
    async getContentVersion(id) {
      const { rows } = await pool.query('SELECT data FROM content_versions WHERE id = $1', [id]);
      return rows[0] ? rows[0].data : null;
    },

    async addMedia(m) {
      const { rows } = await pool.query(
        'INSERT INTO media (path, url, original_name, mime, size) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [m.path, m.url, m.originalName, m.mime, m.size]
      );
      return { ...rows[0], id: Number(rows[0].id), created_at: iso(rows[0].created_at) };
    },
    async listMedia() {
      const { rows } = await pool.query('SELECT * FROM media ORDER BY id DESC LIMIT 500');
      return rows.map((r) => ({ ...r, id: Number(r.id), created_at: iso(r.created_at) }));
    },
    async getMedia(id) {
      const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [id]);
      return rows[0] ? { ...rows[0], id: Number(rows[0].id), created_at: iso(rows[0].created_at) } : null;
    },
    async deleteMedia(id) { await pool.query('DELETE FROM media WHERE id = $1', [id]); },

    async deleteOrder(id) {
      const files = (await pool.query('SELECT stored_name FROM order_files WHERE order_id = $1', [id])).rows.map((r) => r.stored_name);
      const { rowCount } = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
      return rowCount ? files : null;
    },

    async bumpCounter(key, by = 1) {
      await pool.query('INSERT INTO counters (key, n) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET n = counters.n + EXCLUDED.n', [key, by]);
    },
    async getCounters(keys) {
      if (!keys.length) return {};
      const { rows } = await pool.query('SELECT key, n FROM counters WHERE key = ANY($1)', [keys]);
      return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
    },

    async addEvent(kind, key) {
      await pool.query('INSERT INTO events (kind, key, at) VALUES ($1, $2, $3)', [kind, key, Date.now()]);
      if (Math.random() < 0.02) await pool.query('DELETE FROM events WHERE at < $1', [Date.now() - 2 * 864e5]);
    },
    async countEvents(kind, key, sinceMs) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM events WHERE kind = $1 AND key = $2 AND at >= $3', [kind, key, Date.now() - sinceMs]);
      return rows[0].n;
    },
    async clearEvents(kind, key) { await pool.query('DELETE FROM events WHERE kind = $1 AND key = $2', [kind, key]); },

    async consumeToken(nonce) {
      const { rowCount } = await pool.query('INSERT INTO used_tokens (nonce, at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nonce, Date.now()]);
      if (Math.random() < 0.02) await pool.query('DELETE FROM used_tokens WHERE at < $1', [Date.now() - 864e5]);
      return rowCount === 1;
    },
    async releaseToken(nonce) { await pool.query('DELETE FROM used_tokens WHERE nonce = $1', [nonce]); },

    async close() { await pool.end(); },
  };
}

module.exports = { createPostgresStore, prepareConnection };
