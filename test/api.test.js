import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    it('throws on non-ok response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'bad request' }),
      });

      await expect(api.chat('')).rejects.toThrow('HTTP 400');
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

    it('throws on non-ok response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(api.getNow()).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(api.getNow()).rejects.toThrow('ECONNREFUSED');
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

    it('throws on non-ok response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(api.getHistory()).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error('timeout'));

      await expect(api.getHistory()).rejects.toThrow('timeout');
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

    it('throws on non-ok response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      await expect(api.getTaste()).rejects.toThrow('HTTP 503');
    });

    it('throws on network error', async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error('offline'));

      await expect(api.getTaste()).rejects.toThrow('offline');
    });
  });
});
