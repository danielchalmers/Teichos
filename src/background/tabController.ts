import {
  clearBlockedTabState,
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
import { getActiveTab, goBackTab, queryTabs, updateTabUrl } from '../shared/api/tabs';
import { getExtensionUrl } from '../shared/api/runtime';
import { ALARMS, PAGES } from '../shared/constants';
import type { FilterDecision } from '../shared/filtering/engine';
import { getNextRulesChangeAt, isTemporaryFilter } from '../shared/filtering/schedules';
import {
  type BlockedPageState,
  type BlockedTabState,
  type Filter,
  type GetBlockedPageStateResponse,
  type StorageData,
} from '../shared/types';
import { isInternalUrl } from '../shared/utils/helpers';
import { hasSettingsChange } from '../shared/storage/syncLayout';
import { getRulesProvider, type CurrentRules, type RulesProvider } from './rulesProvider';

interface ResolvedBlockedTarget {
  readonly targetUrl: string;
  readonly tabId?: number;
  /** Every filter the block page names, the responsible one first. */
  readonly filterIds: readonly string[];
}

interface BlockedStateResult {
  readonly tabState: BlockedTabState;
  readonly pageState: BlockedPageState;
}

/**
 * When a navigation event fired. A navigation is judged before it commits, to block it as early
 * as possible, and again when it commits, which is the first time some URLs are seen: the
 * destination of a server redirect, or a page Chrome restores from history without a
 * before-navigate event (extension pages such as the block page). Only a committed page is one
 * the tab has actually shown, so only that is recorded as the page to return to.
 */
interface NavigationTiming {
  readonly beforeCommit?: boolean;
}

/** A history step Go back took, waiting for the navigation event of the entry it lands on. */
interface GoBackStep {
  readonly expiresAt: number;
  /** Whether this step is the second one, taken to pass a blocked entry the first landed on. */
  readonly passedBlockedEntry: boolean;
}

// Land just inside the minute a schedule window opens or closes, since windows are compared by
// wall-clock minute and an alarm can fire at the exact boundary.
const RULES_CHANGE_SLACK_MS = 1000;

// A Go back step's navigation event arrives within moments; the limit only keeps a step whose
// event never came from applying to a later, unrelated navigation.
const GO_BACK_STEP_TTL_MS = 3000;

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
  /**
   * The history step Go back just took in each tab. The next navigation event takes it, so the
   * entry the step lands on can be checked against where Go back means to go. Losing it on worker
   * restart only means that step shows whatever block page the entry gets.
   */
  private readonly goBackSteps = new Map<number, GoBackStep>();
  /**
   * The before-navigate judgment of each tab's latest navigation. Its commit gets the same
   * decision, so it waits for that judgment instead of superseding it, which would drop a Go back
   * step the judgment holds. Losing it on worker restart only means the commit is judged in full.
   */
  private readonly startedNavigations = new Map<
    number,
    { readonly url: string; readonly judged: Promise<void> }
  >();

  constructor(private readonly rulesProvider: RulesProvider) {}

  register(): void {
    if (this.didRegister) {
      return;
    }

    this.didRegister = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !hasSettingsChange(changes)) {
        return;
      }

      this.rulesProvider.invalidate();
      this.queueReconcile();
    });

    // Schedule windows and temporary filters change decisions without any settings write, so an
    // alarm at the next boundary re-checks open tabs the same way a settings change does.
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARMS.RULES_CHANGE) {
        this.queueReconcile();
      }
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
  async evaluateNavigation(
    tabId: number,
    url: string,
    timing: NavigationTiming = {}
  ): Promise<void> {
    const started = this.startedNavigations.get(tabId);
    if (!timing.beforeCommit && started?.url === url) {
      this.startedNavigations.delete(tabId);
      await this.recordCommitOfJudgedStart(tabId, url, started.judged);
      return;
    }

    const goBackStep = this.takeGoBackStep(tabId);
    const evaluation = this.evaluateTab(
      tabId,
      url,
      this.bumpNavigationSeq(tabId),
      goBackStep,
      timing
    );
    if (timing.beforeCommit) {
      this.startedNavigations.set(tabId, { url, judged: evaluation.catch(() => undefined) });
    } else {
      this.startedNavigations.delete(tabId);
    }
    await evaluation;
  }

  /**
   * A navigation committed to the URL its start was judged on. Blocking, and any Go back step,
   * were handled there; all that is left is recording an allowed page as the one to return to.
   */
  private async recordCommitOfJudgedStart(
    tabId: number,
    url: string,
    judged: Promise<void>
  ): Promise<void> {
    await judged;
    if (url.startsWith(getExtensionUrl(PAGES.BLOCKED)) || isInternalUrl(url)) {
      return;
    }

    const seq = this.getNavigationSeq(tabId);
    const decision = await this.evaluateForTab(tabId, url, await this.getRules());
    if (decision.action !== 'block') {
      await this.allowTab(tabId, url, seq);
    }
  }

  private async evaluateTab(
    tabId: number,
    url: string,
    seq: number,
    goBackStep?: GoBackStep,
    timing: NavigationTiming = {}
  ): Promise<void> {
    if (await this.leaveReplacedEntryLanding(tabId, url, seq, goBackStep)) {
      return;
    }

    const blockedPageUrl = getExtensionUrl(PAGES.BLOCKED);
    if (url.startsWith(blockedPageUrl)) {
      await this.reconcileBlockedTab(tabId, seq, url);
      return;
    }

    if (isInternalUrl(url)) {
      return;
    }

    const rules = await this.getRules();
    const decision = await this.evaluateForTab(tabId, url, rules);

    if (decision.action === 'block') {
      await this.blockTab(tabId, url, seq, decision, rules.data, goBackStep);
      return;
    }

    // An allowed URL may still redirect somewhere blocked, or never commit at all (a download), so
    // it becomes the page to return to only once it commits.
    if (!timing.beforeCommit) {
      await this.allowTab(tabId, url, seq);
    }
  }

  /**
   * Passing a blocked entry normally lands on the page the tab came from. Anywhere else, the
   * blocked entry had replaced that page (history.replaceState), so open it instead.
   */
  private async leaveReplacedEntryLanding(
    tabId: number,
    url: string,
    seq: number,
    goBackStep: GoBackStep | undefined
  ): Promise<boolean> {
    if (!goBackStep?.passedBlockedEntry || url === (await getLastAllowedUrl(tabId))) {
      return false;
    }

    return this.openReturnUrlInstead(tabId, seq);
  }

  private takeGoBackStep(tabId: number): GoBackStep | undefined {
    const step = this.goBackSteps.get(tabId);
    this.goBackSteps.delete(tabId);
    return step && Date.now() <= step.expiresAt ? step : undefined;
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
    this.goBackSteps.delete(tabId);
    this.startedNavigations.delete(tabId);
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

  /**
   * Step the tab back in its history, so Forward returns to the block page. The step does not
   * depend on a recorded last allowed page: a tab that came from the New Tab page or another
   * browser page has none, and an entry that is blocked now is stepped past where it lands. Only
   * a tab with no earlier entry opens the last allowed page instead.
   */
  async goBackFromTab(tabId: number): Promise<boolean> {
    if (await this.stepBack(tabId, false)) {
      return true;
    }

    const returnUrl = await this.getReturnUrl(tabId);
    if (!returnUrl) {
      return false;
    }

    await this.openReturnUrl(tabId, returnUrl);
    return true;
  }

  /** Step the tab back one history entry, or report that it has no earlier entry. */
  private async stepBack(tabId: number, passedBlockedEntry: boolean): Promise<boolean> {
    // Recorded first: the step's navigation event can arrive before goBack calls back.
    this.goBackSteps.set(tabId, {
      expiresAt: Date.now() + GO_BACK_STEP_TTL_MS,
      passedBlockedEntry,
    });
    try {
      await goBackTab(tabId);
      return true;
    } catch {
      this.goBackSteps.delete(tabId);
      return false;
    }
  }

  /** The last allowed page in the tab, while it is still allowed and not a browser page. */
  private async getReturnUrl(tabId: number): Promise<string | undefined> {
    const lastAllowedUrl = await getLastAllowedUrl(tabId);
    if (!lastAllowedUrl || isInternalUrl(lastAllowedUrl)) {
      return undefined;
    }

    // A page the tab continued past is still somewhere to go back to.
    const decision = await this.evaluateForTab(tabId, lastAllowedUrl, await this.getRules());
    return decision.action === 'block' ? undefined : lastAllowedUrl;
  }

  private async openReturnUrl(tabId: number, returnUrl: string): Promise<void> {
    await updateTabUrl(tabId, returnUrl);
    await this.allowTab(tabId, returnUrl, this.getNavigationSeq(tabId));
  }

  /** Open the return page in place of the navigation `seq`, if there still is one. */
  private async openReturnUrlInstead(tabId: number, seq: number): Promise<boolean> {
    const returnUrl = await this.getReturnUrl(tabId);
    if (!returnUrl || !this.isCurrentNavigation(tabId, seq)) {
      return false;
    }

    await this.openReturnUrl(tabId, returnUrl);
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
    const [rules, bypass] = await Promise.all([this.getRules(), getBypassState(targetTabId)]);
    const bypassedFilterIds = bypass?.filterIds ?? [];
    const decision = rules.engine.evaluate(resolvedTarget.targetUrl, { bypassedFilterIds });
    if (decision.action !== 'block') {
      return false;
    }

    // Bypass the filters the block page names, all of them so one Continue reaches the page, but
    // never whichever filters win now: a repeated Continue from a page whose filters are already
    // bypassed, or one made stale by a rules change, must not quietly pass a filter the user never
    // saw. Any other matching filter gets a fresh block page when the tab navigates.
    const newFilterIds = resolvedTarget.filterIds.filter(
      (filterId) => !bypassedFilterIds.includes(filterId)
    );
    await Promise.all([
      newFilterIds.length === 0
        ? Promise.resolve()
        : setBypassState(targetTabId, { filterIds: [...bypassedFilterIds, ...newFilterIds] }),
      clearBlockedTabState(targetTabId),
    ]);
    // The target becomes the page to return to once it commits, like any other page: it may
    // redirect somewhere another filter blocks.
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
    const decision = await this.evaluateForTab(tabId, resolvedTarget.targetUrl, rules);
    if (decision.action === 'block' || !this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    await updateTabUrl(tabId, resolvedTarget.targetUrl);
    await this.allowTab(tabId, resolvedTarget.targetUrl, this.getNavigationSeq(tabId));
  }

  private async blockTab(
    tabId: number,
    url: string,
    seq: number,
    decision: Extract<FilterDecision, { action: 'block' }>,
    data: StorageData,
    goBackStep?: GoBackStep
  ): Promise<void> {
    if (!this.isCurrentNavigation(tabId, seq)) {
      return;
    }

    // Go back landed on a blocked entry: usually the blocked address itself, which is in history
    // when it committed before the block page replaced it or came from an in-page route change.
    // Step past it once, then settle for opening the page the tab came from.
    if (goBackStep) {
      if (!goBackStep.passedBlockedEntry && (await this.stepBack(tabId, true))) {
        return;
      }
      if (await this.openReturnUrlInstead(tabId, seq)) {
        return;
      }
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
  private async allowTab(tabId: number, url: string, seq: number): Promise<void> {
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
    const otherFilterIds = decision.filterIds.filter((filterId) => filterId !== decision.filterId);
    const tabState: BlockedTabState = {
      blockId,
      tabId,
      targetUrl,
      blockedAt: Date.now(),
      blockedBy: {
        filterId: decision.filterId,
        groupId: decision.groupId,
        ...(otherFilterIds.length > 0 ? { otherFilterIds } : {}),
      },
    };
    const findFilter = (filterId: string): Filter | undefined =>
      data.filters.find((entry) => entry.id === filterId);
    const filter = findFilter(decision.filterId);
    const pageState: BlockedPageState = {
      ...tabState,
      filter: createFilterSnapshot(filter, decision.filterId),
      ...(otherFilterIds.length > 0
        ? {
            otherFilters: otherFilterIds.map((filterId) =>
              createFilterSnapshot(findFilter(filterId), filterId)
            ),
          }
        : {}),
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
          filterIds: getBlockedFilterIds(pageState),
        };
      }
    }

    return existingState
      ? {
          targetUrl: existingState.targetUrl,
          tabId: existingState.tabId,
          filterIds: getBlockedFilterIds(existingState),
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
        const rules = await this.getRules();
        await this.reconcileAllOpenTabs();
        scheduleNextRulesChange(rules.data);
      })
      .catch((error: unknown) => {
        console.error('[Teichos] Failed to reconcile tabs after rules change:', error);
      });
  }

  private async getRules(): Promise<CurrentRules> {
    return this.rulesProvider.loadCurrentRules();
  }

  /**
   * Evaluate a URL for a tab, skipping the filters the user continued past in it. The bypass is
   * read only when something would block, so allowed navigations cost no extra storage read.
   */
  private async evaluateForTab(
    tabId: number,
    url: string,
    rules: CurrentRules
  ): Promise<FilterDecision> {
    const decision = rules.engine.evaluate(url);
    if (decision.action !== 'block') {
      return decision;
    }

    const bypass = await getBypassState(tabId);
    return bypass?.filterIds.length
      ? rules.engine.evaluate(url, { bypassedFilterIds: bypass.filterIds })
      : decision;
  }
}

