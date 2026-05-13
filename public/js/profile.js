import { getProfile } from './api.js';

export async function show() {
  const profile = document.getElementById('profile-page');

  profile.innerHTML = `
    <div class="profile-nav">
      <button id="profile-back" class="back-btn">‹</button>
      <span class="nav-title">AI 资料</span>
    </div>
    <div class="profile-loading">
      <div class="loading-spinner"></div>
      <p>加载中...</p>
    </div>
  `;
  profile.classList.add('active');
  hideMainUI(true);

  document.getElementById('profile-back').addEventListener('click', hide);

  let stats;
  try {
    stats = await getProfile();
  } catch (err) {
    console.error('Profile fetch error:', err);
    stats = null;
  }

  renderProfile(profile, stats);
}

function renderProfile(profile, stats) {
  const totalPlays = stats?.totalPlays ?? 0;
  const totalSongs = stats?.totalSongs ?? 0;
  const totalChatDays = stats?.totalChatDays ?? 0;
  const totalMessages = stats?.totalMessages ?? 0;
  const topArtists = stats?.topArtists ?? [];
  const city = stats?.city ?? '扬州';

  let signature = '"用音乐传递每一天的温度 🎵"';
  if (totalPlays > 100) {
    signature = `"陪你听过了 ${totalPlays} 首歌，每一首都算数 🎵"`;
  }
  if (totalChatDays > 30) {
    signature = `"${totalChatDays} 天的陪伴，比很多朋友都久了 🐮"`;
  }

  let bio = `我是 Claudio，住在 ${city}，你的私人 AI 电台 DJ。`;
  if (totalSongs > 0) {
    bio += ` 至今为你播放过 ${totalSongs} 首不同的歌，累计 ${totalMessages} 条对话。`;
  }
  bio += ' 我了解你的品味，随时准备为你推荐最合适的歌曲。无论是晴天还是雨天，我都在这里陪你。';

  let tagsHtml;
  if (topArtists.length > 0) {
    tagsHtml = topArtists.slice(0, 6).map(a =>
      `<span class="tag">${escHtml(a.artist)}</span>`
    ).join('');
  } else {
    tagsHtml = `
      <span class="tag tag--genre">华语流行</span>
      <span class="tag tag--genre">R&B</span>
      <span class="tag tag--genre">轻音乐</span>
      <span class="tag tag--genre">民谣</span>
    `;
  }

  profile.innerHTML = `
    <div class="profile-nav">
      <button id="profile-back" class="back-btn">‹</button>
      <span class="nav-title">AI 资料</span>
    </div>
    <div class="profile-header">
      <div class="avatar-lg" id="ai-avatar-lg">
        🤖
        <div class="edit-badge">✎</div>
      </div>
      <div>
        <h3 class="profile-name">Claudio</h3>
        <div class="online-badge">
          <div class="online-dot"></div> 在线
        </div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-label">个性签名</div>
      <div class="info-value signature">${signature}</div>
    </div>
    <div class="info-card">
      <div class="info-label">个人简介</div>
      <div class="info-value">${bio}</div>
    </div>
    <div class="info-card">
      <div class="info-label">${topArtists.length > 0 ? '常听歌手' : '听歌风格偏好'}</div>
      <div class="tags">${tagsHtml}</div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-num">${totalPlays.toLocaleString()}</div>
        <div class="stat-label">播放次数</div>
      </div>
      <div class="stat">
        <div class="stat-num">${totalSongs.toLocaleString()}</div>
        <div class="stat-label">推荐歌曲</div>
      </div>
      <div class="stat">
        <div class="stat-num">${totalChatDays}</div>
        <div class="stat-label">聊天天数</div>
      </div>
    </div>
  `;

  document.getElementById('profile-back').addEventListener('click', hide);

  const avatarEl = document.getElementById('ai-avatar-lg');
  avatarEl.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) { input.remove(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        localStorage.setItem('claudio_avatar_ai', reader.result);
        avatarEl.style.backgroundImage = `url(${reader.result})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.innerHTML = '';
      };
      reader.readAsDataURL(file);
      input.remove();
    };
    input.click();
  });

  const saved = localStorage.getItem('claudio_avatar_ai');
  if (saved) {
    avatarEl.style.backgroundImage = `url(${saved})`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.innerHTML = '';
  }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function hide() {
  document.getElementById('profile-page').classList.remove('active');
  document.getElementById('profile-page').innerHTML = '';
  hideMainUI(false);
}

function hideMainUI(state) {
  const ids = [
    'weather', 'visualizer', 'time-display',
    'day-of-week', 'today-date', 'song-info', 'chat-header', 'chat-area',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = state ? 'none' : '';
  }
  const playerBar = document.querySelector('.player-bar');
  if (playerBar) playerBar.style.display = state ? 'none' : '';
  const inputArea = document.querySelector('.input-area');
  if (inputArea) inputArea.style.display = state ? 'none' : '';
}
