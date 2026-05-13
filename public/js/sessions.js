const CURRENT_KEY = 'claudio_current_messages';
const ARCHIVE_KEY = 'claudio_saved_sessions';
const SYNC_KEY = 'claudio_last_sync';

export function getCurrentMessages() {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveCurrentMessages(messages) {
  if (!messages || messages.length === 0) return;
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(messages));
  } catch { /* quota exceeded, ignore */ }
}

export function archiveAndClear() {
  const messages = getCurrentMessages();
  if (!messages || messages.length === 0) return;

  const sessions = getSavedSessions();
  const firstMsg = messages.find(m => m.role === 'user');
  const preview = firstMsg ? firstMsg.content.slice(0, 50) : '空对话';

  sessions.unshift({
    id: generateSessionId(),
    date: new Date().toISOString().slice(0, 10),
    preview,
    messageCount: messages.length,
    messages,
  });

  // Keep at most 20 saved sessions
  if (sessions.length > 20) sessions.length = 20;

  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sessions));
    localStorage.removeItem(CURRENT_KEY);
  } catch { /* ignore */ }
}

export function getSavedSessions() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function loadSession(id) {
  const sessions = getSavedSessions();
  const session = sessions.find(s => s.id === id);
  if (!session) return null;

  // Make this the current session
  saveCurrentMessages(session.messages);

  // Remove from archives
  const remaining = sessions.filter(s => s.id !== id);
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(remaining));
  } catch { /* ignore */ }

  return session.messages;
}

export function deleteSession(id) {
  const sessions = getSavedSessions().filter(s => s.id !== id);
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

// ─── Cloud sync ─────────────────────────────────────────────────

export function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random for older browsers
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getLastSyncTime() {
  try {
    return localStorage.getItem(SYNC_KEY) || null;
  } catch { return null; }
}

export function setLastSyncTime(iso) {
  try {
    localStorage.setItem(SYNC_KEY, iso);
  } catch { /* ignore */ }
}

export async function syncNow() {
  const { syncSessions } = await import('./api.js');

  // Gather current session (if non-empty) + all saved sessions
  const current = getCurrentMessages();
  const saved = getSavedSessions();
  const allLocal = [...saved];

  // Include current live session as a saved entry if it has messages
  if (current && current.length > 0) {
    const firstMsg = current.find(m => m.role === 'user');
    const preview = firstMsg ? firstMsg.content.slice(0, 50) : '';
    allLocal.unshift({
      id: `current-${generateSessionId()}`,
      date: new Date().toISOString().slice(0, 10),
      preview,
      messageCount: current.length,
      messages: current,
    });
  }

  if (allLocal.length === 0) {
    // Nothing to push — still pull from server
    try {
      const { sessions } = await syncSessions([]);
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sessions));
      setLastSyncTime(new Date().toISOString());
      return { ok: true, sessionCount: sessions.length };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  try {
    const { sessions } = await syncSessions(allLocal);
    // Replace local saved sessions with server's canonical list
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sessions));
    setLastSyncTime(new Date().toISOString());
    return { ok: true, sessionCount: sessions.length };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ─── UI ────────────────────────────────────────────────────────

export function showSessionBar(onContinue, onNewChat) {
  // Remove any existing bar
  const existing = document.getElementById('session-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'session-bar';
  bar.className = 'session-bar';
  bar.innerHTML = `
    <span class="session-bar-text">是否继续上次对话？</span>
    <button id="session-continue" class="session-btn primary">继续</button>
    <button id="session-new" class="session-btn">新对话</button>
  `;
  document.getElementById('chat-area').before(bar);

  bar.querySelector('#session-continue').addEventListener('click', () => {
    bar.remove();
    if (onContinue) onContinue();
  });
  bar.querySelector('#session-new').addEventListener('click', () => {
    bar.remove();
    if (onNewChat) onNewChat();
  });
}

export function showSessionPicker(onSelect) {
  const sessions = getSavedSessions();
  if (sessions.length === 0) return;

  // Remove existing
  const existing = document.getElementById('session-picker');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'session-picker';
  overlay.className = 'session-picker-overlay';
  overlay.innerHTML = `
    <div class="session-picker-card">
      <h3 class="session-picker-title">历史对话</h3>
      <div class="session-list">
        ${sessions.map((s, i) => `
          <div class="session-item" data-id="${s.id}">
            <div class="session-item-info">
              <span class="session-item-date">${s.date}</span>
              <span class="session-item-count">${s.messageCount} 条消息</span>
              <span class="session-item-preview">${escHtml(s.preview)}</span>
            </div>
            <button class="session-item-del" data-idx="${i}" title="删除">×</button>
          </div>
        `).join('')}
      </div>
      <button id="session-picker-close" class="session-picker-close">关闭</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Click session → load it
  overlay.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-item-del')) return;
      const id = el.dataset.id;
      overlay.remove();
      if (onSelect) onSelect(id);
    });
  });

  // Delete session
  overlay.querySelectorAll('.session-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.closest('.session-item').dataset.id;
      deleteSession(id);
      btn.closest('.session-item').remove();
      // If all deleted, close picker
      if (getSavedSessions().length === 0) overlay.remove();
    });
  });

  // Close
  overlay.querySelector('#session-picker-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
