import { chatWithRetry, getHistory, deleteMsg, triggerGreeting, sendFeedback, importPlaylist, getWeather, addFavorite, getFavorites, removeFavorite, clearMemory, searchMusic } from './api.js';
import { initVisualizer, addToQueue, setPlaying, togglePlay, playPrevSong, playNextSong, initVolumeSlider, startClock, togglePlaylist, getCurrentSong } from './player.js';
import { render, clearInput, scrollBottom, showToast, saveAvatar, renderSystemMsg, renderFeedbackButtons, renderThinkingBubble, removeThinkingBubble, initElasticScroll, streamText } from './chat.js';
import { getCurrentMessages, saveCurrentMessages, archiveAndClear, getSavedSessions, loadSession, showSessionBar, showSessionPicker, syncNow, getLastSyncTime } from './sessions.js';

// ─── Weather / location ──────────────────────────────────────

async function initWeather() {
  try {
    const w = await getWeather();
    document.getElementById('weather-icon').textContent = w.icon || '🌤️';
    document.getElementById('weather-text').textContent = `${w.city} · ${w.temp !== null ? w.temp + '°C' : '--'}  ${w.desc}`;
  } catch {
    document.getElementById('weather-icon').textContent = '🌤️';
    document.getElementById('weather-text').textContent = '扬州 · --';
  }
}
initWeather();

const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
document.getElementById('today-date').textContent = dateStr;

// ─── Player init ─────────────────────────────────────────────

initVisualizer();
startClock();
setPlaying(false);
initVolumeSlider();

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

// ─── Sync button ───────────────────────────────────────────────

document.getElementById('btn-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync');
  btn.classList.add('syncing');
  btn.textContent = '⏳';
  try {
    const result = await syncNow();
    if (result.ok) {
      updateSyncIndicator('synced');
      showToast(`已同步 ${result.sessionCount} 个会话`);
    } else {
      updateSyncIndicator('error');
      showToast('同步失败，请重试');
    }
  } catch {
    updateSyncIndicator('error');
    showToast('同步失败，网络不可达');
  } finally {
    btn.classList.remove('syncing');
    btn.textContent = '☁️';
  }
});

function updateSyncIndicator(state) {
  const btn = document.getElementById('btn-sync');
  btn.classList.remove('syncing', 'error', 'synced');
  if (state === 'synced') {
    btn.classList.add('synced');
    const last = getLastSyncTime();
    btn.title = last ? `已同步 · ${last.slice(11, 19)}` : '已同步';
  } else if (state === 'error') {
    btn.classList.add('error');
    btn.title = '同步失败，点击重试';
  }
}

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
  const thinkingEl = renderThinkingBubble();

  try {
    const result = await chatWithRetry(text);
    removeThinkingBubble();
    const say = result.say || '嗯...信号不太好，你刚说什么？';
    lastAiEl = render({ type: 'ai', sender: 'Claudio', text: '', time: new Date() });
    const bubble = lastAiEl.querySelector('.bubble');

    // Attach DB ids for later deletion
    if (result.userMessageId && lastUserEl) {
      lastUserEl.dataset.msgId = result.userMessageId;
    }
    if (result.messageId && lastAiEl) {
      lastAiEl.dataset.msgId = result.messageId;
    }

    // Store song list on the AI message element — user chooses whether to play
    const playableSongs = (result.play || []).filter(s => s.url);
    if (playableSongs.length > 0) {
      lastAiEl._songs = playableSongs;
      const fbContainer = renderFeedbackButtons(playableSongs, lastAiEl.querySelector('.msg-body'));
      wireSongFeedback(fbContainer, playableSongs);
    }

    // Stream the text character by character
    if (bubble) await streamText(bubble, say);

    // Persist to localStorage after each exchange
    persistCurrent();
    syncNow().then(r => { if (r.ok) updateSyncIndicator('synced'); }).catch(() => {});
  } catch (err) {
    removeThinkingBubble();
    // Server unreachable — show fallback locally
    const el = render({ type: 'ai', sender: 'Claudio', text: '', time: new Date() });
    if (lastUserEl) lastUserEl.dataset.msgId = '';
    if (el) {
      el.dataset.msgId = '';
      const bubble = el.querySelector('.bubble');
      if (bubble) streamText(bubble, '啧，刚走神了，你再说一遍？', 25);
    }
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

  const thinkingEl = renderThinkingBubble();
  try {
    const result = await triggerGreeting();
    removeThinkingBubble();
    const say = result.say || '哟，Claudio 在这儿呢。今天想听点什么？';
    const aiEl = render({ type: 'ai', sender: 'Claudio', text: '', time: new Date() });
    // Show playable songs with play button but don't auto-add
    const playable = (result.play || []).filter(s => s.url);
    if (playable.length > 0) {
      aiEl._songs = playable;
      const fbContainer = renderFeedbackButtons(playable, aiEl.querySelector('.msg-body'));
      wireSongFeedback(fbContainer, playable);
    }
    const bubble = aiEl.querySelector('.bubble');
    if (bubble) await streamText(bubble, say);
  } catch {
    removeThinkingBubble();
    const el = render({
      type: 'ai',
      sender: 'Claudio',
      text: '',
      time: new Date(),
    });
    const bubble = el.querySelector('.bubble');
    if (bubble) streamText(bubble, '哟，Claudio 在这儿呢。这会天气不错，要不要来首歌？', 25);
  }
}

