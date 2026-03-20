import { createHash } from 'crypto';

export type DetectionChannel = 'http_api' | 'packet' | 'agent';
export type DetectionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DetectionRuleAction = 'block' | 'allow' | 'review';
export type DetectionVerdict = 'allow' | 'block' | 'monitor';
export type DetectionAttackFamily =
  | 'benign'
  | 'sqli'
  | 'xss'
  | 'path_traversal'
  | 'command_injection'
  | 'ssrf'
  | 'automation'
  | 'other';

export interface DetectionSignal {
  source: 'rule' | 'heuristic' | 'existing_signal' | 'ai';
  key: string;
  score: number;
  severity: DetectionSeverity;
  description: string;
  metadata?: Record<string, any>;
}

export interface DetectionRuleMatcher {
  pathPatterns?: string[];
  bodyPatterns?: string[];
  userAgentPatterns?: string[];
  evidencePatterns?: string[];
  sourceIpPatterns?: string[];
  methodPatterns?: string[];
  keywordPatterns?: string[];
  headerPatterns?: Record<string, string[]>;
}

export interface DetectionRequest {
  tenantId: string;
  channel: DetectionChannel;
  requestId: string;
  timestamp: string;
  sourceIp?: string;
  method?: string;
  path?: string;
  decodedPath?: string;
  query?: string;
  decodedQuery?: string;
  parsedQuery?: string;
  headers?: Record<string, string>;
  body?: string;
  normalizedBody?: string;
  parsedBody?: string;
  userAgent?: string;
  evidence?: string;
  protocol?: string;
  rawPayload?: string;
  existingSignals?: DetectionSignal[];
  metadata?: Record<string, any>;
}

export interface DetectionRuleRecord {
  ruleId: string;
  tenantId: string;
  name: string;
  description?: string;
  scope: DetectionChannel | 'all';
  action: DetectionRuleAction;
  priority: number;
  severity: DetectionSeverity;
  matcher: DetectionRuleMatcher;
  source: 'seed' | 'dynamic' | 'candidate';
  enabled: boolean;
  attackFamily?: DetectionAttackFamily;
  version: number;
  metadata?: Record<string, any>;
}

export interface MatchedRule {
  rule: DetectionRuleRecord;
  signal: DetectionSignal;
}

export interface RuleEvaluationResult {
  matchedRules: MatchedRule[];
  matchedRuleIds: string[];
  highestPriorityRule: DetectionRuleRecord | null;
  ruleVerdict: DetectionVerdict | null;
  shouldEscalate: boolean;
  riskScore: number;
  signals: DetectionSignal[];
}

export interface HeuristicAssessment {
  riskScore: number;
  signals: DetectionSignal[];
}

export interface DetectionCandidateSuggestion {
  attackFamily: DetectionAttackFamily;
  matcher: DetectionRuleMatcher;
  matcherFingerprint: string;
  name: string;
  severity: DetectionSeverity;
  description: string;
}

const AUTOMATION_UA_MARKERS = [
  'sqlmap',
  'nikto',
  'masscan',
  'zgrab',
  'curl/',
  'wget/',
  'python-requests',
  'axios',
  'headless',
  'selenium',
  'scrapy',
  'crawler',
  'spider',
  'bot'
];

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, score));
}

function severityToScore(severity: DetectionSeverity): number {
  switch (severity) {
    case 'critical':
      return 1;
    case 'high':
      return 0.85;
    case 'medium':
      return 0.55;
    default:
      return 0.25;
  }
}

export function severityToBlockDurationSeconds(severity: DetectionSeverity): number {
  switch (severity) {
    case 'critical':
      return 7200;
    case 'high':
      return 3600;
    case 'medium':
      return 1800;
    default:
      return 900;
  }
}

function compilePattern(pattern: string): RegExp {
  return new RegExp(pattern, 'i');
}

function anyPatternMatches(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  if (!value) {
    return false;
  }
  return patterns.some((pattern) => compilePattern(pattern).test(value));
}

function matchesHeaderPatterns(
  headerPatterns: Record<string, string[]> | undefined,
  headers: Record<string, string>
): boolean {
  if (!headerPatterns || Object.keys(headerPatterns).length === 0) {
    return true;
  }

  return Object.entries(headerPatterns).every(([key, patterns]) => {
    const normalizedKey = String(key || '').toLowerCase();
    const headerValue = normalizedKey === '*'
      ? Object.entries(headers)
          .map(([headerKey, headerValue]) => `${headerKey}: ${headerValue}`)
          .join('\n')
      : String(headers[normalizedKey] || '');
    return anyPatternMatches(patterns, headerValue);
  });
}

