import './fetch-polyfill.js';
import 'dotenv/config';
import express from 'express';
import { init as initDb, logMessage, deleteMessage, logPlay, getRecentPlays, getHistory, close as closeDb } from './state.js';
import { route, handleDirect } from './router.js';
import { build } from './context.js';
import { search as musicSearch, getSongUrl } from './music.js';
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
app.use(express.json());

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

// Shared helper: resolve Claude's song list to real search results with URLs
async function resolvePlaylist(play) {
  const enriched = await Promise.all(play.map(async (song) => {
    // Fetch more candidates so we can pick the best match
    const results = await musicSearch(`${song.title} ${song.artist || ''}`, 5);
    if (results.length > 0) {
      // Score each result and pick the best
      let best = results[0];
      let bestScore = matchScore(results[0], song);
      for (let i = 1; i < results.length; i++) {
        const s = matchScore(results[i], song);
        if (s > bestScore) { best = results[i]; bestScore = s; }
      }

      // Require at least title + artist match (score >= 13) to exclude covers
      // 3 (title contains keyword) + 10 (artist contains keyword) = 13 minimum
      if (bestScore < 13) {
        console.warn(`[resolve] No good match for "${song.title}" by ${song.artist || '?'} — best score ${bestScore}`);
        return { title: song.title, artist: song.artist || '', reason: song.reason,
          skipped: true, skipReason: 'no_good_match' };
      }

      const url = await getSongUrl(best.id);
      return {
        title: best.title,
        artist: best.artist,
        url: url || undefined,
        reason: song.reason,
      };
    }
    return { title: song.title, artist: song.artist || '', reason: song.reason,
      skipped: true, skipReason: 'not_found' };
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
      const userMsgId = logMessage({ role: 'user', content: message });
      const aiMsgId = logMessage({ role: 'assistant', content: say });
      return res.json({ say, play: [], reason: '', segue: '', userMessageId: userMsgId, messageId: aiMsgId });
    }

    if (intent.type === 'music') {
      if (!musicApiOk) {
        const userMsgId = logMessage({ role: 'user', content: message });
        const say = musicDownMessage();
        const aiMsgId = logMessage({ role: 'assistant', content: say });
        return res.json({ say, play: [], reason: '', segue: '', userMessageId: userMsgId, messageId: aiMsgId });
      }

      const keyword = intent.payload
        .replace(/^(播放|来首|想听|放一首|换首歌|切歌|下一首|推荐首歌)/, '')
        .trim();
      const songs = await musicSearch(keyword || intent.payload, 5);

      await Promise.all(songs.map(async (song) => {
        song.url = await getSongUrl(song.id) || undefined;
      }));

      const userMsgId = logMessage({ role: 'user', content: message });
      const say = songs.length > 0
        ? `为你找到 ${songs.length} 首歌，希望你喜欢~`
        : '抱歉，没有搜到相关歌曲，换个关键词试试？';
      const aiMsgId = logMessage({ role: 'assistant', content: say });
      for (const song of songs) {
        logPlay({ song_id: song.id, title: song.title, artist: song.artist || '' });
      }

      return res.json({
        say,
        play: songs,
        reason: songs.length > 0 ? `搜索"${keyword || intent.payload}"的结果` : '',
        segue: '',
        userMessageId: userMsgId,
        messageId: aiMsgId,
      });
    }

    // claude intent — persist user message first so it survives even if AI fails
    const userMsgId = logMessage({ role: 'user', content: message });

    const state = { getRecentPlays };
    const ctx = build({ trigger: 'chat', input: intent.payload, state });

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
    const playWithUrls = musicApiOk ? await resolvePlaylist(result.play) : result.play.map(s => ({
      title: s.title, artist: s.artist || '', reason: s.reason,
      skipped: true, skipReason: 'music_api_down',
    }));

    // If music API is down, tell the user explicitly
    if (!musicApiOk) {
      const aiMsgId = logMessage({
        role: 'assistant',
        content: result.say,
        meta: { songs: [], reason: result.reason, segue: result.segue },
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
      logPlay({ title: song.title, artist: song.artist || '' });
    }

    // Build response: append skip notice when songs can't be matched to real tracks
    let say = result.say || '嗯，我在听。想听点什么歌吗？';
    const skipped = playWithUrls.filter(s => s.skipped);
    const playable = playWithUrls.filter(s => s.url);
    if (skipped.length > 0 && playable.length === 0) {
      const names = skipped.map(s => `《${s.title}》`).join('、');
      say += `\n\n${names} 在网易云暂时没有正版资源，换个歌试试？`;
    } else if (skipped.length > 0) {
      const names = skipped.map(s => `《${s.title}》`).join('、');
      say += `\n\n（${names} 没找到正版资源，已跳过）`;
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
  try {
    const res = await fetch(`${MUSIC_API_URL}/search?keywords=test&limit=1`);
    if (res.ok) {
      musicApiOk = true;
      console.log(`[server] Music API OK: ${MUSIC_API_URL}`);
    } else {
      console.warn(`[server] Music API returned ${res.status}, music features may not work`);
    }
  } catch {
    console.warn(`[server] Music API unreachable at ${MUSIC_API_URL} — start it with:
  PORT=4000 node node_modules/NeteaseCloudMusicApi/app.js &`);
  }
}

function musicDownMessage() {
  return '音乐服务暂时离线，请确保网易云 API 已启动：\nPORT=4000 node node_modules/NeteaseCloudMusicApi/app.js &';
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
