/**
 * Mirrors the filters that block right now into declarativeNetRequest rules, so Chrome refuses a
 * matching page before its request leaves the browser, even while the service worker is asleep.
 * The navigation handlers still decide everything and still show the block page; these rules only
 * stop the site from loading in the moment before they act.
 *
 * The filtering engine stays the authority. A rule may cover less than its filter: the page then
 * loads until the navigation handlers block it, as it always did. Covering more is what to avoid,
 * since a page Chrome refuses and the engine allows would be left on Chrome's own error page. So
 * a filter or exception that rules can't express is left out. Chrome matches a rule against the
 * whole address, fragment included, as the engine's contains and regex modes do.
 *
 * One difference remains: the rules are rewritten a moment after a settings change, a schedule or
 * snooze changes the engine's answer. For that, and for anything this file gets wrong, the tab
 * controller lets through any refused page the engine allows (see `allowUrlInTab`).
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

/** Text matched as written, case-insensitively, anywhere in the address. */
function containsCondition(text: string): RuleCondition | null {
  if (!PRINTABLE_ASCII.test(text)) {
    return null;
  }
  return URL_FILTER_SYNTAX.test(text)
    ? { regexFilter: escapeRegex(text), isUrlFilterCaseSensitive: false }
    : { urlFilter: text, isUrlFilterCaseSensitive: false };
}

/** An address without its fragment, or null for text that isn't an address. */
function withoutFragment(address: string): string | null {
  try {
    const url = new URL(address);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/**
 * One address, whatever its fragment: the engine's exact match ignores the fragment, and Chrome
 * matches a rule against it. `pattern` is the address without one.
 */
function anchoredConditions(pattern: string): RuleCondition[] {
  return [
    { urlFilter: `|${pattern}|`, isUrlFilterCaseSensitive: false },
    { urlFilter: `|${pattern}#`, isUrlFilterCaseSensitive: false },
  ];
}

/** The conditions for an entry's pattern, before Chrome is asked whether it accepts a regex. */
function describePattern(entry: Filter | Whitelist): RuleCondition[] | null {
  if (entry.matchMode === 'domain') {
    const domain = preparePattern(entry.pattern, 'domain').patternLower ?? '';
    return /^[a-z\d_-]+(?:\.[a-z\d_-]+)*$/.test(domain) ? [{ requestDomains: [domain] }] : null;
  }

  if (entry.matchMode === 'contains') {
    const condition = containsCondition(entry.pattern);
    return condition && [condition];
  }

  if (entry.matchMode === 'exact') {
    // Text that isn't an address is compared as typed by the engine, and matches no page.
    const address = withoutFragment(entry.pattern);
    if (address === null || !PRINTABLE_ASCII.test(address)) {
      return null;
    }
    // Anchored patterns need no regular expression, which Chrome caps at a size a long address
    // would pass. Only an address holding pattern syntax is written as one.
    return URL_FILTER_SYNTAX.test(address)
      ? [{ regexFilter: `^${escapeRegex(address)}(?:#.*)?$`, isUrlFilterCaseSensitive: false }]
      : anchoredConditions(address);
  }

  // The engine tests the expression as written, so the rule is case-sensitive too. An expression
  // JavaScript rejects matches nothing there, whatever RE2 would make of it.
  return ASCII_EXPRESSION.test(entry.pattern) && compileRegex(entry.pattern) !== null
    ? [{ regexFilter: entry.pattern, isUrlFilterCaseSensitive: true }]
    : null;
}

/**
 * The rule conditions that together match what the entry's pattern matches, or null when rules
 * can't express it: text outside ASCII, a regular expression RE2 rejects, an IPv6 host.
 */
async function toConditions(
  entry: Filter | Whitelist,
  isRegexSupported: RegexSupportCheck
): Promise<RuleCondition[] | null> {
  const conditions = describePattern(entry);
  for (const condition of conditions ?? []) {
    if (condition.regexFilter === undefined) {
      continue;
    }
    // One rule Chrome rejects fails the whole update, so each expression is checked first.
    const isCaseSensitive = condition.isUrlFilterCaseSensitive === true;
    if (!(await isRegexSupported(condition.regexFilter, isCaseSensitive))) {
      return null;
    }
  }
  return conditions;
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
    const conditions = await toConditions(entry, isRegexSupported);
    if (conditions) {
      exceptionsByGroup.set(entry.groupId, [
        ...(exceptionsByGroup.get(entry.groupId) ?? []),
        ...conditions,
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
    const conditions = await toConditions(filter, isRegexSupported);
    if (!conditions) {
      continue;
    }
    const tier = tierByGroup.get(filter.groupId) ?? 0;
    for (const condition of conditions) {
      addRule('block', temporary ? temporaryPriority : 2 * tier + 1, condition);
    }
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
      conditions.push(...((await toConditions(filter, isRegexSupported)) ?? []));
    }
    await replaceTabRules(tabId, BYPASS_PRIORITY, conditions);
  });
}

/**
 * Let one address through in one tab, whatever its fragment. This is how a page Chrome refused but
 * the engine allows is released: whatever made the rules cover too much, the address the engine
 * just allowed loads.
 */
export function allowUrlInTab(tabId: number, url: string): Promise<void> {
  return enqueue(async () => {
    const address = withoutFragment(url);
    if (address === null || !PRINTABLE_ASCII.test(address)) {
      return;
    }
    // A wildcard stands in for what a pattern would read as syntax. An allow rule that covers more
    // only leaves more to the navigation handlers, and this one must not depend on a regular
    // expression Chrome may reject.
    const pattern = address.replace(/[*^|]/g, '*');
    await replaceTabRules(tabId, RELEASE_PRIORITY, anchoredConditions(pattern));
  });
}

/** Drop a closed tab's rules. */
export function clearTabRules(tabId: number): Promise<void> {
  return enqueue(() => replaceTabRules(tabId, null, []));
}
