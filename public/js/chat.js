const AVATAR_DEFAULTS = { ai: '🤖', user: '😊' };

export function formatMsgTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function createMsgElement(msg) {
  const div = document.createElement('div');
  div.className = `msg ${msg.type}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${msg.type}`;
  avatar.title = msg.type === 'ai' ? '点击查看 AI 资料' : '点击更换头像';
  const saved = loadAvatar(msg.type);
  if (saved) {
    avatar.style.backgroundImage = `url(${saved})`;
    avatar.style.backgroundSize = 'cover';
    avatar.textContent = '';
  } else {
    avatar.textContent = AVATAR_DEFAULTS[msg.type];
  }
  avatar.addEventListener('click', () => {
    if (msg.type === 'ai') {
      document.dispatchEvent(new CustomEvent('claudio:showProfile'));
    } else {
      document.dispatchEvent(new CustomEvent('claudio:changeAvatar', { detail: { type: 'user' } }));
    }
  });

  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = msg.sender;

  const bubble = document.createElement('div');
  bubble.className = `bubble ${msg.type}`;
  bubble.textContent = msg.text;

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatMsgTime(msg.time);

  body.appendChild(meta);
  body.appendChild(bubble);
  body.appendChild(time);
  div.appendChild(avatar);
  div.appendChild(body);
  return div;
}

export function render(msg) {
  const area = document.getElementById('chat-area');
  const el = createMsgElement(msg);
  area.appendChild(el);
  scrollBottom();
  return el;
}

export async function streamText(bubbleEl, text, speed = 35) {
  bubbleEl.textContent = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    bubbleEl.textContent += chars[i];
    scrollBottom();
    await new Promise(r => setTimeout(r, speed));
  }
}

export function scrollBottom() {
  const area = document.getElementById('chat-area');
  requestAnimationFrame(() => {
    area.scrollTop = area.scrollHeight;
  });
}

export function saveAvatar(type, base64) {
  if (base64 && base64.length > 5 * 1024 * 1024) {
    showToast('图片太大，请选择小于 5MB 的图片');
    return false;
  }
  localStorage.setItem(`claudio_avatar_${type}`, base64 || '');
  return true;
}

export function loadAvatar(type) {
  return localStorage.getItem(`claudio_avatar_${type}`) || null;
}

export function showToast(text, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

export function clearInput() {
  const input = document.getElementById('chat-input');
  input.value = '';
}

export function renderFeedbackButtons(songs, parentEl) {
  if (!songs || songs.length === 0) return;

  const container = document.createElement('div');
  container.className = 'feedback-btns';

  songs.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'feedback-row';
    row.innerHTML = `
      <span class="feedback-song">${escHtml(song.title)}${song.artist ? ' · ' + escHtml(song.artist) : ''}</span>
      <span class="feedback-actions">
        <button class="fb-btn like" data-idx="${i}" title="喜欢">👍</button>
        <button class="fb-btn dislike" data-idx="${i}" title="不喜欢">👎</button>
      </span>
    `;
    container.appendChild(row);
  });

  parentEl.appendChild(container);
  return container;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderThinkingBubble() {
  const area = document.getElementById('chat-area');
  const el = document.createElement('div');
  el.className = 'msg ai thinking-msg';
  el.id = 'thinking-bubble';

  const avatar = document.createElement('div');
  avatar.className = 'avatar ai';
  const saved = loadAvatar('ai');
  if (saved) {
    avatar.style.backgroundImage = `url(${saved})`;
    avatar.style.backgroundSize = 'cover';
  } else {
    avatar.textContent = '🤖';
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = `
    <div class="msg-meta">Claudio</div>
    <div class="bubble ai thinking-bubble">
      <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
      正在思考
    </div>
  `;

  el.appendChild(avatar);
  el.appendChild(body);
  area.appendChild(el);
  scrollBottom();
  return el;
}

export function removeThinkingBubble() {
  const el = document.getElementById('thinking-bubble');
  if (el) el.remove();
}

export function renderSystemMsg(text) {
  const area = document.getElementById('chat-area');
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  area.appendChild(el);
  scrollBottom();
}

export function initElasticScroll(el) {
  let startY = 0;
  let pullDist = 0;
  let pulling = false;

  el.addEventListener('touchstart', (e) => {
    if (el.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      pullDist = 0;
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const delta = e.touches[0].clientY - startY;
    if (delta > 0 && el.scrollTop <= 0) {
      pullDist = Math.min(delta * 0.35, 64);
      el.style.transform = `translateY(${pullDist}px)`;
    }
  }, { passive: true });

  el.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    el.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateY(0)';
    pullDist = 0;
    setTimeout(() => { el.style.transition = ''; }, 350);
  });
}