function scheduleNextRulesChange(data: StorageData): void {
  const nextChangeAt = getNextRulesChangeAt(data);
  const update =
    nextChangeAt === null
      ? chrome.alarms.clear(ALARMS.RULES_CHANGE)
      : chrome.alarms.create(ALARMS.RULES_CHANGE, { when: nextChangeAt + RULES_CHANGE_SLACK_MS });
  Promise.resolve(update).catch((error: unknown) => {
    console.error('[Teichos] Failed to schedule the next rules check:', error);
  });
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

function getBlockedFilterIds(state: BlockedTabState): readonly string[] {
  return [state.blockedBy.filterId, ...(state.blockedBy.otherFilterIds ?? [])];
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

function createFilterSnapshot(
  filter: Filter | undefined,
  fallbackFilterId: string
): BlockedPageState['filter'] {
  return {
    id: filter?.id ?? fallbackFilterId,
    pattern: filter?.pattern ?? fallbackFilterId,
    matchMode: filter?.matchMode ?? 'contains',
    ...(filter?.description ? { description: filter.description } : {}),
    // Kept so the block page can say when a temporary block ends instead of only the group schedule.
    ...(filter && isTemporaryFilter(filter) ? { expiresAt: filter.expiresAt } : {}),
  };
}

const tabController = new TabController(getRulesProvider());

export function getTabController(): TabController {
  return tabController;
}
