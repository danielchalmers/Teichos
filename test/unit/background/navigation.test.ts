import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evaluateNavigation: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: () => ({
    evaluateNavigation: mocks.evaluateNavigation,
  }),
}));

import { handleBeforeNavigate } from '../../../src/background/handlers/navigation';

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

describe('handleBeforeNavigate', () => {
  beforeEach(() => {
    mocks.evaluateNavigation.mockResolvedValue(undefined);
  });

  it('ignores non-main-frame navigations', async () => {
    await handleBeforeNavigate(createNavigationDetails({ frameId: 2, tabId: 4 }));

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });

  it('delegates main-frame navigations to the tab controller', async () => {
    await handleBeforeNavigate(
      createNavigationDetails({ tabId: 9, url: 'https://blocked.com/page' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(9, 'https://blocked.com/page');
  });
});
