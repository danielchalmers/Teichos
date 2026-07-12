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

  if (hasNestedUnboundedQuantifier(pattern)) {
    return 'Nested unbounded repetition like (a+)+ can hang the browser while matching. Simplify the pattern.';
  }

  return null;
}

/**
 * Detect a repeated group that itself contains an unbounded repeat, e.g. (a+)+ or (a*){2,}.
 * These patterns can backtrack exponentially, and filters run on every navigation inside the
 * service worker, so a catastrophic pattern freezes all block/allow decisions. The pattern is
 * known to compile before this runs, so parentheses outside character classes are balanced.
 */
function hasNestedUnboundedQuantifier(pattern: string): boolean {
  const containsUnbounded: boolean[] = [false];
  let inCharacterClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '\\') {
      i += 1;
      continue;
    }

    if (inCharacterClass) {
      if (char === ']') {
        inCharacterClass = false;
      }
      continue;
    }

    switch (char) {
      case '[':
        inCharacterClass = true;
        break;
      case '(':
        containsUnbounded.push(false);
        break;
      case ')': {
        const groupHadUnbounded = containsUnbounded.pop() ?? false;
        const quantifier = readQuantifier(pattern, i + 1);
        if (groupHadUnbounded && quantifier.unbounded) {
          return true;
        }
        if (groupHadUnbounded || quantifier.unbounded) {
          containsUnbounded[containsUnbounded.length - 1] = true;
        }
        i += quantifier.length;
        break;
      }
      case '+':
      case '*':
        containsUnbounded[containsUnbounded.length - 1] = true;
        break;
      case '{': {
        const quantifier = readBraceQuantifier(pattern, i);
        if (quantifier) {
          if (quantifier.unbounded) {
            containsUnbounded[containsUnbounded.length - 1] = true;
          }
          i += quantifier.length - 1;
        }
        break;
      }
    }
  }

  return false;
}

interface QuantifierScan {
  readonly unbounded: boolean;
  readonly length: number;
}

function readQuantifier(pattern: string, index: number): QuantifierScan {
  const char = pattern[index];
  if (char === '+' || char === '*') {
    return { unbounded: true, length: 1 };
  }
  if (char === '{') {
    const brace = readBraceQuantifier(pattern, index);
    if (brace) {
      return brace;
    }
  }
  return { unbounded: false, length: 0 };
}

function readBraceQuantifier(pattern: string, index: number): QuantifierScan | null {
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(index));
  if (!match) {
    return null;
  }
  // {n,} has no upper bound; {n} and {n,m} are bounded.
  return { unbounded: match[2] === '', length: match[0].length };
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
