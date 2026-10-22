/**
 * How settings are laid out in chrome.storage.sync.
 *
 * Sync storage caps each item at 8 KB, which one settings object outgrows at roughly 45 filters.
 * Settings that fit are stored exactly as before: one item under STORAGE_KEY, which every version
 * of Teichos reads. Only settings that don't fit are split into numbered parts under new keys, so
 * an older version on another device never misreads them; it keeps the last single-item copy.
 *
 * A device may hold both layouts at once (one written before the settings grew, or an older copy
 * from another device), and synced items can arrive one at a time. Every save raises
 * `rulesVersion`, so the reader takes the complete copy with the highest one, and stale or
 * half-arrived items are ignored rather than trusted.
 */

import { STORAGE_KEY, type StorageData } from '../types';

/** The part count, revision and rulesVersion of split settings. */
export const SPLIT_INDEX_KEY = `${STORAGE_KEY}_index`;

const SPLIT_PART_KEY_PATTERN = new RegExp(`^${STORAGE_KEY}_(\\d+)$`);

/** chrome.storage.sync.QUOTA_BYTES_PER_ITEM, which counts the key and the value's JSON. */
export const SYNC_ITEM_LIMIT_BYTES = 8192;

// Room for the item's own bookkeeping, so a part never lands exactly on the limit.
const ITEM_BUDGET_BYTES = SYNC_ITEM_LIMIT_BYTES - 64;

interface SplitIndex {
  readonly revision: string;
  readonly parts: number;
  readonly rulesVersion: number;
}

interface SplitPart {
  readonly revision: string;
  readonly text: string;
}

export interface EncodedSettings {
  /** Items to write in one `set` call. */
  readonly items: Readonly<Record<string, unknown>>;
  /** Settings items from an earlier layout that this write leaves stale; safe to remove after. */
  readonly staleKeys: readonly string[];
}

export interface DecodedSettings {
  /** The newest complete copy, or undefined when nothing is stored. */
  readonly raw: unknown;
  /** The highest rulesVersion stored, counting a split copy that hasn't fully arrived. */
  readonly latestRulesVersion: number | undefined;
  /** False while a newer split copy is still arriving, so `raw` is out of date. */
  readonly complete: boolean;
}

export function splitPartKey(index: number): string {
  return `${STORAGE_KEY}_${String(index)}`;
}

/** Whether a sync key holds settings in either layout, for change listeners. */
export function isSettingsKey(key: string): boolean {
  return key === STORAGE_KEY || key === SPLIT_INDEX_KEY || SPLIT_PART_KEY_PATTERN.test(key);
}

export function hasSettingsChange(changes: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(changes).some(isSettingsKey);
}

function itemBytes(key: string, value: unknown): number {
  return key.length + new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Lay settings out for a write. `storedKeys` are the settings keys already in sync storage, so a
 * write can name what it leaves stale: split parts past the new count, or every split item once
 * the settings fit in one item again. The single item is never listed: it is the copy older
 * versions read, and the higher rulesVersion of a split copy already outranks it.
 */
export function encodeSettings(
  data: StorageData,
  storedKeys: readonly string[],
  createRevision: () => string = createRandomRevision
): EncodedSettings {
  const splitKeys = storedKeys.filter((key) => key !== STORAGE_KEY && isSettingsKey(key));

  if (itemBytes(STORAGE_KEY, data) <= ITEM_BUDGET_BYTES) {
    return { items: { [STORAGE_KEY]: data }, staleKeys: splitKeys };
  }

  const revision = createRevision();
  const texts = splitText(JSON.stringify(data), (text, index) =>
    itemBytes(splitPartKey(index), { revision, text } satisfies SplitPart)
  );
  const index: SplitIndex = { revision, parts: texts.length, rulesVersion: data.rulesVersion };
  const items: Record<string, unknown> = { [SPLIT_INDEX_KEY]: index };
  texts.forEach((text, partIndex) => {
    items[splitPartKey(partIndex)] = { revision, text } satisfies SplitPart;
  });

  return { items, staleKeys: splitKeys.filter((key) => !(key in items)) };
}

/**
 * Cut text into the fewest parts whose items each fit the item budget. Each part is the longest
 * prefix that fits, found by binary search, since JSON escaping and multi-byte characters make a
 * part's stored size differ from its length. A part never ends between a surrogate pair.
 */
function splitText(text: string, partBytes: (part: string, index: number) => number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (partBytes(text.slice(start, mid), parts.length) <= ITEM_BUDGET_BYTES) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    let end = low;
    const lastCode = text.charCodeAt(end - 1);
    if (end < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff && end - 1 > start) {
      end -= 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function createRandomRevision(): string {
  return globalThis.crypto.randomUUID();
}

function readRulesVersion(value: unknown): number {
  const rulesVersion = (value as { rulesVersion?: unknown } | null)?.rulesVersion;
  return typeof rulesVersion === 'number' && Number.isFinite(rulesVersion) ? rulesVersion : 0;
}

function readSplitIndex(value: unknown): SplitIndex | undefined {
  const candidate = value as Partial<SplitIndex> | null | undefined;
  return typeof candidate?.revision === 'string' &&
    typeof candidate.parts === 'number' &&
    Number.isInteger(candidate.parts) &&
    candidate.parts > 0 &&
    typeof candidate.rulesVersion === 'number'
    ? (candidate as SplitIndex)
    : undefined;
}

/** Reassemble split settings, or undefined while any part is missing or from another revision. */
function readSplitSettings(items: Readonly<Record<string, unknown>>, index: SplitIndex): unknown {
  let text = '';
  for (let partIndex = 0; partIndex < index.parts; partIndex++) {
    const part = items[splitPartKey(partIndex)] as Partial<SplitPart> | undefined;
    if (part?.revision !== index.revision || typeof part.text !== 'string') {
      return undefined;
    }
    text += part.text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Pick the newest complete copy of the settings out of everything in sync storage. */
export function decodeSettings(items: Readonly<Record<string, unknown>>): DecodedSettings {
  const single = items[STORAGE_KEY];
  const index = readSplitIndex(items[SPLIT_INDEX_KEY]);
  const split = index ? readSplitSettings(items, index) : undefined;

  // On a tie the split copy wins: only an older version editing its single-item copy can tie it.
  const candidates = [
    ...(split !== undefined ? [split] : []),
    ...(single !== undefined ? [single] : []),
  ];
  const raw = candidates.reduce<unknown>(
    (newest, candidate) =>
      newest === undefined || readRulesVersion(candidate) > readRulesVersion(newest)
        ? candidate
        : newest,
    undefined
  );

  const versions = [
    ...(single !== undefined ? [readRulesVersion(single)] : []),
    ...(index ? [index.rulesVersion] : []),
  ];
  const latestRulesVersion = versions.length > 0 ? Math.max(...versions) : undefined;
  const complete =
    latestRulesVersion === undefined ||
    (raw !== undefined && readRulesVersion(raw) === latestRulesVersion);

  return { raw, latestRulesVersion, complete };
}
