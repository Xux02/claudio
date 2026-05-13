export function show() {
  const profile = document.getElementById('profile-page');

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
      <div class="info-value signature">"用音乐传递每一天的温度 🎵"</div>
    </div>
    <div class="info-card">
      <div class="info-label">个人简介</div>
      <div class="info-value">我是 Claudio，你的私人 AI 电台 DJ。我热爱音乐，了解你的品味，随时准备为你推荐最合适的歌曲。无论是晴天还是雨天，我都在这里陪你。</div>
    </div>
    <div class="info-card">
      <div class="info-label">听歌风格偏好</div>
      <div class="tags">
        <span class="tag">华语流行</span>
        <span class="tag">R&B</span>
        <span class="tag">轻音乐</span>
        <span class="tag">民谣</span>
        <span class="tag">电子</span>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-num">1,247</div>
        <div class="stat-label">播放次数</div>
      </div>
      <div class="stat">
        <div class="stat-num">386</div>
        <div class="stat-label">推荐歌曲</div>
      </div>
      <div class="stat">
        <div class="stat-num">42</div>
        <div class="stat-label">聊天天数</div>
      </div>
    </div>
  `;

  profile.classList.add('active');

  // Hide main UI elements
  hideMainUI(true);

  // Back button
  document.getElementById('profile-back').addEventListener('click', hide);

  // AI avatar edit
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

  // Load saved AI avatar
  const saved = localStorage.getItem('claudio_avatar_ai');
  if (saved) {
    avatarEl.style.backgroundImage = `url(${saved})`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.innerHTML = '';
  }
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
