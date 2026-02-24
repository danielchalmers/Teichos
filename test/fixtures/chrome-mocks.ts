/**
 * Chrome API mocks for testing
 */

import { vi } from 'vitest';

interface MockStorage {
  _data: Map<string, unknown>;
  _reset: () => void;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

interface ChromeMock {
  storage: {
    sync: MockStorage;
    local: MockStorage;
    session: MockStorage;
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  alarms: {
    create: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    onAlarm: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  tabs: {
    update: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    onUpdated: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  webNavigation: {
    onBeforeNavigate: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  runtime: {
    id: string;
    getURL: ReturnType<typeof vi.fn>;
    openOptionsPage: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
}

function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>();

  return {
    _data: data,
    _reset: () => data.clear(),
    get: vi.fn((keys: string | string[]) => {
      const result: Record<string, unknown> = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      keyArray.forEach((key) => {
        if (data.has(key)) {
          result[key] = data.get(key);
        }
      });
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.entries(items).forEach(([key, value]) => {
        data.set(key, value);
      });
      return Promise.resolve();
    }),
  };
}

export function createChromeMock(): ChromeMock {
  return {
    storage: {
      sync: createMockStorage(),
      local: createMockStorage(),
      session: createMockStorage(),
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn().mockResolvedValue(true),
      onAlarm: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      update: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    webNavigation: {
      onBeforeNavigate: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      id: 'test-extension-id',
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      openOptionsPage: vi.fn((callback?: () => void) => {
        callback?.();
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };
}

export function getChromeMock(): ChromeMock {
  return globalThis.chrome as unknown as ChromeMock;
}
