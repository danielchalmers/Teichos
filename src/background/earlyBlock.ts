/**
 * Mirrors the filters that block right now into declarativeNetRequest rules, so Chrome refuses a
 * matching page before its request leaves the browser, even while the service worker is asleep.
 * The navigation handlers still decide everything and still show the block page; these rules only
 * stop the site from loading in the moment before they act.
 *
 * The filtering engine stays the authority. A rule may cover less than its filter: the page then
 * loads until the navigation handlers block it, as it always did. Covering more is what to avoid,
 * since a page Chrome refuses and the engine allows would be left on Chrome's own error page. So
 * a filter or exception that rules can't express is left out. Two differences remain: rules never
 * see an address's fragment, which an expression ending in `$` or an exception may depend on, and
 * they are rewritten a moment after a schedule or snooze changes the engine's answer. For those,
 * the tab controller lets through any refused page the engine allows (see `allowUrlInTab`).
 */

import {
  buildGroupById,
  getFilterEffectiveState,
  getScheduleContext,
  isSnoozeActive,
  isTemporaryFilter,
  type ScheduleContext,
} from '../shared/filtering/schedules';
import { compileRegex, preparePattern } from '../shared/filtering/patterns';
import type { Filter, StorageData, Whitelist } from '../shared/types';

type Rule = chrome.declarativeNetRequest.Rule;
type RuleCondition = chrome.declarativeNetRequest.RuleCondition;

/** Whether Chrome's rule engine (RE2) accepts a regular expression. */
export type RegexSupportCheck = (regex: string, isCaseSensitive: boolean) => Promise<boolean>;

// Above every dynamic rule, whose priorities grow with the number of groups. The two kinds of tab
// rule are told apart by their priority.
const BYPASS_PRIORITY = 1_000_000;
const RELEASE_PRIORITY = BYPASS_PRIORITY + 1;

const SIGNATURE_KEY = 'early_block_signature' as const;

/** Characters urlFilter reads as syntax rather than text. */
const URL_FILTER_SYNTAX = /[*^|]/;

/** Rule text must be ASCII, and a space never appears in an address a browser requests. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** A regular expression may hold a space, inside a class for one. */
const ASCII_EXPRESSION = /^[\x20-\x7e]+$/;

function api(): typeof chrome.declarativeNetRequest | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome?.declarativeNetRequest;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const isRegexSupportedByChrome: RegexSupportCheck = async (regex, isCaseSensitive) => {
  const dnr = api();
  if (!dnr) {
    return false;
  }
  const result = await dnr.isRegexSupported({ regex, isCaseSensitive });
  return result.isSupported;
};

/** Text matched as written, case-insensitively: anywhere in the address, or as the whole of it. */
function literalCondition(text: string, wholeAddress: boolean): RuleCondition | null {
  // Rules never see the fragment, so text that needs one can't be matched here.
  if (!PRINTABLE_ASCII.test(text) || text.includes('#')) {
    return null;
  }
  if (!URL_FILTER_SYNTAX.test(text)) {
    return { urlFilter: wholeAddress ? `|${text}|` : text, isUrlFilterCaseSensitive: false };
  }
  const escaped = escapeRegex(text);
  return {
    regexFilter: wholeAddress ? `^${escaped}$` : escaped,
    isUrlFilterCaseSensitive: false,
  };
}

/** The condition for an entry's pattern, before Chrome is asked whether it accepts the regex. */
function describePattern(entry: Filter | Whitelist): RuleCondition | null {
  if (entry.matchMode === 'domain') {
    const domain = preparePattern(entry.pattern, 'domain').patternLower ?? '';
    return /^[a-z\d_-]+(?:\.[a-z\d_-]+)*$/.test(domain) ? { requestDomains: [domain] } : null;
  }

  if (entry.matchMode === 'contains') {
    return literalCondition(entry.pattern, false);
  }

  if (entry.matchMode === 'exact') {
    try {
      const url = new URL(entry.pattern);
      url.hash = '';
      return literalCondition(url.href, true);
    } catch {
      // Not an address, so the engine compares it as typed and it matches no page.
      return null;
    }
  }

  // The engine tests the expression as written, so the rule is case-sensitive too. An expression
  // JavaScript rejects matches nothing there, whatever RE2 would make of it.
  return ASCII_EXPRESSION.test(entry.pattern) && compileRegex(entry.pattern) !== null
    ? { regexFilter: entry.pattern, isUrlFilterCaseSensitive: true }
    : null;
}

