/**
 * Test setup file
 * Configures global mocks for chrome.* APIs
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { createChromeMock } from './fixtures/chrome-mocks';

// Set up global chrome mock before tests
const chromeMock = createChromeMock();
vi.stubGlobal('chrome', chromeMock);

// Reset mocks between tests. Resetting (not just clearing) also drops implementations a test
// installed with mockImplementation, so one test's fake tabs or failures cannot leak into the next.
beforeEach(() => {
  vi.resetAllMocks();
  chromeMock.storage.sync._reset();
  chromeMock.storage.local._reset();
  chromeMock.storage.session._reset();
  chromeMock.runtime.lastError = undefined;
});

// A test that fails before restoring real timers would otherwise run every later test in the file
// against a frozen clock.
afterEach(() => {
  vi.useRealTimers();
});
