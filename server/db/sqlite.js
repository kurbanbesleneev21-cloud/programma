'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  number          TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'new',
  services        TEXT NOT NULL,
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
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_order ON order_files(order_id);

CREATE TABLE IF NOT EXISTS order_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_order ON order_history(order_id);

CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,
  url           TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind  TEXT NOT NULL,
  key   TEXT NOT NULL,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events ON events(kind, key, at);
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'draft',
  template    TEXT NOT NULL,
  data        TEXT NOT NULL,
  owner_name  TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  token_hash  TEXT NOT NULL,
  ip_hash     TEXT NOT NULL DEFAULT '',
  paid_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sites_created ON sites(created_at);
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS used_tokens (
  nonce TEXT PRIMARY KEY,
  at    INTEGER NOT NULL
);
`;

const ORDER_COLUMNS = [
  'number', 'status', 'services', 'project_name', 'description', 'features',
  'references_text', 'deadline', 'budget', 'name', 'email', 'phone', 'telegram',
  'contact_method', 'search_text', 'ip_hash', 'user_agent', 'created_at', 'updated_at',
];

const SORTS = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
};

function rowToOrder(row) {
  if (!row) return null;
  const { search_text, ip_hash, user_agent, ...rest } = { ...row };
  return { ...rest, services: JSON.parse(row.services) };
}

function siteRow(row) {
  if (!row) return null;
  return { ...row, id: Number(row.id), data: JSON.parse(row.data) };
}

function createSqliteStore(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'codeforge.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Later columns (no IF NOT EXISTS for ALTER in SQLite).
  const siteCols = db.prepare('PRAGMA table_info(sites)').all().map((c) => c.name);
  if (!siteCols.includes('order_number')) db.exec("ALTER TABLE sites ADD COLUMN order_number TEXT NOT NULL DEFAULT ''");

  const insertOrder = db.prepare(
    `INSERT INTO orders (${ORDER_COLUMNS.join(', ')}) VALUES (${ORDER_COLUMNS.map(() => '?').join(', ')})`
  );
  const insertFile = db.prepare(
    'INSERT INTO order_files (order_id, stored_name, original_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertHistory = db.prepare(
    'INSERT INTO order_history (order_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?)'
  );

  function buildWhere({ q, status, service, budget }) {
    const clauses = [];
    const params = [];
    if (q) { clauses.push('search_text LIKE ?'); params.push(`%${q.toLowerCase()}%`); }
    if (status) { clauses.push('status = ?'); params.push(status); }
    if (service) { clauses.push('services LIKE ?'); params.push(`%"${service}"%`); }
    if (budget) { clauses.push('budget = ?'); params.push(budget); }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  return {
    kind: 'sqlite',

    async createOrder(order, files) {
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        const values = ORDER_COLUMNS.map((c) => {
          if (c === 'services') return JSON.stringify(order.services);
          if (c === 'created_at' || c === 'updated_at') return now;
          if (c === 'status') return 'new';
          return order[c] ?? '';
        });
        const { lastInsertRowid } = insertOrder.run(...values);
        const id = Number(lastInsertRowid);
        for (const f of files) insertFile.run(id, f.storedName, f.originalName, f.mime, f.size, now);
        insertHistory.run(id, null, 'new', now);
        db.exec('COMMIT');
        return { id, number: order.number, created_at: now };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async numberExists(number) {
      return !!db.prepare('SELECT 1 FROM orders WHERE number = ?').get(number);
    },

    async listOrders({ q, status, service, budget, sort = 'newest', limit = 20, offset = 0 }) {
      const { where, params } = buildWhere({ q, status, service, budget });
      const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${where}`).get(...params).n;
      const rows = db
        .prepare(
          `SELECT o.*, (SELECT COUNT(*) FROM order_files f WHERE f.order_id = o.id) AS files_count
           FROM orders o ${where} ORDER BY ${SORTS[sort] || SORTS.newest} LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);
      return { total: Number(total), items: rows.map(rowToOrder) };
    },

    async getOrder(id) {
      const order = rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
      if (!order) return null;
      order.files = db
        .prepare('SELECT id, original_name, mime, size, created_at FROM order_files WHERE order_id = ? ORDER BY id')
        .all(id).map((r) => ({ ...r }));
      order.history = db
        .prepare('SELECT from_status, to_status, changed_at FROM order_history WHERE order_id = ? ORDER BY id')
        .all(id).map((r) => ({ ...r }));
      return order;
    },

    async updateOrder(id, { status, admin_note }) {
      const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        if (status && status !== current.status) {
          db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
          insertHistory.run(id, current.status, status, now);
        }
        if (typeof admin_note === 'string') {
          db.prepare('UPDATE orders SET admin_note = ?, updated_at = ? WHERE id = ?').run(admin_note, now, id);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return this.getOrder(id);
    },

    async deleteOrder(id) {
      const files = db.prepare('SELECT stored_name FROM order_files WHERE order_id = ?').all(id).map((r) => r.stored_name);
      const { changes } = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
      return changes ? files : null;
    },

    /* ---- client sites (site builder) ---- */
    async createSite(site) {
      const now = new Date().toISOString();
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO sites (slug, status, template, data, owner_name, owner_email, owner_phone, token_hash, ip_hash, order_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(site.slug, site.status, site.template, JSON.stringify(site.data), site.owner_name, site.owner_email, site.owner_phone, site.token_hash, site.ip_hash || '', site.order_number || '', now, now);
      return this.getSite(Number(lastInsertRowid));
    },
    async getSite(id) { return siteRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(id)); },
    async getSiteBySlug(slug) { return siteRow(db.prepare('SELECT * FROM sites WHERE slug = ?').get(slug)); },
    async getSiteByOrder(number) { return number ? siteRow(db.prepare('SELECT * FROM sites WHERE order_number = ? ORDER BY id DESC LIMIT 1').get(number)) : null; },
    async getOrderByNumber(number) { const r = db.prepare('SELECT id FROM orders WHERE number = ?').get(number); return r ? this.getOrder(Number(r.id)) : null; },
    async listSites({ limit = 200 } = {}) { return db.prepare('SELECT * FROM sites ORDER BY id DESC LIMIT ?').all(limit).map(siteRow); },
    async updateSite(id, patch) {
      const cols = ['status', 'template', 'data', 'owner_name', 'owner_email', 'owner_phone', 'token_hash', 'paid_at'].filter((k) => k in patch);
      if (cols.length) {
        const vals = cols.map((k) => (k === 'data' ? JSON.stringify(patch[k]) : patch[k]));
        db.prepare(`UPDATE sites SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, new Date().toISOString(), id);
      }
      return this.getSite(id);
    },
    async deleteSite(id) { return db.prepare('DELETE FROM sites WHERE id = ?').run(id).changes > 0; },

    /* ---- counters (page views per day) ---- */
    async bumpCounter(key, by = 1) {
      db.prepare('INSERT INTO counters (key, n) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET n = n + excluded.n').run(key, by);
    },
    async getCounters(keys) {
      if (!keys.length) return {};
      const rows = db.prepare(`SELECT key, n FROM counters WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
      return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
    },

    async getFile(orderId, fileId) {
      const row = db
        .prepare('SELECT * FROM order_files WHERE id = ? AND order_id = ?')
        .get(fileId, orderId);
      return row ? { ...row } : null;
    },

    async stats() {
      const rows = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const lastWeek = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?').get(since).n;
      return { byStatus, lastWeek: Number(lastWeek) };
    },

    /* ---- key/value (site content, admin password) ---- */
    async getKv(key) {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    async setKv(key, value) {
      db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(key, value, new Date().toISOString());
    },

    /* ---- content versions (keep the last 30) ---- */
    async addContentVersion(data) {
      db.prepare('INSERT INTO content_versions (data, created_at) VALUES (?, ?)').run(data, new Date().toISOString());
      db.prepare('DELETE FROM content_versions WHERE id NOT IN (SELECT id FROM content_versions ORDER BY id DESC LIMIT 30)').run();
    },
    async listContentVersions() {
      return db.prepare('SELECT id, created_at, length(data) AS size FROM content_versions ORDER BY id DESC').all().map((r) => ({ ...r, id: Number(r.id) }));
    },
    async getContentVersion(id) {
      const row = db.prepare('SELECT data FROM content_versions WHERE id = ?').get(id);
      return row ? row.data : null;
    },

    /* ---- media library ---- */
    async addMedia(m) {
      const now = new Date().toISOString();
      const { lastInsertRowid } = db.prepare('INSERT INTO media (path, url, original_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(m.path, m.url, m.originalName, m.mime, m.size, now);
      return { id: Number(lastInsertRowid), path: m.path, url: m.url, original_name: m.originalName, mime: m.mime, size: m.size, created_at: now };
    },
    async listMedia() {
      return db.prepare('SELECT * FROM media ORDER BY id DESC LIMIT 500').all().map((r) => ({ ...r, id: Number(r.id) }));
    },
    async getMedia(id) {
      const r = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
      return r ? { ...r, id: Number(r.id) } : null;
    },
    async deleteMedia(id) { db.prepare('DELETE FROM media WHERE id = ?').run(id); },

    /* ---- events for rate limits / session revocation (shared across instances) ---- */
    async addEvent(kind, key) {
      db.prepare('INSERT INTO events (kind, key, at) VALUES (?, ?, ?)').run(kind, key, Date.now());
      if (Math.random() < 0.02) db.prepare('DELETE FROM events WHERE at < ?').run(Date.now() - 2 * 864e5);
    },
    async countEvents(kind, key, sinceMs) {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ? AND key = ? AND at >= ?').get(kind, key, Date.now() - sinceMs).n);
    },
    async clearEvents(kind, key) { db.prepare('DELETE FROM events WHERE kind = ? AND key = ?').run(kind, key); },

    /* ---- single-use form tokens ---- */
    async consumeToken(nonce) {
      const r = db.prepare('INSERT OR IGNORE INTO used_tokens (nonce, at) VALUES (?, ?)').run(nonce, Date.now());
      if (Math.random() < 0.02) db.prepare('DELETE FROM used_tokens WHERE at < ?').run(Date.now() - 864e5);
      return r.changes === 1;
    },
    async releaseToken(nonce) { db.prepare('DELETE FROM used_tokens WHERE nonce = ?').run(nonce); },

    async close() { db.close(); },
  };
}

module.exports = { createSqliteStore };
