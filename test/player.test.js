// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('player module', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      document.body.innerHTML = `
        <div id="song-title"></div>
        <div id="song-artist"></div>
        <div id="progress-fill"></div>
        <div id="time-current"></div>
        <div id="time-total"></div>
        <div id="time-display"></div>
      `;
      const { update } = await import('../public/js/player.js');

      update({ title: '晴天', artist: '周杰伦', album: '叶惠美' });

      expect(document.getElementById('song-title').textContent).toBe('晴天');
      expect(document.getElementById('song-artist').textContent).toBe('周杰伦 · 叶惠美');
    });

    it('handles missing album', async () => {
      document.body.innerHTML = `
        <div id="song-title"></div>
        <div id="song-artist"></div>
        <div id="progress-fill"></div>
        <div id="time-current"></div>
        <div id="time-total"></div>
        <div id="time-display"></div>
      `;
      const { update } = await import('../public/js/player.js');

      update({ title: '晴天', artist: '周杰伦' });

      expect(document.getElementById('song-artist').textContent).toBe('周杰伦');
    });
  });

  describe('setProgress', () => {
    it('updates progress bar width and time displays', async () => {
      document.body.innerHTML = `
        <div id="progress-fill"></div>
        <div id="time-current">0:00</div>
        <div id="time-total">0:00</div>
        <div id="time-display">0:00</div>
      `;
      const { setProgress } = await import('../public/js/player.js');

      setProgress(125, 257);

      expect(document.getElementById('progress-fill').style.width).toBe('49%');
      expect(document.getElementById('time-current').textContent).toBe('2:05');
      expect(document.getElementById('time-total').textContent).toBe('4:17');
      expect(document.getElementById('time-display').textContent).toBe('2:05');
    });

    it('clamps progress to 100%', async () => {
      document.body.innerHTML = `
        <div id="progress-fill"></div>
        <div id="time-current"></div>
        <div id="time-total"></div>
        <div id="time-display"></div>
      `;
      const { setProgress } = await import('../public/js/player.js');

      setProgress(300, 250);

      expect(document.getElementById('progress-fill').style.width).toBe('100%');
    });

    it('handles zero total', async () => {
      document.body.innerHTML = `
        <div id="progress-fill"></div>
        <div id="time-current"></div>
        <div id="time-total"></div>
        <div id="time-display"></div>
      `;
      const { setProgress } = await import('../public/js/player.js');

      setProgress(0, 0);

      expect(document.getElementById('progress-fill').style.width).toBe('0%');
    });
  });

  describe('initVisualizer', () => {
    it('creates 14 bars with unique animation delays', async () => {
      document.body.innerHTML = '<div id="visualizer"></div>';
      const { initVisualizer } = await import('../public/js/player.js');

      initVisualizer();

      const bars = document.querySelectorAll('#visualizer .bar');
      expect(bars.length).toBe(14);
      const delays = [...bars].map(b => b.style.animationDelay);
      const unique = new Set(delays);
      expect(unique.size).toBe(14);
    });
  });

  describe('setPlaying', () => {
    it('toggles play button text and visualizer class', async () => {
      document.body.innerHTML = `
        <button id="btn-play">▶</button>
        <div id="visualizer"></div>
      `;
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
