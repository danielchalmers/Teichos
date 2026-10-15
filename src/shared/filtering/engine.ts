import type { Filter, FilterGroup, StorageData, Whitelist } from '../types';
import { matchesPattern, preparePattern, type PreparedPattern } from './patterns';
import {
  buildGroupById,
  buildWhitelistByGroup,
  getFilterEffectiveState,
  getScheduleContext,
  isSnoozeActive,
  isTemporaryFilter,
  isTemporaryFilterExpired,
  sortFiltersTemporaryFirst,
  type ScheduleContext,
} from './schedules';

export type FilterDecisionAllowReason =
  | 'no-match'
  | 'snoozed'
  | 'whitelisted'
  | 'group-inactive'
  | 'filter-disabled'
  | 'temporary-expired'
  | 'bypassed';

export type FilterDecision =
  | { readonly action: 'allow'; readonly reason: FilterDecisionAllowReason }
  | {
      readonly action: 'block';
      readonly filterId: string;
      readonly groupId: string;
      /** Every filter that blocks the URL, `filterId` first, so one Continue can pass them all. */
      readonly filterIds: readonly string[];
      readonly reason: 'matched-filter';
    };

export interface FilteringEngine {
  readonly data: StorageData;
  readonly groupsById: ReadonlyMap<string, FilterGroup>;
  readonly whitelistByGroup: ReadonlyMap<string, readonly Whitelist[]>;
  evaluate: (url: string, options?: EvaluateOptions) => FilterDecision;
}

export interface EvaluateOptions {
  readonly context?: ScheduleContext;
  /** Filters the user continued past in this tab. They are skipped, so a later match still blocks. */
  readonly bypassedFilterIds?: readonly string[];
}

const FILTER_DECISION_REASON_PRIORITY: Record<FilterDecisionAllowReason, number> = {
  'no-match': 0,
  'filter-disabled': 1,
  'temporary-expired': 2,
  'group-inactive': 3,
  bypassed: 4,
  whitelisted: 5,
  snoozed: 6,
};

/**
 * Build the lookups and prepared patterns once per rules change. The engine evaluates on every
 * navigation, so regex compilation and pattern lowercasing must not happen per evaluation.
 */
export function createFilteringEngine(data: StorageData): FilteringEngine {
  const groupsById = buildGroupById(data.groups);
  const whitelistByGroup = buildWhitelistByGroup(data.whitelist.map(withPreparedPattern));
  const orderedFilters = sortFiltersTemporaryFirst(data.filters).map(withPreparedPattern);

  return {
    data,
    groupsById,
    whitelistByGroup,
    evaluate(url, options): FilterDecision {
      return evaluateFilterDecision(url, data, {
        context: options?.context ?? getScheduleContext(),
        ...(options?.bypassedFilterIds ? { bypassedFilterIds: options.bypassedFilterIds } : {}),
        filters: orderedFilters,
        groupsById,
        whitelistByGroup,
      });
    },
  };
}

interface EvaluationOptions {
  readonly context: ScheduleContext;
  readonly filters: readonly Filter[];
  readonly groupsById: ReadonlyMap<string, FilterGroup>;
  readonly whitelistByGroup: ReadonlyMap<string, readonly Whitelist[]>;
  readonly bypassedFilterIds: readonly string[];
}

export function evaluateFilterDecision(
  url: string,
  data: StorageData,
  options?: Partial<EvaluationOptions>
): FilterDecision {
  if (isSnoozeActive(data.snooze)) {
    return { action: 'allow', reason: 'snoozed' };
  }

  const context = options?.context ?? getScheduleContext();
  const filters = options?.filters ?? sortFiltersTemporaryFirst(data.filters);
  const groupsById = options?.groupsById ?? buildGroupById(data.groups);
  const whitelistByGroup = options?.whitelistByGroup ?? buildWhitelistByGroup(data.whitelist);
  const urlLower = url.toLowerCase();
  const now = Date.now();
  let fallbackReason: FilterDecisionAllowReason = 'no-match';
  let primary: Filter | undefined;
  const blockingFilterIds: string[] = [];

  for (const filter of filters) {
    if (!matchesPattern(url, filter, undefined, urlLower)) {
      continue;
    }

    if (!filter.enabled) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'filter-disabled');
      continue;
    }

    if (isTemporaryFilterExpired(filter, now)) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'temporary-expired');
      continue;
    }

    if (!getFilterEffectiveState(filter, groupsById, context, now).groupActive) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'group-inactive');
      continue;
    }

    if (!isTemporaryFilter(filter)) {
      const groupWhitelist = whitelistByGroup.get(filter.groupId);
      if (groupWhitelist?.some((entry) => matchesPattern(url, entry, undefined, urlLower))) {
        fallbackReason = selectHigherPriorityReason(fallbackReason, 'whitelisted');
        continue;
      }
    }

    if (options?.bypassedFilterIds?.includes(filter.id)) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'bypassed');
      continue;
    }

    primary ??= filter;
    if (!blockingFilterIds.includes(filter.id)) {
      blockingFilterIds.push(filter.id);
    }
  }

  return primary
    ? {
        action: 'block',
        filterId: primary.id,
        groupId: primary.groupId,
        filterIds: blockingFilterIds,
        reason: 'matched-filter',
      }
    : { action: 'allow', reason: fallbackReason };
}

function withPreparedPattern<T extends Filter | Whitelist>(entry: T): T & PreparedPattern {
  return { ...entry, ...preparePattern(entry.pattern, entry.matchMode) };
}

function selectHigherPriorityReason(
  current: FilterDecisionAllowReason,
  candidate: FilterDecisionAllowReason
): FilterDecisionAllowReason {
  return FILTER_DECISION_REASON_PRIORITY[candidate] > FILTER_DECISION_REASON_PRIORITY[current]
    ? candidate
    : current;
}
