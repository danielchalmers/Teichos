import { loadData } from '../shared/api/storage';
import { createFilteringEngine, type FilteringEngine } from '../shared/filtering/engine';
import type { StorageData } from '../shared/types';

export interface CurrentRules {
  readonly data: StorageData;
  readonly engine: FilteringEngine;
}

interface RulesProviderOptions {
  readonly loadStorageData?: () => Promise<StorageData>;
  readonly createEngine?: (data: StorageData) => FilteringEngine;
}

/**
 * Caches the current rules for the service worker. The cache is authoritative until
 * `invalidate()` is called, which the tab controller does from `chrome.storage.onChanged`, so the
 * per-navigation path never touches storage while the cache is warm. A load that overlaps an
 * invalidation is served to its caller but never cached, because it may have read stale data.
 */
export class RulesProvider {
  private readonly loadStorageData: () => Promise<StorageData>;
  private readonly createEngine: (data: StorageData) => FilteringEngine;
  private cachedRules: CurrentRules | null = null;
  private loadingRules: Promise<CurrentRules> | null = null;
  private invalidationVersion = 0;

  constructor(options: RulesProviderOptions = {}) {
    this.loadStorageData = options.loadStorageData ?? loadData;
    this.createEngine = options.createEngine ?? createFilteringEngine;
  }

  invalidate(): void {
    this.invalidationVersion += 1;
    this.cachedRules = null;
    this.loadingRules = null;
  }

  async loadCurrentRules(): Promise<CurrentRules> {
    if (this.cachedRules) {
      return this.cachedRules;
    }

    if (this.loadingRules) {
      return this.loadingRules;
    }

    const loadVersion = this.invalidationVersion;
    const loadPromise = this.loadStorageData()
      .then((data) => {
        const currentRules: CurrentRules = {
          data,
          engine: this.createEngine(data),
        };

        if (this.invalidationVersion === loadVersion) {
          this.cachedRules = currentRules;
        }

        return currentRules;
      })
      .finally(() => {
        if (this.loadingRules === loadPromise) {
          this.loadingRules = null;
        }
      });

    this.loadingRules = loadPromise;
    return loadPromise;
  }
}

const rulesProvider = new RulesProvider();

export function getRulesProvider(): RulesProvider {
  return rulesProvider;
}
