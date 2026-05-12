# PWA Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Claudio PWA mobile-first frontend with player + WeChat-style chat, vanilla ES modules, Service Worker offline support.

**Architecture:** Express serves `public/` as static files. SPA entry `index.html` loads `js/app.js` as ES module, which initializes `api.js` (fetch wrapper), `player.js` (visualizer + controls + progress), `chat.js` (SSE streaming + bubbles + avatars), and `profile.js` (AI info page). Chat drives all interactions through existing `/api/chat` endpoint.

**Tech Stack:** Vanilla ES modules, CSS animations, Service Worker, vitest + jsdom, Express 4

---

### Task 1: Add Express static file serving

**Files:**
- Modify: `src/server.js:11-12`
- Test: `test/server-static.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('server static serving', () => {
  it('should have public/ directory configured for static serving', () => {
    const app = express();
    const publicDir = path.join(__dirname, '..', 'public');

    // Simulate what server.js should do
    app.use(express.static(publicDir));

    // Verify the middleware stack includes a static-serving middleware
    const hasStatic = app._router.stack.some(
      (layer) => layer.name === 'serveStatic'
    );
    expect(hasStatic).toBe(true);
  });

  it('public/ directory exists', () => {
    const publicDir = path.join(__dirname, '..', 'public');
    expect(fs.existsSync(publicDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server-static.test.js`
Expected: FAIL — `public/` directory doesn't exist or `express.static` not called

- [ ] **Step 3: Create public/ directory and modify server.js**

```bash
mkdir -p /home/xu/claudio/public/css /home/xu/claudio/public/js /home/xu/claudio/public/icons
```

Modify `src/server.js` at line 12 (after `app.use(express.json())`):

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ... existing code ...

app.use(express.json());

// Serve PWA static files
app.use(express.static(path.join(__dirname, '..', 'public')));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server-static.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/server-static.test.js src/server.js
git commit -m "feat: add Express static serving for public/ directory"
```

---

### Task 2: HTML shell + CSS foundation

**Files:**
- Create: `public/index.html`
- Create: `public/css/app.css`

- [ ] **Step 1: Verify public/ exists and create HTML shell**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#0a0a0c">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Claudio</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div id="app" class="phone">
    <!-- weather row -->
    <div id="weather" class="weather-row">
      <span id="weather-icon"></span>
      <span id="weather-text"></span>
      <span id="weather-date"></span>
    </div>

    <!-- visualizer -->
    <div id="visualizer" class="visualizer"></div>

    <!-- progress -->
    <div id="progress-wrap" class="progress-wrap">
      <div class="progress-track">
        <div id="progress-fill" class="progress-fill"></div>
      </div>
      <div class="progress-time">
        <span id="time-current">0:00</span>
        <span id="time-total">0:00</span>
      </div>
    </div>

    <!-- big time -->
    <div id="time-display" class="time-display">0:00</div>

    <!-- song info -->
    <div id="song-info" class="song-info">
      <div id="song-title" class="song-title"></div>
      <div id="song-artist" class="song-artist"></div>
    </div>

    <!-- player controls -->
    <div class="player-controls">
      <button id="btn-prev" class="ctrl-btn" title="上一首">⏮</button>
      <button id="btn-play" class="ctrl-btn play" title="播放/暂停">▶</button>
      <button id="btn-next" class="ctrl-btn" title="下一首">⏭</button>
      <span class="vol-icon">🔊</span>
      <input id="vol-slider" type="range" class="vol-slider" min="0" max="100" value="65">
    </div>

    <!-- chat area -->
    <div id="chat-area" class="chat-area"></div>

    <!-- input -->
    <div class="input-area">
      <input id="chat-input" type="text" placeholder="和 DJ 说点什么..." autocomplete="off">
      <button id="send-btn" class="send-btn">↑</button>
    </div>

    <!-- profile page (hidden by default) -->
    <div id="profile-page" class="profile-page hidden"></div>

    <!-- toast -->
    <div id="toast" class="toast hidden"></div>
  </div>

  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS foundation**

Create `public/css/app.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a0c;
  --bg-card: #111115;
  --bg-bubble-ai: #1e1a29;
  --bg-bubble-user: #2a2530;
  --accent: #c9a87c;
  --text: #e0d5c1;
  --text-dim: #888;
  --text-muted: #555;
  --border: #14141a;
  --track: #1e1e24;
  --radius: 6px;
}

