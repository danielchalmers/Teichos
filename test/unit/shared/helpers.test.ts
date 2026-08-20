/**
 * Tests for shared/utils/helpers.ts
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  escapeHtml,
  formatDuration,
  formatTime,
  generateId,
  getCurrentDayOfWeek,
  getCurrentTimeString,
  isInternalUrl,
  isValidTimeString,
} from '../../../src/shared/utils/helpers';

describe('generateId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1234);
    const mathRandom = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    expect(generateId()).toMatch(/^1234-/);

    dateNow.mockRestore();
    mathRandom.mockRestore();
    vi.stubGlobal('crypto', originalCrypto);
  });
});

describe('escapeHtml', () => {
  it('escapes the HTML-sensitive characters', () => {
    expect(escapeHtml(`<a href="test">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;test&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;'
    );
  });
});

describe('formatTime', () => {
  it('should pad single-digit hours and minutes', () => {
    expect(formatTime(9, 5)).toBe('09:05');
  });
});

describe('isValidTimeString', () => {
  it.each(['09:00', '00:00', '23:59', '12:30'])('accepts %s', (input) => {
    expect(isValidTimeString(input)).toBe(true);
  });

  it.each([
    { input: '', label: 'a cleared time input' },
    // Times are compared as strings, and '9:00' sorts after '23:59'.
    { input: '9:00', label: 'an unpadded hour' },
    { input: '24:00', label: 'an out-of-range hour' },
    { input: '12:60', label: 'an out-of-range minute' },
    { input: '09:0', label: 'a half-typed minute' },
    { input: '09:00:30', label: 'seconds' },
    { input: 'noon', label: 'free text' },
    { input: undefined, label: 'a missing value' },
    { input: 900, label: 'a number' },
  ])('rejects $label', ({ input }) => {
    expect(isValidTimeString(input)).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    { ms: 1, expected: '1m' },
    { ms: 59 * 60_000, expected: '59m' },
    { ms: 61 * 60_000, expected: '1h 1m' },
    { ms: 2 * 60 * 60_000, expected: '2h' },
    { ms: 25 * 60 * 60_000, expected: '1d 1h' },
    { ms: 48 * 60 * 60_000, expected: '2d' },
  ])('formats $ms milliseconds as $expected', ({ ms, expected }) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('getCurrentTimeString', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current time in HH:MM format', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15, 9, 5, 30));

    expect(getCurrentTimeString()).toBe('09:05');
  });
});

describe('getCurrentDayOfWeek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current day of week', () => {
    vi.setSystemTime(new Date(2025, 0, 19, 9, 5, 30));

    expect(getCurrentDayOfWeek()).toBe(0);
  });
});

describe('isInternalUrl', () => {
  it('should detect browser internal URLs', () => {
    expect(isInternalUrl('chrome://extensions')).toBe(true);
    expect(isInternalUrl('chrome-extension://abc123/popup.html')).toBe(true);
    expect(isInternalUrl('edge://settings')).toBe(true);
    expect(isInternalUrl('about:blank')).toBe(true);
    expect(isInternalUrl('moz-extension://abc123/index.html')).toBe(true);
    expect(isInternalUrl('extension://example')).toBe(true);
  });

  it('should return false for normal web URLs', () => {
    expect(isInternalUrl('https://example.com')).toBe(false);
  });
});
