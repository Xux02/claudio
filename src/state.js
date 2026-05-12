import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'state.db');

let db;

export function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plays (
      id TEXT PRIMARY KEY,
      song_id TEXT,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      played_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

export function logMessage({ role, content, meta = null }) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO messages (id, role, content, meta, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, role, content, meta ? JSON.stringify(meta) : null);
  return id;
}

export function deleteMessage(id) {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

export function logPlay({ song_id = null, title, artist = '' }) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO plays (id, song_id, title, artist, played_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, song_id, title, artist);
  return id;
}

export function getRecentMessages(limit = 20) {
  return db
    .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .reverse();
}

export function getRecentPlays(limit = 15) {
  return db
    .prepare('SELECT * FROM plays ORDER BY played_at DESC LIMIT ?')
    .all(limit);
}

export function getPref(key) {
  const row = db.prepare('SELECT value FROM prefs WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setPref(key, value) {
  db.prepare(
    'INSERT OR REPLACE INTO prefs (key, value) VALUES (?, ?)'
  ).run(key, value);
}

export function getHistory(limit = 20) {
  return db
    .prepare('SELECT * FROM messages ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(limit)
    .reverse();
}

export function close() {
  if (db) db.close();
}