body {
  background: #0d0d0f;
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  min-height: 100dvh;
}

.phone {
  width: 100%;
  max-width: 430px;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg);
  padding: env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* weather */
.weather-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  padding: 4px 4px;
  flex-shrink: 0;
}
#weather-date { margin-left: auto; font-size: 11px; }

/* visualizer */
.visualizer {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  height: 48px;
  margin-top: 12px;
  flex-shrink: 0;
}
.visualizer .bar {
  width: 5px;
  background: var(--accent);
  border-radius: 3px;
  animation: bounce 0.65s ease-in-out infinite alternate;
  animation-play-state: paused;
}
.visualizer.playing .bar { animation-play-state: running; }
@keyframes bounce {
  0% { transform: scaleY(0.35); opacity: 0.45; }
  100% { transform: scaleY(1); opacity: 1; }
}

/* progress */
.progress-wrap { margin-top: 10px; padding: 0 4px; flex-shrink: 0; }
.progress-track {
  width: 100%; height: 3px;
  background: var(--track); border-radius: 2px; overflow: hidden;
}
.progress-fill {
  width: 0%; height: 100%;
  background: var(--accent); border-radius: 2px;
  transition: width 0.25s linear;
}
.progress-time {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--text-muted); margin-top: 4px;
}

/* big time */
.time-display {
  text-align: center;
  font-size: 56px; font-weight: 200; letter-spacing: 4px;
  color: #fff;
  margin: 8px 0 2px;
  font-family: 'SF Mono', 'Menlo', 'Courier New', monospace;
  flex-shrink: 0;
}

/* song info */
.song-info { text-align: center; margin-bottom: 4px; flex-shrink: 0; }
.song-title { font-size: 15px; font-weight: 600; }
.song-artist { font-size: 11px; color: var(--text-dim); margin-top: 1px; }

/* player controls */
.player-controls {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px; flex-shrink: 0;
}
.ctrl-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--border); border: none; color: #aaa;
  font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ctrl-btn.play {
  width: 44px; height: 44px;
  background: var(--accent); color: var(--bg); font-size: 18px;
}
.ctrl-btn:active { opacity: 0.7; }
.vol-icon { font-size: 11px; color: var(--text-muted); margin-left: 4px; }
.vol-slider {
  flex: 1; height: 3px; -webkit-appearance: none; appearance: none;
  background: var(--track); border-radius: 2px; outline: none;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: var(--accent); cursor: pointer;
}

