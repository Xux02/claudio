import { describe, it, expect, vi } from 'vitest';
import { synthesize } from '../src/tts.js';

describe('tts.synthesize', () => {
  it('returns relative file path on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });

    const result = await synthesize('你好，我是Claudio');
    expect(result).toMatch(/^tts\/.+\.wav$/);
  });

  it('returns null when TTS API returns non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await synthesize('hello');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await synthesize('hello');
    expect(result).toBeNull();
  });

  it('returns null for empty text', async () => {
    const result = await synthesize('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only text', async () => {
    const result = await synthesize('   ');
    expect(result).toBeNull();
  });
});
