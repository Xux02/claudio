import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { start, stop, getSchedule } from '../src/scheduler.js';

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('getSchedule returns all 6 time slots with triggered=false initially', () => {
    const schedule = getSchedule();
    expect(schedule).toHaveLength(6);
    expect(schedule[0]).toHaveProperty('time');
    expect(schedule[0]).toHaveProperty('reason');
    expect(schedule[0]).toHaveProperty('triggered');
    expect(schedule.every((s) => s.triggered === false)).toBe(true);
  });

  it('start calls callback when time matches', () => {
    const fakeDate = new Date(2026, 4, 12, 7, 30, 0);
    vi.setSystemTime(fakeDate);

    const callback = vi.fn();
    start(callback);

    vi.advanceTimersByTime(60_000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.stringContaining('早上好')
    );
  });

  it('does not trigger same time slot twice on same day', () => {
    const fakeDate = new Date(2026, 4, 12, 7, 30, 0);
    vi.setSystemTime(fakeDate);

    const callback = vi.fn();
    start(callback);

    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(1); // still 1, already triggered
  });

  it('stop clears the interval', () => {
    const fakeDate = new Date(2026, 4, 12, 7, 30, 0);
    vi.setSystemTime(fakeDate);

    const callback = vi.fn();
    start(callback);
    // tick() runs synchronously on start(), so callback fires once immediately
    expect(callback).toHaveBeenCalledTimes(1);
    stop();

    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(1); // no additional calls after stop
  });

  it('getSchedule shows triggered=true after a slot fires', () => {
    const fakeDate = new Date(2026, 4, 12, 7, 30, 0);
    vi.setSystemTime(fakeDate);

    start(vi.fn());
    vi.advanceTimersByTime(60_000);

    const schedule = getSchedule();
    const morning = schedule.find((s) => s.time === '07:30');
    expect(morning.triggered).toBe(true);
  });

  it('does not trigger when no HH:MM match', () => {
    const fakeDate = new Date(2026, 4, 12, 10, 5, 0);
    vi.setSystemTime(fakeDate);

    const callback = vi.fn();
    start(callback);

    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('resets triggered set when date changes (simulated midnight)', () => {
    const day1 = new Date(2026, 4, 12, 7, 30, 0);
    vi.setSystemTime(day1);

    const callback = vi.fn();
    start(callback);
    // tick() runs synchronously, triggers at 07:30 on day 1
    expect(callback).toHaveBeenCalledTimes(1);

    // Restart on next day — simulates a new day beginning
    stop();
    const day2 = new Date(2026, 4, 13, 7, 30, 0);
    vi.setSystemTime(day2);
    start(callback);
    // tick() runs synchronously, triggers again because date changed
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
