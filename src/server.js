import 'dotenv/config';
import express from 'express';
import { init as initDb, logMessage, logPlay, getRecentPlays, getHistory, close as closeDb } from './state.js';
import { route, handleDirect } from './router.js';
import { build } from './context.js';
import { ask } from './claude.js';
import { search as musicSearch, getSongUrl } from './music.js';
import { synthesize } from './tts.js';
import { start as startScheduler, stop as stopScheduler, getSchedule } from './scheduler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve PWA static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Init database
const db = initDb();

// Shared helper: resolve Claude's song list to real search results with URLs
async function resolvePlaylist(play) {
  const enriched = await Promise.all(play.map(async (song) => {
    const results = await musicSearch(`${song.title} ${song.artist || ''}`, 1);
    if (results.length > 0) {
      const url = await getSongUrl(results[0].id);
      return {
        title: results[0].title,
        artist: results[0].artist,
        url: url || undefined,
        reason: song.reason,
      };
    }
    return { title: song.title, artist: song.artist || '', reason: song.reason };
  }));
  return enriched;
}

// Shared helper: run full trigger pipeline (Claude → music → TTS → persist)
async function runTrigger(reason) {
  const state = { getRecentPlays };
  const ctx = build({ trigger: reason, input: '', state });
  const result = await ask(ctx);

  const playWithUrls = await resolvePlaylist(result.play);
  const ttsPath = await synthesize(result.say);

  logMessage({
    role: 'assistant',
    content: result.say,
    meta: { songs: playWithUrls, reason: result.reason, segue: result.segue },
  });
  for (const song of playWithUrls) {
    logPlay({ song_id: song.id || null, title: song.title, artist: song.artist || '' });
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
      logMessage({ role: 'user', content: message });
      logMessage({ role: 'assistant', content: say });
      return res.json({ say, play: [], reason: '', segue: '' });
    }

    if (intent.type === 'music') {
      const keyword = intent.payload
        .replace(/^(播放|来首|想听|放一首|换首歌|切歌|下一首|推荐首歌)/, '')
        .trim();
      const songs = await musicSearch(keyword || intent.payload, 5);

      await Promise.all(songs.map(async (song) => {
        song.url = await getSongUrl(song.id) || undefined;
      }));

      logMessage({ role: 'user', content: message });
      const say = songs.length > 0
        ? `为你找到 ${songs.length} 首歌，希望你喜欢~`
        : '抱歉，没有搜到相关歌曲，换个关键词试试？';
      logMessage({ role: 'assistant', content: say });
      for (const song of songs) {
        logPlay({ song_id: song.id, title: song.title, artist: song.artist || '' });
      }

      return res.json({
        say,
        play: songs,
        reason: songs.length > 0 ? `搜索"${keyword || intent.payload}"的结果` : '',
        segue: '',
      });
    }

    // claude intent
    const state = { getRecentPlays };
    const ctx = build({ trigger: 'chat', input: intent.payload, state });

    const result = await ask(ctx);

    // Persist
    logMessage({ role: 'user', content: message });
    logMessage({
      role: 'assistant',
      content: result.say,
      meta: { songs: result.play, reason: result.reason, segue: result.segue },
    });
    for (const song of result.play) {
      logPlay({ title: song.title, artist: song.artist || '' });
    }

    return res.json({
      say: result.say,
      play: result.play,
      reason: result.reason,
      segue: result.segue,
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Claudio is listening on http://localhost:${PORT}`);
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
