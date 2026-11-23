import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evaluateNavigation: vi.fn(),
  judgeRefusedNavigation: vi.fn(),
}));

vi.mock('../../../src/background/tabController', () => ({
  getTabController: (): {
    evaluateNavigation: typeof mocks.evaluateNavigation;
    judgeRefusedNavigation: typeof mocks.judgeRefusedNavigation;
  } => ({
    evaluateNavigation: mocks.evaluateNavigation,
    judgeRefusedNavigation: mocks.judgeRefusedNavigation,
  }),
}));

import {
  handleBeforeNavigate,
  handleNavigationChange,
  handleNavigationError,
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

describe('navigation handlers', () => {
  beforeEach(() => {
    mocks.evaluateNavigation.mockResolvedValue(undefined);
    mocks.judgeRefusedNavigation.mockReset().mockResolvedValue(undefined);
  });

  it('judges a page Chrome refused with an extension rule, and no other failure', async () => {
    const refused = createNavigationDetails({ tabId: 5, url: 'https://blocked.com/' });

    await handleNavigationError({ ...refused, error: 'net::ERR_NAME_NOT_RESOLVED' });
    await handleNavigationError({ ...refused, error: 'net::ERR_BLOCKED_BY_CLIENT', frameId: 2 });
    expect(mocks.judgeRefusedNavigation).not.toHaveBeenCalled();

    await handleNavigationError({ ...refused, error: 'net::ERR_BLOCKED_BY_CLIENT' });
    expect(mocks.judgeRefusedNavigation).toHaveBeenCalledExactlyOnceWith(5, 'https://blocked.com/');
  });

  it('judges a starting navigation before it commits', async () => {
    await handleBeforeNavigate(
      createNavigationDetails({ tabId: 9, url: 'https://blocked.com/page' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(9, 'https://blocked.com/page', {
      beforeCommit: true,
    });
  });

  // Commits, history-state and fragment events all arrive here with the same details shape;
  // registerBackground wires each of them to this handler.
  it('judges a committed page as one the tab has shown', async () => {
    await handleNavigationChange(
      createNavigationDetails({ tabId: 6, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(6, 'https://example.com/page#blocked');
  });

  it('ignores sub-frame navigations', async () => {
    await handleBeforeNavigate(createNavigationDetails({ frameId: 1, tabId: 4 }));
    await handleNavigationChange(
      createNavigationDetails({ frameId: 3, tabId: 8, url: 'https://example.com/page#blocked' })
    );

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });
});
