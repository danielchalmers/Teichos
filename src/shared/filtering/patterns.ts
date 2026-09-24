import type { FilterMatchMode } from '../types';

export interface PreparedPattern {
  readonly pattern: string;
  readonly matchMode: FilterMatchMode;
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
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
  return { patternLower: pattern.toLowerCase() };
}

export function matchesPattern(
  url: string,
  pattern: string | PreparedPattern,
  matchMode: FilterMatchMode = 'contains',
  urlLower?: string
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

  const normalizedUrl = urlLower ?? url.toLowerCase();
  const normalizedPattern = patternLower ?? resolvedPattern.toLowerCase();

  if (resolvedMode === 'exact') {
    return normalizedUrl === normalizedPattern;
  }

  return normalizedUrl.includes(normalizedPattern);
}
