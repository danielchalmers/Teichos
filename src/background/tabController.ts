import {
  clearBlockedTabState,
  clearBlockedPageState,
  getBlockedPageState,
  getBlockedTabState,
  getLastAllowedUrl,
  setBlockedPageState,
  setBlockedTabState,
  setLastAllowedUrl,
} from '../shared/api/session';
import { getActiveTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { PAGES } from '../shared/constants';
import {
  STORAGE_KEY,
  type BlockedPageState,
  type BlockedTabState,
  type Filter,
  type GetBlockedPageStateResponse,
  type StorageData,
} from '../shared/types';
import { isInternalUrl, type FilterDecision } from '../shared/utils';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

interface ResolvedBlockedTarget {
  readonly targetUrl: string;
  readonly blockId?: string;
  readonly hasSessionState: boolean;
}

interface BlockedStateResult {
  readonly tabState: BlockedTabState;
  readonly pageState: BlockedPageState;
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
      await this.blockTab(tabId, url, decision, rules);
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
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl);
    if (decision.action === 'block') {
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

    const state = await this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl);
    return state?.tabState;
  }

  async getFreshBlockedPageState(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<GetBlockedPageStateResponse> {
    const blockId = parseBlockedPageBlockId(blockedPageUrl);
    if (blockId) {
      return this.getBlockedPageStateByBlockId(blockId);
    }

    if (!Number.isInteger(tabId)) {
      return { status: 'unavailable' };
    }

    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return { status: 'unavailable' };
    }

    const state = await this.refreshBlockedTabState(tabId, resolvedTarget.targetUrl);
    if (state) {
      return { status: 'blocked', state: state.pageState };
    }

    return { status: 'allowed', targetUrl: resolvedTarget.targetUrl };
  }

  async getBlockedPageStateByBlockId(
    blockId: string | undefined
  ): Promise<GetBlockedPageStateResponse> {
    if (!blockId) {
      return { status: 'unavailable' };
    }

    const pageState = await getBlockedPageState(blockId);
    if (!pageState) {
      return { status: 'unavailable' };
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(pageState.targetUrl);
    if (decision.action !== 'block') {
      await this.allowTab(pageState.tabId, pageState.targetUrl);
      return { status: 'allowed', targetUrl: pageState.targetUrl };
    }

    return { status: 'blocked', state: pageState };
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
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl);
    if (decision.action !== 'block') {
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
    rules: CurrentRules
  ): Promise<void> {
    const state = await this.setBlockedState(tabId, url, decision, rules.data);
    const blockedUrl = `${getExtensionUrl(PAGES.BLOCKED)}?blockId=${encodeURIComponent(state.tabState.blockId)}`;
    await updateTabUrl(tabId, blockedUrl);
  }

  private async allowTab(tabId: number, url: string): Promise<void> {
    await Promise.all([clearBlockedTabState(tabId), setLastAllowedUrl(tabId, url)]);
  }

  private async setBlockedState(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData
  ): Promise<BlockedStateResult> {
    const existingState = await getBlockedTabState(tabId);
    if (existingState) {
      await clearBlockedPageState(existingState.blockId);
    }

    const blockId = createBlockId();
    const tabState: BlockedTabState = {
      blockId,
      tabId,
      targetUrl,
      blockedAt: Date.now(),
      rulesVersion: data.rulesVersion,
      blockedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
      },
    };
    const filter = data.filters.find((entry) => entry.id === decision.filterId);
    const pageState: BlockedPageState = {
      ...tabState,
      filter: createFilterSnapshot(filter, decision.filterId),
      group: data.groups.find((entry) => entry.id === decision.groupId),
    };

    await Promise.all([setBlockedTabState(tabState), setBlockedPageState(pageState)]);
    return { tabState, pageState };
  }

  private async resolveBlockedTarget(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<ResolvedBlockedTarget | undefined> {
    const existingState = await getBlockedTabState(tabId);
    const blockId = parseBlockedPageBlockId(blockedPageUrl);
    if (blockId) {
      const pageState = await getBlockedPageState(blockId);
      if (!pageState) {
        return undefined;
      }

      return {
        targetUrl: pageState.targetUrl,
        blockId,
        hasSessionState: true,
      };
    }

    return existingState
      ? {
          targetUrl: existingState.targetUrl,
          blockId: existingState.blockId,
          hasSessionState: true,
        }
      : undefined;
  }

  private async refreshBlockedTabState(
    tabId: number,
    targetUrl: string,
    currentRules?: CurrentRules
  ): Promise<BlockedStateResult | undefined> {
    const rules = currentRules ?? (await this.getRules());
    const decision = rules.engine.evaluate(targetUrl);
    if (decision.action !== 'block') {
      await clearBlockedTabState(tabId);
      return undefined;
    }

    return this.setBlockedState(tabId, targetUrl, decision, rules.data);
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

function parseBlockedPageBlockId(tabUrl: string | undefined): string | null {
  if (!tabUrl) {
    return null;
  }

  const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
  if (!tabUrl.startsWith(blockedPageUrl)) {
    return null;
  }

  try {
    return new URL(tabUrl).searchParams.get('blockId');
  } catch {
    return null;
  }
}

function createBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function createFilterSnapshot(
  filter: Filter | undefined,
  fallbackFilterId: string
): BlockedPageState['filter'] {
  return {
    id: filter?.id ?? fallbackFilterId,
    pattern: filter?.pattern ?? fallbackFilterId,
    matchMode: filter?.matchMode ?? 'contains',
    ...(filter?.description ? { description: filter.description } : {}),
  };
}

const tabController = new TabController(getRulesProvider());

export function getTabController(): TabController {
  return tabController;
}
