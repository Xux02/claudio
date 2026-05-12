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
 * @returns {Promise<{persona: string, taste: string, env: string, memory: string, input: string, trigger: string}>}
 */
export async function build({ trigger = '', input = '', state = null } = {}) {
  // 1. DJ persona
  const persona = readFile('prompts/dj-persona.md');

  // 2. User corpus
  const taste = [
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
  const env = [
    `当前时间: ${timeStr}`,
    `城市: ${city}`,
    `时段: ${hour < 6 ? '深夜' : hour < 9 ? '早晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '深夜'}`,
  ].join('\n');

  // 4. Memory - recent plays
  let memory = '';
  if (state) {
    try {
      const recentPlays = state.getRecentPlays(10);
      if (recentPlays.length > 0) {
        memory =
          '近期播放:\n' +
          recentPlays
            .map((p) => `- ${p.title}${p.artist ? ' - ' + p.artist : ''}`)
            .join('\n');
      }
    } catch {
      memory = '';
    }
  }

  return { persona, taste, env, memory, input, trigger };
}
