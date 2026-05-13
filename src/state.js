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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      messages TEXT NOT NULL,
      date TEXT NOT NULL,
      preview TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations — add context columns (safe to run on every startup)
  const migrateCol = (table, colDef) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch { /* already exists */ }
  };
  for (const colDef of [
    'session_id TEXT DEFAULT \'\'',
    'time_of_day TEXT DEFAULT \'\'',
    'day_of_week INTEGER DEFAULT -1',
    'is_weekend INTEGER DEFAULT 0',
    'weather_desc TEXT DEFAULT \'\'',
  ]) {
    migrateCol('plays', colDef);
    migrateCol('feedback', colDef);
  }

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

export function logFeedback({ title, artist = '', rating, sessionId = '', context = {} }) {
  const id = randomUUID();
  const { timeOfDay = '', dayOfWeek = -1, isWeekend = 0, weatherDesc = '' } = context;
  db.prepare(
    `INSERT INTO feedback (id, title, artist, rating, session_id, time_of_day, day_of_week, is_weekend, weather_desc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, title, artist, rating, sessionId, timeOfDay, dayOfWeek, isWeekend, weatherDesc);
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

export function logPlay({ song_id = null, title, artist = '', sessionId = '', context = {} }) {
  const id = randomUUID();
  const { timeOfDay = '', dayOfWeek = -1, isWeekend = 0, weatherDesc = '' } = context;
  db.prepare(
    `INSERT INTO plays (id, song_id, title, artist, session_id, time_of_day, day_of_week, is_weekend, weather_desc, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, song_id, title, artist, sessionId, timeOfDay, dayOfWeek, isWeekend, weatherDesc);
  return id;
}

// ─── Preference learning helpers ───────────────────────────────────

export function getCurrentContext(weather = null) {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '早晨' : hour < 12 ? '上午'
    : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '深夜';
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0;
  const weatherDesc = weather?.desc || '';
  return { timeOfDay, dayOfWeek, isWeekend, weatherDesc };
}

export function getActiveSessionId() {
  try {
    const row = db.prepare(
      `SELECT id FROM sessions
       WHERE datetime(updated_at) > datetime('now', '-2 hours')
       ORDER BY updated_at DESC LIMIT 1`
    ).get();
    return row ? row.id : '';
  } catch { return ''; }
}

// ─── Bayesian preference learning ──────────────────────────────────

const ALPHA = 10;             // Bayesian smoothing strength (pseudo-sessions)
const LAMBDA = 0.05;          // decay rate: half-life ≈ 14 days
const MIN_CONTEXT_SESSIONS = 5;
const SIGNIFICANT_LIFT_UP = 1.5;
const SIGNIFICANT_LIFT_DOWN = 0.5;
const MIN_POSTERIOR = 0.05;

function _decayWeight(daysAgo) {
  return Math.exp(-LAMBDA * Math.max(0, daysAgo));
}

function _buildContextKey({ timeOfDay, dayOfWeek, isWeekend, weatherDesc }) {
  return `${timeOfDay}|${dayOfWeek}|${isWeekend}|${weatherDesc}`;
}

export function getArtistSessionStats({ timeOfDay, dayOfWeek, isWeekend, weatherDesc }) {
  // One row per (artist, session) — each session counts at most once per artist
  const rows = db.prepare(`
    SELECT p.artist, p.session_id, MIN(p.played_at) as session_start,
           p.time_of_day, p.day_of_week, p.is_weekend, p.weather_desc
    FROM plays p
    WHERE p.artist != ''
      AND p.artist NOT LIKE '%/%'
      AND p.session_id != ''
    GROUP BY p.artist, p.session_id
    ORDER BY session_start DESC
  `).all();

  const now = Date.now();
  const global = {};   // artist → weighted session count
  const ctxLevels = {
    L1: {}, L2: {}, L3: {}, L4: {},
    totalL1: 0, totalL2: 0, totalL3: 0, totalL4: 0,
  };
  let totalGlobalWeight = 0;

  for (const r of rows) {
    const daysAgo = (now - new Date(r.session_start + 'Z').getTime()) / 86400000;
    const w = _decayWeight(daysAgo);

    global[r.artist] = (global[r.artist] || 0) + w;
    totalGlobalWeight += w;

    // Level 4: same time_of_day
    if (r.time_of_day === timeOfDay) {
      ctxLevels.L4[r.artist] = (ctxLevels.L4[r.artist] || 0) + w;
      ctxLevels.totalL4 += w;
    }

    // Level 3: same time_of_day + is_weekend
    if (r.time_of_day === timeOfDay && r.is_weekend === isWeekend) {
      ctxLevels.L3[r.artist] = (ctxLevels.L3[r.artist] || 0) + w;
      ctxLevels.totalL3 += w;
    }

    // Level 2: same time_of_day + is_weekend + weather_desc
    if (r.time_of_day === timeOfDay && r.is_weekend === isWeekend && r.weather_desc === weatherDesc) {
      ctxLevels.L2[r.artist] = (ctxLevels.L2[r.artist] || 0) + w;
      ctxLevels.totalL2 += w;
    }

    // Level 1: exact match (time_of_day + day_of_week + weather_desc)
    if (r.time_of_day === timeOfDay && r.day_of_week === dayOfWeek && r.weather_desc === weatherDesc) {
      ctxLevels.L1[r.artist] = (ctxLevels.L1[r.artist] || 0) + w;
      ctxLevels.totalL1 += w;
    }
  }

  return { global, totalGlobalWeight, ctxLevels };
}

export function computeBayesianLift(globalStats, ctxArtists, totalCtxWeight, alpha = ALPHA) {
  const { global, totalGlobalWeight } = globalStats;
  const results = [];

  for (const [artist, ctxWeight] of Object.entries(ctxArtists)) {
    const globalWeight = global[artist] || 0;
    const prior = (globalWeight + 1) / (totalGlobalWeight + Object.keys(global).length);
    const evidence = totalCtxWeight > 0 ? ctxWeight / totalCtxWeight : 0;
    const posterior = (alpha * prior + totalCtxWeight * evidence) / (alpha + totalCtxWeight);
    const lift = prior > 0 ? posterior / prior : 1;

    results.push({ artist, prior, evidence, posterior, lift, ctxWeight, globalWeight });
  }

  return results.sort((a, b) => b.lift - a.lift);
}

export function getContextInsights({ timeOfDay, dayOfWeek, isWeekend, weatherDesc }) {
  const stats = getArtistSessionStats({ timeOfDay, dayOfWeek, isWeekend, weatherDesc });
  const { global, totalGlobalWeight, ctxLevels } = stats;

  if (totalGlobalWeight === 0) return null; // no session data at all

  // Context hierarchy fallback: pick the most specific level with enough sessions
  const levels = [
    { name: 'L1', label: `${timeOfDay}·周${['日','一','二','三','四','五','六'][dayOfWeek]}·${weatherDesc||'未知天气'}`, artists: ctxLevels.L1, total: ctxLevels.totalL1 },
    { name: 'L2', label: `${timeOfDay}·${isWeekend?'周末':'工作日'}·${weatherDesc||'未知天气'}`, artists: ctxLevels.L2, total: ctxLevels.totalL2 },
    { name: 'L3', label: `${timeOfDay}·${isWeekend?'周末':'工作日'}`, artists: ctxLevels.L3, total: ctxLevels.totalL3 },
    { name: 'L4', label: `${timeOfDay}`, artists: ctxLevels.L4, total: ctxLevels.totalL4 },
  ];

  let chosenLevel = null;
  for (const lv of levels) {
    if (lv.total >= MIN_CONTEXT_SESSIONS) { chosenLevel = lv; break; }
  }

  // Compute lifts for the chosen level
  let liftedArtists = [];
  if (chosenLevel) {
    const allLifts = computeBayesianLift({ global, totalGlobalWeight }, chosenLevel.artists, chosenLevel.total);
    liftedArtists = allLifts.filter(a =>
      a.posterior >= MIN_POSTERIOR &&
      (a.lift >= SIGNIFICANT_LIFT_UP || a.lift <= SIGNIFICANT_LIFT_DOWN)
    );
  }

  // Always compute weather signal (independent of time_of_day matching)
  let weatherSignal = null;
  if (weatherDesc) {
    const weatherArtists = {};
    let totalWeatherWeight = 0;
    const weatherRows = db.prepare(`
      SELECT p.artist, p.session_id, MIN(p.played_at) as session_start
      FROM plays p
      WHERE p.artist != '' AND p.artist NOT LIKE '%/%'
        AND p.session_id != '' AND p.weather_desc = ?
      GROUP BY p.artist, p.session_id
    `).all(weatherDesc);

    const now = Date.now();
    for (const r of weatherRows) {
      const daysAgo = (now - new Date(r.session_start + 'Z').getTime()) / 86400000;
      const w = _decayWeight(daysAgo);
      weatherArtists[r.artist] = (weatherArtists[r.artist] || 0) + w;
      totalWeatherWeight += w;
    }

    if (totalWeatherWeight >= MIN_CONTEXT_SESSIONS) {
      const weatherLifts = computeBayesianLift(
        { global, totalGlobalWeight }, weatherArtists, totalWeatherWeight
      );
      const sigWeather = weatherLifts.filter(a =>
        a.posterior >= MIN_POSTERIOR && a.lift >= SIGNIFICANT_LIFT_UP
      );
      if (sigWeather.length > 0) {
        weatherSignal = {
          desc: weatherDesc,
          sessionCount: Math.round(totalWeatherWeight),
          artists: sigWeather.slice(0, 5),
        };
      }
    }
  }

  // Trend: compare recent 14 days vs 15-30 days ago
  let trend = null;
  const _collectPeriod = (daysStart, daysEnd) => {
    const map = {};
    const rows = db.prepare(`
      SELECT p.artist, p.session_id, MIN(p.played_at) as session_start
      FROM plays p
      WHERE p.artist != '' AND p.artist NOT LIKE '%/%'
        AND p.session_id != ''
        AND p.played_at >= datetime('now', '-${daysEnd} days')
        AND p.played_at < datetime('now', '-${daysStart} days')
      GROUP BY p.artist, p.session_id
    `).all();
    let total = 0;
    const now = Date.now();
    for (const r of rows) {
      const daysAgo = (now - new Date(r.session_start + 'Z').getTime()) / 86400000;
      const w = _decayWeight(daysAgo);
      map[r.artist] = (map[r.artist] || 0) + w;
      total += w;
    }
    return { map, total };
  };

  const recent = _collectPeriod(0, 14);
  const older = _collectPeriod(14, 30);

  if (recent.total >= 3 && older.total >= 3) {
    const rising = [];
    const declining = [];
    for (const [artist, rw] of Object.entries(recent.map)) {
      const ow = older.map[artist] || 0;
      const rFreq = rw / recent.total;
      const oFreq = ow / older.total;
      if (oFreq > 0 && rFreq / oFreq >= 2.0 && rFreq >= 0.05) rising.push(artist);
      if (oFreq > 0 && rFreq / oFreq <= 0.33 && oFreq >= 0.05) declining.push(artist);
    }
    if (rising.length > 0 || declining.length > 0) {
      trend = {
        rising: rising.slice(0, 5),
        declining: declining.slice(0, 5),
        recentSessions: Math.round(recent.total),
      };
    }
  }

  // Recent top songs in the matched context
  let recentContextSongs = [];
  if (chosenLevel) {
    const songRows = db.prepare(`
      SELECT p.title, p.artist, COUNT(DISTINCT p.session_id) as session_cnt
      FROM plays p
      WHERE p.artist != '' AND p.artist NOT LIKE '%/%'
        AND p.session_id != ''
        AND p.time_of_day = ? AND p.is_weekend = ?
        AND p.played_at >= datetime('now', '-30 days')
      GROUP BY p.title, p.artist
      ORDER BY session_cnt DESC LIMIT 5
    `).all(timeOfDay, isWeekend);
    recentContextSongs = songRows;
  }

  return {
    contextLabel: chosenLevel ? chosenLevel.label : '全局',
    contextSessionCount: chosenLevel ? Math.round(chosenLevel.total) : 0,
    levelUsed: chosenLevel ? chosenLevel.name : 'global',
    liftedUp: liftedArtists.filter(a => a.lift >= SIGNIFICANT_LIFT_UP).slice(0, 5),
    liftedDown: liftedArtists.filter(a => a.lift <= SIGNIFICANT_LIFT_DOWN).slice(0, 5),
    weatherSignal,
    trend,
    recentContextSongs,
    totalGlobalSessions: Math.round(totalGlobalWeight),
  };
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

export function upsertSession({ id, messages, date, preview, messageCount }) {
  db.prepare(
    `INSERT INTO sessions (id, messages, date, preview, message_count, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       messages = excluded.messages,
       date = excluded.date,
       preview = excluded.preview,
       message_count = excluded.message_count,
       updated_at = datetime('now')`
  ).run(id, JSON.stringify(messages), date, preview, messageCount);
}

export function getAllSessions() {
  const rows = db.prepare(
    'SELECT * FROM sessions ORDER BY updated_at DESC'
  ).all();
  return rows.map(r => ({
    id: r.id,
    date: r.date,
    preview: r.preview,
    messageCount: r.message_count,
    messages: JSON.parse(r.messages),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSession(id) {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    date: r.date,
    preview: r.preview,
    messageCount: r.message_count,
    messages: JSON.parse(r.messages),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function deleteSession(id) {
  return db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function clearAll() {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM plays');
  db.exec('DELETE FROM feedback');
  db.exec('DELETE FROM favorites');
  db.exec('DELETE FROM prefs');
  db.exec('DELETE FROM sessions');
}

export function close() {
  if (db) db.close();
}
