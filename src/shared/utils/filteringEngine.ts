import type {
  BlockType,
  Filter,
  FilterBlockType,
  FilterGroup,
  StorageData,
  WarningBypassState,
  Whitelist,
} from '../types';
import type { ScheduleContext } from './filters';
import {
  buildGroupById,
  buildWhitelistByGroup,
  getScheduleContext,
  isFilterScheduledActive,
  isSnoozeActive,
  isTemporaryFilter,
  isTemporaryFilterExpired,
  matchesPattern,
  sortFiltersTemporaryFirst,
} from './filters';

export type FilterDecisionAllowReason =
  | 'no-match'
  | 'warning-bypassed'
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
      readonly blockType: BlockType;
      readonly reason: 'matched-filter';
    };

export interface FilteringEngine {
  readonly data: StorageData;
  readonly groupsById: ReadonlyMap<string, FilterGroup>;
  readonly whitelistByGroup: ReadonlyMap<string, readonly Whitelist[]>;
  evaluate: (
    url: string,
    context?: ScheduleContext,
    warningBypasses?: readonly WarningBypassState[]
  ) => FilterDecision;
}

const FILTER_DECISION_REASON_PRIORITY: Record<FilterDecisionAllowReason, number> = {
  'no-match': 0,
  'warning-bypassed': 1,
  'filter-disabled': 2,
  'temporary-expired': 3,
  'group-inactive': 4,
  whitelisted: 5,
  snoozed: 6,
};

export function createFilteringEngine(data: StorageData): FilteringEngine {
  const groupsById = buildGroupById(data.groups);
  const whitelistByGroup = buildWhitelistByGroup(data.whitelist);
  const orderedFilters = sortFiltersTemporaryFirst(data.filters);

  return {
    data,
    groupsById,
    whitelistByGroup,
    evaluate(url, context = getScheduleContext(), warningBypasses = []): FilterDecision {
      return evaluateFilterDecision(url, data, {
        context,
        filters: orderedFilters,
        groupsById,
        whitelistByGroup,
        warningBypasses,
      });
    },
  };
}

interface EvaluationOptions {
  readonly context: ScheduleContext;
  readonly filters: readonly Filter[];
  readonly groupsById: ReadonlyMap<string, FilterGroup>;
  readonly whitelistByGroup: ReadonlyMap<string, readonly Whitelist[]>;
  readonly warningBypasses: readonly WarningBypassState[];
}

export function getWarningBypassScopeKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? parsed.href : parsed.origin;
  } catch {
    return url;
  }
}

function resolveEffectiveBlockType(
  filterBlockType: FilterBlockType | undefined,
  defaultBlockType: BlockType
): BlockType {
  if (filterBlockType === 'block' || filterBlockType === 'warning') {
    return filterBlockType;
  }

  return defaultBlockType;
}

function isWarningBypassed(
  filterId: string,
  url: string,
  warningBypasses: readonly WarningBypassState[]
): boolean {
  const scopeKey = getWarningBypassScopeKey(url);
  return warningBypasses.some(
    (entry) => entry.filterId === filterId && entry.scopeKey === scopeKey
  );
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
  const warningBypasses = options?.warningBypasses ?? [];
  const urlLower = url.toLowerCase();
  const now = Date.now();
  let fallbackReason: FilterDecisionAllowReason = 'no-match';
  let warningDecision: Extract<FilterDecision, { action: 'block' }> | null = null;

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

    if (!isFilterScheduledActive(filter, groupsById, context)) {
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

    const blockType = resolveEffectiveBlockType(filter.blockType, data.blockType);
    if (blockType === 'block') {
      return {
        action: 'block',
        filterId: filter.id,
        groupId: filter.groupId,
        blockType,
        reason: 'matched-filter',
      };
    }

    if (isWarningBypassed(filter.id, url, warningBypasses)) {
      fallbackReason = selectHigherPriorityReason(fallbackReason, 'warning-bypassed');
      continue;
    }

    warningDecision ??= {
      action: 'block',
      filterId: filter.id,
      groupId: filter.groupId,
      blockType,
      reason: 'matched-filter',
    };
  }

  return warningDecision ?? { action: 'allow', reason: fallbackReason };
}

function selectHigherPriorityReason(
  current: FilterDecisionAllowReason,
  candidate: FilterDecisionAllowReason
): FilterDecisionAllowReason {
  return FILTER_DECISION_REASON_PRIORITY[candidate] > FILTER_DECISION_REASON_PRIORITY[current]
    ? candidate
    : current;
}