/**
 * The rule condition that matches what the entry's pattern matches, or null when rules can't
 * express it: text outside ASCII, a regular expression RE2 rejects, an IPv6 host.
 */
async function toCondition(
  entry: Filter | Whitelist,
  isRegexSupported: RegexSupportCheck
): Promise<RuleCondition | null> {
  const condition = describePattern(entry);
  if (condition?.regexFilter === undefined) {
    return condition;
  }

  // One rule Chrome rejects fails the whole update, so each expression is checked first.
  const isCaseSensitive = condition.isUrlFilterCaseSensitive === true;
  return (await isRegexSupported(condition.regexFilter, isCaseSensitive)) ? condition : null;
}

/**
 * The rules for the filters that block at this moment. Groups take priority tiers in their stored
 * order: a group's exceptions outrank its own filters, and a later group's filters outrank an
 * earlier group's exceptions, since an exception only speaks for its own group. An earlier group's
 * filters do lose to a later group's exception, which only means the navigation handlers block that
 * page as before. A temporary block ignores exceptions, so it outranks them all.
 */
export async function buildEarlyBlockRules(
  data: StorageData,
  isRegexSupported: RegexSupportCheck = isRegexSupportedByChrome,
  context: ScheduleContext = getScheduleContext(),
  now = Date.now()
): Promise<Rule[]> {
  if (isSnoozeActive(data.snooze, now)) {
    return [];
  }

  const groupsById = buildGroupById(data.groups);
  const tierByGroup = new Map(data.groups.map((group, index) => [group.id, index]));
  const temporaryPriority = 2 * data.groups.length + 1;
  const rules: Rule[] = [];
  const addRule = (type: 'block' | 'allow', priority: number, condition: RuleCondition): void => {
    rules.push({
      id: rules.length + 1,
      priority,
      action: { type },
      condition: { ...condition, resourceTypes: ['main_frame'] },
    });
  };

  // A group with an exception that can't be mirrored gets no rules at all: without the exception
  // its filters would cover pages the engine allows.
  const exceptionsByGroup = new Map<string, RuleCondition[]>();
  const unmirroredGroups = new Set<string>();
  for (const entry of data.whitelist) {
    if (!entry.enabled) {
      continue;
    }
    const condition = await toCondition(entry, isRegexSupported);
    if (condition) {
      exceptionsByGroup.set(entry.groupId, [
        ...(exceptionsByGroup.get(entry.groupId) ?? []),
        condition,
      ]);
    } else {
      unmirroredGroups.add(entry.groupId);
    }
  }

  const groupsWithFilters = new Set<string>();
  for (const filter of data.filters) {
    if (!getFilterEffectiveState(filter, groupsById, context, now).active) {
      continue;
    }
    const temporary = isTemporaryFilter(filter);
    if (!temporary && unmirroredGroups.has(filter.groupId)) {
      continue;
    }
    const condition = await toCondition(filter, isRegexSupported);
    if (!condition) {
      continue;
    }
    const tier = tierByGroup.get(filter.groupId) ?? 0;
    addRule('block', temporary ? temporaryPriority : 2 * tier + 1, condition);
    if (!temporary) {
      groupsWithFilters.add(filter.groupId);
    }
  }

  for (const groupId of groupsWithFilters) {
    const tier = tierByGroup.get(groupId) ?? 0;
    for (const condition of exceptionsByGroup.get(groupId) ?? []) {
      addRule('allow', 2 * tier + 2, condition);
    }
  }

  return rules;
}

let syncQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = syncQueue.then(task);
  syncQueue = run.catch(() => undefined);
  return run;
}

/**
 * Replace the stored rules with the ones for the filters that block now. The worker wakes for
 * every navigation after a quiet spell, so the rules are only rewritten when they differ from the
 * last set this browser session wrote.
 */
export function syncEarlyBlockRules(data: StorageData): Promise<void> {
  return enqueue(async () => {
    const dnr = api();
    if (!dnr) {
      return;
    }

    const rules = await buildEarlyBlockRules(data);
    const signature = JSON.stringify(rules);
    const stored = await chrome.storage.session.get(SIGNATURE_KEY);
    if (stored[SIGNATURE_KEY] === signature) {
      return;
    }

    const removeRuleIds = (await dnr.getDynamicRules()).map((rule) => rule.id);
    try {
      await dnr.updateDynamicRules({ removeRuleIds, addRules: rules });
      await chrome.storage.session.set({ [SIGNATURE_KEY]: signature });
    } catch (error) {
      // Rules Chrome rejects must not leave an older set in force: stale rules can refuse pages
      // the filters now allow. With none, blocking falls back to the navigation handlers.
      console.error('[Teichos] Failed to update early-block rules:', error);
      await dnr.updateDynamicRules({ removeRuleIds });
      await chrome.storage.session.remove(SIGNATURE_KEY);
    }
  });
}

/** Replace one tab's rules of one kind, told apart by `priority`, with rules for `conditions`. */
async function replaceTabRules(
  tabId: number,
  priority: number | null,
  conditions: readonly RuleCondition[]
): Promise<void> {
  const dnr = api();
  if (!dnr) {
    return;
  }

  const existing = await dnr.getSessionRules();
  const removeRuleIds = existing
    .filter(
      (rule) =>
        rule.condition.tabIds?.includes(tabId) && (priority === null || rule.priority === priority)
    )
    .map((rule) => rule.id);
  let nextId = existing.reduce((highest, rule) => Math.max(highest, rule.id), 0) + 1;
  const addRules = conditions.map((condition): Rule => ({
    id: nextId++,
    priority: priority ?? BYPASS_PRIORITY,
    action: { type: 'allow' },
    condition: { ...condition, resourceTypes: ['main_frame'], tabIds: [tabId] },
  }));
  if (removeRuleIds.length > 0 || addRules.length > 0) {
    await dnr.updateSessionRules({ removeRuleIds, addRules });
  }
}

/**
 * Let a tab past the filters the user continued past in it, mirroring the engine's bypass. The
 * rules live for the browser session, like the bypass itself.
 */
export function syncTabBypass(
  tabId: number,
  bypassedFilters: readonly Filter[],
  isRegexSupported: RegexSupportCheck = isRegexSupportedByChrome
): Promise<void> {
  return enqueue(async () => {
    const conditions: RuleCondition[] = [];
    for (const filter of bypassedFilters) {
      const condition = await toCondition(filter, isRegexSupported);
      if (condition) {
        conditions.push(condition);
      }
    }
    await replaceTabRules(tabId, BYPASS_PRIORITY, conditions);
  });
}

/**
 * Let one address through in one tab. This is how a page Chrome refused but the engine allows is
 * released: whatever made the rules cover too much, the address the engine just allowed loads.
 */
export function allowUrlInTab(tabId: number, url: string): Promise<void> {
  return enqueue(async () => {
    let address: string;
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      address = parsed.href;
    } catch {
      return;
    }
    const condition = literalCondition(address, true);
    if (condition) {
      await replaceTabRules(tabId, RELEASE_PRIORITY, [condition]);
    }
  });
}

/** Drop a closed tab's rules. */
export function clearTabRules(tabId: number): Promise<void> {
  return enqueue(() => replaceTabRules(tabId, null, []));
}
