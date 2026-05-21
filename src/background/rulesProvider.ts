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

  constructor(options: RulesProviderOptions = {}) {
    this.loadStorageData = options.loadStorageData ?? loadData;
    this.createEngine = options.createEngine ?? createFilteringEngine;
  }

  invalidate(): void {
    this.cachedRules = null;
    this.cachedSignature = null;
  }

  async loadCurrentRules(): Promise<CurrentRules> {
    const data = await this.loadStorageData();
    const signature = serializeRulesData(data);

    if (this.cachedRules && this.cachedSignature === signature) {
      return this.cachedRules;
    }

    const currentRules = {
      data,
      engine: this.createEngine(data),
    };

    this.cachedRules = currentRules;
    this.cachedSignature = signature;
    return currentRules;
  }
}

function serializeRulesData(data: StorageData): string {
  return JSON.stringify(data);
}

const rulesProvider = new RulesProvider();

export function getRulesProvider(): RulesProvider {
  return rulesProvider;
}
