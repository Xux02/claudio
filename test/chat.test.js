// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function createChatDOM() {
  document.body.innerHTML = `
    <div id="chat-area"></div>
    <input id="chat-input" value="">
    <button id="send-btn"></button>
    <div id="toast" class="toast hidden"></div>
  `;
}

describe('chat module', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('formatMsgTime', () => {
    it('formats a Date to HH:mm', async () => {
      const { formatMsgTime } = await import('../public/js/chat.js');
      const d = new Date(2026, 4, 12, 10, 33);
      expect(formatMsgTime(d)).toBe('10:33');
    });
  });

  describe('render', () => {
    it('appends a message element to chat area', async () => {
      createChatDOM();
      const { render } = await import('../public/js/chat.js');

      render({ type: 'ai', sender: 'Claudio', text: '你好', time: new Date(2026, 4, 12, 10, 32) });

      const area = document.getElementById('chat-area');
      expect(area.children.length).toBe(1);
      const msg = area.children[0];
      expect(msg.classList.contains('msg')).toBe(true);
      expect(msg.classList.contains('ai')).toBe(true);
      expect(msg.querySelector('.bubble').textContent).toBe('你好');
      expect(msg.querySelector('.msg-meta').textContent).toBe('Claudio');
    });

    it('renders user messages with user class', async () => {
      createChatDOM();
      const { render } = await import('../public/js/chat.js');

      render({ type: 'user', sender: '我', text: '来首周杰伦', time: new Date(2026, 4, 12, 10, 33) });

      const msg = document.querySelector('#chat-area .msg');
      expect(msg.classList.contains('user')).toBe(true);
    });

    it('uses default avatar emojis', async () => {
      createChatDOM();
      const { render } = await import('../public/js/chat.js');

      render({ type: 'ai', sender: 'Claudio', text: 'hi', time: new Date() });
      expect(document.querySelector('.avatar.ai').textContent.trim()).toBe('🤖');

      render({ type: 'user', sender: '我', text: 'hi', time: new Date() });
      expect(document.querySelector('.avatar.user').textContent.trim()).toBe('😊');
    });

    it('auto-scrolls to bottom after render', async () => {
      vi.stubGlobal('requestAnimationFrame', fn => fn());
      createChatDOM();
      const { render } = await import('../public/js/chat.js');
      const area = document.getElementById('chat-area');

      // Simulate scrollable content
      Object.defineProperty(area, 'scrollHeight', { value: 500, writable: true });
      render({ type: 'ai', sender: 'Claudio', text: 'hi', time: new Date() });
      expect(area.scrollTop).toBe(500);
    });
  });

  describe('saveAvatar', () => {
    it('stores base64 in localStorage', async () => {
      const { saveAvatar } = await import('../public/js/chat.js');

      const result = saveAvatar('user', 'data:image/png;base64,abc123');
      expect(result).toBe(true);
      expect(localStorage.getItem('claudio_avatar_user')).toBe('data:image/png;base64,abc123');
    });

    it('rejects data over 5MB and shows toast', async () => {
      createChatDOM();
      const { saveAvatar } = await import('../public/js/chat.js');

      const big = 'x'.repeat(6 * 1024 * 1024);
      const result = saveAvatar('user', big);
      expect(result).toBe(false);
      expect(localStorage.getItem('claudio_avatar_user')).toBeNull();
    });
  });

  describe('loadAvatar', () => {
    it('returns stored avatar or null', async () => {
      const { loadAvatar, saveAvatar } = await import('../public/js/chat.js');

      expect(loadAvatar('ai')).toBeNull();
      saveAvatar('ai', 'data:image/png;base64,xyz');
      expect(loadAvatar('ai')).toBe('data:image/png;base64,xyz');
    });
  });

  describe('showToast', () => {
    it('shows and auto-hides toast element', async () => {
      document.body.innerHTML = '<div id="toast" class="toast hidden"></div>';
      const { showToast } = await import('../public/js/chat.js');

      showToast('测试消息');
      const toast = document.getElementById('toast');
      expect(toast.classList.contains('hidden')).toBe(false);
      expect(toast.textContent).toBe('测试消息');

      vi.advanceTimersByTime(3000);
      expect(toast.classList.contains('hidden')).toBe(true);
    });
  });

  describe('clearInput', () => {
    it('clears the chat input value', async () => {
      createChatDOM();
      const { clearInput } = await import('../public/js/chat.js');

      document.getElementById('chat-input').value = 'hello';
      clearInput();
      expect(document.getElementById('chat-input').value).toBe('');
    });
  });
});
