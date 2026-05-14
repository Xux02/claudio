import './fetch-polyfill.js';
import 'dotenv/config';
import express from 'express';
import { init as initDb, logMessage, deleteMessage, logPlay, logFeedback, getRecentPlays, getRecentMessages, getTasteStats, getFeedback, getPref, setPref, addSkippedSong, getSkippedSongs, getProfileStats, getHistory, addFavorite, getFavorites, removeFavorite, clearAll, close as closeDb, upsertSession, getAllSessions, getSession, deleteSession, getCurrentContext, getActiveSessionId, getContextInsights } from './state.js';
import { route, handleDirect } from './router.js';
import { build } from './context.js';
import { search as musicSearch, getSongUrl, searchAll as musicSearchAll } from './music.js';
import { synthesize } from './tts.js';
import { start as startScheduler, stop as stopScheduler, getSchedule } from './scheduler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pick AI provider: "deepseek" or "claude" (default)
const AI_PROVIDER = process.env.AI_PROVIDER || 'claude';
const aiModule = AI_PROVIDER === 'deepseek'
  ? await import('./deepseek.js')
  : await import('./claude.js');
const { ask } = aiModule;
console.log(`[server] AI provider: ${AI_PROVIDER}`);

const app = express();
app.use(express.json({ limit: '5mb' }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve PWA static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Init database
const db = initDb();

// Score how well a search result matches the AI's suggested song
function matchScore(result, wanted) {
  let score = 0;
  const rTitle = (result.title || '').toLowerCase();
  const rArtist = (result.artist || '').toLowerCase();
  const wTitle = (wanted.title || '').toLowerCase();
  const wArtist = (wanted.artist || '').toLowerCase();

  // Title contains the wanted keyword (or vice versa)
  if (wTitle && (rTitle.includes(wTitle) || wTitle.includes(rTitle))) score += 3;
  // Exact title match
  if (wTitle && rTitle === wTitle) score += 5;
  // Artist matches
  if (wArtist && (rArtist.includes(wArtist) || wArtist.includes(rArtist))) score += 10;
  // Artist exact match
  if (wArtist && rArtist === wArtist) score += 5;

  return score;
}

// Shared helper: resolve AI song list to real search results with URLs
// Tries QQ first, falls back to NetEase if no good match or no URL
async function resolvePlaylist(play) {
  const enriched = await Promise.all(play.map(async (song) => {
    const keyword = `${song.title} ${song.artist || ''}`;
    const providerResults = await musicSearchAll(keyword, 5);

    for (const { provider, results } of providerResults) {
      if (results.length === 0) continue;

      let best = results[0];
      let bestScore = matchScore(results[0], song);
      for (let i = 1; i < results.length; i++) {
        const s = matchScore(results[i], song);
        if (s > bestScore) { best = results[i]; bestScore = s; }
      }

      // Require at least title + artist match (score >= 13)
      if (bestScore < 13) {
        console.warn(`[resolve] No good ${provider} match for "${song.title}" — best score ${bestScore}`);
        continue; // try next provider
      }

      const url = await getSongUrl(`${provider}:${best.id}`);
      if (url) {
        console.log(`[resolve] "${song.title}" → ${provider} ✓`);
        return {
          title: best.title,
          artist: best.artist,
          url,
          reason: song.reason,
          provider,
        };
      }
      console.warn(`[resolve] "${song.title}" matched on ${provider} but no URL (no copyright)`);
      // fall through to next provider
    }

    return { title: song.title, artist: song.artist || '', reason: song.reason,
      skipped: true, skipReason: 'not_found' };
  }));
  return enriched;
}

// Shared helper: run full trigger pipeline (Claude → music → TTS → persist)
async function runTrigger(reason) {
  const city = process.env.CITY || '扬州';
  const weather = await getWeather(city);
  const state = { getRecentPlays, getRecentMessages, getTasteStats, getFeedback, getPref, getSkippedSongs, getContextInsights };
  const ctx = build({ trigger: reason, input: '', state, weather });
  const result = await ask(ctx);

  const playWithUrls = await resolvePlaylist(result.play);
  const ttsPath = await synthesize(result.say);

  const context = getCurrentContext(weather);
  const sessionId = getActiveSessionId();

  logMessage({
    role: 'assistant',
    content: result.say,
    meta: { songs: playWithUrls, reason: result.reason, segue: result.segue },
  });
  for (const song of playWithUrls) {
    logPlay({ song_id: song.id || null, title: song.title, artist: song.artist || '', sessionId, context });
  }

  return {
    say: result.say,
    play: playWithUrls,
    reason: result.reason,
    segue: result.segue,
    tts: ttsPath,
  };
}

// POST /api/chat — main interaction endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const intent = route(message);

    if (intent.type === 'direct') {
      const say = handleDirect(intent.payload);
      const userMsgId = logMessage({ role: 'user', content: message });
      const aiMsgId = logMessage({ role: 'assistant', content: say });
      return res.json({ say, play: [], reason: '', segue: '', userMessageId: userMsgId, messageId: aiMsgId });
    }

    // AI intent — persist user message first so it survives even if AI fails
    const userMsgId = logMessage({ role: 'user', content: message });

    // Auto-retry: if music API just recovered and last recommendation failed, retry it
    const retryPattern = /^(启动了|修好了|好了|试试|再放|重试|现在放|放吧|好|可以|来|嗯|行|OK|ok|yes|放|搞定了|恢复了)$/;
    if (musicApiOk && retryPattern.test(message.trim())) {
      const recent = getRecentMessages(5);
      const lastAssistant = recent.filter(m => m.role === 'assistant').at(-1);
      if (lastAssistant) {
        let lastMeta = null;
        try { lastMeta = lastAssistant.meta ? JSON.parse(lastAssistant.meta) : null; } catch {}
        if (lastMeta?.apiDown && lastMeta?.songs?.length > 0) {
          console.log('[server] Music API recovered, retrying last failed recommendation...');
          const retriedSongs = await resolvePlaylist(lastMeta.songs);
          const playable = retriedSongs.filter(s => s.url);
          if (playable.length > 0) {
            const names = playable.map(s => `《${s.title}》`).join('、');
            const say = `音乐服务恢复了！刚才说的${names}，现在放给你听～`;
            const aiMsgId = logMessage({
              role: 'assistant', content: say,
              meta: { songs: playable, reason: 'API恢复自动重试', segue: '' },
            });
            for (const song of playable) {
              logPlay({ title: song.title, artist: song.artist || '', sessionId: getActiveSessionId(), context: getCurrentContext(null) });
            }
            return res.json({ say, play: playable, reason: 'API恢复自动重试', segue: '', userMessageId, messageId: aiMsgId });
          }
          // Songs still unplayable — fall through to AI for alternatives
          console.log('[server] Retried songs still unplayable, falling through to AI...');
        }
      }
    }

    const city = process.env.CITY || '扬州';
    const weather = await getWeather(city);
    const context = getCurrentContext(weather);
    const sessionId = getActiveSessionId();
    const state = { getRecentPlays, getRecentMessages, getTasteStats, getFeedback, getPref, getSkippedSongs, getContextInsights };
    const ctx = build({ trigger: 'chat', input: intent.payload, state, weather });

    let result;
    try {
      result = await ask(ctx);
    } catch (aiErr) {
      console.error('AI ask error:', aiErr.message);
      const fallbackSay = '啧，刚走神了，你再说一遍？';
      const aiMsgId = logMessage({ role: 'assistant', content: fallbackSay });
      return res.json({
        say: fallbackSay,
        play: [],
        reason: '',
        segue: '',
        userMessageId: userMsgId,
        messageId: aiMsgId,
      });
    }

    // Resolve song URLs so the frontend can actually play them
    let playWithUrls = musicApiOk ? await resolvePlaylist(result.play) : result.play.map(s => ({
      title: s.title, artist: s.artist || '', reason: s.reason,
      skipped: true, skipReason: 'music_api_down',
    }));

    // Re-prompt if ALL recommendations are unavailable
    const allSkipped = playWithUrls.length > 0 && playWithUrls.every(s => s.skipped);
    if (allSkipped && musicApiOk) {
      const names = playWithUrls.map(s => `《${s.title}》`).join('、');
      console.log(`[server] All ${playWithUrls.length} songs skipped, re-prompting AI...`);

      for (const s of result.play) {
        addSkippedSong(s.title, s.artist || '');
      }

      const retryInput = `你推荐的${names}在当前音乐服务上都找不到可播放版本。请推荐其他可替代的热门歌曲（网易云或QQ音乐上常见的）。如果用户指定了语言或风格，务必尊重用户的选择。`;
      const retryState = { getRecentPlays, getRecentMessages, getTasteStats, getFeedback, getPref, getSkippedSongs, getContextInsights };
      const retryCtx = build({ trigger: 'retry', input: retryInput, state: retryState, weather });

      try {
        const retryResult = await ask(retryCtx, { useReasoner: false });
        playWithUrls = await resolvePlaylist(retryResult.play);

        const retryPlayable = playWithUrls.filter(s => s.url);
        if (retryPlayable.length > 0) {
          result.say = retryResult.say || result.say;
          result.reason = retryResult.reason || result.reason;
        }
      } catch (retryErr) {
        console.error('[server] Retry AI call failed:', retryErr.message);
      }
    }

    // If music API is down, save failed songs in meta for later retry
    if (!musicApiOk) {
      const failedSongs = (result.play || []).map(s => ({
        title: s.title, artist: s.artist || '', reason: s.reason,
      }));
      const aiMsgId = logMessage({
        role: 'assistant',
        content: result.say,
        meta: { songs: failedSongs, reason: result.reason, segue: result.segue, apiDown: true },
      });
      return res.json({
        say: (result.say || '嗯，我在听。') + '\n\n' + musicDownMessage(),
        play: [],
        reason: result.reason,
        segue: result.segue,
        userMessageId: userMsgId,
        messageId: aiMsgId,
      });
    }

    // Persist AI response
    const aiMsgId = logMessage({
      role: 'assistant',
      content: result.say,
      meta: { songs: playWithUrls, reason: result.reason, segue: result.segue },
    });
    for (const song of playWithUrls) {
      logPlay({ title: song.title, artist: song.artist || '', sessionId, context });
    }

    // Build response: append skip notice when songs can't be matched to real tracks
    let say = result.say || '嗯，我在听。想听点什么歌吗？';
    const skipped = playWithUrls.filter(s => s.skipped);
    const playable = playWithUrls.filter(s => s.url);

    // Persist skipped songs so AI learns to avoid them
    for (const s of skipped) {
      addSkippedSong(s.title, s.artist || '');
    }

    if (skipped.length > 0 && playable.length === 0) {
      const names = skipped.map(s => `《${s.title}》`).join('、');
      say += `\n\n${names} 暂无正版资源，换个歌试试？`;
    } else if (skipped.length > 0) {
      const names = skipped.map(s => `《${s.title}》`).join('、');
      say += `\n\n（${names} 没找到资源，已跳过）`;
    }

    return res.json({
      say,
      play: playWithUrls,
      reason: result.reason,
      segue: result.segue,
      userMessageId: userMsgId,
      messageId: aiMsgId,
    });
  } catch (err) {
    console.error('/api/chat error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/now — current playback state
app.get('/api/now', (req, res) => {
  try {
    const recent = getRecentPlays(1);
    res.json({
      playing: recent.length > 0,
      song: recent[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/taste — user taste summary
app.get('/api/taste', (req, res) => {
  try {
    const recentPlays = getRecentPlays(20);
    const artists = {};
    for (const p of recentPlays) {
      if (p.artist) {
        artists[p.artist] = (artists[p.artist] || 0) + 1;
      }
    }
    const topArtists = Object.entries(artists)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    res.json({
      recentPlays: recentPlays.length,
      topArtists,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profile — AI profile stats for the profile page
app.get('/api/profile', (req, res) => {
  try {
    const stats = getProfileStats();
    res.json(stats);
  } catch (err) {
    console.error('/api/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Weather cache
let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_CACHE_MS = 10 * 60 * 1000; // 10 minutes

async function getWeather(city) {
  if (weatherCache && Date.now() - weatherCacheTime < WEATHER_CACHE_MS) {
    return weatherCache;
  }
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!res.ok) throw new Error(`wttr.in ${res.status}`);
    const data = await res.json();
    const cur = data.current_condition?.[0] || {};
    const astro = data.weather?.[0]?.astronomy?.[0] || {};
    const hourly = data.weather?.[0]?.hourly || [];

    // Find current hour's rain probability
    const nowHour = new Date().getHours();
    let rainProb = 0;
    for (const h of hourly) {
      const hTime = parseInt(h.time) || -1;
      // hourly.time can be 0-23 or 0-2300 in 100s format
      const hh = hTime >= 100 ? Math.floor(hTime / 100) : hTime;
      if (hh === nowHour) {
        rainProb = parseInt(h.chanceofrain) || 0;
        break;
      }
    }

    weatherCache = {
      temp: cur.temp_C ? parseInt(cur.temp_C) : null,
      desc: cur.weatherDesc?.[0]?.value || '',
      humidity: cur.humidity || '',
      wind: cur.winddir16Point || '',
      icon: weatherIcon(cur.weatherCode),
      feelsLike: cur.FeelsLikeC ? parseInt(cur.FeelsLikeC) : null,
      uvIndex: cur.uvIndex || '',
      visibility: cur.visibility || '',
      pressure: cur.pressure || '',
      sunrise: astro.sunrise || '',
      sunset: astro.sunset || '',
      rainProb,
    };
    weatherCacheTime = Date.now();
    return weatherCache;
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    return weatherCache || { temp: null, desc: '未知', icon: '🌤️' };
  }
}

function weatherIcon(code) {
  const c = parseInt(code) || 0;
  if (c === 113 || c === 116) return '☀️';
  if (c <= 122 || c === 143) return '☁️';
  if (c <= 182 || c === 185) return '🌧️';
  if (c <= 199) return '🌫️';
  if (c <= 266 || c === 281 || c === 284) return '🌦️';
  if (c <= 299) return '🌧️';
  if (c <= 320) return '🌧️';
  if (c <= 353) return '🌦️';
  if (c <= 374 || c === 395) return '❄️';
  if (c <= 392) return '⛈️';
  return '🌤️';
}

// GET /api/weather
app.get('/api/weather', async (req, res) => {
  try {
    const city = process.env.CITY || '扬州';
    const w = await getWeather(city);
    res.json({ city, ...w });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clear — clear all memory, taste, preferences
app.post('/api/clear', (req, res) => {
  try {
    clearAll();
    weatherCache = null;
    weatherCacheTime = 0;
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/clear error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feedback — record like/dislike on a recommended song
app.post('/api/feedback', (req, res) => {
  try {
    const { title, artist, rating } = req.body;
    if (!title || !rating || !['like', 'dislike'].includes(rating)) {
      return res.status(400).json({ error: 'title and rating (like/dislike) are required' });
    }
    const fbCtx = getCurrentContext();
    const fbSid = getActiveSessionId();
    logFeedback({ title, artist: artist || '', rating, sessionId: fbSid, context: fbCtx });
    return res.json({ ok: true });
  } catch (err) {
    console.error('/api/feedback error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/favorites — add a song to favorites
app.post('/api/favorites', (req, res) => {
  try {
    const { title, artist, source } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const id = addFavorite({ title, artist: artist || '', source: source || '' });
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('/api/favorites error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/favorites — list all favorites
app.get('/api/favorites', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const favorites = getFavorites(limit);
    res.json({ favorites });
  } catch (err) {
    console.error('/api/favorites error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/favorites/:id — remove a song from favorites
app.delete('/api/favorites/:id', (req, res) => {
  try {
    const result = removeFavorite(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/favorites error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/import-playlist — import songs from a Netease playlist URL
app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    if (!musicApiOk) {
      return res.status(503).json({ error: musicDownMessage() });
    }

    // Extract playlist ID from URL (supports various formats)
    const match = url.match(/[?&]id=(\d+)/);
    if (!match) {
      return res.status(400).json({ error: '无法解析歌单链接，请提供网易云歌单 URL（如 https://music.163.com/playlist?id=12345）' });
    }
    const playlistId = match[1];

    // Fetch playlist details via Netease API
    const playlistRes = await fetch(authMusicUrl(`${MUSIC_API_URL}/playlist/detail?id=${playlistId}`));
    const playlistData = await playlistRes.json();
    if (playlistData.code !== 200 || !playlistData.playlist) {
      return res.status(404).json({ error: '歌单不存在或无法访问' });
    }

    const playlist = playlistData.playlist;
    const tracks = (playlist.tracks || []).slice(0, 200); // Cap at 200 songs

    const songs = tracks.map(t => ({
      title: t.name || '',
      artist: (t.ar || []).map(a => a.name).join('/'),
      album: t.al?.name || '',
    }));

    // Store as pref (JSON blob in prefs table)
    setPref(`imported_playlist_${playlistId}`, JSON.stringify({
      name: playlist.name,
      importedAt: new Date().toISOString(),
      songCount: songs.length,
      songs,
    }));

    // Update import index for AI context
    const existingIndex = getPref('imported_playlist_index') || '';
    const summary = `歌单《${playlist.name}》: ${songs.slice(0, 10).map(s => `《${s.title}》${s.artist}`).join('、')}${songs.length > 10 ? '等' + songs.length + '首' : ''}`;
    const newIndex = existingIndex
      ? existingIndex + '\n' + summary
      : summary;
    setPref('imported_playlist_index', newIndex);

    // Also log to plays for taste learning
    const impCtx = getCurrentContext();
    const impSid = getActiveSessionId();
    for (const s of songs.slice(0, 50)) {
      logPlay({ title: s.title, artist: s.artist, sessionId: impSid, context: impCtx });
    }

    return res.json({
      ok: true,
      playlistName: playlist.name,
      songCount: songs.length,
    });
  } catch (err) {
    console.error('/api/import-playlist error:', err);
    return res.status(500).json({ error: err.message });
  }
});

function authMusicUrl(url) {
  const COOKIE = process.env.MUSIC_U ? `MUSIC_U=${process.env.MUSIC_U}` : '';
  if (!COOKIE) return url;
  return url + (url.includes('?') ? '&' : '?') + 'cookie=' + COOKIE;
}

// GET /api/history — recent conversation history
app.get('/api/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const messages = getHistory(limit);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/:id — remove a single message
app.delete('/api/messages/:id', (req, res) => {
  try {
    const result = deleteMessage(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search — direct music search (no AI involved)
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 1) return res.status(400).json({ error: 'q is required' });
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);
    const providerResults = await musicSearchAll(q, limit);

    // Flatten results from all providers and enrich with URLs
    const allResults = [];
    for (const { provider, results } of providerResults) {
      for (const r of results) {
        allResults.push({ ...r, provider });
      }
    }

    // Enrich top results with URLs (limit to 5 URL lookups total)
    const enriched = await Promise.all(
      allResults.slice(0, limit).map(async (r) => {
        try {
          const url = await getSongUrl(`${r.provider}:${r.id}`);
          return { ...r, url: url || null };
        } catch {
          return { ...r, url: null };
        }
      })
    );

    res.json({ results: enriched });
  } catch (err) {
    console.error('/api/search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Sessions API ────────────────────────────────────────────────

// GET /api/sessions — list all sessions (metadata only, no messages body)
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = getAllSessions().map(s => ({
      id: s.id,
      date: s.date,
      preview: s.preview,
      messageCount: s.messageCount,
      updatedAt: s.updatedAt,
    }));
    res.json({ sessions });
  } catch (err) {
    console.error('/api/sessions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id — get a single session with full messages
app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  } catch (err) {
    console.error('/api/sessions/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/:id — delete a session
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const result = deleteSession(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/sessions/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/sync — push local sessions, get canonical list back
app.post('/api/sessions/sync', (req, res) => {
  try {
    const { sessions } = req.body;
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: 'sessions must be an array' });
    }
    if (sessions.length > 50) {
      return res.status(400).json({ error: 'too many sessions (max 50)' });
    }

    // Upsert each incoming session
    for (const s of sessions) {
      if (!s.id || !Array.isArray(s.messages)) continue;
      upsertSession({
        id: String(s.id),
        messages: s.messages,
        date: s.date || new Date().toISOString().slice(0, 10),
        preview: String(s.preview || '').slice(0, 100),
        messageCount: s.messageCount || s.messages.length,
      });
    }

    // Return all sessions as canonical list
    const all = getAllSessions();
    res.json({
      sessions: all,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('/api/sessions/sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trigger — manual scheduler trigger
app.post('/api/trigger', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: 'reason is required' });
    }

    const result = await runTrigger(`手动触发: ${reason}`);
    return res.json(result);
  } catch (err) {
    console.error('/api/trigger error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/schedule — view today's trigger status
app.get('/api/schedule', (req, res) => {
  try {
    const schedule = getSchedule();
    res.json({ schedule });
  } catch (err) {
    console.error('/api/schedule error:', err);
    res.status(500).json({ error: err.message });
  }
});


// SPA fallback: serve index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const MUSIC_API_URL = process.env.MUSIC_API_URL || 'http://localhost:4000';

let musicApiOk = false;

async function healthCheck() {
  // Check Netease
  try {
    const res = await fetch(`${MUSIC_API_URL}/search?keywords=test&limit=1`);
    if (res.ok) {
      musicApiOk = true;
      console.log(`[server] Netease API OK: ${MUSIC_API_URL}`);
    } else {
      console.warn(`[server] Netease API returned ${res.status}`);
    }
  } catch {
    console.warn(`[server] Netease API unreachable at ${MUSIC_API_URL} — start it with:
  PORT=4000 node node_modules/NeteaseCloudMusicApi/app.js &`);
  }

  // Check QQ Music (direct API, no external service needed)
  if (process.env.QQ_MUSIC_KEY && process.env.QQ_MUSIC_UIN) {
    const { search: qqSearch } = await import('./music/qq.js');
    const qqResults = await qqSearch('晴天', 1);
    if (qqResults.length > 0) {
      console.log(`[server] QQ Music API OK (direct) — found "${qqResults[0].title}"`);
    } else {
      console.warn('[server] QQ Music API returned no results, cookie may be expired');
    }
  } else {
    console.warn('[server] QQ Music not configured (QQ_MUSIC_KEY / QQ_MUSIC_UIN missing)');
  }
}

function musicDownMessage() {
  return '音乐服务暂时离线，请确保网易云和 QQ 音乐 API 已启动。';
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`Claudio is listening on http://localhost:${PORT}`);
  await healthCheck();
});

// Start scheduler
startScheduler(async (reason) => {
  console.log(`[scheduler] Triggered: ${reason}`);
  try {
    const result = await runTrigger(reason);
    console.log(`[scheduler] DJ says: ${result.say.slice(0, 50)}...`);
    console.log(`[scheduler] TTS: ${result.tts || 'none'}`);
    console.log(`[scheduler] Songs: ${result.play.map(s => s.title).join(', ')}`);
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  stopScheduler();
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopScheduler();
  closeDb();
  process.exit(0);
});
