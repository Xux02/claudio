import { chatWithRetry, getHistory, deleteMsg, triggerGreeting } from './api.js';
import { initVisualizer, addToQueue, setPlaying, togglePlay, playPrevSong, playNextSong, setVolume, startClock, togglePlaylist } from './player.js';
import { render, clearInput, scrollBottom, showToast, saveAvatar, renderSystemMsg, initElasticScroll } from './chat.js';
import { getCurrentMessages, saveCurrentMessages, archiveAndClear, getSavedSessions, loadSession, showSessionBar, showSessionPicker } from './sessions.js';

// ─── Weather / location ──────────────────────────────────────

document.getElementById('weather-icon').textContent = '☀️';
document.getElementById('weather-text').textContent = '扬州 · 18°C';

const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
document.getElementById('today-date').textContent = dateStr;

// ─── Player init ─────────────────────────────────────────────

initVisualizer();
startClock();
setPlaying(false);

// Now playing notification in chat
document.addEventListener('claudio:nowPlaying', (e) => {
  const { title, artist } = e.detail;
  const artistPart = artist ? ` — ${artist}` : '';
  renderSystemMsg(`Now playing: ${title}${artistPart}`);
});

// ─── Button events ───────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-prev').addEventListener('click', playPrevSong);
document.getElementById('btn-next').addEventListener('click', playNextSong);
document.getElementById('btn-playlist').addEventListener('click', togglePlaylist);

document.getElementById('vol-slider').addEventListener('input', (e) => {
  setVolume(parseInt(e.target.value));
});

// ─── Thinking indicator ──────────────────────────────────────

const thinkingEl = document.getElementById('thinking');

function showThinking() { thinkingEl.classList.remove('hidden'); scrollBottom(); }
function hideThinking() { thinkingEl.classList.add('hidden'); }

// ─── Send message ────────────────────────────────────────────

// Track the last user-message DOM element so we can attach DB id later
let lastUserEl = null;
let lastAiEl = null;

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  lastUserEl = render({ type: 'user', sender: '我', text, time: new Date() });
  clearInput();
  showThinking();

  try {
    const result = await chatWithRetry(text);
    hideThinking();
    const say = result.say || '嗯...信号不太好，你刚说什么？';
    lastAiEl = render({ type: 'ai', sender: 'Claudio', text: say, time: new Date() });

    // Attach DB ids for later deletion
    if (result.userMessageId && lastUserEl) {
      lastUserEl.dataset.msgId = result.userMessageId;
    }
    if (result.messageId && lastAiEl) {
      lastAiEl.dataset.msgId = result.messageId;
    }

    if (result.play && result.play.length > 0) {
      addToQueue([result.play[0]]);
    }

    // Persist to localStorage after each exchange
    persistCurrent();
  } catch (err) {
    hideThinking();
    // Server unreachable — show fallback locally
    const el = render({ type: 'ai', sender: 'Claudio', text: '啧，刚走神了，你再说一遍？', time: new Date() });
    if (lastUserEl) lastUserEl.dataset.msgId = '';
    if (el) el.dataset.msgId = '';
    persistCurrent();
    console.error('Chat error:', err);
  }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// ─── Message deletion ────────────────────────────────────────

const chatArea = document.getElementById('chat-area');
initElasticScroll(chatArea);

let deleteTarget = null;

chatArea.addEventListener('contextmenu', (e) => {
  const msg = e.target.closest('.msg');
  if (!msg) return;
  e.preventDefault();
  deleteTarget = msg;
  showDeleteConfirm(e.clientY);
});

// Touch long-press
let longPressTimer = null;
chatArea.addEventListener('touchstart', (e) => {
  const msg = e.target.closest('.msg');
  if (!msg) return;
  deleteTarget = msg;
  longPressTimer = setTimeout(() => {
    const touch = e.touches[0];
    showDeleteConfirm(touch ? touch.clientY : 200);
  }, 600);
}, { passive: false });
chatArea.addEventListener('touchend', () => { clearTimeout(longPressTimer); });
chatArea.addEventListener('touchmove', () => { clearTimeout(longPressTimer); });

function showDeleteConfirm(y) {
  const existing = document.getElementById('delete-confirm');
  if (existing) existing.remove();

  const pop = document.createElement('div');
  pop.id = 'delete-confirm';
  pop.className = 'delete-confirm';
  pop.innerHTML = '<button id="delete-btn">删除</button><button id="delete-cancel">取消</button>';
  pop.style.top = Math.min(y, window.innerHeight - 60) + 'px';
  document.body.appendChild(pop);

  pop.querySelector('#delete-btn').addEventListener('click', async () => {
    pop.remove();
    const el = deleteTarget;
    if (!el) return;
    const msgId = el.dataset.msgId;
    if (msgId) {
      try { await deleteMsg(msgId); } catch {}
    }
    el.remove();
    deleteTarget = null;
  });
  pop.querySelector('#delete-cancel').addEventListener('click', () => {
    pop.remove();
    deleteTarget = null;
  });
  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('click', function dismiss() {
      pop.remove();
      document.removeEventListener('click', dismiss);
    }, { once: true });
  }, 0);
}

