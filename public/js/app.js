import { chatWithRetry, getHistory } from './api.js';
import { initVisualizer, update, setProgress, setPlaying, isPlaying } from './player.js';
import { render, clearInput, showToast, saveAvatar } from './chat.js';

// Weather — placeholder until real data from backend
document.getElementById('weather-icon').textContent = '☀️';
document.getElementById('weather-text').textContent = '南京 · 18°C';
document.getElementById('weather-date').textContent = new Date().toISOString().slice(0, 10);

// Initialize visualizer
initVisualizer();
setPlaying(false);

// Play/pause toggle
document.getElementById('btn-play').addEventListener('click', () => {
  setPlaying(!isPlaying());
});

// Volume slider
document.getElementById('vol-slider').addEventListener('input', (e) => {
  console.log('Volume:', e.target.value);
});

// Send message
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  render({ type: 'user', sender: '我', text, time: new Date() });
  clearInput();

  try {
    const result = await chatWithRetry(text);
    render({ type: 'ai', sender: 'Claudio', text: result.say, time: new Date() });

    if (result.play && result.play.length > 0) {
      const song = result.play[0];
      update({
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
      });
      setPlaying(true);
    }
  } catch (err) {
    showToast('Claudio 走神了，重试一下？');
    console.error('Chat error:', err);
  }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Avatar change handler
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

// Profile page navigation — dynamic import (profile.js is Task 7)
document.addEventListener('claudio:showProfile', async () => {
  try {
    const { show } = await import('./profile.js');
    show();
  } catch {
    showToast('资料页即将上线');
  }
});

// Load initial state — show welcome or history
getHistory(5).then(({ messages }) => {
  if (messages && messages.length > 0) {
    for (const msg of messages) {
      const type = msg.role === 'user' ? 'user' : 'ai';
      render({
        type,
        sender: type === 'ai' ? 'Claudio' : '我',
        text: msg.content,
        time: new Date(msg.created_at + 'Z'),
      });
    }
  } else {
    render({
      type: 'ai',
      sender: 'Claudio',
      text: '你好，我是你的电台 DJ Claudio。今天阳光正好 ☀️',
      time: new Date(),
    });
  }
}).catch(() => {
  render({
    type: 'ai',
    sender: 'Claudio',
    text: '你好，我是你的电台 DJ Claudio。今天阳光正好 ☀️',
    time: new Date(),
  });
});