function buildSearchCorpus(request: DetectionRequest): Record<string, string> {
  const headers = Object.entries(request.headers || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const pathCorpus = uniqueStrings([
    request.path || '',
    request.decodedPath || '',
    request.query || '',
    request.decodedQuery || '',
    request.parsedQuery || ''
  ]).join('\n');
  const bodyCorpus = uniqueStrings([
    request.body || '',
    request.normalizedBody || '',
    request.parsedBody || ''
  ]).join('\n');
  const evidenceCorpus = uniqueStrings([
    request.evidence || '',
    request.rawPayload || ''
  ]).join('\n');
  const userAgent = String(request.userAgent || request.headers?.['user-agent'] || '');

  return {
    method: String(request.method || ''),
    path: pathCorpus,
    query: uniqueStrings([
      request.query || '',
      request.decodedQuery || '',
      request.parsedQuery || ''
    ]).join('\n'),
    body: bodyCorpus,
    userAgent,
    evidence: evidenceCorpus,
    sourceIp: String(request.sourceIp || ''),
    headers,
    keywords: [
      request.method || '',
      pathCorpus,
      bodyCorpus,
      userAgent,
      evidenceCorpus,
      headers
    ].join('\n')
  };
}

function matcherMatchesRequest(matcher: DetectionRuleMatcher, request: DetectionRequest): boolean {
  const corpus = buildSearchCorpus(request);
  const headers = Object.entries(request.headers || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});

  return (
    anyPatternMatches(matcher.methodPatterns, corpus.method) &&
    anyPatternMatches(matcher.pathPatterns, corpus.path) &&
    anyPatternMatches(matcher.bodyPatterns, corpus.body) &&
    anyPatternMatches(matcher.userAgentPatterns, corpus.userAgent) &&
    anyPatternMatches(matcher.evidencePatterns, corpus.evidence) &&
    anyPatternMatches(matcher.sourceIpPatterns, corpus.sourceIp) &&
    anyPatternMatches(matcher.keywordPatterns, corpus.keywords) &&
    matchesHeaderPatterns(matcher.headerPatterns, headers)
  );
}

function actionRank(action: DetectionRuleAction): number {
  switch (action) {
    case 'block':
      return 3;
    case 'allow':
      return 2;
    default:
      return 1;
  }
}

function combineScores(scores: number[]): number {
  const normalized = scores.map(clampScore).filter((score) => score > 0);
  if (normalized.length === 0) {
    return 0;
  }

  const remaining = normalized.reduce((product, score) => product * (1 - score), 1);
  return Number((1 - remaining).toFixed(4));
}

function calculateEntropy(value: string): number {
  if (!value) {
    return 0;
  }

  const frequencies = new Map<string, number>();
  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

function detectRepeatedCharacters(value: string): number {
  let maxRun = 0;
  let currentChar = '';
  let currentRun = 0;

  for (const char of value) {
    if (char === currentChar) {
      currentRun += 1;
    } else {
      currentChar = char;
      currentRun = 1;
    }
    maxRun = Math.max(maxRun, currentRun);
  }

  return maxRun;
}

export function buildSeedDetectionRules(): DetectionRuleRecord[] {
  const base: Array<Omit<DetectionRuleRecord, 'tenantId' | 'enabled' | 'version'>> = [
    {
      ruleId: 'seed-sqli-union',
      name: 'SQLi UNION SELECT',
      description: 'Blocks classic UNION SELECT injection payloads.',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      attackFamily: 'sqli',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          '(?:\\s|%20)union(?:\\s|%20)+(?:all(?:\\s|%20)+)?select'
        ]
      }
    },
    {
      ruleId: 'seed-sqli-auth-bypass',
      name: 'SQLi Auth Bypass',
      description: 'Blocks common OR 1=1 authentication bypass payloads.',
      scope: 'all',
      action: 'block',
      priority: 995,
      severity: 'high',
      attackFamily: 'sqli',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          "'\\s*or\\s*'1'\\s*=\\s*'1",
          "'\\s*or\\s*1\\s*=\\s*1"
        ]
      }
    },
    {
      ruleId: 'seed-sqli-stacked',
      name: 'SQLi Stacked Query',
      description: 'Blocks stacked SQL mutation attempts.',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      attackFamily: 'sqli',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          ';\\s*(drop|delete|insert|update|alter|truncate|create)\\b'
        ]
      }
    },
    {
      ruleId: 'seed-xss-script',
      name: 'XSS Script Tag',
      description: 'Blocks script-tag based XSS payloads.',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      attackFamily: 'xss',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          '<script[^>]*>',
          '</script>',
          'javascript:'
        ]
      }
    },
    {
      ruleId: 'seed-path-traversal',
      name: 'Path Traversal',
      description: 'Blocks parent-directory traversal and sensitive file access.',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      attackFamily: 'path_traversal',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          '\\.\\./',
          '\\.\\.%2[fF]',
          '%2e%2e%2f',
          '/etc/passwd',
          '/etc/shadow',
          '\\.env\\b',
          '\\.git/'
        ]
      }
    },
    {
      ruleId: 'seed-command-injection',
      name: 'Command Injection',
      description: 'Blocks shell metacharacter command execution payloads.',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      attackFamily: 'command_injection',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          ';\\s*(cat|ls|curl|wget|bash|sh|whoami|id|uname)\\b',
          '\\|\\s*(cat|ls|curl|wget|bash|sh|whoami|id|uname)\\b',
          '`[^`]+`',
          '\\$\\([^)]+\\)'
        ]
      }
    },
    {
      ruleId: 'seed-ssrf-review',
      name: 'SSRF Metadata Probe',
      description: 'Flags metadata service access for AI review.',
      scope: 'http_api',
      action: 'review',
      priority: 450,
      severity: 'medium',
      attackFamily: 'ssrf',
      source: 'seed',
      matcher: {
        keywordPatterns: [
          '169\\.254\\.169\\.254',
          'metadata\\.google\\.internal',
          'latest/meta-data'
        ]
      }
    },
    {
      ruleId: 'seed-automation-review',
      name: 'Suspicious Automation User-Agent',
      description: 'Flags automation tooling for AI review.',
      scope: 'all',
      action: 'review',
      priority: 420,
      severity: 'medium',
      attackFamily: 'automation',
      source: 'seed',
      matcher: {
        userAgentPatterns: AUTOMATION_UA_MARKERS.map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
    }
  ];

  return base.map((rule) => ({
    ...rule,
    tenantId: 'global',
    enabled: true,
    version: 1
  }));
}

