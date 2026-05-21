import type { Filter, FilterGroup, StorageData, Whitelist } from '../types';
import type { ScheduleContext } from './filters';
import {
  buildGroupById,
  buildWhitelistByGroup,
  getFilterActivityState,
  getScheduleContext,
  isSnoozeActive,
  isTemporaryFilter,
  matchesPattern,
  sortFiltersTemporaryFirst,
} from './filters';

export type FilterDecisionAllowReason =
  | 'no-match'
  | 'snoozed'
  | 'whitelisted'
  | 'group-inactive'
  | 'filter-disabled'
  | 'temporary-expired';

export type FilterDecision =
  | { readonly action: 'allow'; readonly reason: FilterDecisionAllowReason }
  | {
      readonly action: 'block';
      readonly filterId: string;
      readonly groupId: string;
      readonly reason: 'matched-filter';
    };

export interface FilteringEngine {
  readonly data: StorageData;
  readonly groupsById: ReadonlyMap<string, FilterGroup>;
  readonly whitelistByGroup: ReadonlyMap<string, readonly Whitelist[]>;
  evaluate: (url: string, context?: ScheduleContext) => FilterDecision;
}

const FILTER_DECISION_REASON_PRIORITY: Record<FilterDecisionAllowReason, number> = {
  'no-match': 0,
  'filter-disabled': 1,
  'temporary-expired': 2,
  'group-inactive': 3,
  whitelisted: 4,
  snoozed: 5,
};

export function createFilteringEngine(data: StorageData): FilteringEngine {
  const groupsById = buildGroupById(data.groups);
  const whitelistByGroup = buildWhitelistByGroup(data.whitelist);
  const orderedFilters = sortFiltersTemporaryFirst(data.filters);

  return {
    data,
    groupsById,
    whitelistByGroup,
    evaluate(url, context = getScheduleContext()): FilterDecision {
      return evaluateFilterDecision(url, data, {
        context,
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

  for (const filter of filters) {
    if (!matchesPattern(url, filter, undefined, urlLower)) {
      continue;
    }

    if (!filter.enabled) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'filter-disabled');
      continue;
    }

    const activity = getFilterActivityState(filter, groupsById, context, now);
    if (!activity.active) {
      fallbackReason = selectHigherPriorityReason(
        fallbackReason,
        activity.reason === 'temporary-expired'
          ? 'temporary-expired'
          : activity.reason === 'filter-disabled'
            ? 'filter-disabled'
            : 'group-inactive'
      );
      continue;
    }

    if (!isTemporaryFilter(filter)) {
      const groupWhitelist = whitelistByGroup.get(filter.groupId);
      if (groupWhitelist?.some((entry) => matchesPattern(url, entry, undefined, urlLower))) {
        fallbackReason = selectHigherPriorityReason(fallbackReason, 'whitelisted');
        continue;
      }
    }

    return {
      action: 'block',
      filterId: filter.id,
      groupId: filter.groupId,
      reason: 'matched-filter',
    };
  }

  return { action: 'allow', reason: fallbackReason };
}

function selectHigherPriorityReason(
  current: FilterDecisionAllowReason,
  candidate: FilterDecisionAllowReason
): FilterDecisionAllowReason {
  return FILTER_DECISION_REASON_PRIORITY[candidate] > FILTER_DECISION_REASON_PRIORITY[current]
    ? candidate
    : current;
}
