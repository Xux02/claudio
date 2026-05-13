// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { init, upsertSession, getAllSessions, getSession, deleteSession, clearAll, close } from '../src/state.js';

describe('sessions DB (state.js)', () => {
  let db;

  beforeAll(() => {
    db = init();
  });

  afterAll(() => {
    clearAll();
    close();
  });

  const sample = {
    id: 'test-uuid-001',
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀！' },
    ],
    date: '2026-05-13',
    preview: '你好',
    messageCount: 2,
  };

  describe('upsertSession', () => {
    it('inserts a new session', () => {
      upsertSession(sample);
      const s = getSession('test-uuid-001');
      expect(s).toBeTruthy();
      expect(s.id).toBe('test-uuid-001');
      expect(s.messages).toHaveLength(2);
      expect(s.messages[0].content).toBe('你好');
    });

    it('updates an existing session', () => {
      upsertSession({ ...sample, messageCount: 4, messages: [...sample.messages, { role: 'user', content: 'B' }, { role: 'assistant', content: 'C' }] });
      const s = getSession('test-uuid-001');
      expect(s.messageCount).toBe(4);
      expect(s.messages).toHaveLength(4);
    });
  });

  describe('getAllSessions', () => {
    it('returns an array', () => {
      const sessions = getAllSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('returns sessions with parsed messages', () => {
      const sessions = getAllSessions();
      expect(sessions[0].messages).toBeInstanceOf(Array);
    });
  });

  describe('getSession', () => {
    it('returns null for nonexistent id', () => {
      expect(getSession('nonexistent')).toBeNull();
    });

    it('returns session with all fields', () => {
      const s = getSession('test-uuid-001');
      expect(s.id).toBe('test-uuid-001');
      expect(s.date).toBe('2026-05-13');
      expect(s.preview).toBe('你好');
      expect(s.messageCount).toBeGreaterThanOrEqual(2);
      expect(s.messages).toBeInstanceOf(Array);
      expect(s.createdAt).toBeTruthy();
      expect(s.updatedAt).toBeTruthy();
    });
  });

  describe('deleteSession', () => {
    it('deletes and returns changes', () => {
      upsertSession({ id: 'to-delete', messages: [], date: '2026-05-13', preview: '', messageCount: 0 });
      const result = deleteSession('to-delete');
      expect(result.changes).toBe(1);
      expect(getSession('to-delete')).toBeNull();
    });

    it('returns 0 changes for nonexistent id', () => {
      const result = deleteSession('nonexistent');
      expect(result.changes).toBe(0);
    });
  });
});
