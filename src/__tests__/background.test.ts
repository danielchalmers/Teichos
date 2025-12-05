import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadData } from '../storage';
import { StorageData } from '../types';

// Mock Chrome APIs
const mockTabsUpdate = vi.fn();
const mockTabsOnUpdated = {
  addListener: vi.fn(),
};
const mockWebNavigationOnBeforeNavigate = {
  addListener: vi.fn(),
};
const mockRuntimeGetURL = vi.fn((path: string) => `chrome-extension://mock-id/${path}`);

global.chrome = {
  tabs: {
    update: mockTabsUpdate,
    onUpdated: mockTabsOnUpdated,
  },
  webNavigation: {
    onBeforeNavigate: mockWebNavigationOnBeforeNavigate,
  },
  runtime: {
    getURL: mockRuntimeGetURL,
  },
} as unknown as typeof chrome;

// Mock storage module
vi.mock('../storage', () => ({
  loadData: vi.fn(),
}));

describe('background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('shouldBlockUrl', () => {
    it('should not block URLs that match whitelist', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: 'blocked.com', groupId: 'default', enabled: true },
        ],
        whitelist: [
          { id: 'white1', pattern: 'blocked.com/allowed', enabled: true },
        ],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      // Import background module to execute listener registration
      await import('../background');

      // Get the listener callback for tabs.onUpdated
      const tabsUpdateListener = mockTabsOnUpdated.addListener.mock.calls[0]?.[0];
      
      if (tabsUpdateListener) {
        // Simulate a tab update with a whitelisted URL
        await tabsUpdateListener(1, { status: 'loading' }, { url: 'https://blocked.com/allowed' });
        
        // Should not block because whitelist matches
        expect(mockTabsUpdate).not.toHaveBeenCalled();
      }
    });

    it('should block URLs that match filters and are not whitelisted', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: 'blocked.com', groupId: 'default', enabled: true },
        ],
        whitelist: [],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      await import('../background');

      const tabsUpdateListener = mockTabsOnUpdated.addListener.mock.calls[0]?.[0];
      
      if (tabsUpdateListener) {
        await tabsUpdateListener(1, { status: 'loading' }, { url: 'https://blocked.com/page' });
        
        expect(mockTabsUpdate).toHaveBeenCalledWith(1, {
          url: expect.stringContaining('blocked.html?url='),
        });
      }
    });

    it('should not block URLs that do not match any filter', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: 'blocked.com', groupId: 'default', enabled: true },
        ],
        whitelist: [],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      await import('../background');

      const tabsUpdateListener = mockTabsOnUpdated.addListener.mock.calls[0]?.[0];
      
      if (tabsUpdateListener) {
        await tabsUpdateListener(1, { status: 'loading' }, { url: 'https://allowed.com/page' });
        
        expect(mockTabsUpdate).not.toHaveBeenCalled();
      }
    });

    it('should not block when filter is disabled', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: 'blocked.com', groupId: 'default', enabled: false },
        ],
        whitelist: [],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      await import('../background');

      const tabsUpdateListener = mockTabsOnUpdated.addListener.mock.calls[0]?.[0];
      
      if (tabsUpdateListener) {
        await tabsUpdateListener(1, { status: 'loading' }, { url: 'https://blocked.com/page' });
        
        expect(mockTabsUpdate).not.toHaveBeenCalled();
      }
    });

    it('should handle regex patterns correctly', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: '.*\\.blocked\\.com.*', groupId: 'default', enabled: true, isRegex: true },
        ],
        whitelist: [],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      await import('../background');

      const tabsUpdateListener = mockTabsOnUpdated.addListener.mock.calls[0]?.[0];
      
      if (tabsUpdateListener) {
        await tabsUpdateListener(1, { status: 'loading' }, { url: 'https://subdomain.blocked.com/page' });
        
        expect(mockTabsUpdate).toHaveBeenCalledWith(1, {
          url: expect.stringContaining('blocked.html?url='),
        });
      }
    });
  });

  describe('event listeners', () => {
    it('should register tabs.onUpdated listener', async () => {
      vi.mocked(loadData).mockResolvedValue({
        groups: [],
        filters: [],
        whitelist: [],
      });

      await import('../background');

      expect(mockTabsOnUpdated.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should register webNavigation.onBeforeNavigate listener', async () => {
      vi.mocked(loadData).mockResolvedValue({
        groups: [],
        filters: [],
        whitelist: [],
      });

      await import('../background');

      expect(mockWebNavigationOnBeforeNavigate.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should only process main frame navigation', async () => {
      const mockData: StorageData = {
        groups: [
          { id: 'default', name: '24/7', schedules: [], is24x7: true },
        ],
        filters: [
          { id: 'filter1', pattern: 'blocked.com', groupId: 'default', enabled: true },
        ],
        whitelist: [],
      };

      vi.mocked(loadData).mockResolvedValue(mockData);

      await import('../background');

      const webNavListener = mockWebNavigationOnBeforeNavigate.addListener.mock.calls[0]?.[0];
      
      if (webNavListener) {
        // Simulate iframe navigation (frameId !== 0)
        await webNavListener({ frameId: 1, url: 'https://blocked.com/page', tabId: 1 });
        
        // Should not block iframe navigation
        expect(mockTabsUpdate).not.toHaveBeenCalled();
      }
    });
  });
});
