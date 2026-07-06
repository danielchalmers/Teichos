import {
  clearBlockedTabState,
  clearBypassState,
  getBlockedPageState,
  getBlockedTabState,
  getBypassState,
  getLastAllowedUrl,
  setBlockedPageState,
  setBlockedTabState,
  setBypassState,
  setLastAllowedUrl,
} from '../shared/api/session';
import { getActiveTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { PAGES } from '../shared/constants';
import type { FilterDecision } from '../shared/filtering/engine';
import {
  type BlockedPageState,
  STORAGE_KEY,
  type BlockedTabState,
  type Filter,
  type GetBlockedPageStateResponse,
  type StorageData,
} from '../shared/types';
import { isInternalUrl } from '../shared/utils/helpers';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

interface ResolvedBlockedTarget {
  readonly targetUrl: string;
  readonly tabId?: number;
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
      if (await this.isBypassed(tabId, url, decision)) {
        await this.allowTab(tabId, url, { preserveBypass: true });
        return;
      }

      await this.blockTab(tabId, url, decision, rules.data);
      return;
    }

    await this.allowTab(tabId, url);
  }

  async getUrlDecision(url: string): Promise<FilterDecision> {
    const rules = await this.getRules();
    return rules.engine.evaluate(url);
  }

  /**
   * Look up the snapshot captured when the tab was blocked. The snapshot is intentionally never
   * re-evaluated against current settings; if the block ends, reconciliation redirects the tab.
   */
  async getBlockedPageStateForTab(
    tabId: number,
    blockedPageUrl?: string
  ): Promise<GetBlockedPageStateResponse> {
    const blockId = parseBlockedPageBlockId(blockedPageUrl);
    const stateByBlockId = blockId ? await getBlockedPageState(blockId) : undefined;
    if (stateByBlockId) {
      return { status: 'blocked', state: stateByBlockId };
    }

    if (!Number.isInteger(tabId)) {
      return { status: 'unavailable' };
    }

    const tabState = await getBlockedTabState(tabId);
    const pageState = tabState ? await getBlockedPageState(tabState.blockId) : undefined;
    return pageState ? { status: 'blocked', state: pageState } : { status: 'unavailable' };
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

    return this.goBackFromTab(activeTab.id);
  }

  async goBackFromTab(tabId: number): Promise<boolean> {
    const lastAllowedUrl = await getLastAllowedUrl(tabId);
    if (!lastAllowedUrl || isInternalUrl(lastAllowedUrl)) {
      return false;
    }

    const decision = await this.getUrlDecision(lastAllowedUrl);
    if (decision.action === 'block') {
      return false;
    }

    await updateTabUrl(tabId, lastAllowedUrl);
    await this.allowTab(tabId, lastAllowedUrl);
    return true;
  }

  async continueFromActiveTab(): Promise<boolean> {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      return false;
    }

    return this.continueFromTab(activeTab.id, activeTab.url);
  }

  async continueFromBlockedPage(blockId: string): Promise<boolean> {
    const pageState = await getBlockedPageState(blockId);
    if (!pageState) {
      return false;
    }

    return this.continueFromTab(pageState.tabId, undefined, blockId);
  }

  async continueFromTab(
    tabId: number,
    blockedPageUrl?: string,
    blockId?: string
  ): Promise<boolean> {
    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl, blockId);
    if (!resolvedTarget) {
      return false;
    }

    const targetTabId = resolvedTarget.tabId ?? tabId;
    const rules = await this.getRules();
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl);
    if (decision.action !== 'block') {
      return false;
    }

    await Promise.all([
      setBypassState(targetTabId, {
        filterId: decision.filterId,
        urlKey: getBypassUrlKey(resolvedTarget.targetUrl),
      }),
      clearBlockedTabState(targetTabId),
      setLastAllowedUrl(targetTabId, resolvedTarget.targetUrl),
    ]);
    await updateTabUrl(targetTabId, resolvedTarget.targetUrl);
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

  /**
   * An open blocked tab keeps showing the snapshot captured when the block happened; the only
   * settings-driven change is redirecting back to the target once the block ends.
   */
  private async reconcileBlockedTab(tabId: number, blockedPageUrl?: string): Promise<void> {
    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl);
    const bypassed =
      decision.action === 'block' &&
      (await this.isBypassed(tabId, resolvedTarget.targetUrl, decision));
    if (decision.action === 'block' && !bypassed) {
      return;
    }

    await updateTabUrl(tabId, resolvedTarget.targetUrl);
    await this.allowTab(tabId, resolvedTarget.targetUrl, { preserveBypass: bypassed });
  }

  private async blockTab(
    tabId: number,
    url: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData
  ): Promise<void> {
    const state = await this.ensureBlockedState(tabId, url, decision, data);
    await updateTabUrl(tabId, getBlockedPageUrl(state.tabState.blockId));
  }

  private async allowTab(
    tabId: number,
    url: string,
    options?: { readonly preserveBypass?: boolean }
  ): Promise<void> {
    const operations: Promise<void>[] = [
      clearBlockedTabState(tabId),
      setLastAllowedUrl(tabId, url),
    ];

    if (!options?.preserveBypass) {
      const bypass = await getBypassState(tabId);
      if (bypass && bypass.urlKey !== getBypassUrlKey(url)) {
        operations.push(clearBypassState(tabId));
      }
    }

    await Promise.all(operations);
  }

  private async setBlockedState(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData
  ): Promise<BlockedStateResult> {
    const blockId = createBlockId();
    const tabState: BlockedTabState = {
      blockId,
      tabId,
      targetUrl,
      blockedAt: Date.now(),
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
      effectiveState: {
        filterEnabled: filter?.enabled ?? true,
        groupActive: true,
        snoozeActive: false,
      },
    };

    await Promise.all([setBlockedTabState(tabState), setBlockedPageState(pageState)]);
    return { tabState, pageState };
  }

  private async resolveBlockedTarget(
    tabId: number,
    blockedPageUrl?: string,
    explicitBlockId?: string
  ): Promise<ResolvedBlockedTarget | undefined> {
    const existingState = await getBlockedTabState(tabId);
    const blockId = explicitBlockId ?? parseBlockedPageBlockId(blockedPageUrl);
    if (blockId) {
      const pageState = await getBlockedPageState(blockId);
      if (pageState) {
        return {
          targetUrl: pageState.targetUrl,
          tabId: pageState.tabId,
        };
      }
    }

    return existingState
      ? {
          targetUrl: existingState.targetUrl,
          tabId: existingState.tabId,
        }
      : undefined;
  }

  /**
   * Reuse the existing block for repeat navigations to the same target (e.g. the browser back
   * button re-committing the blocked URL) so the tab returns to the same blocked page and keeps
   * the snapshot from the original block instead of filtering again.
   */
  private async ensureBlockedState(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData
  ): Promise<BlockedStateResult> {
    const existingState = await getBlockedTabState(tabId);
    if (existingState?.targetUrl === targetUrl) {
      const pageState = await getBlockedPageState(existingState.blockId);
      if (pageState) {
        return { tabState: existingState, pageState };
      }
    }

    return this.setBlockedState(tabId, targetUrl, decision, data);
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

  private async isBypassed(
    tabId: number,
    targetUrl: string,
    decision: Extract<FilterDecision, { action: 'block' }>
  ): Promise<boolean> {
    const bypass = await getBypassState(tabId);
    return bypass?.filterId === decision.filterId && bypass.urlKey === getBypassUrlKey(targetUrl);
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
    const blockId = new URL(tabUrl).searchParams.get('blockId');
    return blockId?.trim() ? blockId : null;
  } catch {
    return null;
  }
}

function getBlockedPageUrl(blockId: string): string {
  const url = new URL(getExtensionUrl(PAGES.BLOCKED));
  url.searchParams.set('blockId', blockId);
  return url.toString();
}

function createBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function getBypassUrlKey(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    return parsed.origin !== 'null' ? parsed.origin : targetUrl;
  } catch {
    return targetUrl;
  }
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
