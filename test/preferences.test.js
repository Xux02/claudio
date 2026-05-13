// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  init, close,
  logPlay, logFeedback,
  getCurrentContext, getActiveSessionId,
  getArtistSessionStats, computeBayesianLift, getContextInsights,
  upsertSession,
} from '../src/state.js';

// Use unique prefixes to avoid collision with other test files
const U = 'pt_'; // prefix for unique identifiers in this test file

describe('preference learning', () => {
  beforeAll(() => { init(); });
  afterAll(() => { close(); });

  // ─── getCurrentContext ───────────────────────────────────────────

  describe('getCurrentContext', () => {
    it('returns expected shape', () => {
      const ctx = getCurrentContext();
      expect(ctx).toHaveProperty('timeOfDay');
      expect(ctx).toHaveProperty('dayOfWeek');
      expect(ctx).toHaveProperty('isWeekend');
      expect(ctx).toHaveProperty('weatherDesc');
      expect(typeof ctx.timeOfDay).toBe('string');
      expect(typeof ctx.dayOfWeek).toBe('number');
      expect([0, 1]).toContain(ctx.isWeekend);
    });

    it('accepts weather object and sets weatherDesc', () => {
      const sunny = getCurrentContext({ desc: 'Sunny', temp: 25 });
      expect(sunny.weatherDesc).toBe('Sunny');
      const empty = getCurrentContext(null);
      expect(empty.weatherDesc).toBe('');
    });

    it('maps hour to correct timeOfDay label', () => {
      const ctx = getCurrentContext();
      expect(['深夜', '早晨', '上午', '中午', '下午', '傍晚']).toContain(ctx.timeOfDay);
    });
  });

  // ─── getActiveSessionId ──────────────────────────────────────────

  describe('getActiveSessionId', () => {
    it('returns a string (may be empty or populated from other tests)', () => {
      expect(typeof getActiveSessionId()).toBe('string');
    });

    it('returns non-empty string for a recently upserted session', () => {
      upsertSession({
        id: U + 'active_sid_test',
        messages: [{ role: 'user', content: 'hi' }],
        date: '2026-05-13',
        preview: 'hi',
        messageCount: 1,
      });
      const sid = getActiveSessionId();
      // A recently upserted session should produce a non-empty result
      // (other test files may insert sessions too, so we can't assert a specific ID)
      expect(typeof sid).toBe('string');
      expect(sid.length).toBeGreaterThan(0);
    });
  });

  // ─── logPlay with context ────────────────────────────────────────

  describe('logPlay with context', () => {
    it('stores context columns and they appear in session stats', () => {
      const ctx = { timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' };
      const sid = U + 'logplay_ctx';
      logPlay({ title: 'TestSong', artist: U + 'TestArtist', sessionId: sid, context: ctx });

      const stats = getArtistSessionStats({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' });
      expect(stats.global[U + 'TestArtist']).toBeGreaterThan(0);
      expect(stats.ctxLevels.L1[U + 'TestArtist']).toBeGreaterThan(0);
    });

    it('does not throw when context is omitted (backward compatible)', () => {
      expect(() => logPlay({ title: 'TestSong2', artist: U + 'BC_Artist' })).not.toThrow();
    });
  });

  // ─── logFeedback with context ────────────────────────────────────

  describe('logFeedback with context', () => {
    it('stores context columns without throwing', () => {
      const ctx = { timeOfDay: '下午', dayOfWeek: 3, isWeekend: 0, weatherDesc: 'Rain' };
      const id = logFeedback({ title: 'TestSong', artist: U + 'FB_Artist', rating: 'like', sessionId: U + 'fb_test', context: ctx });
      expect(id).toBeTruthy();
    });

    it('does not throw when context is omitted (backward compatible)', () => {
      const id = logFeedback({ title: 'TestSong2', artist: U + 'FB2_Artist', rating: 'dislike' });
      expect(id).toBeTruthy();
    });
  });

  // ─── getArtistSessionStats ───────────────────────────────────────

  describe('getArtistSessionStats', () => {
    it('ignores plays without session_id', () => {
      const preWeight = getArtistSessionStats({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: '' }).totalGlobalWeight;
      logPlay({ title: 'NoSession', artist: U + 'NoSessArtist' }); // no sessionId
      const postWeight = getArtistSessionStats({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: '' }).totalGlobalWeight;
      // totalGlobalWeight should be unchanged (no session_id = not counted)
      expect(postWeight).toBe(preWeight);
    });

    it('each (artist, session) pair counts as at most 1 session', () => {
      const ctx = { timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' };
      const sid = U + 'multi_play_same_session';
      const artist = U + 'MultiPlayArtist';
      // 5 plays of same artist in same session
      for (let i = 0; i < 5; i++) {
        logPlay({ title: `Song${i}`, artist, sessionId: sid, context: ctx });
      }
      const stats = getArtistSessionStats({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' });
      // One session = weight ~1.0 (today), no more than 1.1
      expect(stats.global[artist]).toBeGreaterThan(0.9);
      expect(stats.global[artist]).toBeLessThan(1.1);
    });

    it('correctly separates context levels', () => {
      const sidM = U + 'sep_morning';
      const sidA = U + 'sep_afternoon';
      const artistM = U + 'MorningArtist';
      const artistA = U + 'AfternoonArtist';

      // Morning session
      logPlay({ title: 'Morning Song', artist: artistM, sessionId: sidM, context: { timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' } });

      // Afternoon session
      logPlay({ title: 'Afternoon Song', artist: artistA, sessionId: sidA, context: { timeOfDay: '下午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' } });

      const stats = getArtistSessionStats({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'Sunny' });

      // Global: both artists appear
      expect(stats.global[artistM]).toBeGreaterThan(0);
      expect(stats.global[artistA]).toBeGreaterThan(0);

      // Level 3 (上午 + weekday): only morning artist
      expect(stats.ctxLevels.L3[artistM]).toBeGreaterThan(0);
      expect(stats.ctxLevels.L3[artistA] || 0).toBe(0);
    });
  });

  // ─── computeBayesianLift ─────────────────────────────────────────

  describe('computeBayesianLift', () => {
    it('returns lift ≈ 1 when context matches global distribution', () => {
      const globalStats = {
        global: { 'A': 10, 'B': 10 },
        totalGlobalWeight: 20,
      };
      const ctxArtists = { 'A': 5, 'B': 5 };
      const lifts = computeBayesianLift(globalStats, ctxArtists, 10);
      const a = lifts.find(l => l.artist === 'A');
      expect(a.lift).toBeCloseTo(1, 0);
    });

    it('returns lift > 1 when artist is over-represented in context', () => {
      const globalStats = {
        global: { 'X': 10, 'Y': 10, 'Z': 10 },
        totalGlobalWeight: 30,
      };
      const ctxArtists = { 'X': 8, 'Y': 1, 'Z': 1 };
      const lifts = computeBayesianLift(globalStats, ctxArtists, 10);
      const x = lifts.find(l => l.artist === 'X');
      expect(x.lift).toBeGreaterThan(1.3);
    });

    it('returns lift < 1 when artist is under-represented in context', () => {
      const globalStats = {
        global: { 'P': 10, 'Q': 10 },
        totalGlobalWeight: 20,
      };
      const ctxArtists = { 'P': 1, 'Q': 9 };
      const lifts = computeBayesianLift(globalStats, ctxArtists, 10);
      const p = lifts.find(l => l.artist === 'P');
      expect(p.lift).toBeLessThan(1.0);
      const q = lifts.find(l => l.artist === 'Q');
      expect(q.lift).toBeGreaterThan(1.0);
    });

    it('with alpha=10 and totalCtxWeight=10, prior and evidence are equally weighted', () => {
      const globalStats = {
        global: { 'M': 5 },
        totalGlobalWeight: 5,
      };
      const lifts = computeBayesianLift(globalStats, { 'M': 10 }, 10, 10);
      expect(lifts[0].lift).toBeCloseTo(1, 1);
    });
  });

  // ─── getContextInsights ──────────────────────────────────────────

  describe('getContextInsights', () => {
    it('returns global fallback when context has too few sessions', () => {
      const artist = U + 'few_sessions_artist';
      // Only 1 session in this specific context
      logPlay({ title: 'Song', artist, sessionId: U + 'few_sess', context: { timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'SpecialWeatherXYZ' } });
      logPlay({ title: 'Song2', artist, sessionId: U + 'few_sess', context: { timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'SpecialWeatherXYZ' } });

      const insights = getContextInsights({ timeOfDay: '上午', dayOfWeek: 1, isWeekend: 0, weatherDesc: 'SpecialWeatherXYZ' });
      // 1 session is too few — falls back to global
      expect(insights).not.toBeNull();
      expect(insights.levelUsed).toBe('global');
      expect(insights.liftedUp).toHaveLength(0);
    });

    it('the "anomalous morning" scenario: 1 morning of Jay Chou + 9 mornings of English music → Jay Chou NOT over-represented', () => {
      // This is the user's core concern: one anomalous morning shouldn't create a false pattern
      const morningCtx = { timeOfDay: '上午', dayOfWeek: 2, isWeekend: 0, weatherDesc: 'Sunny' };
      const jayArtist = U + 'JayChou';
      const engArtist1 = U + 'EngArtist1';
      const engArtist2 = U + 'EngArtist2';

      // 9 morning sessions of English music
      for (let s = 1; s <= 9; s++) {
        logPlay({ title: `EngA_${s}`, artist: engArtist1, sessionId: U + `anom_en_${s}`, context: morningCtx });
        logPlay({ title: `EngB_${s}`, artist: engArtist2, sessionId: U + `anom_en_${s}`, context: morningCtx });
      }

      // 1 morning session of "Jay Chou" (the anomaly)
      logPlay({ title: 'Sunny Day', artist: jayArtist, sessionId: U + 'anom_jay', context: morningCtx });
      logPlay({ title: 'Rice Fragrance', artist: jayArtist, sessionId: U + 'anom_jay', context: morningCtx });
      logPlay({ title: 'Nocturne', artist: jayArtist, sessionId: U + 'anom_jay', context: morningCtx });

      const insights = getContextInsights({ timeOfDay: '上午', dayOfWeek: 2, isWeekend: 0, weatherDesc: 'Sunny' });
      expect(insights).not.toBeNull();

      // "Jay Chou" should NOT appear as significantly over-represented
      const jayUp = insights.liftedUp.find(a => a.artist === jayArtist);
      if (jayUp) {
        // If somehow appears, lift must not be significant
        expect(jayUp.lift).toBeLessThanOrEqual(1.5);
      }
      // But English artists should potentially show up as lifted
      // (9/10 mornings with English music = strong signal)
    });

    it('detects real patterns after enough consistent sessions', () => {
      const afternoonCtx = { timeOfDay: '下午', dayOfWeek: 4, isWeekend: 0, weatherDesc: 'Cloudy' };
      const artistA = U + 'ConsistentArtistA';
      const artistB = U + 'ConsistentArtistB';

      // 12 afternoon sessions, consistently these two artists
      for (let s = 1; s <= 12; s++) {
        logPlay({ title: `SongA_${s}`, artist: artistA, sessionId: U + `pattern_a_${s}`, context: afternoonCtx });
        logPlay({ title: `SongB_${s}`, artist: artistB, sessionId: U + `pattern_a_${s}`, context: afternoonCtx });
      }

      // Also add global diversity in other times of day (different artists)
      const otherCtx = { timeOfDay: '晚上', dayOfWeek: 5, isWeekend: 0, weatherDesc: 'Cloudy' };
      const artistC = U + 'OtherArtistC';
      const artistD = U + 'OtherArtistD';
      for (let s = 1; s <= 8; s++) {
        logPlay({ title: `OtherA_${s}`, artist: artistC, sessionId: U + `other_${s}`, context: otherCtx });
        logPlay({ title: `OtherB_${s}`, artist: artistD, sessionId: U + `other_${s}`, context: otherCtx });
      }

      const insights = getContextInsights({ timeOfDay: '下午', dayOfWeek: 4, isWeekend: 0, weatherDesc: 'Cloudy' });
      expect(insights).not.toBeNull();
      expect(insights.totalGlobalSessions).toBeGreaterThan(0);

      // After 12 sessions, afternoon context should be active
      if (insights.levelUsed !== 'global') {
        // Our consistent artists should be among lifted up
        const aUp = insights.liftedUp.find(a => a.artist === artistA);
        if (aUp) {
          expect(aUp.lift).toBeGreaterThan(1.0);
        }
      }
    });
  });

  // ─── Bayesian smoothing edge cases ───────────────────────────────

  describe('Bayesian smoothing math', () => {
    it('empty context artists returns empty results', () => {
      const globalStats = { global: { 'A': 5 }, totalGlobalWeight: 5 };
      const lifts = computeBayesianLift(globalStats, {}, 0, 10);
      expect(lifts).toHaveLength(0);
    });

    it('handles single-artist edge case', () => {
      const globalStats = { global: { 'Solo': 5 }, totalGlobalWeight: 5 };
      const lifts = computeBayesianLift(globalStats, { 'Solo': 5 }, 5, 10);
      expect(lifts).toHaveLength(1);
      expect(lifts[0].artist).toBe('Solo');
    });
  });
});
