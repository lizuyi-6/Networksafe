/**
 * SECURITY FIX (R6 V2.4 + Wave 6 F13): Reject user-controlled regex patterns
 * that could trigger catastrophic backtracking (ReDoS).
 *
 * This module provides a lightweight static check for the most common
 * ReDoS shapes. It does NOT replace a full complexity analyzer (e.g. the
 * `safe-regex` npm package) but is sufficient to block the well-known
 * patterns that can lock up a single-threaded Node.js event loop.
 *
 * Threat model: any caller that forwards a user-supplied regex string into
 * `new RegExp(userInput, flags)` MUST route the input through
 * `validateRegexPattern` first.
 */

const MAX_PATTERN_LENGTH = 500;
const MAX_GROUP_DEPTH = 3;

/**
 * Quantifier immediately following another quantifier (e.g. `}+`, `}*`).
 * The `}` is part of a `{n,m}` quantifier, so `}+` means "quantify a
 * quantifier", which the JS engine rejects with a SyntaxError. Detecting
 * this shape (and similar) up-front gives a friendlier error and prevents
 * patterns such as `[\s\S]{400}+` from being compiled in the first place.
 */
const QUANTIFIER_ON_QUANTIFIER = /[}]\s*[+*?{]/;

/**
 * Recursive structural detector for nested-quantifier catastrophic
 * backtracking. A regex is considered dangerous when ANY group is BOTH
 * followed by an unbounded quantifier (`+` or `*`, including after a
 * `{n,m}` quantifier) AND its content contains a quantifier, an
 * alternation, or a nested quantified group — at any depth.
 *
 * This single function covers the four ReDoS families that the original
 * R6 regex missed:
 *
 *   - Alternation:           `(a|a)*`, `([abc]|[def])+x`
 *   - Non-capturing group:   `(?:a+)+`
 *   - Lookahead / lookbehind: `(?=(a+)+$)`, `(?<=(a+)+)`
 *   - Char-class quantifier:  `([\s\S]{400})+\d`
 *
 * It also continues to catch the original shapes:
 *
 *   - `(a+)+b`  `(a+)*`  `(.*)*`  `(a+)+`  `(a|b+)+`  `(a*)*b`
 *
 * The function is intentionally cheap: a single left-to-right pass with
 * O(n) work, no regex compilation of the user pattern, no execution
 * against arbitrary input.
 */
function findCharClassEnd(pattern: string, start: number): number {
  // `start` points at the opening '[' of a character class. Returns the
  // index of the matching ']'. Handles '[^' negation and the leading
  // literal-']' escape (the first ']' after '[' or '[^' is treated as a
  // literal, not a class terminator).
  let i = start + 1;
  if (pattern[i] === '^') i += 1;
  if (pattern[i] === ']') i += 1;
  while (i < pattern.length && pattern[i] !== ']') {
    if (pattern[i] === '\\') i += 1; // skip escaped char
    i += 1;
  }
  return i;
}

function findMatchingParen(pattern: string, start: number): number {
  // Returns the index of the ')' that closes the '(' at `start`.
  let depth = 0;
  for (let i = start; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1; // skip escaped char
      continue;
    }
    if (ch === '[') {
      i = findCharClassEnd(pattern, i);
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function getQuantifierEnd(pattern: string, closeIdx: number): number {
  // Returns the index AFTER any quantifier that follows the ')' at
  // `closeIdx`. Recognises `+`, `*`, and bounded `{n}`, `{n,}`, `{n,m}`.
  let i = closeIdx + 1;
  if (i < pattern.length && pattern[i] === '{') {
    const close = pattern.indexOf('}', i);
    if (close !== -1) {
      const inner = pattern.substring(i + 1, close);
      if (/^\d+(,\d*)?$/.test(inner)) {
        return close + 1;
      }
    }
  }
  if (i < pattern.length && (pattern[i] === '+' || pattern[i] === '*')) {
    return i + 1;
  }
  return closeIdx + 1;
}

function contentHasDanger(content: string): boolean {
  // Returns true if `content` contains a quantifier, an alternation, or
  // a nested quantified group — at any depth. Used to decide whether a
  // quantified outer group can backtrack catastrophically.
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2; // skip escape
      continue;
    }
    if (ch === '[') {
      i = findCharClassEnd(content, i) + 1;
      continue;
    }
    if (ch === '(') {
      const close = findMatchingParen(content, i);
      if (close === -1) return false;
      const innerAfter = getQuantifierEnd(content, close);
      if (innerAfter > close + 1) {
        // Nested group is itself quantified — that's already "danger"
        // for the purposes of an outer quantified group.
        return true;
      }
      if (contentHasDanger(content.substring(i + 1, close))) return true;
      i = innerAfter;
      continue;
    }
    if (ch === '+' || ch === '*' || ch === '|') return true;
    if (ch === '{') {
      // Bounded quantifier like `{400}` or `{1,1000}` counts as danger.
      const close = content.indexOf('}', i);
      if (close !== -1) {
        const inner = content.substring(i + 1, close);
        if (/^\d+(,\d*)?$/.test(inner)) return true;
      }
    }
    i += 1;
  }
  return false;
}

function scanForNestedQuantifier(s: string, start: number, end: number): boolean {
  // Walks `s[start..end)` looking for a group that is BOTH quantified
  // AND has dangerous content (or contains an inner nested quantifier).
  let i = start;
  while (i < end) {
    const ch = s[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i = findCharClassEnd(s, i) + 1;
      continue;
    }
    if (ch === '(') {
      const close = findMatchingParen(s, i);
      if (close === -1 || close >= end) return false;
      const content = s.substring(i + 1, close);
      const afterEnd = getQuantifierEnd(s, close);
      const isQuantified = afterEnd > close + 1;
      if (isQuantified && contentHasDanger(content)) return true;
      // Recurse into the content so inner nested groups are also checked.
      if (scanForNestedQuantifier(content, 0, content.length)) return true;
      i = afterEnd;
      continue;
    }
    i += 1;
  }
  return false;
}

/**
 * Back-reference with a quantifier. This covers the V11.19 meta-attack
 * family — e.g. `(.+)\1+`, `(.+)\1*`, `(.+)\1{2,}`, `(a)\1+`. The
 * regex engine has to re-scan the captured group on every
 * back-reference match attempt, and a greedy capture combined with a
 * quantified back-reference causes runaway work on long input. The
 * check matches `\1`-`\9` followed by EITHER a `+`/`*` quantifier OR a
 * bounded `{n}`/`{n,}`/`{n,m}` quantifier.
 * See docs/security-audit/2026-06-06-wave7-meta-attack-3.md (V11.19).
 */
const BACKREFERENCE_WITH_QUANTIFIER = /\\\d+(?:\{[^}{]+\}|[+*])/;

function hasNestedQuantifier(pattern: string): boolean {
  // Quantifier-on-quantifier is illegal JS regex syntax and almost
  // always an attack artefact (e.g. `[\s\S]{400}+`).
  if (QUANTIFIER_ON_QUANTIFIER.test(pattern)) return true;
  // Back-reference + quantifier is the V11.19 false-negative family.
  // Any back-reference (`\1`..`\9`) followed by a `+`/`*` or a
  // bounded `{n}`/`{n,}`/`{n,m}` quantifier is rejected up-front so
  // the engine never has to evaluate it.
  if (BACKREFERENCE_WITH_QUANTIFIER.test(pattern)) return true;
  return scanForNestedQuantifier(pattern, 0, pattern.length);
}

/**
 * Back-reference with a tight unbounded quantifier, e.g. `(.+)\1{2,}`.
 * This shape can be linear in the input but the engine still has to
 * re-scan the captured group for each back-reference. Combined with the
 * `(.+)` greedy capture it tends to be slow on long inputs.
 */
const HEAVY_BACKREFERENCE = /\(\.\+\)\\\d+\{\d+,?\d*\}/;

export interface RegexValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Statically validate a user-supplied regex pattern string.
 *
 * Returns `{ valid: true }` if the pattern passes every heuristic, or
 * `{ valid: false, reason }` describing the first violation found.
 *
 * The function is intentionally cheap: no regex compilation, no execution
 * against arbitrary input — only a length check and a handful of
 * `RegExp.test` calls on the pattern string itself.
 */
export function validateRegexPattern(pattern: string): RegexValidation {
  if (typeof pattern !== 'string') {
    return { valid: false, reason: 'Pattern must be a string' };
  }

  if (pattern.length === 0) {
    return { valid: false, reason: 'Pattern must not be empty' };
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      valid: false,
      reason: `Pattern exceeds ${MAX_PATTERN_LENGTH} chars (got ${pattern.length})`
    };
  }

  if (hasNestedQuantifier(pattern)) {
    return {
      valid: false,
      reason: 'Catastrophic backtracking pattern detected (nested quantifier)'
    };
  }

  if (HEAVY_BACKREFERENCE.test(pattern)) {
    return {
      valid: false,
      reason: 'Heavy back-reference pattern detected'
    };
  }

  // Compute maximum group nesting depth via a single pass over the string.
  // We skip escaped characters so "\(" / "\)" don't fool the counter.
  let depth = 0;
  let maxDepth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      // Skip the next character — it is an escape sequence.
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === ')') {
      if (depth > 0) depth -= 1;
    }
  }

  if (maxDepth > MAX_GROUP_DEPTH) {
    return {
      valid: false,
      reason: `Group nesting depth ${maxDepth} exceeds ${MAX_GROUP_DEPTH}`
    };
  }

  return { valid: true };
}

export const SAFE_REGEX_LIMITS = {
  MAX_PATTERN_LENGTH,
  MAX_GROUP_DEPTH
};
