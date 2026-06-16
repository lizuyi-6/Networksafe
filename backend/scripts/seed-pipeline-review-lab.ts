import fs from 'fs';
import path from 'path';
import type { DetectionAIResult } from '../src/services/detection-pipeline.service';
import type { DetectionAttackFamily, DetectionRequest } from '../src/services/detection-engine';

process.env.NODE_ENV ||= 'test';
process.env.PROFILE ||= 'dev';
process.env.APP_PROFILE ||= 'dev';
process.env.DB_MODE ||= 'sqlite';
process.env.DISABLE_REDIS ||= 'true';
process.env.JWT_SECRET ||= 'review-lab-jwt-secret-minimum-32-characters';
process.env.AUDIT_LOG_SECRET ||= 'review-lab-audit-secret-minimum-32-characters';
process.env.ADMIN_PASSWORD ||= 'ReviewLabAdmin!2026';
process.env.ENABLE_DEV_LOGIN_PRESETS ||= 'true';
process.env.DATA_DIR ||= path.resolve(__dirname, '..', 'data');

const { closeDatabase, getDatabase } = require('../src/config/database') as typeof import('../src/config/database');
const { PLATFORM_TENANT_ID } = require('../src/core/tenant/tenant-context') as typeof import('../src/core/tenant/tenant-context');
const { bootstrapPersistence } = require('../src/bootstrap/persistence') as typeof import('../src/bootstrap/persistence');
const { detectionPipelineService } = require('../src/services/detection-pipeline.service') as typeof import('../src/services/detection-pipeline.service');
const { securityOperationsService } = require('../src/services/security-operations.service') as typeof import('../src/services/security-operations.service');
const { finalDefenseService } = require('../src/services/final-defense.service') as typeof import('../src/services/final-defense.service');

type AssetType = 'url' | 'site' | 'domain' | 'host' | 'ip' | 'device' | 'agent' | 'service';
type Severity = 'critical' | 'high' | 'medium' | 'low';
type ActionStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'rolled_back';
type ValidationVerdict = 'blocked' | 'alerted' | 'missed' | 'false_positive' | 'timeout';

type Scenario = {
  label: string;
  request: DetectionRequest;
  forceAiReview?: boolean;
  asset?: {
    type: AssetType;
    ref: string;
    name: string;
    address?: string;
  };
};

type DecisionRow = {
  label: string;
  requestId: string;
  channel: DetectionRequest['channel'];
  verdict: string;
  attackFamily: DetectionAttackFamily;
  riskScore: number;
  matchedRuleIds: string[];
  candidateId?: string | null;
  escalatedToAI: boolean;
  decisionSource: string;
  processingTimeMs: number;
};

type AssetSeed = {
  key: string;
  type: AssetType;
  ref: string;
  name: string;
  address?: string;
  status?: string;
  metadata?: Record<string, any>;
};

type FindingSeed = {
  key: string;
  assetKey: string;
  sourceType: string;
  sourceRef: string;
  target: string;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  evidence: Record<string, any>;
  remediation: Record<string, any>;
  alertType?: 'security' | 'performance' | 'system';
};

type SeededOperations = {
  assets: number;
  findings: number;
  alerts: number;
  actions: number;
  validations: number;
  trafficSessions: number;
  scanRuns: number;
  scanEvidence: number;
  scanServices: number;
  finalDefenseGateways: number;
};

type ReviewTelemetrySummary = {
  asyncReviews: number;
  completedAsyncReviews: number;
  failedAsyncReviews: number;
  debateReviews: number;
  blockingDiscussions: number;
  failClosedDiscussions: number;
};

const argValue = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const tenantId = argValue('tenant') || process.env.AETHERGUARD_REVIEW_TENANT || PLATFORM_TENANT_ID;
const runId = argValue('run-id') || process.env.AETHERGUARD_REVIEW_RUN_ID || `review-lab-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const sampleMultiplier = Math.max(1, Number(argValue('multiplier') || process.env.AETHERGUARD_REVIEW_SAMPLE_MULTIPLIER || 4));
const outputDir = path.resolve(
  process.cwd(),
  '..',
  'artifacts',
  'ops',
  runId
);

const now = Date.now();
const isoMinutesAgo = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
const json = (value: any): string => JSON.stringify(value ?? {});
const parseJson = <T>(value: unknown, fallback: T): T => {
  try {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9:_-]/g, '-');
const signalRef = (value: string): string => `SIG-${safeId(value).replace(/-/g, '').slice(0, 12).toUpperCase()}`;
const opsBatchCode = (() => {
  const match = runId.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}` : `OPS-${safeId(runId).slice(0, 8).toUpperCase()}`;
})();

