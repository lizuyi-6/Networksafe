import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    syncSignalFinding: jest.fn()
  }
}));

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { platformConfigService } from '../../services/platform-config.service';
import {
  detectionPipelineService,
  type DetectionAIResult
} from '../../services/detection-pipeline.service';
import type { DetectionChannel, DetectionRequest } from '../../services/detection-engine';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-detection-learning-test-data');
const tenantId = 'tenant-learning';

function buildRequest(channel: DetectionChannel, overrides: Partial<DetectionRequest> = {}): DetectionRequest {
  return {
    tenantId,
    channel,
    requestId: `${channel}-request-1`,
    timestamp: new Date().toISOString(),
    sourceIp: '10.0.0.8',
    method: 'POST',
    path: '/api/workflow/submit',
    decodedPath: '/api/workflow/submit',
    query: 'review=true',
    decodedQuery: 'review=true',
    parsedQuery: 'review=true\ntrue',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0'
    },
    body: '{"operation":"review","value":"unclassified"}',
    normalizedBody: '{"operation":"review","value":"unclassified"}',
    parsedBody: 'operation\nreview\nvalue\nunclassified',
    userAgent: 'Mozilla/5.0',
    evidence: 'local detector marked this sample risky',
    protocol: channel === 'packet' ? 'tcp' : 'http',
    rawPayload: 'POST /api/workflow/submit',
    existingSignals: [{
      source: 'existing_signal',
      key: 'test-local-risk',
      score: 0.55,
      severity: 'medium',
      description: 'Upstream deterministic detector marked the sample for local model review'
    }],
    metadata: {},
    ...overrides
  };
}

