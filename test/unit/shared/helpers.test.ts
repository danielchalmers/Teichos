/**
 * Tests for shared/utils/helpers.ts
 */

import { describe, it, expect } from 'vitest';
import { generateId, escapeHtml, formatTime, getCurrentTimeString } from '../../../src/shared/utils/helpers';

describe('generateId', () => {
  it('should generate a unique ID', () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it('should generate valid UUID format', () => {
    const id = generateId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should handle ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should handle quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('should pass through safe text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('formatTime', () => {
  it('should format single digit hours and minutes with leading zeros', () => {
    expect(formatTime(9, 5)).toBe('09:05');
  });

  it('should format double digit hours and minutes', () => {
    expect(formatTime(14, 30)).toBe('14:30');
  });

  it('should handle midnight', () => {
    expect(formatTime(0, 0)).toBe('00:00');
  });
});

describe('getCurrentTimeString', () => {
  it('should return a string in HH:MM format', () => {
    const time = getCurrentTimeString();
    expect(time).toMatch(/^\d{2}:\d{2}$/);
  });
});
