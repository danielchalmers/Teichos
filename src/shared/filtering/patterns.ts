import type { FilterMatchMode } from '../types';

export interface PreparedPattern {
  readonly pattern: string;
  readonly matchMode: FilterMatchMode;
  /**
   * The pattern as matching compares it: lowercased, for exact mode also URL-normalized, and for
   * domain mode the host as browsers report it.
   */
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
}

/** A URL in the forms matching compares, worked out once per evaluation instead of per pattern. */
export interface PreparedUrl {
  readonly lower: string;
  /** The host without a trailing dot, or null for a URL with no host. */
  readonly host: string | null;
}

export function prepareUrl(url: string): PreparedUrl {
  return { lower: url.toLowerCase(), host: getUrlHost(url) };
}

/**
 * The host as matching compares it. A trailing dot names the same site (`reddit.com.` loads
 * reddit.com), so it is dropped rather than letting it slip past a domain filter. A blob: URL has
 * no host of its own and belongs to the site that made it (blob:https://reddit.com/…).
 */
function getUrlHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.protocol === 'blob:' ? new URL(parsed.pathname).hostname : parsed.hostname;
    return host.replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

/** Characters a site's host can hold once a URL parser has read it (punycode included). */
const HOST_PATTERN = /^(?:[a-z\d_-]+(?:\.[a-z\d_-]+)*|\[[\da-f:.]+\])$/;

/**
 * Read a domain pattern the way people write or paste one: any case, a leading `*.` or `.`, a
 * trailing dot, or a bare site address such as https://www.reddit.com/. Returns the host as browsers
 * report it (lowercase, punycode for international names), or null when the input is not a site:
 * a path, query, port or credentials name less than a whole site, so they are rejected rather
 * than silently dropped, which would block more than the user asked for.
 */
export function normalizeDomainPattern(input: string): string | null {
  const trimmed = input.trim().replace(/^\*?\./, '');
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }

  const namesMoreThanASite =
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== '/' ||
    (hasScheme && parsed.protocol !== 'http:' && parsed.protocol !== 'https:');
  const host = parsed.hostname.replace(/\.$/, '');
  // A single word is a valid host but almost never a site someone means ("reddit"); text like
  // that belongs in a contains filter. localhost is the one single-label site worth naming. The
  // parser also lets through characters no site has, such as the * in "*reddit.com".
  const isSite =
    HOST_PATTERN.test(host) && (host === 'localhost' || host.startsWith('[') || host.includes('.'));
  return namesMoreThanASite || !isSite ? null : host;
}

/**
 * File names look like site names but are matched as text: "viewtopic.php" as a domain would
 * never match the forum page it was written for. Some are also real top-level domains (.md,
 * .zip, .mov), but a contains pattern ending in one is far more likely a file, and leaving a
 * pattern as text keeps its old behaviour, so the doubt goes that way.
 */
const FILE_EXTENSIONS = new Set([
  'asp',
  'aspx',
  'avi',
  'cgi',
  'css',
  'csv',
  'doc',
  'docx',
  'exe',
  'gif',
  'htm',
  'html',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsp',
  'md',
  'mjs',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'pdf',
  'php',
  'png',
  'ppt',
  'rss',
  'shtml',
  'svg',
  'txt',
  'wav',
  'webm',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'zip',
]);

/**
 * Whether a contains pattern is nothing but a site name (reddit.com, www.youtube.com), which as
 * contains text also matched any address mentioning it: x.com blocked netflix.com, and a search
 * for reddit.com was blocked like reddit itself. Such patterns are what domain matching is for.
 * The last label must look like a top-level domain and not a file extension, so text like "v1.2"
 * or "viewtopic.php" is left alone.
 */
export function isSiteNamePattern(pattern: string): boolean {
  const trimmed = pattern.trim().toLowerCase();
  const lastLabel = trimmed.slice(trimmed.lastIndexOf('.') + 1);
  return (
    normalizeDomainPattern(trimmed) === trimmed &&
    /^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/.test(lastLabel) &&
    !FILE_EXTENSIONS.has(lastLabel)
  );
}

const MAX_REGEX_PATTERN_LENGTH = 512;

