import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function readFile(relPath) {
  const full = path.join(ROOT, relPath);
  try {
    return fs.readFileSync(full, 'utf-8').trim();
  } catch {
    return '';
  }
}

/**
 * Build the context object for the Claude call.
 * Assembles 6 fragments in order:
 *   1. persona (prompts/dj-persona.md)
 *   2. taste (user/*.md)
 *   3. env (weather, calendar, time)
 *   4. memory (recent plays from state.db)
 *   5. input (user message / tool result)
 *   6. trigger (scheduler trigger reason)
 *
 * @param {Object} opts
 * @param {string} [opts.trigger] - What triggered this call
 * @param {string} [opts.input] - User message or tool result
 * @param {Object} [opts.state] - state.js module for memory fetching
 * @returns {{persona: string, taste: string, env: string, memory: string, input: string, trigger: string}}
 */
function formatInsights(insights) {
  if (!insights) return '';
  const lines = [];

  lines.push('## 学习到的偏好模式');

  // Context-aware patterns
  if (insights.liftedUp.length > 0 || insights.liftedDown.length > 0) {
    const levelLabel = insights.levelUsed === 'global' ? '全局' : `当前情境（${insights.contextLabel}）`;
    lines.push(`### ${levelLabel}`);
    if (insights.contextSessionCount > 0) {
      lines.push(`基于此情境的 ${insights.contextSessionCount} 个历史会话（衰减加权）：`);
    }
    if (insights.liftedUp.length > 0) {
      lines.push('- 偏好度显著高于平时的：' + insights.liftedUp.map(a =>
        `${a.artist}(↑${a.lift.toFixed(1)}x)`).join(', '));
    }
    if (insights.liftedDown.length > 0) {
      lines.push('- 偏好度显著低于平时的：' + insights.liftedDown.map(a =>
        `${a.artist}(↓${(1/a.lift).toFixed(1)}x)`).join(', '));
    }
    if (insights.recentContextSongs.length > 0) {
      lines.push('- 此情境近期常播：' + insights.recentContextSongs.map(s =>
        `${s.artist} - ${s.title}`).join('、'));
    }
  }

  // Trend
  if (insights.trend) {
    lines.push('### 听歌趋势（近两周 vs 前两周）');
    if (insights.trend.rising.length > 0) {
      lines.push('- 最近听得更多的：' + insights.trend.rising.join('、'));
    }
    if (insights.trend.declining.length > 0) {
      lines.push('- 最近听得更少的：' + insights.trend.declining.join('、'));
    }
  }

  // Weather signal
  if (insights.weatherSignal) {
    lines.push(`### 今日特别信号`);
    lines.push(`- ${insights.weatherSignal.desc}天你通常喜欢：` +
      insights.weatherSignal.artists.map(a =>
        `${a.artist}(↑${a.lift.toFixed(1)}x)`).join(', ') +
      `（基于 ${insights.weatherSignal.sessionCount} 个${insights.weatherSignal.desc}天会话）`);
  }

  return lines.join('\n');
}

