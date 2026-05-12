import { describe, it, expect, vi } from 'vitest';
import { search, getSongUrl, getLyric } from '../src/music.js';

describe('music.search', () => {
  it('returns parsed song array on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({
        code: 200,
        result: {
          songs: [
            { id: 123, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 269000 },
          ],
        },
      }),
    });

    const result = await search('晴天', 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: '123',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: 269000,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?keywords=')
    );
  });

  it('returns empty array when API returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 500 }),
    });

    const result = await search('xxx');
    expect(result).toEqual([]);
  });

  it('returns empty array on fetch error (API down)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await search('xxx');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty keyword', async () => {
    const result = await search('');
    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only keyword', async () => {
    const result = await search('   ');
    expect(result).toEqual([]);
  });
});

describe('music.getSongUrl', () => {
  it('returns URL string on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({
        code: 200,
        data: [{ id: 123, url: 'https://music.163.com/song/media/outer/url?id=123.mp3', br: 320000 }],
      }),
    });

    const url = await getSongUrl('123');
    expect(url).toBe('https://music.163.com/song/media/outer/url?id=123.mp3');
  });

  it('returns null when API returns no URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 200, data: [] }),
    });

    const url = await getSongUrl('123');
    expect(url).toBeNull();
  });

  it('returns null on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));

    const url = await getSongUrl('123');
    expect(url).toBeNull();
  });
});

describe('music.getLyric', () => {
  it('returns lyric string on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({
        code: 200,
        lrc: { lyric: '[00:00.00]晴天 - 周杰伦\n[00:10.00]故事的小黄花' },
      }),
    });

    const lyric = await getLyric('123');
    expect(lyric).toBe('[00:00.00]晴天 - 周杰伦\n[00:10.00]故事的小黄花');
  });

  it('returns empty string on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'));

    const lyric = await getLyric('123');
    expect(lyric).toBe('');
  });
});
