/**
 * Tests for shared/utils/helpers.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatTime, getCurrentTimeString, isInternalUrl } from '../../../src/shared/utils/helpers';

describe('formatTime', () => {
  it('should pad single-digit hours and minutes', () => {
    expect(formatTime(9, 5)).toBe('09:05');
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