// ─── "清除记忆" button ──────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('确定要清除 Claudio 的所有记忆和品味偏好吗？\n\n这将删除所有对话记录、播放记录、反馈和偏好设置。清除后你可以重新导入歌单。')) return;
  try {
    await clearMemory();
    clearChatArea();
    // Clear localStorage sessions too
    const { archiveAndClear } = await import('./sessions.js');
    archiveAndClear();
    showToast('记忆已清除，重新开始吧 🧹');
    // Re-trigger greeting
    setTimeout(() => startNewChat(), 500);
  } catch (err) {
    showToast('清除失败: ' + err.message);
  }
});

// ─── "导入歌单" dialog ──────────────────────────────────────────

document.getElementById('btn-import').addEventListener('click', () => {
  const dialog = document.getElementById('import-dialog');
  dialog.classList.remove('hidden');
  document.getElementById('import-url').value = '';
  document.getElementById('import-error').classList.add('hidden');
  document.getElementById('import-submit').disabled = false;
});

document.getElementById('import-cancel').addEventListener('click', () => {
  document.getElementById('import-dialog').classList.add('hidden');
});

document.getElementById('import-dialog').querySelector('.import-dialog-mask')
  .addEventListener('click', () => {
    document.getElementById('import-dialog').classList.add('hidden');
  });

document.getElementById('import-submit').addEventListener('click', async () => {
  const urlInput = document.getElementById('import-url');
  const errEl = document.getElementById('import-error');
  const submitBtn = document.getElementById('import-submit');
  const url = urlInput.value.trim();

  if (!url) {
    errEl.textContent = '请输入歌单链接';
    errEl.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '导入中...';
  errEl.classList.add('hidden');

  try {
    const result = await importPlaylist(url);
    document.getElementById('import-dialog').classList.add('hidden');
    showToast(`已导入歌单「${result.playlistName}」(${result.songCount}首)`);
  } catch (err) {
    errEl.textContent = err.message || '导入失败';
    errEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = '导入';
  }
});

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
    const aiEl = render({ type: 'ai', sender: 'Claudio', text: '', time: new Date() });
    const playable = (result.play || []).filter(s => s.url);
    if (playable.length > 0) {
      aiEl._songs = playable;
      const fbContainer = renderFeedbackButtons(playable, aiEl.querySelector('.msg-body'));
      wireSongFeedback(fbContainer, playable);
    }
    const bubble = aiEl.querySelector('.bubble');
    if (bubble) await streamText(bubble, say);
  } catch {
    const el = render({
      type: 'ai',
      sender: 'Claudio',
      text: '',
      time: new Date(),
    });
    const bubble = el.querySelector('.bubble');
    if (bubble) streamText(bubble, '哟，Claudio 在这儿呢。这会天气不错，要不要来首歌？', 25);
  }
}

// ─── Favorites panel ──────────────────────────────────────────

const FAV_CACHE_KEY = 'claudio_favorites_cache';
let favoritesOpen = false;

function getFavoritesCache() {
  try { return JSON.parse(localStorage.getItem(FAV_CACHE_KEY)) || []; } catch { return []; }
}
function setFavoritesCache(favs) {
  try { localStorage.setItem(FAV_CACHE_KEY, JSON.stringify(favs)); } catch {}
}

function renderFavoritesList(list, favorites) {
  if (favorites.length === 0) {
    list.innerHTML = '<div class="favorites-empty">还没有收藏歌曲，给喜欢的歌点个赞吧 👍</div>';
    return;
  }
  list.innerHTML = favorites.map((f, i) => `
    <div class="favorites-item" data-id="${f.id}">
      <span class="favorites-index">${i + 1}</span>
      <div class="favorites-song-info">
        <span class="favorites-song-title">${escHtml(f.title)}</span>
        <span class="favorites-song-artist">${escHtml(f.artist || '')}</span>
      </div>
      <button class="favorites-play" data-title="${escHtml(f.title)}" data-artist="${escHtml(f.artist || '')}" title="播放">▶</button>
      <button class="favorites-del" data-id="${f.id}" title="取消收藏">×</button>
    </div>
  `).join('');
}

function closeFavorites() {
  favoritesOpen = false;
  document.getElementById('favorites-panel').classList.add('hidden');
}

