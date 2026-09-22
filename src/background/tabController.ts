import {
  clearBlockedTabState,
  clearBypassState,
  clearTabSessionState,
  getBlockedPageState,
  getBlockedTabState,
  getBypassState,
  getLastAllowedUrl,
  getTabSessionState,
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
  /**
   * Bumped for every navigation event (and tab removal) so an evaluation that is still awaiting
   * storage when the tab navigates again does not redirect or record state for a page the tab has
   * already left. Losing this on worker restart is harmless: it only orders events within one
   * worker lifetime.
   */
  private readonly navigationSeq = new Map<number, number>();

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

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.forgetTab(tabId);
    });
    chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
      this.forgetTab(removedTabId);
    });

    this.queueReconcile();
  }

  /**
   * Evaluate a main-frame navigation event. It supersedes any evaluation still in flight for the
   * tab.
   */
  async evaluateNavigation(tabId: number, url: string): Promise<void> {
    await this.evaluateTab(tabId, url, this.bumpNavigationSeq(tabId));
  }

  private async evaluateTab(tabId: number, url: string, seq: number): Promise<void> {
    const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
    if (url.startsWith(blockedPageUrl)) {
      await this.reconcileBlockedTab(tabId, seq, url);
      return;
    }

    if (isInternalUrl(url)) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(url);

    if (decision.action === 'block') {
      if (await this.isBypassed(tabId, url, decision)) {
        await this.allowTab(tabId, url, seq, { preserveBypass: true });
        return;
      }

      await this.blockTab(tabId, url, seq, decision, rules.data);
      return;
    }

    await this.allowTab(tabId, url, seq);
  }

  private bumpNavigationSeq(tabId: number): number {
    const seq = this.getNavigationSeq(tabId) + 1;
    this.navigationSeq.set(tabId, seq);
    return seq;
  }

  private getNavigationSeq(tabId: number): number {
    return this.navigationSeq.get(tabId) ?? 0;
  }

  private forgetTab(tabId: number): void {
    this.bumpNavigationSeq(tabId);
    clearTabSessionState(tabId).catch((error: unknown) => {
      console.error('[Teichos] Failed to clear state for closed tab:', error);
    });
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
    // Snapshot before querying: a tab that navigates while the query is in flight reports a URL
    // it is already leaving, and its own navigation event will evaluate the new one.
    const seqBeforeQuery = new Map(this.navigationSeq);
    const tabs = await queryTabs({});
    const results = await Promise.allSettled(
      tabs.map(async (tab) => {
        if (!tab.url || typeof tab.id !== 'number') {
          return;
        }

        await this.evaluateTab(tab.id, tab.url, seqBeforeQuery.get(tab.id) ?? 0);
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
    await this.allowTab(tabId, lastAllowedUrl, this.getNavigationSeq(tabId));
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

  /**
   * An open blocked tab keeps showing the snapshot captured when the block happened; the only
   * settings-driven change is redirecting back to the target once the block ends.
   */
  private async reconcileBlockedTab(
    tabId: number,
    seq: number,
    blockedPageUrl?: string
  ): Promise<void> {
    const resolvedTarget = await this.resolveBlockedTarget(tabId, blockedPageUrl);
    if (!resolvedTarget) {
      return;
    }

    const rules = await this.getRules();
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl);
    const bypassed =
      decision.action === 'block' &&
      (await this.isBypassed(tabId, resolvedTarget.targetUrl, decision));
    if ((decision.action === 'block' && !bypassed) || !this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    await updateTabUrl(tabId, resolvedTarget.targetUrl);
    await this.allowTab(tabId, resolvedTarget.targetUrl, this.getNavigationSeq(tabId), {
      preserveBypass: bypassed,
    });
  }

  private async blockTab(
    tabId: number,
    url: string,
    seq: number,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData
  ): Promise<void> {
    if (!this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    const state = await this.ensureBlockedState(tabId, url, decision, data);
    if (!this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    await updateTabUrl(tabId, getBlockedPageUrl(state.tabState.blockId));
  }

  /**
   * Record that the tab is on an allowed page, writing only what changed: this runs for every
   * navigation and for every open tab whenever the worker wakes.
   */
  private async allowTab(
    tabId: number,
    url: string,
    seq: number,
    options?: { readonly preserveBypass?: boolean }
  ): Promise<void> {
    const session = await getTabSessionState(tabId);
    if (!this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    const operations: Promise<void>[] = [];
    if (session.blockedTabState) {
      operations.push(clearBlockedTabState(tabId));
    }
    if (session.lastAllowedUrl !== url) {
      operations.push(setLastAllowedUrl(tabId, url));
    }
    if (
      !options?.preserveBypass &&
      session.bypass &&
      session.bypass.urlKey !== getBypassUrlKey(url)
    ) {
      operations.push(clearBypassState(tabId));
    }

    await Promise.all(operations);
  }

  private isCurrentNavigation(tabId: number, seq: number): boolean {
    return this.getNavigationSeq(tabId) === seq;
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

/**
 * Key the bypass to the exact page (without the fragment) so Continue only unlocks the page the
 * user saw blocked, not every other page on the same origin. Fragment navigations re-fire
 * evaluation but stay on the same page, so the hash is stripped.
 */
function getBypassUrlKey(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    parsed.hash = '';
    return parsed.toString();
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
