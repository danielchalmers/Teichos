import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getChromeMock } from '../../fixtures/chrome-mocks';

const mocks = vi.hoisted(() => ({
  handleNavigationChange: vi.fn(),
  handleMessage: vi.fn(),
  registerTabController: vi.fn(),
  registerSnoozeHandlers: vi.fn(),
}));

vi.mock('../../../src/background/handlers', () => ({
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
    mocks.handleMessage.mockReset();
    mocks.registerTabController.mockReset();
    mocks.registerSnoozeHandlers.mockReset();
  });

  it('registers all webNavigation listeners with the shared navigation handler', async () => {
    const chromeMock = getChromeMock();

    const { registerBackground } = await import('../../../src/background/index');
    registerBackground();

    expect(chromeMock.webNavigation.onBeforeNavigate.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.webNavigation.onHistoryStateUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.webNavigation.onReferenceFragmentUpdated.addListener).toHaveBeenCalledTimes(
      1
    );
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledWith(mocks.handleMessage);
    expect(mocks.registerTabController).toHaveBeenCalledTimes(1);
    expect(mocks.registerSnoozeHandlers).toHaveBeenCalledTimes(1);

    const beforeNavigateListener =
      chromeMock.webNavigation.onBeforeNavigate.addListener.mock.calls[0]?.[0];
    const historyStateListener =
      chromeMock.webNavigation.onHistoryStateUpdated.addListener.mock.calls[0]?.[0];
    const referenceFragmentListener =
      chromeMock.webNavigation.onReferenceFragmentUpdated.addListener.mock.calls[0]?.[0];

    const details = {
      frameId: 0,
      tabId: 12,
      url: 'https://example.com/blocked-route',
    };

    await beforeNavigateListener?.(details);
    await historyStateListener?.(details);
    await referenceFragmentListener?.(details);

    expect(mocks.handleNavigationChange).toHaveBeenNthCalledWith(1, details);
    expect(mocks.handleNavigationChange).toHaveBeenNthCalledWith(2, details);
    expect(mocks.handleNavigationChange).toHaveBeenNthCalledWith(3, details);
  });
});
