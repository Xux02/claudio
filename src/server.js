import 'dotenv/config';
import express from 'express';
import { init as initDb, logMessage, logPlay, getRecentPlays, getHistory, close as closeDb } from './state.js';
import { route, handleDirect } from './router.js';
import { build } from './context.js';
import { ask } from './claude.js';
import { search as musicSearch, getSongUrl } from './music.js';
import { synthesize } from './tts.js';
import { start as startScheduler, stop as stopScheduler, getSchedule } from './scheduler.js';

const app = express();
app.use(express.json());

// Init database
const db = initDb();

// Root — simple welcome page
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Claudio</title>
<style>body{font-family:system-ui;max-width:600px;margin:80px auto;padding:20px;background:#1a1a2e;color:#e0d5c1}
h1{color:#c9a87c}a{color:#c9a87c}code{background:#2a2a3e;padding:2px 6px;border-radius:4px}</style></head>
<body>
<h1>Claudio — 个人 AI 电台</h1>
<p>API 已就绪。</p>
<ul>
<li><code>POST /api/chat</code> — 发送消息</li>
<li><code>GET /api/now</code> — 当前播放</li>
<li><code>GET /api/taste</code> — 品味统计</li>
<li><code>GET /api/history</code> — 对话历史</li>
</ul>
<p>前端界面将在 Phase 3 上线。</p>
</body></html>`);
});

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

      for (const song of songs) {
        const url = await getSongUrl(song.id);
        song.url = url || undefined;
      }

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

    const state = { getRecentPlays };
    const ctx = build({ trigger: `手动触发: ${reason}`, input: '', state });

    const result = await ask(ctx);

    // Search real song URLs
    const playWithUrls = [];
    for (const song of result.play) {
      const searchResults = await musicSearch(`${song.title} ${song.artist || ''}`, 1);
      if (searchResults.length > 0) {
        const url = await getSongUrl(searchResults[0].id);
        playWithUrls.push({
          title: searchResults[0].title,
          artist: searchResults[0].artist,
          url: url || undefined,
          reason: song.reason,
        });
      } else {
        playWithUrls.push({ title: song.title, artist: song.artist || '', reason: song.reason });
      }
    }

    // Generate TTS
    const ttsPath = await synthesize(result.say);

    // Persist
    logMessage({
      role: 'assistant',
      content: result.say,
      meta: { songs: playWithUrls, reason: result.reason, segue: result.segue },
    });
    for (const song of playWithUrls) {
      logPlay({ song_id: song.id || null, title: song.title, artist: song.artist || '' });
    }

    return res.json({
      say: result.say,
      play: playWithUrls,
      reason: result.reason,
      segue: result.segue,
      tts: ttsPath,
    });
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
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Claudio is listening on http://localhost:${PORT}`);
});

// Start scheduler
startScheduler(async (reason) => {
  console.log(`[scheduler] Triggered: ${reason}`);
  try {
    const state = { getRecentPlays };
    const ctx = build({ trigger: reason, input: '', state });
    const result = await ask(ctx);

    const playWithUrls = [];
    for (const song of result.play) {
      const searchResults = await musicSearch(`${song.title} ${song.artist || ''}`, 1);
      if (searchResults.length > 0) {
        const url = await getSongUrl(searchResults[0].id);
        playWithUrls.push({
          title: searchResults[0].title,
          artist: searchResults[0].artist,
          url: url || undefined,
          reason: song.reason,
        });
      } else {
        playWithUrls.push({ title: song.title, artist: song.artist || '', reason: song.reason });
      }
    }

    const ttsPath = await synthesize(result.say);

    logMessage({
      role: 'assistant',
      content: result.say,
      meta: { songs: playWithUrls, reason: result.reason, segue: result.segue },
    });
    for (const song of playWithUrls) {
      logPlay({ song_id: song.id || null, title: song.title, artist: song.artist || '' });
    }

    console.log(`[scheduler] DJ says: ${result.say.slice(0, 50)}...`);
    console.log(`[scheduler] TTS: ${ttsPath || 'none'}`);
    console.log(`[scheduler] Songs: ${playWithUrls.map(s => s.title).join(', ')}`);
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