// ─── Avatar change ───────────────────────────────────────────

document.addEventListener('claudio:changeAvatar', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      saveAvatar('user', reader.result);
      showToast('头像已更新');
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

// ─── Profile page ────────────────────────────────────────────

document.addEventListener('claudio:showProfile', async () => {
  try {
    const { show } = await import('./profile.js');
    show();
  } catch {
    showToast('资料页即将上线');
  }
});

// ─── Session helpers ───────────────────────────────────────────

function collectMessages() {
  const msgs = [];
  chatArea.querySelectorAll('.msg').forEach(el => {
    const role = el.classList.contains('user') ? 'user' : 'assistant';
    const bubble = el.querySelector('.bubble');
    if (bubble) msgs.push({ role, content: bubble.textContent });
  });
  return msgs;
}

function persistCurrent() {
  const msgs = collectMessages();
  if (msgs.length > 0) saveCurrentMessages(msgs);
}

function clearChatArea() {
  chatArea.innerHTML = '';
  // Also clear any session bar
  const bar = document.getElementById('session-bar');
  if (bar) bar.remove();
}

async function startNewChat() {
  archiveAndClear();
  clearChatArea();

  showThinking();
  try {
    const result = await triggerGreeting();
    hideThinking();
    const say = result.say || '哟，Claudio 在这儿呢。今天想听点什么？';
    render({ type: 'ai', sender: 'Claudio', text: say, time: new Date() });
    if (result.play && result.play.length > 0) {
      addToQueue([result.play[0]]);
    }
  } catch {
    hideThinking();
    render({
      type: 'ai',
      sender: 'Claudio',
      text: '哟，Claudio 在这儿呢。这会天气不错，要不要来首歌？',
      time: new Date(),
    });
  }
}

// ─── "新对话" and "历史" buttons ───────────────────────────────

document.getElementById('btn-new-chat').addEventListener('click', () => {
  persistCurrent();
  startNewChat();
});

document.getElementById('btn-history').addEventListener('click', () => {
  persistCurrent();
  showSessionPicker((id) => {
    const messages = loadSession(id);
    if (!messages) return;
    clearChatArea();
    for (const msg of messages) {
      const type = msg.role === 'user' ? 'user' : 'ai';
      render({
        type,
        sender: type === 'ai' ? 'Claudio' : '我',
        text: msg.content,
        time: new Date(),
      });
    }
    saveCurrentMessages(messages);
  });
});

// ─── Load history ────────────────────────────────────────────

async function loadChat() {
  // 1. Try localStorage current session first
  const local = getCurrentMessages();
  if (local && local.length > 0) {
    for (const msg of local) {
      const type = msg.role === 'user' ? 'user' : 'ai';
      render({
        type,
        sender: type === 'ai' ? 'Claudio' : '我',
        text: msg.content,
        time: new Date(),
      });
    }
    // Show continue-or-new bar
    showSessionBar(
      () => { /* continue — do nothing, messages are already there */ },
      () => { startNewChat(); }
    );
    return;
  }

  // 2. Try server history
  try {
    const { messages } = await getHistory(50);
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const type = msg.role === 'user' ? 'user' : 'ai';
        const el = render({
          type,
          sender: type === 'ai' ? 'Claudio' : '我',
          text: msg.content,
          time: new Date(msg.created_at + 'Z'),
        });
        el.dataset.msgId = msg.id;
      }
      persistCurrent();
      showSessionBar(
        () => {},
        () => { startNewChat(); }
      );
      return;
    }
  } catch { /* server unreachable, show greeting */ }

  // 3. No history at all — trigger AI greeting
  try {
    const result = await triggerGreeting();
    const say = result.say || '哟，Claudio 在这儿呢。这会天气不错，要不要来首歌？';
    render({ type: 'ai', sender: 'Claudio', text: say, time: new Date() });
    if (result.play && result.play.length > 0) {
      addToQueue([result.play[0]]);
    }
  } catch {
    render({
      type: 'ai',
      sender: 'Claudio',
      text: '哟，Claudio 在这儿呢。这会天气不错，要不要来首歌？',
      time: new Date(),
    });
  }
}

loadChat();