export function getRegexValidationError(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Pattern is longer than ${MAX_REGEX_PATTERN_LENGTH} characters.`;
  }

  try {
    new RegExp(pattern);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const hazard = findBacktrackingHazard(parseAlternatives(pattern, { index: 0 }));
  if (hazard === 'nested') {
    return 'Nested unbounded repetition like (a+)+ can hang the browser while matching. Simplify the pattern.';
  }
  if (hazard === 'ambiguous') {
    return 'Repeating a group whose parts can match the same text, like (a|aa)+, can hang the browser while matching. Simplify the pattern.';
  }

  return null;
}

/*
 * Filters run on every navigation inside the service worker, so a pattern that backtracks
 * exponentially freezes all block/allow decisions. Full ReDoS analysis is out of reach here;
 * instead the pattern is parsed into groups and alternatives, and a group repeated without an
 * upper bound is rejected when one text can be split across its iterations in many ways:
 *
 * - it contains another unbounded repeat, e.g. (a+)+ or (a*){2,};
 * - two of its alternatives can start with the same character, e.g. (a|aa)+ or (\w|\d)*;
 * - one of its alternatives is a single atom of variable width, e.g. (a{2,4})* or (a?)+.
 *
 * Patterns that pass can still be slow, but these are the shapes that hang on short inputs.
 */

interface Quantifier {
  readonly min: number;
  readonly max: number;
}

interface Atom {
  /** The atom's own text, without its quantifier. */
  readonly source: string;
  /** Anchors, word boundaries, and lookarounds match a position rather than characters. */
  readonly zeroWidth: boolean;
  readonly body?: Alternative[];
  readonly quantifier: Quantifier;
}

type Alternative = Atom[];

interface ParseState {
  index: number;
}

const ONCE: Quantifier = { min: 1, max: 1 };

/** The pattern is known to compile, so groups and character classes are balanced. */
function parseAlternatives(pattern: string, state: ParseState): Alternative[] {
  const alternatives: Alternative[] = [[]];

  while (state.index < pattern.length && pattern[state.index] !== ')') {
    if (pattern[state.index] === '|') {
      alternatives.push([]);
      state.index += 1;
      continue;
    }
    alternatives[alternatives.length - 1]?.push(parseAtom(pattern, state));
  }

  return alternatives;
}

function parseAtom(pattern: string, state: ParseState): Atom {
  const start = state.index;
  const char = pattern[start];
  let zeroWidth = false;
  let body: Alternative[] | undefined;

  if (char === '(') {
    state.index += 1;
    const prefix = /^\?(?::|<?[=!]|<[^>]*>)/.exec(pattern.slice(state.index))?.[0] ?? '';
    zeroWidth = /[=!]$/.test(prefix);
    state.index += prefix.length;
    body = parseAlternatives(pattern, state);
    state.index += 1;
  } else if (char === '[') {
    state.index = endOfCharacterClass(pattern, start);
  } else if (char === '\\') {
    state.index = endOfEscape(pattern, start);
    zeroWidth = /^\\[bB]$/.test(pattern.slice(start, state.index));
  } else {
    state.index += 1;
    zeroWidth = char === '^' || char === '$';
  }

  const source = pattern.slice(start, state.index);
  const quantifier = readQuantifier(pattern, state);
  return body ? { source, zeroWidth, body, quantifier } : { source, zeroWidth, quantifier };
}

function endOfCharacterClass(pattern: string, start: number): number {
  let i = start + 1;
  while (i < pattern.length && pattern[i] !== ']') {
    i += pattern[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

function endOfEscape(pattern: string, start: number): number {
  const rest = pattern.slice(start + 1);
  const escape =
    /^(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|c[a-zA-Z]|[0-9]+|k<[^>]*>)/.exec(rest)?.[0] ??
    rest.slice(0, 1);
  return start + 1 + escape.length;
}

function readQuantifier(pattern: string, state: ParseState): Quantifier {
  const char = pattern[state.index];
  let quantifier: Quantifier | null = null;
  let length = 1;

  if (char === '*') {
    quantifier = { min: 0, max: Infinity };
  } else if (char === '+') {
    quantifier = { min: 1, max: Infinity };
  } else if (char === '?') {
    quantifier = { min: 0, max: 1 };
  } else if (char === '{') {
    // A brace that isn't a well-formed quantifier is a literal in patterns without the u flag.
    const match = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(state.index));
    if (match) {
      const min = Number(match[1]);
      // {n} is exact, {n,} has no upper bound, and {n,m} is bounded.
      const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
      quantifier = { min, max };
      length = match[0].length;
    }
  }

  if (!quantifier) {
    return ONCE;
  }

  state.index += length;
  // A trailing ? makes the quantifier lazy, which changes the order of attempts, not how many.
  if (pattern[state.index] === '?') {
    state.index += 1;
  }
  return quantifier;
}

function findBacktrackingHazard(
  alternatives: readonly Alternative[]
): 'nested' | 'ambiguous' | null {
  for (const atom of alternatives.flat()) {
    if (!atom.body) {
      continue;
    }
    if (atom.quantifier.max === Infinity) {
      if (containsUnboundedRepeat(atom.body)) {
        return 'nested';
      }
      if (hasAmbiguousIterations(atom.body)) {
        return 'ambiguous';
      }
    }
    const inner = findBacktrackingHazard(atom.body);
    if (inner) {
      return inner;
    }
  }
  return null;
}

function containsUnboundedRepeat(alternatives: readonly Alternative[]): boolean {
  return alternatives
    .flat()
    .some(
      (atom) =>
        atom.quantifier.max === Infinity || (atom.body ? containsUnboundedRepeat(atom.body) : false)
    );
}

function hasAmbiguousIterations(alternatives: readonly Alternative[]): boolean {
  if (alternatives.some(isSingleVariableWidthAtom)) {
    return true;
  }

  const firstSets = alternatives.map(firstCharacters);
  return firstSets.some((set, i) => firstSets.slice(i + 1).some((other) => overlaps(set, other)));
}

function isSingleVariableWidthAtom(alternative: Alternative): boolean {
  const consuming = alternative.filter((atom) => !atom.zeroWidth);
  const atom = consuming[0];
  if (consuming.length !== 1 || !atom) {
    return false;
  }
  if (atom.quantifier.min !== atom.quantifier.max) {
    return true;
  }
  // A plain group around the atom, as in ((a{2,4}))*, hides nothing.
  return atom.body !== undefined && atom.quantifier.max === 1 && hasAmbiguousIterations(atom.body);
}

/**
 * The characters an atom can start with are probed over ASCII plus a few non-ASCII samples,
 * which is exact for the literals, escapes, and classes URL patterns use.
 */
const PROBE_CHARACTERS = [
  ...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)),
  '\u00e9',
  '\u2028',
];

type CharacterSet = readonly boolean[];

const ANY_CHARACTER: CharacterSet = PROBE_CHARACTERS.map(() => true);

function firstCharacters(alternative: Alternative): CharacterSet {
  let result: CharacterSet = PROBE_CHARACTERS.map(() => false);

  for (const atom of alternative) {
    if (atom.zeroWidth) {
      continue;
    }
    result = union(result, atomFirstCharacters(atom));
    if (atom.quantifier.min > 0) {
      break;
    }
  }

  return result;
}

function atomFirstCharacters(atom: Atom): CharacterSet {
  if (atom.body) {
    return atom.body.map(firstCharacters).reduce(union);
  }
  // A backreference can start with whatever its group captured.
  if (/^\\(?:[1-9]|k<)/.test(atom.source)) {
    return ANY_CHARACTER;
  }
  const regex = new RegExp(`^(?:${atom.source})$`);
  return PROBE_CHARACTERS.map((char) => regex.test(char));
}

function union(a: CharacterSet, b: CharacterSet): CharacterSet {
  return a.map((value, i) => value || (b[i] ?? false));
}

function overlaps(a: CharacterSet, b: CharacterSet): boolean {
  return a.some((value, i) => value && (b[i] ?? false));
}

export function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export function preparePattern(
  pattern: string,
  matchMode: FilterMatchMode
): Pick<PreparedPattern, 'patternLower' | 'regex'> {
  if (matchMode === 'regex') {
    return { regex: compileRegex(pattern) };
  }
  if (matchMode === 'exact') {
    return { patternLower: normalizeExactUrl(pattern) };
  }
  if (matchMode === 'domain') {
    return { patternLower: normalizeDomainPattern(pattern) ?? pattern.trim().toLowerCase() };
  }
  return { patternLower: pattern.toLowerCase() };
}

/**
 * Compare exact patterns the way the browser reports URLs, not character for character. The
 * browser always gives an origin a path, so https://example.com arrives as https://example.com/,
 * and a fragment only scrolls within the page, so #anything must not get around an exact filter.
 * A pattern that isn't a URL is compared as typed.
 */
function normalizeExactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.href.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function matchesPattern(
  url: string,
  pattern: string | PreparedPattern,
  matchMode: FilterMatchMode = 'contains',
  preparedUrl?: PreparedUrl
): boolean {
  let resolvedPattern: string;
  let resolvedMode: FilterMatchMode;
  let patternLower: string | undefined;
  let regex: RegExp | null | undefined;

  if (typeof pattern === 'string') {
    resolvedPattern = pattern;
    resolvedMode = matchMode;
  } else {
    resolvedPattern = pattern.pattern;
    resolvedMode = pattern.matchMode;
    patternLower = pattern.patternLower;
    regex = pattern.regex;
  }

  if (resolvedMode === 'regex') {
    if (regex === null) {
      return false;
    }
    const resolvedRegex = regex ?? compileRegex(resolvedPattern);
    if (!resolvedRegex) {
      return false;
    }
    return resolvedRegex.test(url);
  }

  if (resolvedMode === 'exact') {
    return normalizeExactUrl(url) === (patternLower ?? normalizeExactUrl(resolvedPattern));
  }

  if (resolvedMode === 'domain') {
    const domain = patternLower ?? preparePattern(resolvedPattern, 'domain').patternLower;
    const host = preparedUrl ? preparedUrl.host : getUrlHost(url);
    // A whole label must match, so reddit.com covers old.reddit.com but not notreddit.com.
    return host !== null && (host === domain || host.endsWith(`.${domain ?? ''}`));
  }

  const normalizedUrl = preparedUrl?.lower ?? url.toLowerCase();
  const normalizedPattern = patternLower ?? resolvedPattern.toLowerCase();

  return normalizedUrl.includes(normalizedPattern);
}
