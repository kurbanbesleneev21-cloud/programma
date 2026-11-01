'use strict';

const config = require('../config');

async function createStore() {
  if (config.databaseCandidates.length) {
    // Try DATABASE_URL first, then the Vercel ↔ Supabase integration URLs, so one broken
    // variable (wrong password, paused project, typo) doesn't take the whole site down.
    const { createPostgresStore } = require('./postgres');
    let lastError;
    for (const { name, url } of config.databaseCandidates) {
      try {
        return await createPostgresStore(url);
      } catch (err) {
        lastError = err;
        console.error(`[db] cannot connect via ${name}: ${err.message}`);
      }
    }
    throw lastError;
  }
  if (config.isVercel) {
    // Vercel has no persistent disk: a local SQLite file would silently lose every order.
    throw new Error('DATABASE_URL is not set (required on Vercel: use a Supabase/Postgres connection string)');
  }
  const { createSqliteStore } = require('./sqlite');
  return createSqliteStore(config.dataDir);
}

module.exports = { createStore };