function clearReviewLabRowsForRun(): void {
  const db = getDatabase();
  const likeRun = `%${runId}%`;
  const findingRows = db.prepare(`
    SELECT finding_id
    FROM sec_findings
    WHERE tenant_id = ? AND (
      fingerprint LIKE ? OR source_ref LIKE ? OR evidence_json LIKE ? OR remediation_json LIKE ?
    )
  `).all(tenantId, likeRun, likeRun, likeRun, likeRun) as Array<{ finding_id: string }>;
  const findingIds = findingRows.map((row) => row.finding_id).filter(Boolean);

  if (findingIds.length > 0) {
    const placeholders = findingIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM sec_actions WHERE tenant_id = ? AND finding_id IN (${placeholders})`).run(tenantId, ...findingIds);
    db.prepare(`DELETE FROM sec_alerts WHERE tenant_id = ? AND finding_id IN (${placeholders})`).run(tenantId, ...findingIds);
    db.prepare(`DELETE FROM sec_findings WHERE tenant_id = ? AND finding_id IN (${placeholders})`).run(tenantId, ...findingIds);
  }

  db.prepare(`DELETE FROM sec_actions WHERE tenant_id = ? AND run_log_json LIKE ?`).run(tenantId, likeRun);
  db.prepare(`DELETE FROM sec_alerts WHERE tenant_id = ? AND metadata_json LIKE ?`).run(tenantId, likeRun);
  db.prepare(`DELETE FROM sec_validations WHERE tenant_id = ? AND (attack_id LIKE ? OR result_json LIKE ?)`).run(tenantId, likeRun, likeRun);
  db.prepare(`DELETE FROM sec_traffic_sessions WHERE tenant_id = ? AND (session_id LIKE ? OR metadata_json LIKE ?)`).run(tenantId, likeRun, likeRun);
  db.prepare(`DELETE FROM sec_detection_async_reviews WHERE tenant_id = ? AND (review_id LIKE ? OR request_id LIKE ? OR request_snapshot_json LIKE ?)`).run(tenantId, likeRun, likeRun, likeRun);
  db.prepare(`DELETE FROM sec_detection_events WHERE tenant_id = ? AND (request_id LIKE ? OR request_snapshot_json LIKE ? OR response_snapshot_json LIKE ?)`).run(tenantId, likeRun, likeRun, likeRun);
  db.prepare(`DELETE FROM sec_rule_candidates WHERE tenant_id = ? AND (candidate_id LIKE ? OR latest_evidence_json LIKE ? OR reasoning LIKE ?)`).run(tenantId, likeRun, likeRun, likeRun);
  db.prepare(`DELETE FROM final_defense_policies WHERE tenant_id = ? AND (policy_id LIKE ? OR allowed_actions_json LIKE ?)`).run(tenantId, likeRun, likeRun);
  db.prepare(`DELETE FROM final_defense_status WHERE tenant_id = ? AND gate_id IN ('ag-gate-core-01', 'network-isolation-gateway-v1-01')`).run(tenantId);
  db.prepare(`DELETE FROM root_resistant_gateways WHERE tenant_id = ? AND gateway_id = 'network-isolation-gateway-v1-01'`).run(tenantId);
}

const buildRequest = (
  label: string,
  attackFamily: DetectionAttackFamily,
  overrides: Partial<DetectionRequest>,
  ageMinutes: number
): DetectionRequest => {
  const requestId = `${runId}:${label}:${String(ageMinutes).padStart(3, '0')}`;
  return {
    tenantId,
    channel: 'http_api',
    requestId,
    timestamp: isoMinutesAgo(ageMinutes),
    sourceIp: '203.0.113.18',
    method: 'POST',
    path: '/api/auth/login',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 AetherGuard-Review-Lab/1.0',
      'x-review-lab-run-id': runId,
      'x-review-lab-family': attackFamily
    },
    body: '',
    normalizedBody: '',
    evidence: '',
    metadata: {
      runId,
      reviewLab: true,
      scenario: label,
      declaredFamily: attackFamily,
      dataSource: 'controlled-review-lab-replay'
    },
    ...overrides
  };
};

const scenarioTemplates: Scenario[] = [
  {
    label: 'sqli-union-login',
    asset: { type: 'service', ref: 'auth-core.cluster.local:443', name: 'Auth Core API', address: '10.42.12.8' },
    request: buildRequest('sqli-union-login', 'sqli', {
      sourceIp: '198.51.100.44',
      body: JSON.stringify({ email: "ops' UNION SELECT username,password FROM users--", password: 'x' }),
      normalizedBody: "ops' union select username,password from users--",
      evidence: 'authentication endpoint received UNION SELECT credential extraction probe'
    }, 42)
  },
  {
    label: 'xss-admin-widget',
    forceAiReview: true,
    asset: { type: 'url', ref: 'https://console.cluster.local/admin/widgets', name: 'Admin Widget Editor' },
    request: buildRequest('xss-admin-widget', 'xss', {
      path: '/admin/widgets',
      sourceIp: '203.0.113.77',
      body: JSON.stringify({ title: 'notice', html: '<img src=x onerror=fetch("/token")>' }),
      normalizedBody: '<img src=x onerror=fetch("/token")>',
      evidence: 'stored widget field contains event-handler script execution path'
    }, 34)
  },
  {
    label: 'metadata-ssrf-fetch',
    forceAiReview: true,
    asset: { type: 'service', ref: 'report-renderer.cluster.local:8080', name: 'Report Renderer', address: '10.42.20.14' },
    request: buildRequest('metadata-ssrf-fetch', 'ssrf', {
      path: '/api/reports/render',
      sourceIp: '10.42.20.31',
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' }),
      normalizedBody: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      evidence: 'server-side renderer attempted metadata service fetch',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'python-requests/2.31',
        'x-review-lab-run-id': runId,
        'x-review-lab-family': 'ssrf'
      }
    }, 27)
  },
  {
    label: 'path-traversal-config',
    asset: { type: 'host', ref: 'edge-proxy-02.cluster.local', name: 'Edge Proxy 02', address: '10.42.8.22' },
    request: buildRequest('path-traversal-config', 'path_traversal', {
      method: 'GET',
      path: '/api/files/download',
      query: 'name=../../../../etc/passwd',
      decodedQuery: 'name=../../../../etc/passwd',
      evidence: 'download handler received parent-directory traversal for /etc/passwd',
      body: ''
    }, 21)
  },
  {
    label: 'command-injection-diagnostics',
    asset: { type: 'service', ref: 'diagnostics.cluster.local:8443', name: 'Diagnostics Service', address: '10.42.31.9' },
    request: buildRequest('command-injection-diagnostics', 'command_injection', {
      path: '/api/tools/ping',
      sourceIp: '192.0.2.61',
      body: JSON.stringify({ host: '127.0.0.1; cat /etc/passwd' }),
      normalizedBody: '127.0.0.1; cat /etc/passwd',
      evidence: 'diagnostics ping tool received shell metacharacter command payload'
    }, 16)
  },
  {
    label: 'agent-credential-spray',
    forceAiReview: true,
    asset: { type: 'agent', ref: 'agent-edge-17', name: 'Agent Edge 17', address: '10.42.44.17' },
    request: buildRequest('agent-credential-spray', 'automation', {
      channel: 'agent',
      sourceIp: '198.51.100.88',
      path: '/agent/auth',
      body: JSON.stringify({ hostname: 'agent-edge-17', failures: 42, windowSeconds: 60 }),
      evidence: 'agent gateway observed burst authentication failures from a single source',
      userAgent: 'curl/8.4.0',
      existingSignals: [{
        source: 'existing_signal',
        key: 'agent-auth-failure-burst',
        score: 0.82,
        severity: 'high',
        description: '42 failed agent credential attempts inside 60 seconds'
      }]
    }, 10)
  },
  {
    label: 'packet-api-key-leak',
    forceAiReview: true,
    asset: { type: 'service', ref: 'payments-egress.cluster.local:443', name: 'Payments Egress' },
    request: buildRequest('packet-api-key-leak', 'other', {
      channel: 'packet',
      sourceIp: '10.42.52.16',
      method: 'TCP',
      path: 'tls-record',
      protocol: 'tcp',
      rawPayload: `POST /charge HTTP/1.1\r\nHost: payments.internal\r\nX-Api-Key: ${'A'.repeat(48)}\r\n\r\namount=1999`,
      evidence: `high-entropy API key-like header observed on egress flow ${'Z'.repeat(96)}`,
      existingSignals: [{
        source: 'existing_signal',
        key: 'egress-secret-shaped-token',
        score: 0.78,
        severity: 'high',
        description: 'High-entropy token-shaped header crossed egress boundary'
      }]
    }, 5)
  }
];

const expandScenarios = (): Scenario[] => {
  const scenarios: Scenario[] = [];
  for (let round = 0; round < sampleMultiplier; round += 1) {
    for (const template of scenarioTemplates) {
      const requestId = `${template.request.requestId}:r${round + 1}`;
      const timestamp = isoMinutesAgo((scenarioTemplates.length * sampleMultiplier) - scenarios.length);
      scenarios.push({
        ...template,
        label: `${template.label}-r${round + 1}`,
        request: {
          ...template.request,
          requestId,
          timestamp,
          sourceIp: round % 2 === 0
            ? template.request.sourceIp
            : `198.51.100.${20 + round}`,
          metadata: {
            ...(template.request.metadata || {}),
            round: round + 1
          }
        }
      });
    }
  }
  return scenarios;
};

const familyFromText = (request: DetectionRequest): DetectionAttackFamily => {
  const text = [
    request.path,
    request.query,
    request.decodedQuery,
    request.body,
    request.normalizedBody,
    request.evidence,
    request.rawPayload,
    request.userAgent
  ].join('\n').toLowerCase();
  if (/union\s+select|or\s+1\s*=\s*1/.test(text)) return 'sqli';
  if (/<script|onerror\s*=|javascript:/.test(text)) return 'xss';
  if (/169\.254\.169\.254|latest\/meta-data/.test(text)) return 'ssrf';
  if (/\.\.\/|\/etc\/passwd|\.env\b/.test(text)) return 'path_traversal';
  if (/;\s*(cat|ls|curl|wget|bash|sh)|\$\(|`/.test(text)) return 'command_injection';
  if (/credential|curl\/|python-requests|failure-burst/.test(text)) return 'automation';
  return 'other';
};

const aiAnalyzer = {
  async analyze(request: DetectionRequest, options?: { analysisPurpose?: string; routeModeOverride?: string; forceDebate?: boolean }): Promise<DetectionAIResult> {
    const attackFamily = familyFromText(request);
    const maliciousFamilies = new Set<DetectionAttackFamily>(['sqli', 'xss', 'ssrf', 'path_traversal', 'command_injection', 'automation']);
    const malicious = maliciousFamilies.has(attackFamily);
    return {
      verdict: malicious ? 'malicious' : 'suspicious',
      confidence: malicious ? 0.91 : 0.72,
      attackFamily,
      reasoning: malicious
        ? `Review-lab analyzer correlated ${attackFamily} indicators across request body, route context, and existing signals.`
        : 'Review-lab analyzer found an unusual packet-level signal that needs analyst review.',
      routeMode: options?.routeModeOverride || 'local_only',
      model: options?.routeModeOverride === 'cloud_only' ? 'review-lab-cloud-verifier' : 'review-lab-local-analyzer',
      decisionId: `${runId}:${request.requestId}:ai`,
      rawDecision: {
        reviewLab: true,
        forceDebate: Boolean(options?.forceDebate),
        analysisPurpose: options?.analysisPurpose || 'primary',
        layersActivated: options?.forceDebate ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 7],
        stageLatencies: {
          localMs: 24,
          debateMs: options?.forceDebate ? 138 : 0
        }
      }
    };
  }
};

