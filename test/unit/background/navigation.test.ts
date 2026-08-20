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

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(5, 'https://example.com/blocked-route');
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

function createCommittedDetails(
  overrides: Partial<chrome.webNavigation.WebNavigationTransitionCallbackDetails>
): chrome.webNavigation.WebNavigationTransitionCallbackDetails {
  return {
    ...createNavigationDetails({}),
    documentId: 'doc-1',
    transitionType: 'link',
    transitionQualifiers: [],
    ...overrides,
  };
}

describe('handleNavigationCommitted', () => {
  beforeEach(() => {
    mocks.evaluateNavigation.mockReset();
    mocks.evaluateNavigation.mockResolvedValue(undefined);
  });

  it.each(['server_redirect', 'client_redirect'] as const)(
    'evaluates the committed url after a %s',
    async (qualifier) => {
      // onBeforeNavigate only saw the url the browser first requested, never this one.
      await handleNavigationCommitted(
        createCommittedDetails({
          tabId: 7,
          url: 'https://redirect-target.example/final',
          transitionQualifiers: [qualifier],
        })
      );

      expect(mocks.evaluateNavigation).toHaveBeenCalledWith(
        7,
        'https://redirect-target.example/final'
      );
    }
  );

  it('evaluates the final url of a chain that also carries other qualifiers', async () => {
    await handleNavigationCommitted(
      createCommittedDetails({
        tabId: 2,
        url: 'https://final.example/page',
        transitionQualifiers: ['from_address_bar', 'server_redirect'],
      })
    );

    expect(mocks.evaluateNavigation).toHaveBeenCalledWith(2, 'https://final.example/page');
  });

  it('ignores a commit that was not redirected, since onBeforeNavigate saw the same url', async () => {
    await handleNavigationCommitted(
      createCommittedDetails({ url: 'https://example.com/plain', transitionQualifiers: [] })
    );

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });

  it('ignores sub-frame commits', async () => {
    await handleNavigationCommitted(
      createCommittedDetails({
        frameId: 3,
        url: 'https://framed.example/final',
        transitionQualifiers: ['server_redirect'],
      })
    );

    expect(mocks.evaluateNavigation).not.toHaveBeenCalled();
  });
});
