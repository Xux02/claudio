import { describe, it, expect, vi } from 'vitest';
import { search, getSongUrl, getLyric, loginByQR, checkLoginStatus } from '../src/music.js';

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

describe('music.loginByQR', () => {
  it('returns qrUrl and unikey on success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          code: 200,
          data: { unikey: 'abc123' },
        }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          code: 200,
          data: { qrurl: 'https://music.163.com/login/qr?key=abc123', unikey: 'abc123' },
        }),
      });

    const result = await loginByQR();
    expect(result).toEqual({
      qrUrl: 'https://music.163.com/login/qr?key=abc123',
      unikey: 'abc123',
    });
  });

  it('returns null when key generation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({ code: 500 }),
    });

    const result = await loginByQR();
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await loginByQR();
    expect(result).toBeNull();
  });
});

describe('music.checkLoginStatus', () => {
  it('returns loggedIn=true with profile when logged in', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({
        data: {
          code: 200,
          profile: { userId: 12345, nickname: 'Xux02' },
        },
      }),
    });

    const result = await checkLoginStatus();
    expect(result).toEqual({ loggedIn: true, profile: { userId: 12345, nickname: 'Xux02' } });
  });

  it('returns loggedIn=false when not logged in (code 801)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: () => Promise.resolve({
        code: 200,
        data: { code: 801 },
      }),
    });

    const result = await checkLoginStatus();
    expect(result).toEqual({ loggedIn: false, profile: null });
  });

  it('returns loggedIn=false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fail'));

    const result = await checkLoginStatus();
    expect(result).toEqual({ loggedIn: false, profile: null });
  });
});
