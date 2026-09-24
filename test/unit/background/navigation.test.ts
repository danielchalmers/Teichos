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

  // Before-navigate, history-state and fragment events all arrive here with the same details
  // shape; registerBackground wires each of them to this handler.
  it('delegates main-frame navigations to the tab controller', async () => {
    await handleBeforeNavigate(
      createNavigationDetails({ tabId: 9, url: 'https://blocked.com/page' })
    );
    await handleNavigationChange(
      createNavigationDetails({ tabId: 6, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenNthCalledWith(1, 9, 'https://blocked.com/page');
    expect(mocks.evaluateNavigation).toHaveBeenNthCalledWith(
      2,
      6,
      'https://example.com/page#blocked'
    );
  });

  it('ignores sub-frame navigations', async () => {
    await handleBeforeNavigate(createNavigationDetails({ frameId: 1, tabId: 4 }));
    await handleNavigationChange(
      createNavigationDetails({ frameId: 3, tabId: 8, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });
});
