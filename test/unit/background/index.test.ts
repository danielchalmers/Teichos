import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChromeMock } from '../../fixtures/chrome-mocks';

const mocks = vi.hoisted(() => ({
  handleBeforeNavigate: vi.fn(),
  handleNavigationChange: vi.fn(),
  handleMessage: vi.fn(),
  registerTabController: vi.fn(),
  registerSnoozeHandlers: vi.fn(),
}));

vi.mock('../../../src/background/handlers', () => ({
  handleBeforeNavigate: mocks.handleBeforeNavigate,
  handleNavigationChange: mocks.handleNavigationChange,
  handleMessage: mocks.handleMessage,
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    register: typeof mocks.registerTabController;
  } => ({
    register: mocks.registerTabController,
  }),
}));

vi.mock('../../../src/background/snooze', () => ({
  registerSnoozeHandlers: mocks.registerSnoozeHandlers,
}));

describe('background entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handleNavigationChange.mockReset().mockResolvedValue(undefined);
    mocks.handleBeforeNavigate.mockReset().mockResolvedValue(undefined);
    mocks.handleMessage.mockReset();
    mocks.registerTabController.mockReset();
    mocks.registerSnoozeHandlers.mockReset();
  });

  it('judges navigations when they start and again for every committed change', async () => {
    const chromeMock = getChromeMock();

    const { registerBackground } = await import('../../../src/background/index');
    registerBackground();

    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledWith(mocks.handleMessage);
    expect(mocks.registerTabController).toHaveBeenCalledTimes(1);
    expect(mocks.registerSnoozeHandlers).toHaveBeenCalledTimes(1);

    const listenerOf = (event: {
      addListener: { mock: { calls: unknown[][] } };
    }): ((details: unknown) => void) => {
      expect(event.addListener).toHaveBeenCalledTimes(1);
      return event.addListener.mock.calls[0]?.[0] as (details: unknown) => void;
    };
    const { webNavigation } = chromeMock;
    const details = { frameId: 0, tabId: 12, url: 'https://example.com/blocked-route' };

    listenerOf(webNavigation.onBeforeNavigate)(details);
    expect(mocks.handleBeforeNavigate).toHaveBeenCalledWith(details);

    for (const event of [
      webNavigation.onCommitted,
      webNavigation.onHistoryStateUpdated,
      webNavigation.onReferenceFragmentUpdated,
    ]) {
      listenerOf(event)(details);
    }
    expect(mocks.handleNavigationChange).toHaveBeenCalledTimes(3);
    expect(mocks.handleNavigationChange).toHaveBeenCalledWith(details);
    expect(mocks.handleBeforeNavigate).toHaveBeenCalledTimes(1);
  });

  it('logs a failed navigation evaluation instead of leaving the rejection unhandled', async () => {
    const chromeMock = getChromeMock();
    const failure = new Error('storage unavailable');
    mocks.handleBeforeNavigate.mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { registerBackground } = await import('../../../src/background/index');
    registerBackground();
    chromeMock.webNavigation.onBeforeNavigate.addListener.mock.calls[0]?.[0]({
      frameId: 0,
      tabId: 3,
      url: 'https://example.com/',
    });

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('[Teichos] Error handling navigation:', failure);
    });
  });
});
