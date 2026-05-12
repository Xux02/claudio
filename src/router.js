const DIRECT_KEYWORDS = ['天气', '时间', '几点了', '帮助', 'help'];
const MUSIC_KEYWORDS = ['播放', '来首', '想听', '放一首', '换首歌', '切歌', '下一首', '推荐首歌'];

/**
 * Route user input to the correct handler.
 * @param {string} message
 * @returns {{ type: 'direct' | 'claude' | 'music', payload: string }}
 */
export function route(message) {
  const trimmed = (message || '').trim();

  if (!trimmed) {
    return { type: 'claude', payload: '' };
  }

  // Check music intent first to avoid substring collisions
  for (const kw of MUSIC_KEYWORDS) {
    if (trimmed.includes(kw)) {
      return { type: 'music', payload: trimmed };
    }
  }

  // Only pure utility queries go direct — everything else goes to Claude
  for (const kw of DIRECT_KEYWORDS) {
    if (trimmed.includes(kw)) {
      return { type: 'direct', payload: trimmed };
    }
  }

  // Default: send to Claude for natural language understanding
  return { type: 'claude', payload: trimmed };
}

/**
 * Handle direct utility commands without LLM.
 */
export function handleDirect(message) {
  if (message.includes('天气')) {
    return '让我看看窗外的天气...今天南京天气不错，适合来点轻快的音乐。具体的天气数据我还在接入中，很快就能给你准确的天气播报了~';
  }
  if (message.includes('时间') || message.includes('几点了')) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const hour = now.getHours();
    let vibe = '';
    if (hour < 6) vibe = '夜深了，需要安静的陪伴吗？';
    else if (hour < 9) vibe = '早上好！新的一天开始了~';
    else if (hour < 12) vibe = '上午好，正在专注中吧？';
    else if (hour < 14) vibe = '午安，休息一下充个电~';
    else if (hour < 18) vibe = '下午好，来点音乐提提神？';
    else if (hour < 21) vibe = '傍晚了，放松一下吧~';
    else vibe = '晚上好，一天的忙碌该收尾了~';
    return `现在是 ${timeStr}。${vibe}`;
  }
  if (message.includes('帮助') || message.includes('help')) {
    return '我是 Claudio，你的个人 AI 电台 DJ 🎵\n\n你可以这样和我对话：\n• 直接聊天：「今天心情不错」「好累啊」\n• 点歌：「来首周杰伦」「想听民谣」\n• 控制播放：「换首歌」「下一首」（即将支持）\n\n直接打字跟我聊天吧~';
  }
  return '';
}
