import { loadData } from '../shared/api/storage';
import type { StorageData } from '../shared/types';
import { createFilteringEngine, type FilteringEngine } from '../shared/utils';

export interface CurrentRules {
  readonly data: StorageData;
  readonly engine: FilteringEngine;
}

interface RulesProviderOptions {
  readonly loadStorageData?: () => Promise<StorageData>;
  readonly createEngine?: (data: StorageData) => FilteringEngine;
}

export class RulesProvider {
  private readonly loadStorageData: () => Promise<StorageData>;
  private readonly createEngine: (data: StorageData) => FilteringEngine;
  private cachedRules: CurrentRules | null = null;
  private cachedSignature: string | null = null;
  private loadingRules: Promise<CurrentRules> | null = null;
  private invalidationVersion = 0;

  constructor(options: RulesProviderOptions = {}) {
    this.loadStorageData = options.loadStorageData ?? loadData;
    this.createEngine = options.createEngine ?? createFilteringEngine;
  }

  invalidate(): void {
    this.invalidationVersion += 1;
    this.cachedRules = null;
    this.cachedSignature = null;
    this.loadingRules = null;
  }

  async loadCurrentRules(): Promise<CurrentRules> {
    if (this.loadingRules) {
      return this.loadingRules;
    }

    const loadVersion = this.invalidationVersion;
    const loadPromise = this.loadStorageData()
      .then((data) => {
        const signature = serializeRulesData(data);
        const cacheCanBeUpdated = this.invalidationVersion === loadVersion;

        if (this.cachedRules && this.cachedSignature === signature) {
          return this.cachedRules;
        }

        const currentRules = {
          data,
          engine: this.createEngine(data),
        };

        if (cacheCanBeUpdated) {
          this.cachedRules = currentRules;
          this.cachedSignature = signature;
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

function serializeRulesData(data: StorageData): string {
  return JSON.stringify(data);
}

const rulesProvider = new RulesProvider();

export function getRulesProvider(): RulesProvider {
  return rulesProvider;
}
