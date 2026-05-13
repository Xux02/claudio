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

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      rating TEXT NOT NULL CHECK(rating IN ('like', 'dislike')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      source TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

export function logFeedback({ title, artist = '', rating }) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO feedback (id, title, artist, rating, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, title, artist, rating);
  return id;
}

export function getFeedback(limit = 50) {
  const likes = db
    .prepare("SELECT title, artist FROM feedback WHERE rating = 'like' ORDER BY created_at DESC LIMIT ?")
    .all(limit);
  const dislikes = db
    .prepare("SELECT title, artist FROM feedback WHERE rating = 'dislike' ORDER BY created_at DESC LIMIT ?")
    .all(limit);
  return { likes, dislikes };
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

export function getSkippedSongs(limit = 20) {
  const raw = getPref('skipped_songs');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return arr.slice(0, limit);
  } catch {
    return [];
  }
}

export function addSkippedSong(title, artist = '') {
  const current = getSkippedSongs(50);
  const exists = current.some(s => s.title === title && s.artist === artist);
  if (!exists) {
    current.unshift({ title, artist, skippedAt: new Date().toISOString() });
  }
  const capped = current.slice(0, 20);
  setPref('skipped_songs', JSON.stringify(capped));
}

export function getTasteStats() {
  // Top artists from all plays
  const topArtists = db
    .prepare(
      `SELECT artist, COUNT(*) as cnt FROM plays
       WHERE artist != '' AND artist NOT LIKE '%/%'
       GROUP BY artist ORDER BY cnt DESC LIMIT 15`
    )
    .all();

  // Recent distinct artists
  const recentArtists = db
    .prepare(
      `SELECT DISTINCT artist FROM plays
       WHERE artist != '' AND artist NOT LIKE '%/%'
       ORDER BY played_at DESC LIMIT 20`
    )
    .all()
    .map(r => r.artist);

  // Total plays
  const totalPlays = db.prepare('SELECT COUNT(*) as cnt FROM plays').get().cnt;

  // Top songs
  const topSongs = db
    .prepare(
      `SELECT title, artist, COUNT(*) as cnt FROM plays
       WHERE artist NOT LIKE '%/%'
       GROUP BY title, artist ORDER BY cnt DESC LIMIT 10`
    )
    .all();

  return { topArtists, recentArtists, totalPlays, topSongs };
}

export function getProfileStats() {
  const totalPlays = db.prepare('SELECT COUNT(*) as cnt FROM plays').get().cnt;
  const totalSongs = db.prepare('SELECT COUNT(DISTINCT title) as cnt FROM plays').get().cnt;
  const totalChatDays = db.prepare(
    "SELECT COUNT(DISTINCT date(created_at)) as cnt FROM messages"
  ).get().cnt;
  const totalMessages = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
  const likesCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM feedback WHERE rating = 'like'"
  ).get().cnt;
  const dislikesCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM feedback WHERE rating = 'dislike'"
  ).get().cnt;

  const { topArtists } = getTasteStats();
  const city = process.env.CITY || '南京';

  return {
    totalPlays,
    totalSongs,
    totalChatDays,
    totalMessages,
    likesCount,
    dislikesCount,
    topArtists,
    city,
  };
}

export function addFavorite({ title, artist = '', source = '' }) {
  const existing = db.prepare(
    'SELECT id FROM favorites WHERE title = ? AND artist = ? LIMIT 1'
  ).get(title, artist);
  if (existing) return null;
  const id = randomUUID();
  db.prepare(
    'INSERT INTO favorites (id, title, artist, source, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, title, artist, source);
  return id;
}

export function getFavorites(limit = 100) {
  return db
    .prepare('SELECT * FROM favorites ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

export function removeFavorite(id) {
  return db.prepare('DELETE FROM favorites WHERE id = ?').run(id);
}

export function isFavorite(title, artist = '') {
  const row = db.prepare(
    'SELECT id FROM favorites WHERE title = ? AND artist = ? LIMIT 1'
  ).get(title, artist);
  return !!row;
}

export function clearAll() {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM plays');
  db.exec('DELETE FROM feedback');
  db.exec('DELETE FROM favorites');
  db.exec('DELETE FROM prefs');
}

export function close() {
  if (db) db.close();
}