export function evaluateDetectionRules(
  request: DetectionRequest,
  rules: DetectionRuleRecord[]
): RuleEvaluationResult {
  const applicableRules = rules
    .filter((rule) => rule.enabled)
    .filter((rule) => rule.scope === 'all' || rule.scope === request.channel);

  const matchedRules = applicableRules
    .filter((rule) => matcherMatchesRequest(rule.matcher, request))
    .sort((left, right) => {
      const priorityDelta = right.priority - left.priority;
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return actionRank(right.action) - actionRank(left.action);
    })
    .map((rule) => ({
      rule,
      signal: {
        source: 'rule' as const,
        key: rule.ruleId,
        score: severityToScore(rule.severity),
        severity: rule.severity,
        description: rule.description || rule.name,
        metadata: {
          action: rule.action,
          priority: rule.priority,
          attackFamily: rule.attackFamily
        }
      }
    }));

  const highestPriorityRule = matchedRules[0]?.rule || null;
  const matchedRuleIds = matchedRules.map((item) => item.rule.ruleId);
  const signals = matchedRules.map((item) => item.signal);

  let ruleVerdict: DetectionVerdict | null = null;
  let shouldEscalate = false;

  if (highestPriorityRule?.action === 'block') {
    ruleVerdict = 'block';
  } else if (highestPriorityRule?.action === 'allow') {
    ruleVerdict = 'allow';
  } else if (matchedRules.some((item) => item.rule.action === 'review')) {
    ruleVerdict = 'monitor';
    shouldEscalate = true;
  }

  return {
    matchedRules,
    matchedRuleIds,
    highestPriorityRule,
    ruleVerdict,
    shouldEscalate,
    riskScore: combineScores(signals.map((signal) => signal.score)),
    signals
  };
}

