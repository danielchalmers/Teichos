import {
  clearBlockedTabState,
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedTabState,
  setLastAllowedUrl,
} from '../shared/api/session';
import { getActiveTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { PAGES } from '../shared/constants';
import { STORAGE_KEY, type BlockedTabState } from '../shared/types';
import { isInternalUrl, type FilterDecision } from '../shared/utils';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

class TabController {
  private didRegister = false;
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rulesProvider: RulesProvider = getRulesProvider()) {}

  register(): void {
    if (this.didRegister) {
      return;
    }

    this.didRegister = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[STORAGE_KEY]) {
        return;
      }

      this.rulesProvider.invalidate();
      this.queueReconcile();
    });

    this.queueReconcile();
  }

  async evaluateNavigation(tabId: number, url: string): Promise<void> {
    const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
    if (url.startsWith(blockedPageUrl)) {
      await this.reconcileBlockedTab(tabId, url);
      return;
    }

    if (isInternalUrl(url)) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(url);

    if (decision.action === 'block') {
      await this.blockTab(tabId, url, decision, rules.data.rulesVersion);
      return;
    }

    await this.allowTab(tabId, url);
  }

  async getUrlDecision(url: string): Promise<FilterDecision> {
    const rules = await this.getRules();
    return rules.engine.evaluate(url);
  }

  async restoreIfAllowed(tabId: number, blockedPageUrl?: string): Promise<boolean> {
    const state = await this.resolveBlockedTabState(tabId, blockedPageUrl);
    if (!state) {
      return false;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(state.targetUrl);
    if (decision.action === 'block') {
      await this.setBlockedState(tabId, state.targetUrl, decision, rules.data.rulesVersion);
      return false;
    }

    await updateTabUrl(tabId, state.targetUrl);
    await this.allowTab(tabId, state.targetUrl);
    return true;
  }

  async reconcileAllOpenTabs(): Promise<void> {
    const tabs = await queryTabs({});
    const results = await Promise.allSettled(
      tabs.map(async (tab) => {
        if (!tab.url || typeof tab.id !== 'number') {
          return;
        }

        await this.reconcileTab(tab.id, tab.url);
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[Teichos] Failed to reconcile tab:', result.reason);
      }
    }
  }

  async goBackFromActiveTab(): Promise<boolean> {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      return false;
    }

    const lastAllowedUrl = await getLastAllowedUrl(activeTab.id);
    if (!lastAllowedUrl || isInternalUrl(lastAllowedUrl)) {
      return false;
    }

    const decision = await this.getUrlDecision(lastAllowedUrl);
    if (decision.action === 'block') {
      return false;
    }

    await updateTabUrl(activeTab.id, lastAllowedUrl);
    await this.allowTab(activeTab.id, lastAllowedUrl);
    return true;
  }

  private async reconcileTab(tabId: number, url: string): Promise<void> {
    const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
    if (url.startsWith(blockedPageUrl)) {
      await this.reconcileBlockedTab(tabId, url);
      return;
    }

    if (isInternalUrl(url)) {
      return;
    }

    await this.evaluateNavigation(tabId, url);
  }

  private async reconcileBlockedTab(tabId: number, blockedPageUrl?: string): Promise<void> {
    const state = await this.resolveBlockedTabState(tabId, blockedPageUrl);
    if (!state) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(state.targetUrl);

    if (decision.action === 'allow') {
      await updateTabUrl(tabId, state.targetUrl);
      await this.allowTab(tabId, state.targetUrl);
      return;
    }

    await this.setBlockedState(tabId, state.targetUrl, decision, rules.data.rulesVersion);
  }

  private async blockTab(
    tabId: number,
    url: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    rulesVersion: number
  ): Promise<void> {
    await this.setBlockedState(tabId, url, decision, rulesVersion);
    const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(url)}`;
    await updateTabUrl(tabId, blockedUrl);
  }

  private async allowTab(tabId: number, url: string): Promise<void> {
    await Promise.all([clearBlockedTabState(tabId), setLastAllowedUrl(tabId, url)]);
  }

  private async setBlockedState(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    rulesVersion: number
  ): Promise<void> {
    const state: BlockedTabState = {
      tabId,
      targetUrl,
      blockedAt: Date.now(),
      rulesVersion,
      blockedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
      },
    };

    await setBlockedTabState(state);
  }

  private async resolveBlockedTabState(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<BlockedTabState | undefined> {
    const existingState = await getBlockedTabState(tabId);
    if (existingState) {
      return existingState;
    }

    const fallbackTargetUrl = parseBlockedTargetUrl(blockedPageUrl);
    if (!fallbackTargetUrl) {
      return undefined;
    }

    // Migration path for blocked tabs that were created before blocked-tab
    // session state started being recorded.
    const rules = await this.getRules();
    const decision = rules.engine.evaluate(fallbackTargetUrl);
    if (decision.action !== 'block') {
      return undefined;
    }

    const state: BlockedTabState = {
      tabId,
      targetUrl: fallbackTargetUrl,
      blockedAt: Date.now(),
      rulesVersion: rules.data.rulesVersion,
      blockedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
      },
    };
    await setBlockedTabState(state);
    return state;
  }

  private queueReconcile(): void {
    this.reconcileQueue = this.reconcileQueue
      .then(async () => {
        await this.getRules();
        await this.reconcileAllOpenTabs();
      })
      .catch((error: unknown) => {
        console.error('[Teichos] Failed to reconcile tabs after rules change:', error);
      });
  }

  private async getRules(): Promise<CurrentRules> {
    return this.rulesProvider.loadCurrentRules();
  }
}

function parseBlockedTargetUrl(tabUrl: string | undefined): string | null {
  if (!tabUrl) {
    return null;
  }

  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  if (!tabUrl.startsWith(blockedPageUrl)) {
    return null;
  }

  try {
    const blockedTargetUrl = new URL(tabUrl).searchParams.get('url');
    if (
      !blockedTargetUrl ||
      isInternalUrl(blockedTargetUrl) ||
      blockedTargetUrl.startsWith(blockedPageUrl)
    ) {
      return null;
    }

    return blockedTargetUrl;
  } catch {
    return null;
  }
}

const tabController = new TabController();

export function getTabController(): TabController {
  return tabController;
}
