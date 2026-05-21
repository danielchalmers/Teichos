import {
  addWarningBypass,
  clearBlockedTabState,
  clearWarningTabState,
  getBlockedTabState,
  getLastAllowedUrl,
  getWarningBypasses,
  getWarningTabState,
  setBlockedTabState,
  setLastAllowedUrl,
  setWarningTabState,
} from '../shared/api/session';
import { getActiveTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { PAGES } from '../shared/constants';
import {
  STORAGE_KEY,
  type BlockType,
  type BlockedTabState,
  type WarningTabState,
} from '../shared/types';
import { getUrlOriginKey, isInternalUrl, type FilterDecision } from '../shared/utils';
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
    const interstitial = parseInterstitialTarget(url);
    if (interstitial) {
      if (interstitial.blockType === 'warning') {
        await this.reconcileWarningTab(tabId, url);
        return;
      }

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

    if (decision.action === 'warning') {
      if (await this.isWarningBypassed(tabId, url, decision.filterId)) {
        await this.allowTab(tabId, url);
        return;
      }

      await this.warnTab(tabId, url, decision, rules.data.rulesVersion);
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

    if (decision.action === 'warning') {
      await this.warnTab(tabId, state.targetUrl, decision, rules.data.rulesVersion);
      return false;
    }

    await updateTabUrl(tabId, state.targetUrl);
    await this.allowTab(tabId, state.targetUrl);
    return true;
  }

  async continueWarningFromActiveTab(): Promise<{ continued: boolean; error?: string }> {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      return { continued: false, error: 'No active tab is available.' };
    }

    return this.continueWarningInTab(activeTab.id, activeTab.url);
  }

  async continueWarningInTab(
    tabId: number,
    tabUrl?: string
  ): Promise<{ continued: boolean; error?: string }> {
    const state = await this.resolveWarningTabState(tabId, tabUrl);
    if (!state) {
      return { continued: false, error: 'No warning interstitial is available.' };
    }

    await addWarningBypass(tabId, {
      filterId: state.warnedBy.filterId,
      urlKey: state.bypassKey,
    });

    try {
      await updateTabUrl(tabId, state.targetUrl);
      return { continued: true };
    } catch (error) {
      console.error('[Teichos] Failed to continue past warning:', error);
      return {
        continued: false,
        error: error instanceof Error ? error.message : 'Failed to continue to the page.',
      };
    }
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
    const interstitial = parseInterstitialTarget(url);
    if (interstitial) {
      if (interstitial.blockType === 'warning') {
        await this.reconcileWarningTab(tabId, url);
        return;
      }

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

    if (decision.action === 'warning') {
      await this.warnTab(tabId, state.targetUrl, decision, rules.data.rulesVersion);
      return;
    }

    await this.setBlockedState(tabId, state.targetUrl, decision, rules.data.rulesVersion);
  }

  private async reconcileWarningTab(tabId: number, warningPageUrl?: string): Promise<void> {
    const state = await this.resolveWarningTabState(tabId, warningPageUrl);
    if (!state) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(state.targetUrl);

    if (decision.action === 'block') {
      await this.blockTab(tabId, state.targetUrl, decision, rules.data.rulesVersion);
      return;
    }

    if (decision.action === 'allow') {
      await updateTabUrl(tabId, state.targetUrl);
      await this.allowTab(tabId, state.targetUrl);
      return;
    }

    await this.setWarningState(tabId, state.targetUrl, decision, rules.data.rulesVersion);
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

  private async warnTab(
    tabId: number,
    url: string,
    decision: Extract<FilterDecision, { action: 'warning' }>,
    rulesVersion: number
  ): Promise<void> {
    await this.setWarningState(tabId, url, decision, rulesVersion);
    const warningUrl = getInterstitialUrl(url, 'warning');
    await updateTabUrl(tabId, warningUrl);
  }

  private async allowTab(tabId: number, url: string): Promise<void> {
    await Promise.all([
      clearBlockedTabState(tabId),
      clearWarningTabState(tabId),
      setLastAllowedUrl(tabId, url),
    ]);
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

  private async setWarningState(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'warning' }>,
    rulesVersion: number
  ): Promise<void> {
    const state: WarningTabState = {
      tabId,
      targetUrl,
      warningAt: Date.now(),
      rulesVersion,
      bypassKey: getUrlOriginKey(targetUrl),
      warnedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
      },
    };

    await Promise.all([clearBlockedTabState(tabId), setWarningTabState(state)]);
  }

  private async resolveWarningTabState(
    tabId: number,
    warningPageUrl?: string
  ): Promise<WarningTabState | undefined> {
    const existingState = await getWarningTabState(tabId);
    if (existingState) {
      return existingState;
    }

    const interstitial = parseInterstitialTarget(warningPageUrl);
    if (interstitial?.blockType !== 'warning') {
      return undefined;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(interstitial.targetUrl);
    if (decision.action !== 'warning') {
      return undefined;
    }

    const state: WarningTabState = {
      tabId,
      targetUrl: interstitial.targetUrl,
      warningAt: Date.now(),
      rulesVersion: rules.data.rulesVersion,
      bypassKey: getUrlOriginKey(interstitial.targetUrl),
      warnedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
      },
    };
    await setWarningTabState(state);
    return state;
  }

  private async isWarningBypassed(tabId: number, url: string, filterId: string): Promise<boolean> {
    const bypasses = await getWarningBypasses(tabId);
    const urlKey = getUrlOriginKey(url);
    return bypasses.some((bypass) => bypass.filterId === filterId && bypass.urlKey === urlKey);
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
  return parseInterstitialTarget(tabUrl)?.targetUrl ?? null;
}

function getInterstitialUrl(targetUrl: string, blockType: BlockType): string {
  const url = new URL(getExtensionUrl(PAGES.BLOCKED));
  url.searchParams.set('url', targetUrl);
  if (blockType === 'warning') {
    url.searchParams.set('mode', 'warning');
  }
  return url.toString();
}

function parseInterstitialTarget(
  tabUrl: string | undefined
): { targetUrl: string; blockType: BlockType } | null {
  if (!tabUrl) {
    return null;
  }

  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  if (!tabUrl.startsWith(blockedPageUrl)) {
    return null;
  }

  try {
    const parsedUrl = new URL(tabUrl);
    const blockedTargetUrl = parsedUrl.searchParams.get('url');
    if (
      !blockedTargetUrl ||
      isInternalUrl(blockedTargetUrl) ||
      blockedTargetUrl.startsWith(blockedPageUrl)
    ) {
      return null;
    }

    return {
      targetUrl: blockedTargetUrl,
      blockType: parsedUrl.searchParams.get('mode') === 'warning' ? 'warning' : 'block-page',
    };
  } catch {
    return null;
  }
}

const tabController = new TabController(getRulesProvider());

export function getTabController(): TabController {
  return tabController;
}
