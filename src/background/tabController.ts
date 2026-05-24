import {
  addWarningBypass,
  clearBlockedTabState,
  getBlockedTabState,
  getWarningBypasses,
  getLastAllowedUrl,
  setBlockedTabState,
  setLastAllowedUrl,
} from '../shared/api/session';
import { getActiveTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { PAGES } from '../shared/constants';
import { STORAGE_KEY, type BlockedTabState } from '../shared/types';
import { getWarningBypassScopeKey, isInternalUrl, type FilterDecision } from '../shared/utils';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

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
    const decision = await this.getTabUrlDecision(tabId, url, rules);

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
    const targetUrl = await this.resolveBlockedTargetUrl(tabId, blockedPageUrl);
    if (!targetUrl) {
      return false;
    }

    const rules = await this.getRules();
    const decision = await this.getTabUrlDecision(tabId, targetUrl, rules);
    if (decision.action === 'block') {
      await this.setBlockedState(tabId, targetUrl, decision, rules.data.rulesVersion);
      return false;
    }

    await updateTabUrl(tabId, targetUrl);
    await this.allowTab(tabId, targetUrl);
    return true;
  }

  async getBlockedStateFromTab(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<BlockedTabState | undefined> {
    if (!Number.isInteger(tabId)) {
      return undefined;
    }

    return this.resolveBlockedTabState(tabId, blockedPageUrl);
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

    return this.goBackFromTab(activeTab.id);
  }

  async goBackFromTab(tabId: number): Promise<boolean> {
    if (!Number.isInteger(tabId)) {
      return false;
    }

    const lastAllowedUrl = await getLastAllowedUrl(tabId);
    if (!lastAllowedUrl || isInternalUrl(lastAllowedUrl)) {
      return false;
    }

    const rules = await this.getRules();
    const decision = await this.getTabUrlDecision(tabId, lastAllowedUrl, rules);
    if (decision.action === 'block') {
      return false;
    }

    await updateTabUrl(tabId, lastAllowedUrl);
    await this.allowTab(tabId, lastAllowedUrl);
    return true;
  }

  async continueWarningFromActiveTab(): Promise<boolean> {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      return false;
    }

    return this.continueWarningFromTab(activeTab.id, activeTab.url);
  }

  async continueWarningFromTab(tabId: number, tabUrl?: string): Promise<boolean> {
    if (!Number.isInteger(tabId)) {
      return false;
    }

    const targetUrl = await this.resolveBlockedTargetUrl(tabId, tabUrl);
    if (!targetUrl) {
      return false;
    }

    const rules = await this.getRules();
    const decision = await this.getTabUrlDecision(tabId, targetUrl, rules);
    if (decision.action !== 'block') {
      await updateTabUrl(tabId, targetUrl);
      await this.allowTab(tabId, targetUrl);
      return true;
    }

    if (decision.blockType !== 'warning') {
      await this.setBlockedState(tabId, targetUrl, decision, rules.data.rulesVersion);
      return false;
    }

    await addWarningBypass(tabId, {
      filterId: decision.filterId,
      scopeKey: getWarningBypassScopeKey(targetUrl),
    });
    await updateTabUrl(tabId, targetUrl);
    await this.allowTab(tabId, targetUrl);
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
    const existingState = await getBlockedTabState(tabId);
    const targetUrl = await this.resolveBlockedTargetUrl(tabId, blockedPageUrl);
    if (!targetUrl) {
      return;
    }

    const rules = await this.getRules();
    const decision = await this.getTabUrlDecision(tabId, targetUrl, rules);

    if (!existingState && decision.action === 'allow') {
      return;
    }

    if (decision.action === 'allow') {
      await updateTabUrl(tabId, targetUrl);
      await this.allowTab(tabId, targetUrl);
      return;
    }

    await this.setBlockedState(tabId, targetUrl, decision, rules.data.rulesVersion);
    const nextBlockedPageUrl = getBlockedPageUrl(targetUrl, decision.blockType);
    if (blockedPageUrl && blockedPageUrl !== nextBlockedPageUrl) {
      await updateTabUrl(tabId, nextBlockedPageUrl);
    }
  }

  private async blockTab(
    tabId: number,
    url: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    rulesVersion: number
  ): Promise<void> {
    await this.setBlockedState(tabId, url, decision, rulesVersion);
    await updateTabUrl(tabId, getBlockedPageUrl(url, decision.blockType));
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
      blockType: decision.blockType,
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
    const fallbackTargetUrl = parseBlockedTargetUrl(blockedPageUrl);
    const targetUrl = fallbackTargetUrl ?? existingState?.targetUrl;
    if (!targetUrl) {
      if (existingState) {
        await clearBlockedTabState(tabId);
      }
      return undefined;
    }

    const rules = await this.getRules();
    const shouldRefreshState =
      existingState?.targetUrl !== targetUrl ||
      existingState?.rulesVersion !== rules.data.rulesVersion;

    if (!shouldRefreshState) {
      return existingState;
    }

    // Migration path for blocked tabs that were created before blocked-tab
    // session state started being recorded, plus refresh for stale blocked
    // interstitial state after rules changes.
    const decision = await this.getTabUrlDecision(tabId, targetUrl, rules);
    if (decision.action !== 'block') {
      if (existingState) {
        await clearBlockedTabState(tabId);
      }
      return undefined;
    }

    const state = createBlockedTabState(
      tabId,
      targetUrl,
      decision,
      rules.data.rulesVersion,
      existingState?.blockedAt
    );
    await setBlockedTabState(state);
    return state;
  }

  private async resolveBlockedTargetUrl(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<string | undefined> {
    const existingState = await getBlockedTabState(tabId);
    return parseBlockedTargetUrl(blockedPageUrl) ?? existingState?.targetUrl;
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

  private async getTabUrlDecision(
    tabId: number,
    url: string,
    rules: CurrentRules
  ): Promise<FilterDecision> {
    const warningBypasses = await getWarningBypasses(tabId);
    return rules.engine.evaluate(url, undefined, warningBypasses);
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

function getBlockedPageUrl(
  targetUrl: string,
  mode: Extract<FilterDecision, { action: 'block' }>['blockType']
): string {
  return `${getExtensionUrl(PAGES.BLOCKED)}?url=${encodeURIComponent(targetUrl)}&mode=${mode}`;
}

function createBlockedTabState(
  tabId: number,
  targetUrl: string,
  decision: Extract<FilterDecision, { action: 'block' }>,
  rulesVersion: number,
  blockedAt = Date.now()
): BlockedTabState {
  return {
    tabId,
    targetUrl,
    blockType: decision.blockType,
    blockedAt,
    rulesVersion,
    blockedBy: {
      filterId: decision.filterId,
      groupId: decision.groupId,
    },
  };
}

const tabController = new TabController(getRulesProvider());

export function getTabController(): TabController {
  return tabController;
}