export function build({ trigger = '', input = '', state = null, weather = null } = {}) {
  // 1. DJ persona
  const persona = readFile('prompts/dj-persona.md');

  // 2. User corpus
  const taste = [
    readFile('user/about.md'),
    readFile('user/taste.md'),
    readFile('user/routines.md'),
    readFile('user/mood-rules.md'),
  ]
    .filter(Boolean)
    .join('\n\n');

  // 3. Environment injection
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
  });
  const hour = now.getHours();
  const city = process.env.CITY || '南京';
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '早晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '深夜';
  const envLines = [
    `当前时间: ${timeStr}`,
    `城市: ${city}`,
    `时段: ${timeOfDay}`,
  ];
  if (weather) {
    envLines.push(`天气: ${weather.desc} ${weather.temp !== null ? weather.temp + '°C' : ''}${weather.humidity ? ' 湿度' + weather.humidity + '%' : ''}${weather.wind ? ' ' + weather.wind : ''}`.trim());
  }
  const env = envLines.join('\n');

  // 4. Memory - recent plays + taste stats from actual listening
  let memory = '';
  if (state) {
    try {
      const recentPlays = state.getRecentPlays(10);
      const tasteStats = state.getTasteStats ? state.getTasteStats() : null;

      const parts = [];

      if (recentPlays.length > 0) {
        parts.push(
          '近期播放:\n' +
            recentPlays
              .map((p) => `- ${p.title}${p.artist ? ' - ' + p.artist : ''}`)
              .join('\n')
        );
      }

      if (tasteStats && tasteStats.totalPlays > 0) {
        const ta = tasteStats.topArtists;
        const ra = tasteStats.recentArtists;
        const ts = tasteStats.topSongs;

        const tasteLines = [];
        tasteLines.push(`用户总共播放了 ${tasteStats.totalPlays} 首歌`);

        if (ta.length > 0) {
          tasteLines.push('最常听的歌手: ' + ta.map(a => `${a.artist}(${a.cnt}次)`).join('、'));
        }
        if (ra.length > 0) {
          tasteLines.push('近期口味: ' + ra.slice(0, 10).join('、'));
        }
        if (ts.length > 0) {
          tasteLines.push('常听歌曲: ' + ts.map(s => `《${s.title}》${s.artist}`).join('、'));
        }

        parts.push('用户听歌统计（反映真实偏好）:\n' + tasteLines.join('\n'));
      }

      // Learned preference patterns (Bayesian + context-aware)
      if (state.getContextInsights) {
        try {
          const now2 = new Date();
          const hr = now2.getHours();
          const dow = now2.getDay();
          const we = (dow === 0 || dow === 6) ? 1 : 0;
          const tod = hr < 6 ? '深夜' : hr < 9 ? '早晨' : hr < 12 ? '上午'
            : hr < 14 ? '中午' : hr < 18 ? '下午' : hr < 21 ? '傍晚' : '深夜';
          const wd = weather?.desc || '';
          const insights = state.getContextInsights({ timeOfDay: tod, dayOfWeek: dow, isWeekend: we, weatherDesc: wd });
          if (insights) {
            const formatted = formatInsights(insights);
            if (formatted) parts.push(formatted);
          }
        } catch { /* preference learning not critical */ }
      }

      // Feedback history
      if (state.getFeedback) {
        const fb = state.getFeedback(20);
        const fbLines = [];
        if (fb.likes.length > 0) {
          fbLines.push('用户喜欢的歌: ' + fb.likes.map(s => `《${s.title}》${s.artist || ''}`).join('、'));
        }
        if (fb.dislikes.length > 0) {
          fbLines.push('用户不喜欢的歌: ' + fb.dislikes.map(s => `《${s.title}》${s.artist || ''}`).join('、'));
        }
        if (fbLines.length > 0) {
          parts.push('用户反馈（喜欢/不喜欢的歌曲）:\n' + fbLines.join('\n'));
        }
      }

      // Imported playlists
      if (state.getPref) {
        try {
          const importedJson = state.getPref('imported_playlist_index');
          if (importedJson) {
            parts.push('用户导入的歌单:\n' + importedJson);
          }
        } catch { /* no imported playlists yet */ }
      }

      // Skipped songs (unavailable on Netease) — avoid recommending these
      if (state.getSkippedSongs) {
        try {
          const skipped = state.getSkippedSongs(10);
          if (skipped.length > 0) {
            parts.push('近期无法播放的歌曲（避免推荐）:\n' +
              skipped.map(s => `- 《${s.title}》${s.artist ? ' - ' + s.artist : ''}`).join('\n'));
          }
        } catch { /* no skipped songs module yet */ }
      }

      // Recent conversation — so AI remembers what was just said
      if (state.getRecentMessages) {
        try {
          const msgs = state.getRecentMessages(20);
          if (msgs.length > 0) {
            parts.push('近期对话记录:\n' +
              msgs.map(m => `[${m.role === 'user' ? '用户' : 'Claudio'}] ${m.content}`).join('\n'));
          }
        } catch { /* getRecentMessages not available */ }
      }

      memory = parts.join('\n\n');
    } catch {
      memory = '';
    }
  }

  return { persona, taste, env, memory, input, trigger };
}
