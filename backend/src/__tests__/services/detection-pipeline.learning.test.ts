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
    path: '/proxy?url=http://169.254.169.254/latest/meta-data',
    decodedPath: '/proxy?url=http://169.254.169.254/latest/meta-data',
    query: 'url=http://169.254.169.254/latest/meta-data',
    decodedQuery: 'url=http://169.254.169.254/latest/meta-data',
    parsedQuery: 'url=http://169.254.169.254/latest/meta-data\nhttp://169.254.169.254/latest/meta-data',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'sqlmap/1.8'
    },
    body: '{"url":"http://169.254.169.254/latest/meta-data"}',
    normalizedBody: '{"url":"http://169.254.169.254/latest/meta-data"}',
    parsedBody: 'url\nhttp://169.254.169.254/latest/meta-data',
    userAgent: 'sqlmap/1.8',
    evidence: 'metadata fetch attempt',
    protocol: channel === 'packet' ? 'tcp' : 'http',
    rawPayload: 'GET /latest/meta-data',
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
    db.exec('DELETE FROM sec_rule_candidates');
    db.exec('DELETE FROM sec_detection_rules');
    db.exec('DELETE FROM platform_config');
    detectionPipelineService.setAiAnalyzer(null);
  });

  it('creates a pending candidate for http_api after cloud verification while keeping the primary verdict', async () => {
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
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, { channel: 'http_api', limit: 5 });

    expect(decision.verdict).toBe('monitor');
    expect(decision.aiVerdict).toBe('suspicious');
    expect(decision.candidateId).toBeTruthy();
    expect(decision.learningVerificationAiResult?.verdict).toBe('malicious');
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0][1]).toEqual({ analysisPurpose: 'primary' });
    expect(analyze.mock.calls[1][1]).toEqual({
      analysisPurpose: 'learning_verification',
      routeModeOverride: 'cloud_only'
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].attackFamily).toBe('ssrf');
    expect(candidates[0].latestEvidence.primaryAi.attackFamily).toBe('ssrf');
    expect(candidates[0].latestEvidence.learningVerificationAi.attackFamily).toBe('ssrf');
    expect(events[0].aiConfidence).toBe(0.68);
    expect(events[0].responseSnapshot.learningVerificationAi.attackFamily).toBe('ssrf');
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
      userAgent: 'sqlmap/1.8',
      rawPayload: 'User-Agent: sqlmap/1.8'
    }));
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, { channel: 'packet', limit: 5 });

    expect(decision.verdict).toBe('monitor');
    expect(decision.candidateId).toBeNull();
    expect(decision.learningVerificationAiResult?.verdict).toBe('suspicious');
    expect(candidates).toHaveLength(0);
    expect(events[0].responseSnapshot.learningVerificationAi.verdict).toBe('suspicious');
  });

  it('creates a pending candidate for agent async review without manual backfill', async () => {
    const analyze = jest.fn<Promise<DetectionAIResult>, any[]>()
      .mockResolvedValueOnce({
        verdict: 'suspicious',
        confidence: 0.74,
        reasoning: 'Agent local-preferred review sees high-risk automation behavior.',
        attackFamily: 'benign',
        routeMode: 'local_preferred',
        model: 'local-hot-path'
      })
      .mockResolvedValueOnce({
        verdict: 'malicious',
        confidence: 0.91,
        reasoning: 'Cloud verification confirms scripted attack automation.',
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

    expect(decision.verdict).toBe('monitor');
    expect(decision.candidateId).toBeTruthy();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].channel).toBe('agent');
    expect(candidates[0].attackFamily).toBe('automation');
    expect(decision.aiResult?.attackFamily).toBe('automation');
    expect(decision.learningVerificationAiResult?.attackFamily).toBe('automation');
    expect(candidates[0].latestEvidence.learningVerificationAi.routeMode).toBe('cloud_only');
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
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, 'pending');
    const events = await detectionPipelineService.listDetectionEvents(tenantId, {
      channel: 'http_api',
      candidateId: decision.candidateId || undefined,
      limit: 5
    });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(decision.aiVerdict).toBe('malicious');
    expect(decision.aiConfidence).toBe(0);
    expect(decision.learningVerificationAiResult?.confidence).toBe(0.96);
    expect(decision.candidateId).toBeTruthy();
    expect(candidates).toHaveLength(1);
    expect(events[0].aiConfidence).toBe(0);
    expect(events[0].responseSnapshot.learningVerificationAi.confidence).toBe(0.96);
  });
});