describe('detectionPipelineService learning verification', () => {
  beforeAll(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.env.DATA_DIR = testDataDir;
    await initDatabase();
    platformConfigService.prepare();
    detectionPipelineService.prepare();
  });

  afterAll(() => {
    detectionPipelineService.setAiAnalyzer(null);
    closeDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM sec_detection_events');
    db.exec('DELETE FROM sec_detection_async_reviews');
    db.exec('DELETE FROM sec_rule_candidates');
    db.exec('DELETE FROM sec_detection_rules');
    db.exec('DELETE FROM platform_config');
    detectionPipelineService.setAiAnalyzer(null);
  });

  it('queues async review for http_api after the local hot-path model keeps the primary verdict', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'suspicious',
        confidence: 0.68,
        reasoning: 'Local pass flags SSRF probe but wants cloud verification.',
        attackFamily: 'ssrf',
        routeMode: 'local_preferred',
        model: 'local-hot-path'
      })
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: 0.93,
        reasoning: 'Cloud verification confirms SSRF metadata access attempt.',
        attackFamily: 'ssrf',
        routeMode: 'cloud_only',
        model: 'glm-5'
      });

    detectionPipelineService.setAiAnalyzer({ analyze });

    const decision = await detectionPipelineService.evaluateRequest(buildRequest('http_api'));
    expect(decision.verdict).toBe('monitor');
    expect(decision.aiVerdict).toBe('suspicious');
    expect(decision.queuedForAsyncReview).toBe(true);
    expect(decision.candidateId).toBeNull();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][1]).toEqual({
      analysisPurpose: 'primary',
      routeModeOverride: 'local_only'
    });

    await detectionPipelineService.drainAsyncReviewQueueForTests();
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, { channel: 'http_api', limit: 5 });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[1][1]).toEqual({
      analysisPurpose: 'learning_verification',
      routeModeOverride: 'cloud_only'
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].attackFamily).toBe('ssrf');
    expect(candidates[0].latestEvidence.primaryAi.attackFamily).toBe('ssrf');
    expect(candidates[0].latestEvidence.learningVerificationAi.attackFamily).toBe('ssrf');
    expect(events[0].aiConfidence).toBe(0.68);
    expect(events[0].queuedForAsyncReview).toBe(true);
  });

  it('does not create a candidate for packet traffic when cloud verification stays suspicious', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'suspicious',
        confidence: 0.71,
        reasoning: 'Primary packet review sees automation indicators.',
        attackFamily: 'automation',
        routeMode: 'local_preferred',
        model: 'local-hot-path'
      })
      .mockResolvedValueOnce({
        verdict: 'suspicious',
        confidence: 0.77,
        reasoning: 'Cloud verification still sees only suspicious automation.',
        attackFamily: 'automation',
        routeMode: 'cloud_only',
        model: 'glm-5'
      });

    detectionPipelineService.setAiAnalyzer({ analyze });

    const decision = await detectionPipelineService.evaluateRequest(buildRequest('packet', {
      requestId: 'packet-request-1',
      path: '/capture',
      decodedPath: '/capture',
      query: '',
      decodedQuery: '',
      parsedQuery: '',
      userAgent: 'Mozilla/5.0',
      rawPayload: 'TLS application frame with elevated local risk'
    }));
    expect(decision.queuedForAsyncReview).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);

    await detectionPipelineService.drainAsyncReviewQueueForTests();
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, { channel: 'packet', limit: 5 });

    expect(decision.verdict).toBe('monitor');
    expect(decision.candidateId).toBeNull();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(candidates).toHaveLength(0);
    expect(events[0].queuedForAsyncReview).toBe(true);
  });

  it('creates a pending candidate for agent async review without manual backfill', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: 0.91,
        reasoning: 'Agent async review sees high-risk automation behavior.',
        attackFamily: 'benign',
        routeMode: 'cloud_only',
        model: 'glm-5'
      });

    detectionPipelineService.setAiAnalyzer({ analyze });

    const decision = await detectionPipelineService.reviewAgentSample(buildRequest('agent', {
      requestId: 'agent-review-1',
      path: '/agent/review',
      decodedPath: '/agent/review',
      query: '',
      decodedQuery: '',
      parsedQuery: '',
      evidence: 'sqlmap replay against admin login',
      rawPayload: 'sqlmap -u https://target/admin/login'
    }));
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');

    expect(decision.verdict).toBe('block');
    expect(decision.candidateId).toBeTruthy();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].channel).toBe('agent');
    expect(candidates[0].attackFamily).toBe('automation');
    expect(decision.aiResult?.attackFamily).toBe('automation');
    expect(decision.learningVerificationAiResult).toBeUndefined();
    expect(candidates[0].latestEvidence.primaryAi.routeMode).toBe('cloud_only');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][1]).toEqual({
      analysisPurpose: 'learning_verification',
      routeModeOverride: 'cloud_only'
    });
  });

  it('re-runs learning verification when primary malicious confidence is missing and records normalized confidence in events', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: Number.NaN,
        reasoning: 'Primary model believes the request is malicious but returns no usable confidence.',
        attackFamily: 'ssrf',
        routeMode: 'local_preferred',
        model: 'local-hot-path'
      })
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: 0.96,
        reasoning: 'Cloud verification confirms the SSRF payload.',
        attackFamily: 'ssrf',
        routeMode: 'cloud_only',
        model: 'glm-5'
      });

    detectionPipelineService.setAiAnalyzer({ analyze });

    const decision = await detectionPipelineService.evaluateRequest(buildRequest('http_api', {
      requestId: 'http-missing-confidence-1'
    }));
    expect(decision.queuedForAsyncReview).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);

    await detectionPipelineService.drainAsyncReviewQueueForTests();
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, { channel: 'http_api', limit: 5 });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(decision.aiVerdict).toBe('malicious');
    expect(decision.aiConfidence).toBe(0);
    expect(decision.learningVerificationAiResult).toBeUndefined();
    expect(decision.candidateId).toBeNull();
    expect(candidates).toHaveLength(1);
    expect(events[0].aiConfidence).toBe(0);
    expect(events[0].queuedForAsyncReview).toBe(true);
  });

  it('returns immediately on rule block without entering the local model', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>();
    detectionPipelineService.setAiAnalyzer({ analyze });

    const decision = await detectionPipelineService.evaluateRequest(buildRequest('http_api', {
      requestId: 'rule-block-1',
      path: '/search',
      decodedPath: '/search',
      query: 'q=UNION SELECT password FROM users',
      decodedQuery: 'q=UNION SELECT password FROM users',
      parsedQuery: 'q=UNION SELECT password FROM users\nUNION SELECT password FROM users',
      body: '',
      normalizedBody: '',
      parsedBody: ''
    }));

    expect(decision.verdict).toBe('block');
    expect(decision.matchedRuleIds).toContain('seed-sqli-union');
    expect(decision.escalatedToAI).toBe(false);
    expect(decision.queuedForAsyncReview).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('flags a disagreement when cloud verification flips the primary verdict', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'suspicious',
        confidence: 0.6,
        reasoning: 'Local hot path treats this as borderline suspicious.',
        attackFamily: 'ssrf',
        routeMode: 'local_only',
        model: 'local-hot-path'
      })
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: 0.95,
        reasoning: 'Cloud verification flips to malicious — real SSRF metadata access.',
        attackFamily: 'ssrf',
        routeMode: 'cloud_only',
        model: 'glm-5'
      });

    detectionPipelineService.setAiAnalyzer({ analyze });

    await detectionPipelineService.evaluateRequest(buildRequest('http_api', {
      requestId: 'disagreement-flip-1'
    }));
    await detectionPipelineService.drainAsyncReviewQueueForTests();

    // Surfaces in stats (observability for the learning loop).
    const stats = await detectionPipelineService.getAsyncReviewStats(tenantId);
    expect(stats.completed).toBe(1);
    expect(stats.disagreements).toBe(1);
    expect(stats.disagreementRate).toBe(1);

    // Persisted on the review row with structured detail for future training pairs.
    const db = getDatabase();
    const row = db.prepare(`SELECT disagreement, disagreement_json FROM sec_detection_async_reviews WHERE request_id = ?`).get('disagreement-flip-1') as any;
    expect(row.disagreement).toBe(1);
    const detail = JSON.parse(row.disagreement_json);
    expect(detail.verdictDisagree).toBe(true);
    expect(detail.primaryVerdict).toBe('suspicious');
    expect(detail.verifiedVerdict).toBe('malicious');
    expect(detail.flippedTo).toBe('malicious');
  });
});