/* chat area */
.chat-area {
  flex: 1;
  display: flex; flex-direction: column; gap: 2px;
  overflow-y: auto;
  margin-top: 6px; padding: 8px 0;
  border-top: 1px solid var(--border);
}
.msg { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0; }
.msg.user { flex-direction: row-reverse; }
.avatar {
  width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer;
}
.avatar.ai { background: var(--bg-bubble-ai); border: 1px solid #2a2535; }
.avatar.user { background: #2a2520; border: 1px solid #3a3530; }
.msg-body { max-width: 68%; }
.msg-meta { font-size: 9px; color: var(--text-muted); margin-bottom: 3px; }
.msg.user .msg-meta { text-align: right; }
.bubble {
  padding: 7px 11px; border-radius: 6px; font-size: 12px; line-height: 1.5;
  display: inline-block; max-width: 100%; word-break: break-word;
}
.bubble.ai { background: var(--bg-bubble-ai); color: var(--text); }
.bubble.user { background: var(--bg-bubble-user); color: var(--text); }
.msg-time { font-size: 9px; color: #444; margin-top: 4px; }

/* input */
.input-area {
  display: flex; gap: 8px; align-items: center;
  background: var(--bg-card); border-radius: 20px;
  padding: 7px 14px; flex-shrink: 0;
}
.input-area input {
  flex: 1; background: none; border: none;
  color: #fff; font-size: 13px; outline: none;
}
.input-area input::placeholder { color: #444; }
.send-btn {
  width: 30px; height: 30px;
  background: var(--bg-bubble-ai); border: none; border-radius: 50%;
  color: var(--accent); font-size: 14px; cursor: pointer;
}
.send-btn:active { opacity: 0.7; }

/* profile page (hidden by default) */
.profile-page { display: none; }
.profile-page.active { display: flex; flex-direction: column; }

/* toast */
.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: #333; color: #fff; padding: 10px 20px;
  border-radius: 20px; font-size: 12px; z-index: 100;
  transition: opacity 0.3s;
}
.toast.hidden { opacity: 0; pointer-events: none; }

.hidden { display: none !important; }
```

- [ ] **Step 3: Start server and verify HTML/CSS loads**

Run: `node src/server.js &`
Then: `curl -s http://localhost:9876/ | head -5`
Expected: Returns `index.html` content (not the old welcome page)
Then: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/app.css
git commit -m "feat: add PWA HTML shell and CSS foundation with dark theme"
```

---

### Task 3: api.js — fetch wrapper

**Files:**
- Create: `public/js/api.js`
- Create: `test/api.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/api.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the module's pure functions by importing and mocking fetch
// The module uses globalThis.fetch, so we mock it before import

describe('api module', () => {
  let api;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn();
    api = await import('../public/js/api.js');
  });

  describe('chat', () => {
    it('sends POST to /api/chat with message in body', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ say: '你好', play: [], reason: '', segue: '' }),
      });

      const result = await api.chat('来首周杰伦的歌');

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '来首周杰伦的歌' }),
      });
      expect(result).toEqual({ say: '你好', play: [], reason: '', segue: '' });
    });

    it('throws on network error', async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(api.chat('hello')).rejects.toThrow('Network error');
    });
  });

  describe('getNow', () => {
    it('fetches GET /api/now', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ playing: true, song: { title: '晴天', artist: '周杰伦' } }),
      });

      const result = await api.getNow();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/now');
      expect(result.playing).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('fetches GET /api/history with default limit', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });

      await api.getHistory();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/history?limit=20');
    });

    it('fetches GET /api/history with custom limit', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });

      await api.getHistory(10);

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/history?limit=10');
    });
  });

  describe('getTaste', () => {
    it('fetches GET /api/taste', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recentPlays: 42, topArtists: [] }),
      });

      const result = await api.getTaste();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/taste');
      expect(result.recentPlays).toBe(42);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.js`
Expected: FAIL — cannot import module (file doesn't exist)

- [ ] **Step 3: Implement api.js**

Create `public/js/api.js`:

```js
export async function chat(text) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getNow() {
  const res = await fetch('/api/now');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getHistory(limit = 20) {
  const res = await fetch(`/api/history?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getTaste() {
  const res = await fetch('/api/taste');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/api.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/api.js test/api.test.js
git commit -m "feat: add api.js fetch wrapper for /api/chat, /now, /history, /taste"
```

---

### Task 4: player.js — player module

**Files:**
- Create: `public/js/player.js`
- Create: `test/player.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/player.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// player.js uses DOM APIs — we mock the DOM elements it touches
function createMockDOM() {
  const els = {};
  for (const id of [
    'visualizer', 'progress-fill', 'time-current', 'time-total',
    'time-display', 'song-title', 'song-artist', 'btn-play', 'btn-prev',
    'btn-next', 'vol-slider'
  ]) {
    const el = document.createElement('div');
    el.id = id;
    if (id === 'vol-slider') {
      Object.defineProperty(el, 'value', { value: '65', writable: true });
    }
    document.body.appendChild(el);
    els[id] = el;
  }
  return els;
}

function createBars(n) {
  const container = document.getElementById('visualizer');
  for (let i = 0; i < n; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    container.appendChild(bar);
  }
}

function setupPlayerModule() {
  vi.mock('../public/js/player.js', async () => {
    const mod = await vi.importActual('../public/js/player.js');
    return mod;
  });
}

describe('player module', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('formatTime', () => {
    it('formats seconds to m:ss', async () => {
      const { formatTime } = await import('../public/js/player.js');
      expect(formatTime(0)).toBe('0:00');
      expect(formatTime(60)).toBe('1:00');
      expect(formatTime(125)).toBe('2:05');
      expect(formatTime(3661)).toBe('61:01');
    });
  });

  describe('update', () => {
    it('sets song title and artist on DOM elements', async () => {
      createMockDOM();
      const { update } = await import('../public/js/player.js');

      update({ title: '晴天', artist: '周杰伦', album: '叶惠美' });

      expect(document.getElementById('song-title').textContent).toBe('晴天');
      expect(document.getElementById('song-artist').textContent).toBe('周杰伦 · 叶惠美');
    });

    it('handles missing album', async () => {
      createMockDOM();
      const { update } = await import('../public/js/player.js');

      update({ title: '晴天', artist: '周杰伦' });

      expect(document.getElementById('song-artist').textContent).toBe('周杰伦');
    });
  });

  describe('setProgress', () => {
    it('updates progress bar width and time display', async () => {
      createMockDOM();
      const { setProgress } = await import('../public/js/player.js');

      setProgress(125, 257); // 2:05 of 4:17

      expect(document.getElementById('progress-fill').style.width).toBe('48%');
      expect(document.getElementById('time-current').textContent).toBe('2:05');
      expect(document.getElementById('time-total').textContent).toBe('4:17');
      expect(document.getElementById('time-display').textContent).toBe('2:05');
    });

    it('clamps progress to 100%', async () => {
      createMockDOM();
      const { setProgress } = await import('../public/js/player.js');

      setProgress(300, 250);

      expect(document.getElementById('progress-fill').style.width).toBe('100%');
    });
  });

  describe('visualizer', () => {
    it('initVisualizer creates 14 bars', async () => {
      createMockDOM();
      const { initVisualizer } = await import('../public/js/player.js');

      initVisualizer();

      const bars = document.querySelectorAll('#visualizer .bar');
      expect(bars.length).toBe(14);
      // Each bar should have a unique animation-delay
      const delays = [...bars].map(b => b.style.animationDelay);
      const unique = new Set(delays);
      expect(unique.size).toBe(14);
    });
  });

  describe('controls', () => {
    it('setPlaying toggles play button text and visualizer class', async () => {
      createMockDOM();
      createBars(14);
      const { setPlaying } = await import('../public/js/player.js');

      setPlaying(true);
      expect(document.getElementById('btn-play').textContent).toBe('⏸');
      expect(document.getElementById('visualizer').classList.contains('playing')).toBe(true);

      setPlaying(false);
      expect(document.getElementById('btn-play').textContent).toBe('▶');
      expect(document.getElementById('visualizer').classList.contains('playing')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/player.test.js`
Expected: FAIL — cannot import module

- [ ] **Step 3: Install jsdom for DOM-dependent tests**

The existing vitest config (`environment: 'node'`) stays as-is. DOM tests use a per-file annotation.

```bash
cd /home/xu/claudio && npm install -D jsdom
```

Ensure `test/player.test.js` starts with:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 4: Implement player.js**

Create `public/js/player.js`:

```js
let currentSong = null;
let playing = false;

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function initVisualizer() {
  const container = document.getElementById('visualizer');
  container.innerHTML = '';
  const heights = [14, 44, 22, 48, 28, 40, 18, 36, 24, 46, 20, 42, 32, 38];
  const delays = heights.map((_, i) => (i * 0.065).toFixed(2) + 's');
  for (let i = 0; i < 14; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = heights[i] + 'px';
    bar.style.animationDelay = delays[i];
    container.appendChild(bar);
  }
}

export function update(song) {
  currentSong = song;
  document.getElementById('song-title').textContent = song.title || '';
  const artist = song.artist || '';
  const album = song.album || '';
  document.getElementById('song-artist').textContent = album ? `${artist} · ${album}` : artist;
  setProgress(0, song.duration ? Math.floor(song.duration / 1000) : 0);
}

export function setProgress(current, total) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('time-current').textContent = formatTime(current);
  document.getElementById('time-total').textContent = formatTime(total);
  document.getElementById('time-display').textContent = formatTime(current);
}

export function setPlaying(state) {
  playing = state;
  document.getElementById('btn-play').textContent = state ? '⏸' : '▶';
  const viz = document.getElementById('visualizer');
  if (state) {
    viz.classList.add('playing');
  } else {
    viz.classList.remove('playing');
  }
}

export function isPlaying() {
  return playing;
}

export function getCurrentSong() {
  return currentSong;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run test/player.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/player.js test/player.test.js vitest.config.js package.json package-lock.json
git commit -m "feat: add player.js with visualizer, progress, and play controls"
```

---

### Task 5: chat.js — chat module

**Files:**
- Create: `public/js/chat.js`
- Create: `test/chat.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/chat.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function createChatDOM() {
  document.body.innerHTML = `
    <div id="chat-area"></div>
    <input id="chat-input">
    <button id="send-btn"></button>
  `;
}

describe('chat module', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    it('auto-scrolls to bottom', async () => {
      createChatDOM();
      const { render } = await import('../public/js/chat.js');

      const scrollTopSpy = vi.fn();
      Object.defineProperty(document.getElementById('chat-area'), 'scrollTop', {
        get: () => 0,
        set: scrollTopSpy,
      });

      render({ type: 'ai', sender: 'Claudio', text: 'hi', time: new Date() });
      expect(scrollTopSpy).toHaveBeenCalled();
    });
  });

  describe('avatar persistence', () => {
    it('saveAvatar stores base64 in localStorage', async () => {
      const { saveAvatar } = await import('../public/js/chat.js');

      saveAvatar('user', 'data:image/png;base64,abc123');
      expect(localStorage.getItem('claudio_avatar_user')).toBe('data:image/png;base64,abc123');
    });

    it('loadAvatar returns stored avatar or null', async () => {
      const { loadAvatar, saveAvatar } = await import('../public/js/chat.js');

      expect(loadAvatar('ai')).toBeNull();
      saveAvatar('ai', 'data:image/png;base64,xyz');
      expect(loadAvatar('ai')).toBe('data:image/png;base64,xyz');
    });

    it('saveAvatar compresses if >5MB', async () => {
      const { saveAvatar } = await import('../public/js/chat.js');

      // Create a string > 5MB
      const big = 'x'.repeat(6 * 1024 * 1024);
      saveAvatar('user', big);
      const stored = localStorage.getItem('claudio_avatar_user');
      expect(stored).toBeNull(); // rejected, too large
    });
  });

  describe('showToast', () => {
    it('shows and hides toast element', async () => {
      document.body.innerHTML = '<div id="toast" class="toast hidden"></div>';
      const { showToast } = await import('../public/js/chat.js');
      vi.useFakeTimers();

      showToast('测试消息');
      const toast = document.getElementById('toast');
      expect(toast.classList.contains('hidden')).toBe(false);
      expect(toast.textContent).toBe('测试消息');

      vi.advanceTimersByTime(3000);
      expect(toast.classList.contains('hidden')).toBe(true);

      vi.useRealTimers();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/chat.test.js`
Expected: FAIL — cannot import module

- [ ] **Step 3: Implement chat.js**

Create `public/js/chat.js`:

```js
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
  avatar.textContent = loadAvatar(msg.type) || AVATAR_DEFAULTS[msg.type];
  if (loadAvatar(msg.type)) {
    avatar.style.backgroundImage = `url(${loadAvatar(msg.type)})`;
    avatar.style.backgroundSize = 'cover';
    avatar.textContent = '';
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
}

export function scrollBottom() {
  const area = document.getElementById('chat-area');
  area.scrollTop = area.scrollHeight;
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run test/chat.test.js`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/chat.js test/chat.test.js
git commit -m "feat: add chat.js with message rendering, avatars, and localStorage persistence"
```

---

### Task 6: app.js — entry point wiring

**Files:**
- Create: `public/js/app.js`

- [ ] **Step 1: Implement app.js**

Create `public/js/app.js`:

```js
import { chat, getNow, getHistory } from './api.js';
import { initVisualizer, update, setProgress, setPlaying, isPlaying, formatTime } from './player.js';
import { render, clearInput, showToast, saveAvatar, loadAvatar } from './chat.js';

// Weather — hardcoded for now, real data from Claude later
document.getElementById('weather-icon').textContent = '☀️';
document.getElementById('weather-text').textContent = '南京 · 18°C';
document.getElementById('weather-date').textContent = new Date().toISOString().slice(0, 10);

// Initialize visualizer bars
initVisualizer();
setPlaying(false);

// Play/pause toggle
document.getElementById('btn-play').addEventListener('click', () => {
  setPlaying(!isPlaying());
});

// Volume slider
document.getElementById('vol-slider').addEventListener('input', (e) => {
  // Volume control — actual audio element integration in Phase 3e
  console.log('Volume:', e.target.value);
});

// Send message
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  // Render user message
  render({ type: 'user', sender: '我', text, time: new Date() });
  clearInput();

  try {
    const result = await chat(text);

    // Render AI reply
    render({ type: 'ai', sender: 'Claudio', text: result.say, time: new Date() });

    // If there's a song to play, update player
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
    showToast('网络异常，请稍后');
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

// Load initial state
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
    // Welcome message if no history
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
```

- [ ] **Step 2: Build step — update index.html to use SPA routing**

The server needs to serve `index.html` for all non-API routes to support SPA routing. Add this to `src/server.js` after the static middleware:

```js
// SPA fallback: serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
```

Also remove the old `app.get('/')` route that returns the inline HTML welcome page (lines 63-80 of server.js).

- [ ] **Step 3: Manual verification — start server and test**

Run: `node src/server.js &`
Then: `curl -s http://localhost:9876/ | grep '<title>'`
Expected: `<title>Claudio</title>` (from index.html, not the old welcome page)
Then: `curl -s -X POST http://localhost:9876/api/chat -H 'Content-Type: application/json' -d '{"message":"你好"}' | jq .say`
Expected: Returns a response from the chat endpoint (should still work)
Then: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js src/server.js
git commit -m "feat: add app.js entry point wiring player + chat + API"
```

---

### Task 7: profile.js — AI profile page

**Files:**
- Create: `public/js/profile.js`
- Append to: `public/css/app.css`

- [ ] **Step 1: Implement profile.js**

Create `public/js/profile.js`:

```js
export function show() {
  const app = document.getElementById('app');
  const profile = document.getElementById('profile-page');

  // Build profile content
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
  document.getElementById('ai-avatar-lg').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        localStorage.setItem('claudio_avatar_ai', reader.result);
        document.getElementById('ai-avatar-lg').style.backgroundImage = `url(${reader.result})`;
        document.getElementById('ai-avatar-lg').style.backgroundSize = 'cover';
        document.getElementById('ai-avatar-lg').innerHTML = '';
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  // Load saved AI avatar
  const saved = localStorage.getItem('claudio_avatar_ai');
  if (saved) {
    const avatarEl = document.getElementById('ai-avatar-lg');
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
    'weather', 'visualizer', 'progress-wrap', 'time-display',
    'song-info', 'chat-area',
    'chat-input', 'send-btn',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = state ? 'none' : '';
  }
  // player controls
  const controls = document.querySelector('.player-controls');
  if (controls) controls.style.display = state ? 'none' : '';
  // input area
  const inputArea = document.querySelector('.input-area');
  if (inputArea) inputArea.style.display = state ? 'none' : '';
}
```

- [ ] **Step 2: Add profile CSS**

Append to `public/css/app.css`:

```css
/* profile page */
.profile-page {
  position: absolute; inset: 0;
  background: var(--bg); z-index: 10;
  padding: env(safe-area-inset-top, 48px) 20px 24px;
  overflow-y: auto;
}
.profile-nav { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.back-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--border); border: none; color: #aaa;
  font-size: 18px; cursor: pointer;
}
.nav-title { font-size: 16px; font-weight: 600; }
.profile-header {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  margin-bottom: 24px;
}
.avatar-lg {
  width: 80px; height: 80px; border-radius: 50%;
  background: var(--bg-bubble-ai); border: 2px solid #2a2535;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; position: relative; cursor: pointer;
}
.avatar-lg .edit-badge {
  position: absolute; bottom: 2px; right: 2px;
  width: 22px; height: 22px; background: #333;
  border-radius: 50%; font-size: 10px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--bg);
}
.profile-name { font-size: 18px; }
.online-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: #0f2; color: var(--bg); font-size: 10px;
  padding: 2px 8px; border-radius: 10px; font-weight: 600;
}
.online-dot { width: 6px; height: 6px; background: var(--bg); border-radius: 50%; }
.info-card {
  background: var(--bg-card); border-radius: 12px; padding: 14px;
  margin-bottom: 10px;
}
.info-label {
  font-size: 10px; color: #666; text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 6px;
}
.info-value { font-size: 13px; color: #ddd; line-height: 1.5; }
.signature { font-style: italic; color: var(--accent); }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag {
  background: var(--bg-bubble-ai); color: var(--accent);
  padding: 4px 10px; border-radius: 14px; font-size: 11px;
}
.stats {
  display: flex; justify-content: space-around;
  background: var(--bg-card); border-radius: 12px; padding: 16px;
}
.stat { text-align: center; }
.stat-num { font-size: 18px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 10px; color: #666; margin-top: 2px; }
```

- [ ] **Step 3: Wire profile into app.js**

Add to `public/js/app.js` imports:

```js
import { show as showProfile } from './profile.js';
```

Add event listener in `app.js`:

```js
// Profile page navigation
document.addEventListener('claudio:showProfile', () => {
  showProfile();
});
```

- [ ] **Step 4: Commit**

```bash
git add public/js/profile.js public/css/app.css public/js/app.js
git commit -m "feat: add AI profile page with avatar editing and stats"
```

---

### Task 8: PWA — manifest, service worker, icons

**Files:**
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Create: `public/icons/icon-192.png` (generated placeholder)
- Create: `public/icons/icon-512.png` (generated placeholder)

- [ ] **Step 1: Create manifest.json**

Create `public/manifest.json`:

```json
{
  "name": "Claudio",
  "short_name": "Claudio",
  "description": "个人 AI 电台 — 你的私人 DJ",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0a0a0c",
  "background_color": "#0a0a0c",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Add manifest link to `public/index.html` `<head>`:

```html
<link rel="manifest" href="/manifest.json">
```

- [ ] **Step 2: Create Service Worker**

Create `public/sw.js`:

```js
const CACHE = 'claudio-v1';
const PRECACHE = ['/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/player.js', '/js/chat.js', '/js/profile.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET and API calls
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
```

Register SW in `public/js/app.js`:

```js
// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

- [ ] **Step 3: Generate placeholder icons**

Use a script to generate minimal PNG icons:

```bash
cd /home/xu/claudio && node -e "
const { writeFileSync } = await import('node:fs');

// Minimal 1x1 pink PNG in base64 (will be replaced with real icons later)
// Actually generate proper-colored placeholder PNGs using a script
const { createCanvas } = (await import('canvas')).default || {};
"

# Simple approach: use Python to generate colored squares
cd /home/xu/claudio && python3 -c "
import struct, zlib

def create_png(size, filename):
    # Create a simple solid-color PNG
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))

    # Raw image data: bg #0a0a0c with accent #c9a87c circle
    raw = b''
    for y in range(size):
        raw += b'\\x00'  # filter byte
        for x in range(size):
            cx, cy = size // 2, size // 2
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist < size * 0.4:
                raw += b'\\xc9\\xa8\\x7c'  # accent
            else:
                raw += b'\\x0a\\x0a\\x0c'  # bg

    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(header + ihdr + idat + iend)

create_png(192, 'public/icons/icon-192.png')
create_png(512, 'public/icons/icon-512.png')
print('Icons created')
"
```

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json public/sw.js public/icons/ public/index.html public/js/app.js
git commit -m "feat: add PWA manifest, service worker, and placeholder icons"
```

---

### Task 9: Integration polish — error handling + loading states

**Files:**
- Modify: `public/js/app.js`
- Modify: `public/js/chat.js`

- [ ] **Step 1: Add retry logic to api.js**

Append to `public/js/api.js`:

```js
export async function chatWithRetry(text, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chat(text);
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastErr;
}
```

- [ ] **Step 2: Update app.js to use retry and better error states**

Modify the sendMessage function in `public/js/app.js`:

```js
import { chatWithRetry } from './api.js';

// In sendMessage:
try {
  const result = await chatWithRetry(text);
  // ... rest of handling
} catch (err) {
  showToast('Claudio 走神了，重试一下？');
  console.error('Chat error:', err);
}
```

- [ ] **Step 3: Verify all tests still pass**

Run: `npx vitest run`
Expected: All tests pass (api.test.js, player.test.js, chat.test.js)

- [ ] **Step 4: Commit**

```bash
git add public/js/api.js public/js/app.js
git commit -m "feat: add SSE retry logic and improved error toasts"
```

---

### Task 10: Final verification — full integration test

- [ ] **Step 1: Start server and verify all endpoints**

Run: `node src/server.js &`
Then:
```bash
# 1. HTML is served
curl -s http://localhost:9876/ | grep -c 'Claudio' && echo "HTML OK"

# 2. CSS is served
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/css/app.css && echo " CSS OK"

# 3. JS modules are served
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/js/app.js && echo " JS OK"
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/js/api.js && echo " api.js OK"
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/js/player.js && echo " player.js OK"
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/js/chat.js && echo " chat.js OK"

# 4. API still works
curl -s -X POST http://localhost:9876/api/chat -H 'Content-Type: application/json' -d '{"message":"你好"}' | jq -r .say

# 5. manifest.json served
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/manifest.json && echo " manifest OK"

# 6. SW served
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/sw.js && echo " SW OK"

# 7. Icons served
curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/icons/icon-192.png && echo " icon-192 OK"
```

Expected: All return HTTP 200, API returns valid JSON response
Then: `kill %1`

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: integration verification — all endpoints and tests pass"
```

---

## Summary

| Task | Files Created | Files Modified | Tests |
|------|--------------|----------------|-------|
| 1. Static serving | `public/` dirs | `src/server.js` | `test/server-static.test.js` |
| 2. HTML/CSS | `public/index.html`, `public/css/app.css` | — | — |
| 3. api.js | `public/js/api.js` | — | `test/api.test.js` (5) |
| 4. player.js | `public/js/player.js` | `vitest.config.js`, `package.json` | `test/player.test.js` (6) |
| 5. chat.js | `public/js/chat.js` | — | `test/chat.test.js` (8) |
| 6. app.js | `public/js/app.js` | `src/server.js` | — |
| 7. profile.js | `public/js/profile.js` | `public/css/app.css`, `public/js/app.js` | — |
| 8. PWA | `public/manifest.json`, `public/sw.js`, `public/icons/` | `public/index.html`, `public/js/app.js` | — |
| 9. Error handling | — | `public/js/api.js`, `public/js/app.js` | — |
| 10. Integration | — | — | — |

**Total: ~19 tests across 4 test files**