function seedAssets(): Map<string, any> {
  const seeds: AssetSeed[] = [
    { key: 'auth', type: 'service', ref: 'auth-core.cluster.local:443', name: 'Auth Core API', address: '10.42.12.8', metadata: { tier: 'critical', owner: 'identity', runtime: 'node18' } },
    { key: 'adminWidget', type: 'url', ref: 'https://console.cluster.local/admin/widgets', name: 'Admin Widget Editor', address: '10.42.12.21', metadata: { tier: 'admin', owner: 'console' } },
    { key: 'renderer', type: 'service', ref: 'report-renderer.cluster.local:8080', name: 'Report Renderer', address: '10.42.20.14', metadata: { tier: 'internal', owner: 'analytics' } },
    { key: 'edgeProxy', type: 'host', ref: 'edge-proxy-02.cluster.local', name: 'Edge Proxy 02', address: '10.42.8.22', metadata: { tier: 'edge', owner: 'network' } },
    { key: 'diagnostics', type: 'service', ref: 'diagnostics.cluster.local:8443', name: 'Diagnostics Service', address: '10.42.31.9', metadata: { tier: 'ops', owner: 'platform' } },
    { key: 'payments', type: 'service', ref: 'payments-egress.cluster.local:443', name: 'Payments Egress', address: '10.42.52.16', metadata: { tier: 'restricted', owner: 'payments' } },
    { key: 'kubeApi', type: 'service', ref: 'kubernetes.default.svc:443', name: 'Kubernetes API', address: '10.42.0.1', metadata: { tier: 'critical', owner: 'platform' } },
    { key: 'grafana', type: 'url', ref: 'https://grafana.ops.cluster.local', name: 'Grafana Ops Console', address: '10.42.9.19', metadata: { tier: 'ops', owner: 'sre' } },
    { key: 'minio', type: 'service', ref: 'minio.storage.cluster.local:9000', name: 'MinIO Object Store', address: '10.42.18.33', metadata: { tier: 'data', owner: 'storage' } },
    { key: 'postgres', type: 'service', ref: 'postgres.core.cluster.local:5432', name: 'Postgres Core DB', address: '10.42.4.12', metadata: { tier: 'data', owner: 'database' } },
    { key: 'agentEdge', type: 'agent', ref: 'agent-edge-17', name: 'Agent Edge 17', address: '10.42.44.17', metadata: { version: '1.8.4', host: 'edge-proxy-02' } },
    { key: 'agentApi', type: 'agent', ref: 'agent-api-03', name: 'Agent API 03', address: '10.42.12.30', metadata: { version: '1.8.4', host: 'auth-core' } },
    {
      key: 'gateCore',
      type: 'device',
      ref: 'ag-gate-core-01',
      name: 'Core Hardware Gate 01',
      address: 'core-uart-gate-01',
      status: 'online',
      metadata: {
        firmwareVersion: '2.4.7',
        chipModel: 'ESP32-WROOM-32',
        flashSize: 4194304,
        freeHeap: 184320,
        sdkVersion: 'esp-idf-v5.2.2',
        cpuUsage: 31,
        memoryUsage: 52,
        uptime: 682400,
        wifiRssi: -49,
        connectedAgents: ['agent-edge-17', 'agent-api-03'],
        group: 'core-control',
        site: 'Shanghai Lab Rack A',
        networkProfile: 'serial-uart-gated',
        scanProfile: 'critical-service',
        tags: ['hardware-gate', 'core', 'uart'],
        notes: 'Physical confirmation gate for critical control-plane operations.'
      }
    },
    {
      key: 'gateEdge',
      type: 'device',
      ref: 'ag-gate-edge-02',
      name: 'Edge Hardware Gate 02',
      address: 'edge-uart-gate-02',
      status: 'online',
      metadata: {
        firmwareVersion: '2.4.6',
        chipModel: 'ESP32-WROOM-32',
        flashSize: 4194304,
        freeHeap: 165888,
        sdkVersion: 'esp-idf-v5.2.1',
        cpuUsage: 37,
        memoryUsage: 58,
        uptime: 441960,
        wifiRssi: -55,
        connectedAgents: ['agent-edge-17'],
        group: 'edge-approval',
        site: 'Shanghai Lab Rack B',
        networkProfile: 'serial-uart-gated',
        scanProfile: 'edge-balanced',
        tags: ['hardware-gate', 'edge', 'uart'],
        notes: 'Approval gate for edge proxy maintenance and recovery commands.'
      }
    },
    {
      key: 'gateDb',
      type: 'device',
      ref: 'ag-gate-db-03',
      name: 'Data Hardware Gate 03',
      address: 'data-uart-gate-03',
      status: 'online',
      metadata: {
        firmwareVersion: '2.4.5',
        chipModel: 'ESP32-WROOM-32',
        flashSize: 4194304,
        freeHeap: 151552,
        sdkVersion: 'esp-idf-v5.2.1',
        cpuUsage: 43,
        memoryUsage: 61,
        uptime: 239180,
        wifiRssi: -61,
        connectedAgents: ['agent-api-03'],
        group: 'data-approval',
        site: 'Shanghai Lab Rack C',
        networkProfile: 'serial-uart-gated',
        scanProfile: 'database-strict',
        tags: ['hardware-gate', 'data', 'uart'],
        notes: 'Physical approval gate for database and object-store destructive operations.'
      }
    }
  ];

  const assets = new Map<string, any>();
  for (const seed of seeds) {
    const asset = securityOperationsService.upsertAsset({
      tenantId,
      assetType: seed.type,
      externalRef: seed.ref,
      displayName: seed.name,
      primaryAddress: seed.address,
      status: seed.status || 'observed',
      metadata: {
        ...(seed.metadata || {}),
        runId,
        reviewLab: true
      }
    });
    assets.set(seed.key, asset);
  }
  return assets;
}

