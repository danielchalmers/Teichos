/**
 * Test setup file
 * Configures global mocks for chrome.* APIs
 */

import { vi } from 'vitest';
import { createChromeMock } from './fixtures/chrome-mocks';

// Set up global chrome mock before tests
const chromeMock = createChromeMock();
vi.stubGlobal('chrome', chromeMock);

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  chromeMock.storage.sync._reset();
});
