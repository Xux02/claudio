import 'dotenv/config';
import express from 'express';
import { init as initDb, logMessage, logPlay, getRecentPlays, getHistory, close as closeDb } from './state.js';
import { route, handleDirect } from './router.js';
import { build } from './context.js';
import { ask } from './claude.js';

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
      return res.json({
        say: '音乐搜索功能正在接入中，很快就能用了！你可以先跟我聊聊天，我会根据你的品味推荐歌曲~',
        play: [],
        reason: '',
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Claudio is listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
