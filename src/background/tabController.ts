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
import {
  STORAGE_KEY,
  type BlockedTabState,
  type GetBlockedPageStateResponse,
} from '../shared/types';
import { isInternalUrl, type FilterDecision } from '../shared/utils';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

interface ResolvedBlockedTarget {
  readonly targetUrl: string;
  readonly hasSessionState: boolean;
}

class TabController {
  private didRegister = false;
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rulesProvider: RulesProvider) {}

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
    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return false;
    }

    const rules = await this.getRules();
    const state = await this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl, rules);
    if (state) {
      return false;
    }

    await updateTabUrl(tabId, resolvedTarget.targetUrl);
    await this.allowTab(tabId, resolvedTarget.targetUrl);
    return true;
  }

  async getFreshBlockedTabState(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<BlockedTabState | undefined> {
    if (!Number.isInteger(tabId)) {
      return undefined;
    }

    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return undefined;
    }

    return this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl);
  }

  async getFreshBlockedPageState(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<GetBlockedPageStateResponse> {
    if (!Number.isInteger(tabId)) {
      return { status: 'unavailable' };
    }

    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return { status: 'unavailable' };
    }

    const state = await this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl);
    if (state) {
      return { status: 'blocked', state };
    }

    return { status: 'allowed', targetUrl: resolvedTarget.targetUrl };
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
    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return;
    }

    const rules = await this.getRules();
    const state = await this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl, rules);
    if (!state) {
      if (resolvedTarget.hasSessionState) {
        await updateTabUrl(tabId, resolvedTarget.targetUrl);
        await this.allowTab(tabId, resolvedTarget.targetUrl);
      }
      return;
    }
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
  ): Promise<BlockedTabState> {
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
    return state;
  }

  private async resolveBlockedTarget(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<ResolvedBlockedTarget | undefined> {
    const existingState = await getBlockedTabState(tabId);
    const fallbackTargetUrl = parseBlockedTargetUrl(blockedPageUrl);
    if (fallbackTargetUrl) {
      return {
        targetUrl: fallbackTargetUrl,
        hasSessionState: Boolean(existingState),
      };
    }

    return existingState
      ? { targetUrl: existingState.targetUrl, hasSessionState: true }
      : undefined;
  }

  private async refreshBlockedTabState(
    tabId: number,
    targetUrl: string,
    currentRules?: CurrentRules
  ): Promise<BlockedTabState | undefined> {
    const rules = currentRules ?? (await this.getRules());
    const decision = rules.engine.evaluate(targetUrl);
    if (decision.action !== 'block') {
      await clearBlockedTabState(tabId);
      return undefined;
    }

    return this.setBlockedState(tabId, targetUrl, decision, rules.data.rulesVersion);
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

const tabController = new TabController(getRulesProvider());

export function getTabController(): TabController {
  return tabController;
}
