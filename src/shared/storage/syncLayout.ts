/**
 * How settings are laid out in chrome.storage.sync.
 *
 * Sync storage caps each item at 8 KB, which one settings object outgrows at roughly 45 filters.
 * Settings that fit are stored exactly as before: one item under STORAGE_KEY, which every version
 * of Teichos reads. Only settings that don't fit are split into numbered parts under new keys, so
 * an older version on another device never misreads them; it keeps the last single-item copy.
 * Once split, settings stay split and every save overwrites the same items. Nothing is deleted,
 * since a delete issued after a write can remove a newer save another context made in between.
 *
 * A device may hold both layouts at once (one written before the settings grew, or an older copy
 * from another device), and synced items can arrive one at a time. Every save raises
 * `rulesVersion`, so the reader takes the complete copy with the highest one, and stale or
 * half-arrived items are ignored rather than trusted. A single item without a `schemaVersion`
 * comes from a version that can't split settings, so it never outranks a split copy: its
 * rulesVersion only counts edits made on that older device.
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

/**
 * An item's size as Chrome counts it against the limit: the key plus the value's JSON in UTF-8.
 * Chrome's JSON writer escapes "<", U+2028 and U+2029 as six-character \u escapes, which
 * JSON.stringify leaves alone, so they count at that size (checked against Chrome's own limit).
 */
function itemBytes(key: string, value: unknown): number {
  const json = JSON.stringify(value);
  const escapedByChrome = json.match(/[<\u2028\u2029]/g) ?? [];
  const utf8Bytes = new TextEncoder().encode(json).length;
  const extraBytes = escapedByChrome.reduce((sum, char) => sum + (char === '<' ? 5 : 3), 0);
  return key.length + utf8Bytes + extraBytes;
}

/**
 * Lay settings out as the items to write in one `set` call. Settings already split stay split even
 * when they would fit in one item again: the write then overwrites the same items in place, and
 * never needs room in the sync quota for both layouts at once. Parts past the new count are left
 * behind, and never read, since the index names how many parts there are.
 */
export function encodeSettings(data: StorageData, isSplit: boolean): Record<string, unknown> {
  if (!isSplit && itemBytes(STORAGE_KEY, data) <= ITEM_BUDGET_BYTES) {
    return { [STORAGE_KEY]: data };
  }

  const json = JSON.stringify(data);
  const revision = hashText(json);
  const texts = splitText(json, (text, index) =>
    itemBytes(splitPartKey(index), { revision, text } satisfies SplitPart)
  );
  const index: SplitIndex = { revision, parts: texts.length, rulesVersion: data.rulesVersion };
  const items: Record<string, unknown> = { [SPLIT_INDEX_KEY]: index };
  texts.forEach((text, partIndex) => {
    items[splitPartKey(partIndex)] = { revision, text } satisfies SplitPart;
  });

  return items;
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

/**
 * A revision named after the content, so two devices saving the same settings at once (every
 * device clears an expired snooze at the same moment) write interchangeable parts instead of
 * leaving a mix that can never be assembled. A 53-bit hash: a collision would need different
 * settings saved at the same rulesVersion, and their mixed parts would then fail to parse.
 */
function hashText(text: string): string {
  let high = 0xdeadbeef;
  let low = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & low) + (high >>> 0);
  return `${hash.toString(36)}-${text.length.toString(36)}`;
}

function hasSchemaVersion(value: unknown): boolean {
  return typeof (value as { schemaVersion?: unknown } | null)?.schemaVersion === 'number';
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

/**
 * Pick the newest complete copy of the settings out of everything in sync storage. `remembered` is
 * a complete copy the reader picked earlier; it competes with the stored copies under the same
 * rules, and loses a tie to them.
 */
export function decodeSettings(
  items: Readonly<Record<string, unknown>>,
  remembered?: unknown
): DecodedSettings {
  const single = items[STORAGE_KEY];
  const index = readSplitIndex(items[SPLIT_INDEX_KEY]);
  const split = index ? readSplitSettings(items, index) : undefined;
  // Once settings are split, a single item an older version wrote is out of the running.
  const singleCounts = single !== undefined && !(index && !hasSchemaVersion(single));

  // On a tie the split copy wins: only an older version editing its single-item copy can tie it.
  const candidates = [split, singleCounts ? single : undefined, remembered].filter(
    (candidate) => candidate !== undefined
  );
  const newestCandidate = candidates.reduce<unknown>(
    (newest, candidate) =>
      newest === undefined || readRulesVersion(candidate) > readRulesVersion(newest)
        ? candidate
        : newest,
    undefined
  );
  // With nothing else whole, an older version's copy still beats having no settings at all.
  const raw = newestCandidate ?? single;

  const versions = [
    ...(singleCounts ? [readRulesVersion(single)] : []),
    ...(index ? [index.rulesVersion] : []),
  ];
  const latestRulesVersion = versions.length > 0 ? Math.max(...versions) : undefined;
  const complete =
    latestRulesVersion === undefined ||
    (raw !== undefined && readRulesVersion(raw) === latestRulesVersion);

  return { raw, latestRulesVersion, complete };
}