export function assessDetectionHeuristics(request: DetectionRequest): HeuristicAssessment {
  const combinedText = [
    request.path || '',
    request.decodedPath || '',
    request.query || '',
    request.decodedQuery || '',
    request.parsedQuery || '',
    request.body || '',
    request.normalizedBody || '',
    request.parsedBody || '',
    request.evidence || '',
    request.rawPayload || '',
    request.userAgent || '',
    Object.entries(request.headers || {}).map(([key, value]) => `${key}: ${value}`).join('\n')
  ].join('\n');

  const signals: DetectionSignal[] = [];
  const userAgent = String(request.userAgent || request.headers?.['user-agent'] || '').toLowerCase();

  const automationMatch = AUTOMATION_UA_MARKERS.find((marker) => userAgent.includes(marker));
  if (automationMatch) {
    signals.push({
      source: 'heuristic',
      key: 'heuristic-automation',
      score: 0.42,
      severity: 'medium',
      description: `Automation marker detected in user-agent: ${automationMatch}`
    });
  }

  if (combinedText.length > 4096) {
    signals.push({
      source: 'heuristic',
      key: 'heuristic-large-payload',
      score: combinedText.length > 8192 ? 0.45 : 0.25,
      severity: combinedText.length > 8192 ? 'high' : 'medium',
      description: `Large payload observed (${combinedText.length} bytes)`
    });
  }

  const entropy = calculateEntropy(combinedText);
  if (combinedText.length > 128 && entropy > 4.6) {
    signals.push({
      source: 'heuristic',
      key: 'heuristic-high-entropy',
      score: 0.34,
      severity: 'medium',
      description: `High-entropy payload observed (${entropy.toFixed(2)})`
    });
  }

  const repeats = detectRepeatedCharacters(combinedText);
  if (repeats > 32) {
    signals.push({
      source: 'heuristic',
      key: 'heuristic-fuzzing',
      score: 0.4,
      severity: 'medium',
      description: `Repeated character run observed (${repeats})`
    });
  }

  const newlineHeaders = Object.values(request.headers || {}).some((value) => /[\r\n]/.test(String(value)));
  if (newlineHeaders) {
    signals.push({
      source: 'heuristic',
      key: 'heuristic-header-injection',
      score: 0.5,
      severity: 'high',
      description: 'Header injection markers detected'
    });
  }

  for (const signal of request.existingSignals || []) {
    signals.push({
      ...signal,
      source: 'existing_signal'
    });
  }

  return {
    riskScore: combineScores(signals.map((signal) => signal.score)),
    signals
  };
}

