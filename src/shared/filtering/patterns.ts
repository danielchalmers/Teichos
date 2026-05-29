import type { FilterMatchMode } from '../types';

export interface PreparedPattern {
  readonly pattern: string;
  readonly matchMode: FilterMatchMode;
  readonly patternLower?: string;
  readonly regex?: RegExp | null;
}

export function getRegexValidationError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
