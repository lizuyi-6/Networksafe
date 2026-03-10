import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { ProtocolParser, ThreatIndicator } from '../traffic-interceptor/processing/protocol-parser';

export type HttpTrafficVerdict = 'allow' | 'block';

export interface HttpTrafficEvaluateRequest {
  tenantId: string;
  requestId: string;
  method: string;
  url: string;
  httpVersion: string;
  headers: Record<string, string>;
  bodyBase64: string;
  sourceIp?: string;
  truncated: boolean;
}

export interface HttpTrafficThreat {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface HttpTrafficEvaluateResponse {
  protocol: 'http';
  verdict: HttpTrafficVerdict;
  matchedRule: string | null;
  threats: HttpTrafficThreat[];
  truncated: boolean;
  decisionSource: string;
  processingTimeMicros: number;
}

export interface HttpTrafficBenchmarkFixture {
  name: string;
  request: HttpTrafficEvaluateRequest;
  expectedVerdict: HttpTrafficVerdict;
  expectsCriticalBlock: boolean;
}

const protocolParser = new ProtocolParser();

const GENERIC_CRITICAL_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /'\s*or\s+'1'\s*=\s*'1/gi, type: 'sql_injection' },
  { pattern: /;\s*drop\s+table/gi, type: 'sql_injection' },
  { pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/gi, type: 'xss' },
  { pattern: /\.\.\/\.\.\/\.\.\/etc\/passwd/gi, type: 'path_traversal' }
];