function seedFindings(assets: Map<string, any>): Map<string, any> {
  const seeds: FindingSeed[] = [
    {
      key: 'sqliAuth',
      assetKey: 'auth',
      sourceType: 'pipeline',
      sourceRef: signalRef('sqli-auth-core'),
      target: '/api/auth/login',
      category: 'sqli',
      severity: 'critical',
      title: 'SQL Injection Probe Blocked on Auth Core',
      description: 'Authentication endpoint received a UNION SELECT credential extraction payload and was blocked before query execution.',
      evidence: { method: 'POST', path: '/api/auth/login', sourceIp: '198.51.100.44', rule: 'sqli-union-select', attackId: `${runId}:atk-001` },
      remediation: { owner: 'identity', nextStep: 'Review ORM parameterization and keep auth route in deny-by-default mode.' }
    },
    {
      key: 'xssWidget',
      assetKey: 'adminWidget',
      sourceType: 'pipeline',
      sourceRef: signalRef('xss-widget'),
      target: '/admin/widgets',
      category: 'xss',
      severity: 'high',
      title: 'Stored XSS Payload Blocked in Admin Widget Editor',
      description: 'Widget HTML field contained an event-handler payload capable of reading session tokens.',
      evidence: { field: 'html', indicator: 'onerror=fetch', sourceIp: '203.0.113.77', attackId: `${runId}:atk-002` },
      remediation: { owner: 'console', nextStep: 'Keep HTML sanitizer enabled and enforce CSP on admin routes.' }
    },
    {
      key: 'ssrfRenderer',
      assetKey: 'renderer',
      sourceType: 'pipeline',
      sourceRef: signalRef('metadata-ssrf'),
      target: '/api/reports/render',
      category: 'ssrf',
      severity: 'critical',
      title: 'Metadata Service SSRF Attempt Blocked',
      description: 'Report renderer received a request targeting the cloud metadata address and was denied by egress policy.',
      evidence: { url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/', sourceIp: '10.42.20.31', attackId: `${runId}:atk-003` },
      remediation: { owner: 'analytics', nextStep: 'Maintain URL allow-list and deny link-local destinations from render workers.' }
    },
    {
      key: 'traversalEdge',
      assetKey: 'edgeProxy',
      sourceType: 'pipeline',
      sourceRef: signalRef('path-traversal'),
      target: '/api/files/download',
      category: 'path_traversal',
      severity: 'high',
      title: 'Path Traversal Blocked at Edge Proxy',
      description: 'Download handler received parent-directory traversal targeting system account files.',
      evidence: { query: 'name=../../../../etc/passwd', sourceIp: '198.51.100.29', attackId: `${runId}:atk-004` },
      remediation: { owner: 'network', nextStep: 'Keep canonical path enforcement enabled and alert on encoded traversal variants.' }
    },
    {
      key: 'cmdDiag',
      assetKey: 'diagnostics',
      sourceType: 'pipeline',
      sourceRef: signalRef('command-injection'),
      target: '/api/tools/ping',
      category: 'command_injection',
      severity: 'critical',
      title: 'Command Injection Payload Blocked in Diagnostics',
      description: 'Diagnostics ping tool received shell metacharacters chained to local file read commands.',
      evidence: { body: '127.0.0.1; cat /etc/passwd', sourceIp: '192.0.2.61', attackId: `${runId}:atk-005` },
      remediation: { owner: 'platform', nextStep: 'Keep diagnostics tool behind argument vector execution and hardware approval for privileged actions.' }
    },
    {
      key: 'agentSpray',
      assetKey: 'agentEdge',
      sourceType: 'agent-gateway',
      sourceRef: signalRef('credential-spray'),
      target: 'agent-edge-17',
      category: 'automation',
      severity: 'high',
      title: 'Agent Credential Spray Detected',
      description: 'Agent gateway observed clustered authentication failures from a single public source inside one minute.',
      evidence: { failures: 42, windowSeconds: 60, sourceIp: '198.51.100.88', attackId: `${runId}:atk-006` },
      remediation: { owner: 'agent-platform', nextStep: 'Rotate rejected bootstrap token and keep credential spray throttling enabled.' }
    },
    {
      key: 'apiKeyEgress',
      assetKey: 'payments',
      sourceType: 'packet',
      sourceRef: signalRef('egress-token'),
      target: 'payments.internal',
      category: 'sensitive-exposure',
      severity: 'high',
      title: 'High-Entropy API Key Observed on Egress Flow',
      description: 'Packet inspection found a token-shaped header crossing the restricted payments boundary.',
      evidence: { header: 'X-Api-Key', entropy: 4.9, destPort: 443, attackId: `${runId}:atk-007` },
      remediation: { owner: 'payments', nextStep: 'Rotate exposed token and enforce secret redaction before egress.' }
    },
    {
      key: 'redisExposure',
      assetKey: 'edgeProxy',
      sourceType: 'scanner',
      sourceRef: signalRef('scanner-edge'),
      target: 'edge-proxy-02.cluster.local:6379',
      category: 'service-exposure',
      severity: 'critical',
      title: 'Redis Administrative Port Exposed',
      description: 'Scanner observed an unauthenticated Redis service on an edge-adjacent host segment.',
      evidence: { host: 'edge-proxy-02.cluster.local', port: 6379, banner: 'redis_version:7.0', attackId: `${runId}:scan-001` },
      remediation: { owner: 'network', nextStep: 'Close port 6379 at the edge segment and require service mesh identity.' }
    },
    {
      key: 'postgresExposure',
      assetKey: 'postgres',
      sourceType: 'scanner',
      sourceRef: signalRef('scanner-data'),
      target: 'postgres.core.cluster.local:5432',
      category: 'service-exposure',
      severity: 'high',
      title: 'Database Port Exposed Outside Expected Segment',
      description: 'Postgres listener was reachable from a non-database scan origin.',
      evidence: { host: 'postgres.core.cluster.local', port: 5432, service: 'postgres', attackId: `${runId}:scan-002` },
      remediation: { owner: 'database', nextStep: 'Restrict database listener to application subnets and rotate shared passwords.' }
    },
    {
      key: 'minioPolicy',
      assetKey: 'minio',
      sourceType: 'scanner',
      sourceRef: signalRef('scanner-storage'),
      target: 'minio.storage.cluster.local:9000',
      category: 'storage-posture',
      severity: 'high',
      title: 'Object Store Bucket Policy Allows Broad Read',
      description: 'Storage scan found a bucket policy pattern that grants broad read access to internal principals.',
      evidence: { bucket: 'reports-export', permission: 'read', principal: 'internal:*', attackId: `${runId}:scan-003` },
      remediation: { owner: 'storage', nextStep: 'Replace broad principal with service-specific roles and record approval through hardware gate.' }
    },
    {
      key: 'kubeWeakAuth',
      assetKey: 'kubeApi',
      sourceType: 'scanner',
      sourceRef: signalRef('scanner-kube'),
      target: 'kubernetes.default.svc:443',
      category: 'control-plane-posture',
      severity: 'high',
      title: 'Kubernetes API Token Scope Too Broad',
      description: 'Scanner correlated a service account token with list permissions beyond the target namespace.',
      evidence: { verb: 'list', resource: 'secrets', namespaceScope: 'cluster', attackId: `${runId}:scan-004` },
      remediation: { owner: 'platform', nextStep: 'Reduce service account RBAC scope and trigger token rotation.' }
    },
    {
      key: 'grafanaHeader',
      assetKey: 'grafana',
      sourceType: 'scanner',
      sourceRef: signalRef('scanner-grafana'),
      target: 'https://grafana.ops.cluster.local',
      category: 'web-posture',
      severity: 'medium',
      title: 'Grafana Console Missing Hardening Header',
      description: 'Web posture scan found missing clickjacking protection on the operations console.',
      evidence: { header: 'x-frame-options', status: 200, attackId: `${runId}:scan-005` },
      remediation: { owner: 'sre', nextStep: 'Apply standard response header policy to the ops ingress.' }
    },
    {
      key: 'gateFirmware',
      assetKey: 'gateEdge',
      sourceType: 'device-health',
      sourceRef: signalRef('gate-firmware'),
      target: 'ag-gate-edge-02',
      category: 'device-health',
      severity: 'medium',
      title: 'Hardware Gate Firmware One Patch Behind',
      description: 'Edge hardware gate is healthy but running one patch behind the recommended firmware baseline.',
      evidence: { current: '2.4.6', recommended: '2.4.7', gate: 'ag-gate-edge-02', attackId: `${runId}:device-001` },
      remediation: { owner: 'hardware', nextStep: 'Schedule OTA update and confirm the update with local button approval.' }
    },
    {
      key: 'gateHeap',
      assetKey: 'gateDb',
      sourceType: 'device-health',
      sourceRef: signalRef('gate-heap'),
      target: 'ag-gate-db-03',
      category: 'device-health',
      severity: 'low',
      title: 'Hardware Gate Heap Pressure Elevated',
      description: 'Data hardware gate remains online but reported sustained heap pressure during approval bursts.',
      evidence: { freeHeap: 151552, memoryUsage: 61, gate: 'ag-gate-db-03', attackId: `${runId}:device-002` },
      remediation: { owner: 'hardware', nextStep: 'Collect telemetry bundle and watch for repeated heap-pressure alerts.' }
    }
  ];

  const findings = new Map<string, any>();
  for (const seed of seeds) {
    const asset = assets.get(seed.assetKey);
    const finding = securityOperationsService.ingestFinding({
      tenantId,
      assetId: asset?.assetId,
      sourceType: seed.sourceType,
      sourceRef: seed.sourceRef,
      target: seed.target,
      category: seed.category,
      severity: seed.severity,
      title: seed.title,
      description: seed.description,
      evidence: {
        ...seed.evidence,
        runId,
        reviewLab: true
      },
      remediation: seed.remediation,
      fingerprint: `${runId}:finding:${seed.key}`,
      createAlert: seed.severity !== 'low',
      alertType: seed.alertType || 'security'
    });
    findings.set(seed.key, finding);
  }
  return findings;
}

function seedActions(assets: Map<string, any>, findings: Map<string, any>): number {
  const actionSeeds: Array<{ key: string; title: string; status: ActionStatus; operator: string; assetKey?: string; findingKey?: string; age: number }> = [
    { key: 'rotate-auth', title: 'Rotate auth-core database credential', status: 'running', operator: 'secops.lead', findingKey: 'sqliAuth', age: 8 },
    { key: 'isolate-renderer', title: 'Apply renderer egress deny-list', status: 'pending', operator: 'network.ops', findingKey: 'ssrfRenderer', age: 14 },
    { key: 'close-redis', title: 'Close edge Redis exposure', status: 'queued', operator: 'edge.ops', findingKey: 'redisExposure', age: 21 },
    { key: 'minio-policy', title: 'Narrow object-store read policy', status: 'pending', operator: 'storage.ops', findingKey: 'minioPolicy', age: 27 },
    { key: 'gate-edge-ota', title: 'Require hardware approval: update edge gate firmware', status: 'running', operator: 'hardware.ops', assetKey: 'gateEdge', findingKey: 'gateFirmware', age: 33 },
    { key: 'gate-db-collect', title: 'Collect hardware gate telemetry bundle', status: 'completed', operator: 'hardware.ops', assetKey: 'gateDb', findingKey: 'gateHeap', age: 42 },
    { key: 'kube-rbac', title: 'Reduce Kubernetes service-account token scope', status: 'failed', operator: 'platform.ops', findingKey: 'kubeWeakAuth', age: 51 },
    { key: 'diag-shell', title: 'Lock diagnostics command runner', status: 'pending', operator: 'platform.ops', findingKey: 'cmdDiag', age: 63 }
  ];

  for (const seed of actionSeeds) {
    const finding = seed.findingKey ? findings.get(seed.findingKey) : null;
    const asset = seed.assetKey ? assets.get(seed.assetKey) : finding?.assetId ? null : null;
    securityOperationsService.recordActionRun({
      tenantId,
      assetId: asset?.assetId || finding?.assetId,
      findingId: finding?.findingId,
      title: seed.title,
      status: seed.status,
      operator: seed.operator,
      rollbackNotes: 'Revert policy change and restore previous control-plane snapshot if validation fails.',
      runLog: [
        { at: isoMinutesAgo(seed.age), actor: 'system', message: `Action ${seed.key} opened from correlated security evidence.`, runId },
        { at: isoMinutesAgo(Math.max(1, seed.age - 4)), actor: seed.operator, message: `Current status: ${seed.status}.` }
      ]
    });
  }
  return actionSeeds.length;
}

function seedValidations(): number {
  const validations: Array<{ attackId: string; attackName: string; category: string; severity: Severity; verdict: ValidationVerdict; detected: boolean; blocked: boolean; responseTime: number; age: number }> = [
    { attackId: `${runId}:atk-001`, attackName: 'Auth SQLi replay', category: 'sqli', severity: 'critical', verdict: 'blocked', detected: true, blocked: true, responseTime: 31, age: 6 },
    { attackId: `${runId}:atk-002`, attackName: 'Admin widget XSS replay', category: 'xss', severity: 'high', verdict: 'blocked', detected: true, blocked: true, responseTime: 39, age: 12 },
    { attackId: `${runId}:atk-003`, attackName: 'Metadata SSRF replay', category: 'ssrf', severity: 'critical', verdict: 'blocked', detected: true, blocked: true, responseTime: 44, age: 18 },
    { attackId: `${runId}:atk-004`, attackName: 'Traversal encoded variant', category: 'path_traversal', severity: 'high', verdict: 'alerted', detected: true, blocked: false, responseTime: 58, age: 24 },
    { attackId: `${runId}:scan-001`, attackName: 'Edge Redis exposure check', category: 'service-exposure', severity: 'critical', verdict: 'missed', detected: false, blocked: false, responseTime: 0, age: 31 },
    { attackId: `${runId}:scan-002`, attackName: 'Postgres segmentation check', category: 'service-exposure', severity: 'high', verdict: 'timeout', detected: false, blocked: false, responseTime: 5000, age: 39 },
    { attackId: `${runId}:device-001`, attackName: 'Hardware OTA approval drill', category: 'device-health', severity: 'medium', verdict: 'blocked', detected: true, blocked: true, responseTime: 81, age: 46 },
    { attackId: `${runId}:atk-007`, attackName: 'Egress token leakage drill', category: 'sensitive-exposure', severity: 'high', verdict: 'false_positive', detected: true, blocked: false, responseTime: 93, age: 54 }
  ];

  for (const seed of validations) {
    securityOperationsService.recordValidationRun({
      tenantId,
      attackId: seed.attackId,
      attackName: seed.attackName,
      category: seed.category,
      severity: seed.severity,
      verdict: seed.verdict,
      detected: seed.detected,
      blocked: seed.blocked,
      responseTime: seed.responseTime,
      startedAt: isoMinutesAgo(seed.age + 1),
      completedAt: isoMinutesAgo(seed.age),
      result: {
        runId,
        reviewLab: true,
        replay: true,
        expected: seed.blocked ? 'block' : 'monitor'
      }
    });
  }
  return validations.length;
}

function seedTrafficSessions(assets: Map<string, any>): number {
  const dests = [
    assets.get('auth'), assets.get('adminWidget'), assets.get('renderer'), assets.get('edgeProxy'),
    assets.get('diagnostics'), assets.get('payments'), assets.get('kubeApi'), assets.get('grafana'),
    assets.get('minio'), assets.get('postgres'), assets.get('gateCore'), assets.get('gateEdge')
  ].filter(Boolean);
  const sourceIps = ['198.51.100.44', '203.0.113.77', '192.0.2.61', '198.51.100.88', '10.42.12.30', '10.42.44.17', '10.42.8.22'];
  const portProfiles = [
    { destPort: 443, protocol: 'tcp', service: 'https' },
    { destPort: 8443, protocol: 'tcp', service: 'https-alt' },
    { destPort: 80, protocol: 'tcp', service: 'http' },
    { destPort: 8080, protocol: 'tcp', service: 'http-alt' },
    { destPort: 53, protocol: 'udp', service: 'dns' },
    { destPort: 5432, protocol: 'tcp', service: 'postgres' },
    { destPort: 9000, protocol: 'tcp', service: 'minio' },
    { destPort: 6379, protocol: 'tcp', service: 'redis' }
  ];
  const families = ['sqli', 'xss', 'ssrf', 'path_traversal', 'command_injection', 'automation', 'sensitive-exposure', 'normal'];
  const count = Math.max(110, sampleMultiplier * 28);

  for (let i = 0; i < count; i += 1) {
    const dest = dests[i % dests.length];
    const profile = portProfiles[i % portProfiles.length];
    const sourceIP = sourceIps[i % sourceIps.length];
    const age = Math.max(1, count - i);
    const blocked = i % 5 === 0 || i % 7 === 0 || profile.destPort === 6379;
    const sensitive = !blocked && (i % 11 === 0 || profile.destPort === 5432 || profile.destPort === 9000);
    const state = blocked ? 'BLOCKED' : (i % 3 === 0 ? 'ESTABLISHED' : 'COMPLETED');
    const packetCount = 180 + ((i * 73) % 720);
    const byteCount = packetCount * (260 + ((i * 37) % 980));
    const family = families[i % families.length];

    securityOperationsService.upsertTrafficSession({
      tenantId,
      sessionId: `${runId}:flow:${String(i + 1).padStart(4, '0')}`,
      sourceIP,
      destIP: dest.primaryAddress || `10.42.${10 + (i % 40)}.${20 + (i % 120)}`,
      sourcePort: 32000 + ((i * 97) % 24000),
      destPort: profile.destPort,
      protocol: profile.protocol,
      state,
      packetCount,
      byteCount,
      startTime: isoMinutesAgo(age + 3 + (i % 4)),
      lastActivity: isoMinutesAgo(age),
      destAssetId: dest.assetId,
      metadata: {
        runId,
        reviewLab: true,
        service: profile.service,
        classification: blocked ? 'security-signal' : sensitive ? 'sensitive-exposure' : 'normal-business',
        attackId: blocked ? `${runId}:atk-${String((i % 7) + 1).padStart(3, '0')}` : undefined,
        family,
        decision: blocked ? 'block' : sensitive ? 'monitor' : 'allow',
        simulatedRps: 12 + (i % 28)
      }
    });
  }
  return count;
}

function clearScanRowsForRun(): void {
  const db = getDatabase();
  const pattern = `${runId}:scan:%`;
  const opsPattern = `scan-%-${opsBatchCode}`;
  db.prepare('DELETE FROM scan_events WHERE task_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_events WHERE task_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_findings WHERE task_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_findings WHERE task_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_evidence WHERE run_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_evidence WHERE run_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_services WHERE run_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_services WHERE run_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_target_assets WHERE run_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_target_assets WHERE run_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_run_stages WHERE run_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_run_stages WHERE run_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_run_targets WHERE run_id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_run_targets WHERE run_id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_runs WHERE id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_runs WHERE id LIKE ?').run(opsPattern);
  db.prepare('DELETE FROM scan_tasks WHERE id LIKE ?').run(pattern);
  db.prepare('DELETE FROM scan_tasks WHERE id LIKE ?').run(opsPattern);
}

function seedScannerRuns(assets: Map<string, any>, findings: Map<string, any>): { runs: number; evidence: number; services: number } {
  clearScanRowsForRun();
  const db = getDatabase();
  const profileId = `${runId}:scan-profile:balanced`;
  const createdAt = isoMinutesAgo(95);
  db.prepare(`
    INSERT OR REPLACE INTO scan_profiles (
      id, tenant_id, name, scopes_json, engines_json, port_set_json, template_set_json, timeout_policy_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    tenantId,
    'Review Balanced Exposure Profile',
    json(['web', 'host', 'service', 'nuclei']),
    json(['web_probe', 'port_probe', 'nuclei', 'correlation']),
    json([22, 53, 80, 443, 5432, 6379, 8080, 8443, 9000]),
    json(['cves', 'misconfig', 'exposure']),
    json({ connectMs: 1800, requestMs: 4200, stageMs: 90000 }),
    json({ runId, reviewLab: true }),
    createdAt,
    isoMinutesAgo(3)
  );

  const runDefs = [
    {
      id: `scan-edge-posture-${opsBatchCode}`,
      createdAge: 16,
      targets: [
        { kind: 'host', value: 'edge-proxy-02.cluster.local', assetKey: 'edgeProxy' },
        { kind: 'url', value: 'https://console.cluster.local/admin/widgets', assetKey: 'adminWidget' }
      ],
      findingKeys: ['redisExposure', 'traversalEdge', 'xssWidget', 'grafanaHeader'],
      services: [
        { assetKey: 'edgeProxy', host: 'edge-proxy-02.cluster.local', port: 443, protocol: 'https', service: 'edge-proxy', banner: 'nginx/1.24' },
        { assetKey: 'edgeProxy', host: 'edge-proxy-02.cluster.local', port: 6379, protocol: 'redis', service: 'redis', banner: 'redis_version:7.0.11' },
        { assetKey: 'adminWidget', host: 'console.cluster.local', port: 443, protocol: 'https', service: 'admin-console', banner: 'vite-control-plane' }
      ]
    },
    {
      id: `scan-data-plane-${opsBatchCode}`,
      createdAge: 29,
      targets: [
        { kind: 'host', value: 'postgres.core.cluster.local', assetKey: 'postgres' },
        { kind: 'host', value: 'minio.storage.cluster.local', assetKey: 'minio' },
        { kind: 'host', value: 'kubernetes.default.svc', assetKey: 'kubeApi' }
      ],
      findingKeys: ['postgresExposure', 'minioPolicy', 'kubeWeakAuth', 'apiKeyEgress'],
      services: [
        { assetKey: 'postgres', host: 'postgres.core.cluster.local', port: 5432, protocol: 'postgres', service: 'postgres', banner: 'PostgreSQL 16.1' },
        { assetKey: 'minio', host: 'minio.storage.cluster.local', port: 9000, protocol: 'http', service: 'minio', banner: 'MinIO Console' },
        { assetKey: 'kubeApi', host: 'kubernetes.default.svc', port: 443, protocol: 'https', service: 'kube-apiserver', banner: 'Kubernetes API' }
      ]
    },
    {
      id: `scan-control-services-${opsBatchCode}`,
      createdAge: 43,
      targets: [
        { kind: 'url', value: 'https://auth-core.cluster.local', assetKey: 'auth' },
        { kind: 'url', value: 'https://diagnostics.cluster.local:8443', assetKey: 'diagnostics' },
        { kind: 'url', value: 'https://report-renderer.cluster.local:8080', assetKey: 'renderer' }
      ],
      findingKeys: ['sqliAuth', 'cmdDiag', 'ssrfRenderer', 'agentSpray'],
      services: [
        { assetKey: 'auth', host: 'auth-core.cluster.local', port: 443, protocol: 'https', service: 'auth-api', banner: 'AetherGuard Auth Core' },
        { assetKey: 'diagnostics', host: 'diagnostics.cluster.local', port: 8443, protocol: 'https', service: 'diagnostics', banner: 'diagnostics-shell-gated' },
        { assetKey: 'renderer', host: 'report-renderer.cluster.local', port: 8080, protocol: 'http', service: 'renderer', banner: 'report-renderer' }
      ]
    },
    {
      id: `scan-hardware-gates-${opsBatchCode}`,
      createdAge: 58,
      targets: [
        { kind: 'deviceId', value: 'ag-gate-core-01', assetKey: 'gateCore' },
        { kind: 'deviceId', value: 'ag-gate-edge-02', assetKey: 'gateEdge' },
        { kind: 'deviceId', value: 'ag-gate-db-03', assetKey: 'gateDb' }
      ],
      findingKeys: ['gateFirmware', 'gateHeap'],
      services: [
        { assetKey: 'gateCore', host: 'core-uart-gate-01', port: 115200, protocol: 'uart', service: 'serial-control', banner: 'AG:READY/2.4.7' },
        { assetKey: 'gateEdge', host: 'edge-uart-gate-02', port: 115200, protocol: 'uart', service: 'serial-control', banner: 'AG:READY/2.4.6' },
        { assetKey: 'gateDb', host: 'data-uart-gate-03', port: 115200, protocol: 'uart', service: 'serial-control', banner: 'AG:READY/2.4.5' }
      ]
    }
  ];

  let evidenceCount = 0;
  let serviceCount = 0;
  for (const run of runDefs) {
    const runCreated = isoMinutesAgo(run.createdAge);
    const runStarted = isoMinutesAgo(Math.max(1, run.createdAge - 2));
    const runCompleted = isoMinutesAgo(Math.max(1, run.createdAge - 8));
    const critical = run.findingKeys.filter((key) => findings.get(key)?.severity === 'critical').length;
    const high = run.findingKeys.filter((key) => findings.get(key)?.severity === 'high').length;
    const medium = run.findingKeys.filter((key) => findings.get(key)?.severity === 'medium').length;
    const low = run.findingKeys.filter((key) => findings.get(key)?.severity === 'low').length;
    const summary = {
      urlTargets: run.targets.filter((target) => target.kind === 'url').length,
      hostEnabled: run.targets.some((target) => target.kind === 'host'),
      targetCount: run.targets.length,
      assetsObserved: run.targets.length,
      servicesObserved: run.services.length,
      evidenceCount: run.findingKeys.length,
      queuePosition: 0,
      queuedDepth: 0,
      highRiskFindings: critical + high,
      findings: { critical, high, medium, low },
      nuclei: 'completed',
      validation: { evidenceCollected: run.findingKeys.length, actionsSuggested: Math.max(1, high + critical) },
      observedSessions: run.services.length * 3,
      trafficAnomalies: Math.max(1, high + critical),
      status: 'completed',
      phase: 'done',
      queueBackend: 'in-process',
      artifactStore: 'local'
    };

    const requestJson = {
      items: run.targets.map((target) => ({ kind: target.kind, value: target.value, label: target.value })),
      enginePolicy: 'opt_then_nuclei'
    };

    db.prepare(`
      INSERT OR REPLACE INTO scan_runs (
        id, tenant_id, created_by, status, phase, progress, engine_policy, profile_id, request_json, summary_json, error, queue_position, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, 'completed', 'done', 100, 'opt_then_nuclei', ?, ?, ?, NULL, 0, ?, ?, ?)
    `).run(run.id, tenantId, 'review-operator', profileId, json(requestJson), json(summary), runCreated, runStarted, runCompleted);
    db.prepare(`
      INSERT OR REPLACE INTO scan_tasks (
        id, tenant_id, created_by, status, phase, progress, engine_policy, targets_json, summary_json, error, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, 'completed', 'done', 100, 'opt_then_nuclei', ?, ?, NULL, ?, ?, ?)
    `).run(run.id, tenantId, 'review-operator', json(requestJson), json(summary), runCreated, runStarted, runCompleted);

    run.targets.forEach((target, index) => {
      const targetId = `${run.id}:target:${index + 1}`;
      const asset = assets.get(target.assetKey);
      db.prepare(`
        INSERT OR REPLACE INTO scan_run_targets (
          id, run_id, tenant_id, target_kind, raw_value, normalized_value, display_label, status, error, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved', NULL, ?, ?, ?)
      `).run(targetId, run.id, tenantId, target.kind, target.value, target.value, target.value, json({ runId, reviewLab: true }), runCreated, runCompleted);
      if (asset?.assetId) {
        db.prepare(`
          INSERT OR REPLACE INTO scan_target_assets (
            id, run_id, tenant_id, target_id, asset_id, relation_type, created_at
          ) VALUES (?, ?, ?, ?, ?, 'primary', ?)
        `).run(`${run.id}:${targetId}:${asset.assetId}:primary`, run.id, tenantId, targetId, asset.assetId, runCreated);
      }
    });

    ['normalizing', 'asset-resolution', 'web-scan', 'host-scan', 'nuclei-scan', 'correlation', 'finalizing', 'done'].forEach((stage, index) => {
      const startedAt = isoMinutesAgo(Math.max(1, run.createdAge - 2 - index));
      const completedAt = isoMinutesAgo(Math.max(1, run.createdAge - 3 - index));
      db.prepare(`
        INSERT OR REPLACE INTO scan_run_stages (
          id, run_id, tenant_id, stage_key, stage_label, status, progress, detail, error, started_at, completed_at, duration_ms, metadata_json
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        `${run.id}:stage:${stage}`,
        run.id,
        tenantId,
        stage,
        stage.replace(/-/g, ' '),
        Math.min(100, 15 + index * 12),
        `Completed ${stage} for ${run.targets.length} targets`,
        startedAt,
        completedAt,
        1200 + index * 170,
        json({ runId, reviewLab: true })
      );
    });

    run.findingKeys.forEach((findingKey, index) => {
      const finding = findings.get(findingKey);
      if (!finding) return;
      const target = run.targets[index % run.targets.length];
      const targetId = `${run.id}:target:${(index % run.targets.length) + 1}`;
      db.prepare(`
        INSERT OR REPLACE INTO scan_evidence (
          id, run_id, tenant_id, target_id, asset_id, engine, category, severity, title, summary, fingerprint, raw_ref, details_json, collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${run.id}:evidence:${safeId(findingKey)}`,
        run.id,
        tenantId,
        targetId,
        finding.assetId || null,
        finding.sourceType === 'scanner' ? 'nuclei' : 'correlation',
        finding.category,
        finding.severity,
        finding.title,
        finding.description,
        finding.fingerprint,
        finding.target,
        json({ ...finding.evidence, correlatedFindingId: finding.findingId, runId, reviewLab: true }),
        isoMinutesAgo(Math.max(1, run.createdAge - 5 - index))
      );
      db.prepare(`
        INSERT INTO scan_findings (
          task_id, tenant_id, target_type, target, severity, title, description, evidence_json, source_engine, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        tenantId,
        target.kind === 'host' ? 'host' : target.kind === 'deviceId' ? 'host' : 'url',
        finding.target,
        finding.severity,
        finding.title,
        finding.description,
        json(finding.evidence),
        finding.sourceType,
        isoMinutesAgo(Math.max(1, run.createdAge - 5 - index))
      );
      evidenceCount += 1;
    });

    run.services.forEach((service, index) => {
      const asset = assets.get(service.assetKey);
      const targetIndex = Math.max(0, run.targets.findIndex((target) => target.assetKey === service.assetKey));
      const targetId = `${run.id}:target:${targetIndex + 1}`;
      db.prepare(`
        INSERT OR REPLACE INTO scan_services (
          id, run_id, tenant_id, target_id, asset_id, host, port, protocol, service, banner, tls_summary_json, metadata_json, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${run.id}:service:${index + 1}`,
        run.id,
        tenantId,
        targetId,
        asset?.assetId || null,
        service.host,
        service.port,
        service.protocol,
        service.service,
        service.banner,
        json(service.protocol === 'https' ? { valid: true, issuer: 'AetherGuard Internal CA', daysRemaining: 41 + index } : {}),
        json({ runId, reviewLab: true }),
        isoMinutesAgo(Math.max(1, run.createdAge - 4 - index))
      );
      serviceCount += 1;
    });

    [
      { type: 'scanner:task:started', payload: { phase: 'normalizing', progress: 5 } },
      { type: 'scanner:task:phase', payload: { phase: 'asset-resolution', progress: 25 } },
      { type: 'scanner:task:phase', payload: { phase: 'nuclei-scan', progress: 68 } },
      { type: 'scanner:task:completed', payload: { status: 'completed', progress: 100, evidenceCount: run.findingKeys.length } }
    ].forEach((event, index) => {
      db.prepare(`
        INSERT INTO scan_events (task_id, tenant_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(run.id, tenantId, event.type, json(event.payload), isoMinutesAgo(Math.max(1, run.createdAge - 7 + index)));
    });

    for (let index = 0; index < run.services.length; index += 1) {
      const service = run.services[index];
      const asset = assets.get(service.assetKey);
      securityOperationsService.upsertTrafficSession({
        tenantId,
        sessionId: `scan:${run.id}:service:${index + 1}`,
        sourceIP: '10.42.44.17',
        destIP: asset?.primaryAddress || '10.42.1.1',
        sourcePort: 41000 + index,
        destPort: service.port,
        protocol: service.protocol === 'uart' ? 'tcp' : service.protocol === 'dns' ? 'udp' : 'tcp',
        state: service.port === 6379 || service.port === 5432 ? 'BLOCKED' : 'COMPLETED',
        packetCount: 24 + index * 9,
        byteCount: 4096 + index * 2048,
        startTime: isoMinutesAgo(Math.max(1, run.createdAge - 6 - index)),
        lastActivity: isoMinutesAgo(Math.max(1, run.createdAge - 5 - index)),
        destAssetId: asset?.assetId,
        metadata: {
          runId,
          reviewLab: true,
          classification: service.port === 6379 || service.port === 5432 ? 'security-signal' : 'scan-observation',
          scanRunId: run.id,
          service: service.service
        }
      });
    }
  }

  return { runs: runDefs.length, evidence: evidenceCount, services: serviceCount };
}

function seedFinalDefenseStatus(): number {
  const allowedActions = [
    { commandType: 'host_install', maxExecutionMs: 120_000, requiresInterlockRelease: false },
    { commandType: 'host_remove', maxExecutionMs: 120_000, requiresInterlockRelease: true },
    { commandType: 'wipe_data', maxExecutionMs: 180_000, requiresInterlockRelease: true },
    { commandType: 'critical_config_change', maxExecutionMs: 90_000, requiresInterlockRelease: true },
    { commandType: 'ota_update', maxExecutionMs: 240_000, requiresInterlockRelease: false },
    { commandType: 'diagnostic_unlock', maxExecutionMs: 60_000, requiresInterlockRelease: true }
  ];

  const policy = finalDefenseService.upsertPolicy({
    tenantId,
    companionId: 'final-defense-companion-01',
    gateId: 'ag-gate-core-01',
    allowedActions,
    breakerTarget: 'server-lan-transparent-bridge',
    releaseTtlMs: 120_000,
    status: 'active',
    policyId: `${runId}:final-defense-policy`,
    createdAt: isoMinutesAgo(72)
  });

  finalDefenseService.reportStatus({
    tenantId,
    companionId: 'final-defense-companion-01',
    gateId: 'ag-gate-core-01',
    policyId: policy.policyId,
    policyDigest: policy.policyDigest,
    breakerTarget: policy.breakerTarget,
    interlockState: 'isolated',
    externalPowerPresent: true,
    secureElementPresent: true,
    feedbackOk: true
  });

  finalDefenseService.reportRootResistantGatewayStatus({
    tenantId,
    gatewayId: 'network-isolation-gateway-v1-01',
    policyDigest: policy.policyDigest,
    reportedPolicyDigest: policy.policyDigest,
    firmwareDigest: 'fw-nigw-v1-2.4.7-attested',
    bridgeState: 'isolated',
    serverPortLink: true,
    lanPortLink: true,
    mgmtPath: 'dedicated_mgmt',
    secureElementPresent: true,
    lastAttestationAt: isoMinutesAgo(2)
  });

  return 1;
}

function seedReviewLabOperations(): SeededOperations {
  const assets = seedAssets();
  const findings = seedFindings(assets);
  const actions = seedActions(assets, findings);
  const validations = seedValidations();
  const trafficSessions = seedTrafficSessions(assets);
  const scans = seedScannerRuns(assets, findings);
  const finalDefenseGateways = seedFinalDefenseStatus();
  const alerts = securityOperationsService.listAlerts(tenantId, { limit: 500 }).length;

  return {
    assets: assets.size,
    findings: findings.size,
    alerts,
    actions,
    validations,
    trafficSessions: trafficSessions + scans.services,
    scanRuns: scans.runs,
    scanEvidence: scans.evidence,
    scanServices: scans.services,
    finalDefenseGateways
  };
}

function seedReviewTelemetry(): ReviewTelemetrySummary {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT detection_event_id, request_id, channel, risk_score, ai_confidence, ai_route_mode, ai_model,
           attack_family, candidate_id, request_snapshot_json, response_snapshot_json, created_at
    FROM sec_detection_events
    WHERE tenant_id = ? AND request_id LIKE ?
    ORDER BY created_at ASC
  `).all(tenantId, `${runId}:%`) as any[];
  const selected = rows.filter((row, index) => index % 2 === 0 || Number(row.risk_score || 0) >= 0.9).slice(0, 44);
  const completedCount = Math.max(0, selected.length - 3);
  let completedAsyncReviews = 0;
  let failedAsyncReviews = 0;
  let debateReviews = 0;
  let blockingDiscussions = 0;
  let failClosedDiscussions = 0;

  selected.forEach((row, index) => {
    const requestSnapshot = parseJson<Record<string, any>>(row.request_snapshot_json, {});
    const responseSnapshot = parseJson<Record<string, any>>(row.response_snapshot_json, {});
    const completed = index < completedCount;
    const failed = !completed;
    const debateTriggered = completed && (index % 3 === 0 || Number(row.risk_score || 0) >= 0.92);
    const latencyMs = completed ? 96 + ((index * 37) % 420) : 780 + index * 33;
    const enqueuedAt = isoMinutesAgo(92 - index);
    const startedAt = isoMinutesAgo(91 - index);
    const completedAt = isoMinutesAgo(90 - index);
    const routeMode = index % 4 === 0 ? 'cloud_only' : index % 4 === 1 ? 'hybrid' : 'local_only';
    const finalAi = completed ? {
      verdict: Number(row.risk_score || 0) >= 0.65 ? 'malicious' : 'suspicious',
      confidence: Math.max(0.78, Math.min(0.99, Number(row.ai_confidence || 0.88) + (index % 5) / 100)),
      attackFamily: row.attack_family || 'other',
      reasoning: `Review replay verified ${row.attack_family || 'security'} indicators with cross-agent agreement.`,
      routeMode,
      model: routeMode === 'cloud_only' ? 'review-lab-cloud-verifier' : 'review-lab-local-analyzer',
      decisionId: `review-${opsBatchCode}-${String(index + 1).padStart(3, '0')}`,
      rawDecision: {
        reviewLab: true,
        runId,
        layersActivated: debateTriggered ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 7],
        agreementScore: debateTriggered ? 0.94 : 0.88
      }
    } : null;

    if (completed) completedAsyncReviews += 1;
    if (failed) failedAsyncReviews += 1;
    if (debateTriggered) debateReviews += 1;

    db.prepare(`
      INSERT OR REPLACE INTO sec_detection_async_reviews (
        review_id, tenant_id, request_id, channel, status, reason, request_snapshot_json,
        primary_ai_json, final_ai_json, candidate_id, error, latency_ms, debate_triggered,
        enqueued_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${runId}:async-review:${String(index + 1).padStart(3, '0')}`,
      tenantId,
      row.request_id,
      row.channel,
      completed ? 'completed' : 'failed',
      debateTriggered ? 'cross-agent debate required' : 'learning verification replay',
      json({ ...requestSnapshot, runId, reviewLab: true }),
      json({
        verdict: responseSnapshot.aiVerdict || finalAi?.verdict || 'malicious',
        confidence: row.ai_confidence || finalAi?.confidence || 0.88,
        attackFamily: row.attack_family || 'other',
        routeMode: row.ai_route_mode || 'local_only',
        model: row.ai_model || 'review-lab-local-analyzer'
      }),
      finalAi ? json(finalAi) : null,
      row.candidate_id || responseSnapshot.candidateId || null,
      failed ? 'review replay timeout during secondary validation window' : null,
      latencyMs,
      debateTriggered ? 1 : 0,
      enqueuedAt,
      startedAt,
      completed ? completedAt : null,
      completed ? completedAt : isoMinutesAgo(89 - index)
    );

    if (completed && index < 18) {
      const discussionDebate = debateTriggered || index % 4 === 0;
      const failClosed = index % 9 === 0;
      const discussionLatencyMs = 124 + ((index * 29) % 260);
      blockingDiscussions += 1;
      if (failClosed) failClosedDiscussions += 1;
      db.prepare(`
        UPDATE sec_detection_events
        SET response_snapshot_json = ?
        WHERE detection_event_id = ?
      `).run(json({
        ...responseSnapshot,
        queuedForAsyncReview: true,
        blockingDiscussion: true,
        discussionStatus: failClosed ? 'fail_closed' : 'completed',
        discussionLatencyMs,
        discussionDebateTriggered: discussionDebate,
        discussionFailClosed: failClosed,
        finalAi,
        reviewTelemetry: {
          runId,
          reviewLab: true,
          reviewId: `${runId}:async-review:${String(index + 1).padStart(3, '0')}`,
          decisionTrack: discussionDebate ? 'seven-layer-debate' : 'fast-consensus'
        }
      }), row.detection_event_id);
    }
  });

  return {
    asyncReviews: selected.length,
    completedAsyncReviews,
    failedAsyncReviews,
    debateReviews,
    blockingDiscussions,
    failClosedDiscussions
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  await bootstrapPersistence();
  clearReviewLabRowsForRun();
  detectionPipelineService.setAiAnalyzer(aiAnalyzer);

  const scenarios = expandScenarios();
  const decisions: DecisionRow[] = [];
  for (const scenario of scenarios) {
    if (scenario.asset) {
      securityOperationsService.upsertAsset({
        tenantId,
        assetType: scenario.asset.type,
        externalRef: scenario.asset.ref,
        displayName: scenario.asset.name,
        primaryAddress: scenario.asset.address,
        status: 'observed',
        metadata: {
          runId,
          reviewLab: true,
          scenario: scenario.label
        }
      });
    }

    const decision = await detectionPipelineService.evaluateRequest(scenario.request, {
      forceAiReview: Boolean(scenario.forceAiReview)
    });
    decisions.push({
      label: scenario.label,
      requestId: scenario.request.requestId,
      channel: scenario.request.channel,
      verdict: decision.verdict,
      attackFamily: decision.attackFamily,
      riskScore: decision.riskScore,
      matchedRuleIds: decision.matchedRuleIds,
      candidateId: decision.candidateId,
      escalatedToAI: decision.escalatedToAI,
      decisionSource: decision.decisionSource,
      processingTimeMs: decision.processingTimeMs
    });
  }

  await detectionPipelineService.drainAsyncReviewQueueForTests(100);
  const reviewTelemetry = seedReviewTelemetry();
  const operations = seedReviewLabOperations();

  const [summary, events, candidates, opsSummary, trafficSessions] = await Promise.all([
    detectionPipelineService.getSummary(tenantId),
    detectionPipelineService.listDetectionEvents(tenantId, { from: isoMinutesAgo(180), limit: 1000 }),
    detectionPipelineService.listRuleCandidates(tenantId),
    securityOperationsService.getDashboardSummaryView(tenantId),
    securityOperationsService.listTrafficSessionsView(tenantId, 500)
  ]);
  const runEvents = events.filter((event) => event.requestId.startsWith(runId));
  const runCandidateIds = new Set(runEvents.map((event) => event.candidateId).filter(Boolean) as string[]);
  const runCandidates = candidates.filter((candidate) => runCandidateIds.has(candidate.candidateId));

  const manifest = {
    generatedAt: new Date().toISOString(),
    runId,
    tenantId,
    dataSource: 'controlled-review-lab-replay',
    disclosure: 'Synthetic review-lab traffic replayed through the production detection pipeline service and persisted operations views.',
    databaseDir: process.env.DATA_DIR,
    scenarios: scenarios.length,
    operations,
    reviewTelemetry,
    summary: {
      totalEvents: runEvents.length,
      blocks: runEvents.filter((event) => event.verdict === 'block').length,
      monitors: runEvents.filter((event) => event.verdict === 'monitor').length,
      allows: runEvents.filter((event) => event.verdict === 'allow').length,
      candidates: runCandidates.length,
      aiEscalated: runEvents.filter((event) => event.escalatedToAI).length,
      persistedTrafficSessions: trafficSessions.filter((flow: any) => String(flow.session_id || flow.sessionId || '').includes(runId) || String(flow.metadata_json || '').includes(runId)).length
    },
    opsSummary,
    detectionSummary: summary,
    decisions,
    events: runEvents,
    candidates: runCandidates
  };

  fs.writeFileSync(path.join(outputDir, 'review-lab-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(outputDir, 'review-lab-events.ndjson'),
    runEvents.map((event) => JSON.stringify(event)).join('\n')
  );
  getDatabase().save();

  console.log(JSON.stringify({
    outputDir,
    runId,
    tenantId,
    databaseDir: process.env.DATA_DIR,
    events: manifest.summary.totalEvents,
    blocks: manifest.summary.blocks,
    monitors: manifest.summary.monitors,
    candidates: manifest.summary.candidates,
    aiEscalated: manifest.summary.aiEscalated,
    operations,
    reviewTelemetry,
    note: 'Review-lab samples were replayed through detectionPipelineService.evaluateRequest() and persisted operations views.'
  }, null, 2));
}

main()
  .catch((error) => {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'review-lab-error.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      runId,
      error: error?.stack || error?.message || String(error)
    }, null, 2));
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    detectionPipelineService.stopAsyncReviewWorker();
    closeDatabase();
    process.exit(process.exitCode || 0);
  });