async function openFavorites() {
  favoritesOpen = true;
  const panel = document.getElementById('favorites-panel');
  const list = document.getElementById('favorites-list');
  panel.classList.remove('hidden');

  // Show cached favorites immediately (instant first paint)
  const cached = getFavoritesCache();
  if (cached.length > 0) {
    renderFavoritesList(list, cached);
    wireFavoritesActions(list);
  } else {
    list.innerHTML = '<div class="favorites-loading"><span class="loading-spinner"></span>加载中...</div>';
  }

  try {
    const { favorites } = await getFavorites();
    setFavoritesCache(favorites);
    renderFavoritesList(list, favorites);
    wireFavoritesActions(list);
  } catch {
    // If fetch fails, keep showing cached data; only show error if no cache
    if (cached.length === 0) {
      list.innerHTML = '<div class="favorites-empty">加载失败，请重试</div>';
    }
  }
}

function wireFavoritesActions(list) {
  list.querySelectorAll('.favorites-play').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const title = btn.dataset.title;
      const artist = btn.dataset.artist;
      const keyword = `${title} ${artist}`.trim();
      try {
        const { results } = await searchMusic(keyword);
        const playable = results.filter(s => s.url);
        if (playable.length > 0) {
          addToQueue(playable);
          showToast(`已加入: ${playable[0].title}`);
        } else {
          showToast('未找到可播放的资源');
        }
      } catch {
        showToast('搜索失败');
      }
    });
  });

  list.querySelectorAll('.favorites-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      try {
        await removeFavorite(id);
        const favs = getFavoritesCache().filter(f => f.id !== id);
        setFavoritesCache(favs);
        const item = btn.closest('.favorites-item');
        if (item) {
          item.style.opacity = '0';
          item.style.transition = 'opacity 0.2s';
          setTimeout(() => {
            item.remove();
            list.querySelectorAll('.favorites-index').forEach((el, i) => { el.textContent = i + 1; });
            if (list.querySelectorAll('.favorites-item').length === 0) {
              list.innerHTML = '<div class="favorites-empty">还没有收藏歌曲，给喜欢的歌点个赞吧 👍</div>';
            }
          }, 200);
        }
        showToast('已取消收藏');
      } catch {
        showToast('操作失败');
      }
    });
  });
}

document.getElementById('btn-favorites').addEventListener('click', () => {
  if (favoritesOpen) {
    closeFavorites();
  } else {
    openFavorites();
  }
});

document.getElementById('favorites-panel').querySelector('.favorites-panel-mask')
  .addEventListener('click', closeFavorites);
document.getElementById('favorites-close').addEventListener('click', closeFavorites);

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function wireSongFeedback(fbContainer, playableSongs) {
  if (!fbContainer) return;

  // Add play button to each row
  fbContainer.querySelectorAll('.feedback-row').forEach((row, i) => {
    const playBtn = document.createElement('button');
    playBtn.className = 'fb-btn play';
    playBtn.title = '加入播放';
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', () => {
      addToQueue([playableSongs[i]]);
      showToast(`已加入: ${playableSongs[i].title}`);
    });
    const actions = row.querySelector('.feedback-actions');
    if (actions) actions.appendChild(playBtn);
  });

  // Like → feedback + add to favorites
  fbContainer.querySelectorAll('.fb-btn.like').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = playableSongs[parseInt(btn.dataset.idx)];
      try {
        await sendFeedback(s.title, s.artist, 'like');
        try {
          const res = await addFavorite(s.title, s.artist, 'ai_recommend');
          // Update cache if newly added (res.id not null means it was inserted)
          if (res && res.id) {
            const favs = getFavoritesCache();
            favs.unshift({ id: res.id, title: s.title, artist: s.artist, source: 'ai_recommend' });
            setFavoritesCache(favs);
          }
        } catch { /* server unreachable, skip */ }
        showToast('已标记为喜欢，已加入收藏 ❤️');
      }
      catch { showToast('反馈失败'); }
    });
  });

  // Dislike → feedback + skip current if playing
  fbContainer.querySelectorAll('.fb-btn.dislike').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = playableSongs[parseInt(btn.dataset.idx)];
      const cur = getCurrentSong();
      if (cur && cur.title === s.title && cur.artist === s.artist) {
        playNextSong();
      }
      try { await sendFeedback(s.title, s.artist, 'dislike'); showToast('已标记为不喜欢，以后少推'); }
      catch { showToast('反馈失败'); }
    });
  });
}

loadChat();

// Pull cloud sessions after page load (delayed to not compete with initial render)
setTimeout(() => {
  if (getLastSyncTime()) {
    // Only pull if we've synced before; otherwise wait for first manual or auto sync
    syncNow().then(r => { if (r.ok) updateSyncIndicator('synced'); }).catch(() => {});
  } else {
    // First time: pull cloud sessions (empty push) to restore from other devices
    syncNow().then(r => {
      if (r.ok && r.sessionCount > 0) {
        updateSyncIndicator('synced');
      }
    }).catch(() => {});
  }
}, 3000);

// Periodic background sync every 5 minutes
setInterval(() => {
  syncNow().then(r => { if (r.ok) updateSyncIndicator('synced'); }).catch(() => {});
}, 5 * 60 * 1000);