function normalizeHttpVersion(version: string): string {
  const trimmed = String(version || '').trim();
  if (!trimmed) {
    return 'HTTP/1.1';
  }
  if (/^HTTP\//i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return `HTTP/${trimmed}`;
}

function decodeBody(bodyBase64: string): Buffer {
  if (!bodyBase64) {
    return Buffer.alloc(0);
  }
  try {
    return Buffer.from(bodyBase64, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.entries(headers || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key) {
      return acc;
    }

    if (Array.isArray(value)) {
      acc[key.toLowerCase()] = value.map((item) => String(item ?? '')).join(', ');
      return acc;
    }

    acc[key.toLowerCase()] = String(value ?? '');
    return acc;
  }, {});
}

function buildRawHttpPayload(input: HttpTrafficEvaluateRequest): Buffer {
  const body = decodeBody(input.bodyBase64);
  const startLine = `${String(input.method || '').trim()} ${String(input.url || '').trim()} ${normalizeHttpVersion(input.httpVersion)}\r\n`;
  const headerLines = Object.entries(normalizeHeaders(input.headers || {}))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  const headerBlock = headerLines ? `${startLine}${headerLines}\r\n\r\n` : `${startLine}\r\n`;
  return Buffer.concat([Buffer.from(headerBlock, 'utf8'), body]);
}

function mapThreat(threat: ThreatIndicator): HttpTrafficThreat {
  return {
    type: threat.type,
    severity: threat.severity,
    description: threat.description
  };
}

function dedupeThreats(threats: HttpTrafficThreat[]): HttpTrafficThreat[] {
  const seen = new Set<string>();
  return threats.filter((threat) => {
    const key = `${threat.type}|${threat.severity}|${threat.description}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function detectGenericCriticalThreats(content: string): HttpTrafficThreat[] {
  const threats: HttpTrafficThreat[] = [];
  for (const { pattern, type } of GENERIC_CRITICAL_PATTERNS) {
    if (pattern.test(content)) {
      threats.push({
        type,
        severity: 'critical',
        description: `Critical threat detected: ${type}`
      });
    }
  }
  return threats;
}

function detectHeaderInjection(headers: Record<string, string>): HttpTrafficThreat[] {
  return Object.entries(headers).flatMap(([key, value]) => {
    if (!value.includes('\r\n') && !value.includes('\n')) {
      return [];
    }

    return [{
      type: 'header_injection',
      severity: 'high' as const,
      description: `Header injection in ${key}`
    }];
  });
}

function buildFixtureRequest(
  name: string,
  partial: Partial<HttpTrafficEvaluateRequest> & {
    expectedVerdict?: HttpTrafficVerdict;
    expectsCriticalBlock?: boolean;
  }
): HttpTrafficBenchmarkFixture {
  const body = partial.bodyBase64
    ? partial.bodyBase64
    : Buffer.from(String((partial as any).bodyText || ''), 'utf8').toString('base64');
  const request: HttpTrafficEvaluateRequest = {
    tenantId: 'global',
    requestId: `fixture:${name}`,
    method: partial.method || 'GET',
    url: partial.url || '/',
    httpVersion: partial.httpVersion || 'HTTP/1.1',
    headers: normalizeHeaders(partial.headers || { host: 'example.test' }),
    bodyBase64: body,
    sourceIp: partial.sourceIp || '127.0.0.1',
    truncated: Boolean(partial.truncated)
  };

  const expectedVerdict = partial.expectedVerdict || 'allow';

  return {
    name,
    request,
    expectedVerdict,
    expectsCriticalBlock: partial.expectsCriticalBlock ?? expectedVerdict === 'block'
  };
}

export const httpTrafficBenchmarkFixtures: HttpTrafficBenchmarkFixture[] = [
  buildFixtureRequest('benign', {
    method: 'GET',
    url: '/search?q=test',
    headers: {
      host: 'example.test',
      accept: 'application/json'
    }
  }),
  buildFixtureRequest('sqli', {
    method: 'POST',
    url: '/login',
    headers: {
      host: 'example.test',
      'content-type': 'application/x-www-form-urlencoded'
    },
    bodyBase64: Buffer.from("username=admin' OR '1'='1&password=test", 'utf8').toString('base64'),
    expectedVerdict: 'block',
    expectsCriticalBlock: true
  }),
  buildFixtureRequest('xss', {
    method: 'POST',
    url: '/comment',
    headers: {
      host: 'example.test',
      'content-type': 'application/json'
    },
    bodyBase64: Buffer.from(JSON.stringify({ body: '<script>alert(1)</script>' }), 'utf8').toString('base64'),
    expectedVerdict: 'block',
    expectsCriticalBlock: true
  }),
  buildFixtureRequest('path-traversal', {
    method: 'GET',
    url: '/../../../etc/passwd',
    headers: {
      host: 'example.test'
    },
    expectedVerdict: 'block',
    expectsCriticalBlock: true
  }),
  buildFixtureRequest('header-injection', {
    method: 'GET',
    url: '/download',
    headers: {
      host: 'example.test',
      'x-test': 'ok\r\nx-evil: injected'
    },
    expectedVerdict: 'allow',
    expectsCriticalBlock: false
  }),
  buildFixtureRequest('malformed-request-line', {
    method: 'BAD',
    url: '',
    httpVersion: '',
    headers: {
      host: 'example.test'
    },
    expectedVerdict: 'allow',
    expectsCriticalBlock: false
  }),
  buildFixtureRequest('empty-body', {
    method: 'POST',
    url: '/status',
    headers: {
      host: 'example.test',
      'content-type': 'application/json'
    },
    bodyBase64: ''
  }),
  buildFixtureRequest('truncated-long-body', {
    method: 'POST',
    url: '/upload',
    headers: {
      host: 'example.test',
      'content-type': 'text/plain'
    },
    bodyBase64: Buffer.from('A'.repeat(65536), 'utf8').toString('base64'),
    truncated: true
  })
];

export function normalizeThreatSignatures(threats: HttpTrafficThreat[]): string[] {
  return Array.from(new Set(threats.map((threat) => `${threat.type}:${threat.severity}`))).sort();
}

export function hashTrafficSampleKey(input: Pick<HttpTrafficEvaluateRequest, 'tenantId' | 'requestId' | 'url' | 'method'>): number {
  const hash = createHash('sha1')
    .update(`${input.tenantId}|${input.requestId}|${input.method}|${input.url}`)
    .digest();
  return hash.readUInt32BE(0) % 100;
}

class HttpTrafficEvaluatorService {
  evaluateBaseline(input: HttpTrafficEvaluateRequest): HttpTrafficEvaluateResponse {
    const startedAt = process.hrtime.bigint();
    const payload = buildRawHttpPayload(input);
    const payloadString = payload.toString('utf8');
    const httpResult = protocolParser.parseHTTP(payload);
    const httpThreats = httpResult.threats.map(mapThreat);
    const headerThreats = detectHeaderInjection(normalizeHeaders(input.headers || {}));
    const genericThreats = detectGenericCriticalThreats(payloadString);
    const threats = dedupeThreats([...httpThreats, ...headerThreats, ...genericThreats]);

    let verdict: HttpTrafficVerdict = 'allow';
    let matchedRule: string | null = null;

    const criticalHttpThreat = httpThreats.find((threat) => threat.severity === 'critical');
    if (criticalHttpThreat) {
      verdict = 'block';
      matchedRule = `fast_path:${criticalHttpThreat.type}`;
    } else if (genericThreats.some((threat) => threat.severity === 'critical')) {
      verdict = 'block';
      matchedRule = 'fast_path:critical_threat';
    }

    return {
      protocol: 'http',
      verdict,
      matchedRule,
      threats,
      truncated: Boolean(input.truncated),
      decisionSource: 'typescript-http-baseline',
      processingTimeMicros: Number((process.hrtime.bigint() - startedAt) / 1000n)
    };
  }
}

export const httpTrafficEvaluatorService = new HttpTrafficEvaluatorService();
