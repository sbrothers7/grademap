import { createClient } from '@libsql/client';

if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_URL and TURSO_AUTH_TOKEN must be set');
}

const client = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});

export const db = {
  async get(sql, args = []) {
    const r = await client.execute({ sql, args });
    return r.rows[0] || null;
  },
  async all(sql, args = []) {
    const r = await client.execute({ sql, args });
    return r.rows;
  },
  async run(sql, args = []) {
    const r = await client.execute({ sql, args });
    return {
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
      changes: r.rowsAffected,
    };
  },
};

await client.executeMultiple(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    email         TEXT UNIQUE,
    google_id     TEXT UNIQUE,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grademaps (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