export function inferAttackFamily(request: DetectionRequest, signals: DetectionSignal[] = []): DetectionAttackFamily {
  const corpus = [
    request.path || '',
    request.decodedPath || '',
    request.query || '',
    request.decodedQuery || '',
    request.parsedQuery || '',
    request.body || '',
    request.normalizedBody || '',
    request.parsedBody || '',
    request.evidence || '',
    request.rawPayload || '',
    request.userAgent || '',
    ...signals.map((signal) => signal.description || '')
  ].join('\n').toLowerCase();

  if (/union\s+select|'?\s*or\s+1\s*=\s*1|drop\s+table/.test(corpus)) {
    return 'sqli';
  }
  if (/<script|javascript:|onerror\s*=|onload\s*=/.test(corpus)) {
    return 'xss';
  }
  if (/\.\.\/|%2e%2e%2f|\/etc\/passwd|\.env\b/.test(corpus)) {
    return 'path_traversal';
  }
  if (/;\s*(cat|ls|curl|wget|bash|sh)|\|\s*(cat|ls|curl|wget|bash|sh)|\$\(|`/.test(corpus)) {
    return 'command_injection';
  }
  if (/169\.254\.169\.254|metadata\.google\.internal|latest\/meta-data/.test(corpus)) {
    return 'ssrf';
  }
  if (AUTOMATION_UA_MARKERS.some((marker) => corpus.includes(marker))) {
    return 'automation';
  }
  return 'other';
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function extractSuspiciousFragments(input: string, family: DetectionAttackFamily): string[] {
  if (!input) {
    return [];
  }

  const patterns: Record<DetectionAttackFamily, RegExp[]> = {
    benign: [],
    sqli: [
      /union\s+(?:all\s+)?select[^\s"']*/ig,
      /'\s*or\s*'1'\s*=\s*'1/ig,
      /'\s*or\s*1\s*=\s*1/ig,
      /;\s*(drop|delete|insert|update|truncate|alter)[^&\s]*/ig
    ],
    xss: [
      /<script[^>]*>[\s\S]*?<\/script>/ig,
      /on(?:error|load|click|mouseover)\s*=\s*[^&\s>]+/ig,
      /javascript:[^&\s'"]+/ig
    ],
    path_traversal: [
      /(?:\.\.\/)+[^\s"'&]*/ig,
      /%2e%2e%2f[^\s"'&]*/ig,
      /\/etc\/(?:passwd|shadow)/ig
    ],
    command_injection: [
      /(?:;|\||&&)\s*(?:cat|ls|curl|wget|bash|sh|whoami|id)[^&\s]*/ig,
      /`[^`]+`/g,
      /\$\([^)]+\)/g
    ],
    ssrf: [
      /169\.254\.169\.254[^\s"'&]*/ig,
      /metadata\.google\.internal[^\s"'&]*/ig,
      /latest\/meta-data[^\s"'&]*/ig
    ],
    automation: AUTOMATION_UA_MARKERS.map((marker) => new RegExp(escapeForRegex(marker), 'ig')),
    other: []
  };

  const matches = (patterns[family] || []).flatMap((pattern) => input.match(pattern) || []);
  if (matches.length > 0) {
    return uniqueStrings(matches).slice(0, 4);
  }

  return uniqueStrings(
    input
      .split(/[\s&?=]+/)
      .filter((token) => token.length >= 4)
      .slice(0, 4)
      .map(escapeForRegex)
  );
}

function buildMatcherFromFragments(request: DetectionRequest, fragments: string[]): DetectionRuleMatcher {
  const matcher: DetectionRuleMatcher = {};
  const normalizedFragments = uniqueStrings(fragments).slice(0, 4);

  if (normalizedFragments.length === 0) {
    return matcher;
  }

  const path = uniqueStrings([
    request.path || '',
    request.decodedPath || '',
    request.query || '',
    request.decodedQuery || '',
    request.parsedQuery || ''
  ]).join('\n');
  const body = uniqueStrings([
    request.body || '',
    request.normalizedBody || '',
    request.parsedBody || ''
  ]).join('\n');
  const evidence = uniqueStrings([
    request.evidence || '',
    request.rawPayload || ''
  ]).join('\n');
  const userAgent = String(request.userAgent || request.headers?.['user-agent'] || '');

  if (path && normalizedFragments.some((fragment) => compilePattern(fragment).test(path))) {
    matcher.pathPatterns = normalizedFragments;
  }
  if (body && normalizedFragments.some((fragment) => compilePattern(fragment).test(body))) {
    matcher.bodyPatterns = normalizedFragments;
  }
  if (evidence && normalizedFragments.some((fragment) => compilePattern(fragment).test(evidence))) {
    matcher.evidencePatterns = normalizedFragments;
  }
  if (userAgent && normalizedFragments.some((fragment) => compilePattern(fragment).test(userAgent))) {
    matcher.userAgentPatterns = normalizedFragments;
  }

  if (
    !matcher.pathPatterns &&
    !matcher.bodyPatterns &&
    !matcher.evidencePatterns &&
    !matcher.userAgentPatterns
  ) {
    matcher.keywordPatterns = normalizedFragments;
  }

  return matcher;
}

export function canonicalizeMatcher(matcher: DetectionRuleMatcher): string {
  const normalizedHeaders = Object.entries(matcher.headerPatterns || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, string[]>>((acc, [key, values]) => {
      acc[key] = uniqueStrings(values).sort();
      return acc;
    }, {});

  const normalized = {
    pathPatterns: uniqueStrings(matcher.pathPatterns || []).sort(),
    bodyPatterns: uniqueStrings(matcher.bodyPatterns || []).sort(),
    userAgentPatterns: uniqueStrings(matcher.userAgentPatterns || []).sort(),
    evidencePatterns: uniqueStrings(matcher.evidencePatterns || []).sort(),
    sourceIpPatterns: uniqueStrings(matcher.sourceIpPatterns || []).sort(),
    methodPatterns: uniqueStrings(matcher.methodPatterns || []).sort(),
    keywordPatterns: uniqueStrings(matcher.keywordPatterns || []).sort(),
    headerPatterns: normalizedHeaders
  };

  return JSON.stringify(normalized);
}

export function buildMatcherFingerprint(
  tenantId: string,
  channel: DetectionChannel,
  attackFamily: DetectionAttackFamily,
  matcher: DetectionRuleMatcher
): string {
  return createHash('sha1')
    .update(`${tenantId}|${channel}|${attackFamily}|${canonicalizeMatcher(matcher)}`)
    .digest('hex');
}

export function buildDetectionCandidateSuggestion(
  request: DetectionRequest,
  attackFamily: DetectionAttackFamily,
  severity: DetectionSeverity,
  reasoning: string
): DetectionCandidateSuggestion {
  const sourceText = [
    request.path || '',
    request.decodedPath || '',
    request.query || '',
    request.decodedQuery || '',
    request.parsedQuery || '',
    request.body || '',
    request.normalizedBody || '',
    request.parsedBody || '',
    request.evidence || '',
    request.rawPayload || '',
    request.userAgent || ''
  ].join('\n');
  const fragments = extractSuspiciousFragments(sourceText, attackFamily);
  const matcher = buildMatcherFromFragments(request, fragments);
  const matcherFingerprint = buildMatcherFingerprint(request.tenantId, request.channel, attackFamily, matcher);

  return {
    attackFamily,
    matcher,
    matcherFingerprint,
    name: `${attackFamily.replace(/_/g, ' ')} learned rule`,
    severity,
    description: reasoning
  };
}
