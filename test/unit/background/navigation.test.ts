import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evaluateNavigation: vi.fn(),
  settleGoBackStep: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    evaluateNavigation: typeof mocks.evaluateNavigation;
    settleGoBackStep: typeof mocks.settleGoBackStep;
  } => ({
    evaluateNavigation: mocks.evaluateNavigation,
    settleGoBackStep: mocks.settleGoBackStep,
  }),
}));

import {
  handleBeforeNavigate,
  handleNavigationChange,
  handleNavigationCommitted,
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

describe('handleNavigationCommitted', () => {
  it('settles a Go back step on main-frame commits only', async () => {
    mocks.settleGoBackStep.mockResolvedValue(undefined);

    await handleNavigationCommitted(
      createNavigationDetails({ tabId: 5, url: 'chrome-extension://id/options.html' })
    );
    await handleNavigationCommitted(createNavigationDetails({ frameId: 2, tabId: 5 }));

    expect(mocks.settleGoBackStep).toHaveBeenCalledTimes(1);
    expect(mocks.settleGoBackStep).toHaveBeenCalledWith(5, 'chrome-extension://id/options.html');
    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });
});
