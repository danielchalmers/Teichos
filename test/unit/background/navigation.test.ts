import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evaluateNavigation: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    evaluateNavigation: typeof mocks.evaluateNavigation;
  } => ({
    evaluateNavigation: mocks.evaluateNavigation,
  }),
}));

import {
 handleBeforeNavigate,
 handleNavigationChange,
} from '../../../src/background/handlers/navigation';

function createNavigationDetails(
  overrides: Partial<chrome.webNavigation.WebNavigationBaseCallbackDetails>
): chrome.webNavigation.WebNavigationBaseCallbackDetails {
  return {
    documentLifecycle: 'active',
    frameId: 0,
    frameType: 'outermost_frame',
    parentDocumentId: undefined,
    parentFrameId: -1,
    processId: 1,
    tabId: 1,
    timeStamp: Date.now(),
    url: 'https://example.com',
    ...overrides,
  };
}

describe('handleNavigationChange', () => {
  beforeEach(() => {
    mocks.evaluateNavigation.mockResolvedValue(undefined);
  });

  it('ignores non-main-frame navigations', async () => {
    await handleNavigationChange(createNavigationDetails({ frameId: 2, tabId: 4 }));

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });

  it('delegates main-frame before-navigate events to the tab controller', async () => {
    await handleBeforeNavigate(
      createNavigationDetails({ tabId: 9, url: 'https://blocked.com/page' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(9, 'https://blocked.com/page');
  });

  it('delegates main-frame history-state updates to the tab controller', async () => {
    await handleNavigationChange(
      createNavigationDetails({ tabId: 5, url: 'https://example.com/blocked-route' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(
      5,
      'https://example.com/blocked-route'
    );
  });

  it('delegates main-frame fragment updates to the tab controller', async () => {
    await handleNavigationChange(
      createNavigationDetails({ tabId: 6, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(6, 'https://example.com/page#blocked');
  });

  it('ignores sub-frame history-state and fragment updates', async () => {
    await handleNavigationChange(
      createNavigationDetails({ frameId: 2, tabId: 7, url: 'https://example.com/blocked-route' })
    );
    await handleNavigationChange(
      createNavigationDetails({ frameId: 3, tabId: 8, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });
});
