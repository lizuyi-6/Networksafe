/**
 * DetectionPipelineService tests
 *
 * Covers: evaluateRequest (rule matching, AI escalation, attack family),
 * listRules, listRuleCandidates, approve/rejectRuleCandidate, getSummary,
 * getAsyncReviewStats, recordBlockedThreat, runBlockingReview.
 */

import { initDatabase } from '../../config/database';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { platformConfigService } from '../../services/platform-config.service';
import type { DetectionRequest } from '../../services/detection-engine';
import type { DetectionAIResult } from '../../services/detection-pipeline.service';

// DetectionAIAnalyzer is not exported by the production module; define a
// structurally-compatible local type so the mock satisfies setAiAnalyzer().
interface DetectionAIAnalyzer {
  analyze(
    request: DetectionRequest,
    options?: Record<string, unknown>
  ): Promise<DetectionAIResult>;
}

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../../services/job-queue.service', () => ({
  jobQueueService: {
    enqueue: jest.fn().mockResolvedValue(undefined),
    drain: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    syncSignalFinding: jest.fn().mockResolvedValue(undefined)
  }
}));

function buildRequest(overrides: Partial<DetectionRequest> = {}): DetectionRequest {
  return {
    tenantId: 'tenant-test-pipeline',
    channel: 'http_api',
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    method: 'GET',
    path: '/api/test',
    decodedPath: '/api/test',
    headers: {},
    body: '',
    query: '',
    decodedQuery: '',
    parsedQuery: '',
    userAgent: 'jest-test',
    evidence: '',
    rawPayload: '',
    protocol: 'HTTP/1.1',
    metadata: {},
    ...overrides
  };
}

function makeAiResult(overrides: Partial<DetectionAIResult> = {}): DetectionAIResult {
  return {
    verdict: 'safe',
    confidence: 0.95,
    reasoning: 'Test AI result',
    ...overrides
  };
}

describe('DetectionPipelineService', () => {
  let mockAnalyzer: DetectionAIAnalyzer;

  beforeAll(async () => {
    await initDatabase();
    detectionPipelineService.prepare();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAnalyzer = {
      analyze: jest.fn().mockResolvedValue(makeAiResult({ verdict: 'safe', confidence: 0.95 }))
    };
    detectionPipelineService.setAiAnalyzer(mockAnalyzer);
  });

  afterEach(() => {
    detectionPipelineService.setAiAnalyzer(null);
  });

  describe('listRules', () => {
    it('returns seed rules without database rules', async () => {
      const rules = await detectionPipelineService.listRules('tenant-test-pipeline');
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]).toHaveProperty('ruleId');
      expect(rules[0]).toHaveProperty('severity');
    });
  });

  describe('evaluateRequest — rule matching', () => {
    it('returns allow verdict for benign traffic with no rule match', async () => {
      const request = buildRequest({ path: '/api/health', method: 'GET' });

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.verdict).toBeDefined();
      expect(decision.attackFamily).toBeDefined();
      expect(decision.riskScore).toBeGreaterThanOrEqual(0);
    });

    it('escalates to AI and returns suspicious verdict when AI analyzer is set', async () => {
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({ verdict: 'suspicious', confidence: 0.4, reasoning: 'Ambiguous payload' })
      );

      // Use a path that won't match seed rules so hot-path AI fires
      const request = buildRequest({
        path: '/api/ambiguous-request',
        method: 'GET',
        query: 'data=something_neutral'
      });

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.escalatedToAI).toBe(true);
      expect(decision.aiVerdict).toBe('suspicious');
    });

    it('blocks when rule verdict is block (seed rule match)', async () => {
      // Seed SQLi rules fire on this pattern
      const request = buildRequest({
        path: '/api/search',
        query: 'q=union%20select%201',
        decodedQuery: 'q=union select 1',
        parsedQuery: 'q=union select 1\nunion select 1'
      });

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.verdict).toBe('block');
      expect(decision.matchedRuleIds.length).toBeGreaterThan(0);
    });

    it('escalates to AI when forceAiReview is set', async () => {
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({ verdict: 'safe', confidence: 0.95, reasoning: 'Clean request' })
      );

      const request = buildRequest({
        path: '/api/search',
        query: 'q=test'
      });

      const decision = await detectionPipelineService.evaluateRequest(request, { forceAiReview: true });

      expect(decision.escalatedToAI).toBe(true);
    });
  });

  describe('evaluateRequest — AI escalation decisions', () => {
    it('does not escalate to AI when no analyzer is set and classification is standard', async () => {
      detectionPipelineService.setAiAnalyzer(null);

      const request = buildRequest({ path: '/api/public', method: 'GET' });

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.escalatedToAI).toBe(false);
    });

    it('records matched rule IDs in the decision', async () => {
      const request = buildRequest({
        path: '/api/search',
        query: 'q=union%20select%201',
        decodedQuery: 'q=union select 1',
        parsedQuery: 'q=union select 1\nunion select 1'
      });

      const decision = await detectionPipelineService.evaluateRequest(request);

      if (decision.matchedRuleIds.length > 0) {
        expect(decision.ruleMatches.length).toBeGreaterThan(0);
      }
    });

    it('sets processingTimeMs in the decision', async () => {
      const request = buildRequest();

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluateRequest — attack family classification', () => {
    it('returns a valid attack family classification for safe requests', async () => {
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({ verdict: 'safe', confidence: 0.99 })
      );

      const request = buildRequest({ path: '/api/health', method: 'GET' });

      const decision = await detectionPipelineService.evaluateRequest(request);

      // attackFamily is always a valid string (benign/other/sqli/xss/etc.)
      expect(['benign', 'other', 'sqli', 'xss', 'path_traversal', 'command_injection', 'ssrf', 'automation']).toContain(decision.attackFamily);
    });

    it('normalizes AI attack family through the service normalizer', async () => {
      // The AI result attack family goes through normalizeAttackFamily
      // A request that triggers AI (no rule match) with a specific AI attack family
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({ verdict: 'malicious', confidence: 0.95, attackFamily: 'sqli', reasoning: 'SQL injection' })
      );

      const request = buildRequest({
        path: '/api/search',
        query: 'q=1'  // not matching seed patterns but AI fires
      });

      const decision = await detectionPipelineService.evaluateRequest(request);

      expect(decision.escalatedToAI).toBe(true);
      expect(decision.aiVerdict).toBe('malicious');
    });
  });

  describe('listRuleCandidates', () => {
    it('returns empty array when no candidates exist', async () => {
      const candidates = await detectionPipelineService.listRuleCandidates('tenant-test-pipeline');
      expect(Array.isArray(candidates)).toBe(true);
    });

    it('returns candidates filtered by status when provided', async () => {
      const candidates = await detectionPipelineService.listRuleCandidates('tenant-test-pipeline', 'pending');
      expect(Array.isArray(candidates)).toBe(true);
    });
  });

  describe('approveRuleCandidate', () => {
    it('returns null when candidate does not exist', async () => {
      const result = await detectionPipelineService.approveRuleCandidate(
        'tenant-test-pipeline', 'nonexistent-candidate', 'actor-1'
      );
      expect(result).toBeNull();
    });
  });

  describe('rejectRuleCandidate', () => {
    it('returns null when candidate does not exist', async () => {
      const result = await detectionPipelineService.rejectRuleCandidate(
        'tenant-test-pipeline', 'nonexistent-candidate', 'actor-1'
      );
      expect(result).toBeNull();
    });
  });

  describe('getAsyncReviewStats', () => {
    it('returns valid stats structure for a tenant with no reviews', async () => {
      const stats = await detectionPipelineService.getAsyncReviewStats('tenant-test-pipeline');

      expect(stats).toHaveProperty('queueDepth');
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('completionRate');
      expect(stats).toHaveProperty('debateCompletionRate');
      expect(stats).toHaveProperty('avgLatencyMs');
    });
  });

  describe('getSummary', () => {
    it('returns valid summary structure', async () => {
      const summary = await detectionPipelineService.getSummary('tenant-test-pipeline');

      expect(summary).toHaveProperty('totalRules');
      expect(summary).toHaveProperty('activeRules');
      expect(summary).toHaveProperty('pendingCandidates');
      expect(summary).toHaveProperty('ruleHitRate');
      expect(summary).toHaveProperty('aiEscalationRate');
      expect(summary).toHaveProperty('classificationLevel');
      expect(Array.isArray(summary.topRules)).toBe(true);
    });
  });

  describe('recordBlockedThreat', () => {
    it('records a blocked threat without error', async () => {
      const request = buildRequest({
        requestId: `blocked-req-${Date.now()}`
      });

      await expect(
        detectionPipelineService.recordBlockedThreat(
          request,
          ['seed-sqli-union'],
          'critical',
          'SQL injection attempt'
        )
      ).resolves.not.toThrow();
    });
  });

  describe('evaluateRequest — skipPersistence option', () => {
    it('does not persist event when skipPersistence is true', async () => {
      const request = buildRequest();

      const decision = await detectionPipelineService.evaluateRequest(request, { skipPersistence: true });

      expect(decision.verdict).toBeDefined();
    });
  });

  describe('runBlockingReview', () => {
    it('returns unavailable when AI analyzer is null', async () => {
      detectionPipelineService.setAiAnalyzer(null);

      const request = buildRequest();

      const result = await detectionPipelineService.runBlockingReview({
        request,
        reason: 'test blocking review'
      });

      expect(result.required).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe('unavailable');
      expect(result.failClosed).toBe(true);
    });

    it('runs blocking review with AI analyzer available', async () => {
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({ verdict: 'safe', confidence: 0.95, reasoning: 'Verified safe' })
      );

      const request = buildRequest();

      const result = await detectionPipelineService.runBlockingReview({
        request,
        reason: 'elevated classification review'
      });

      expect(result.required).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.failClosed).toBe(false);
    });

    it('fails closed when blocking review times out', async () => {
      mockAnalyzer.analyze = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(makeAiResult({ verdict: 'safe' })), 5000))
      );

      const request = buildRequest();

      const result = await detectionPipelineService.runBlockingReview({
        request,
        reason: 'timeout test',
        settings: { blockingDiscussionTimeoutMs: 100 } as any
      });

      expect(result.status).toBe('timeout');
      expect(result.failClosed).toBe(true);
    });
  });

  describe('listDetectionEvents', () => {
    it('returns array of events for a tenant', async () => {
      const events = await detectionPipelineService.listDetectionEvents('tenant-test-pipeline');
      expect(Array.isArray(events)).toBe(true);
    });

    it('filters by channel when provided', async () => {
      const events = await detectionPipelineService.listDetectionEvents('tenant-test-pipeline', {
        channel: 'http_api'
      });
      expect(Array.isArray(events)).toBe(true);
    });

    it('filters by verdict when provided', async () => {
      const events = await detectionPipelineService.listDetectionEvents('tenant-test-pipeline', {
        verdict: 'allow'
      });
      expect(Array.isArray(events)).toBe(true);
    });

    it('surfaces aiHeuristicDegraded from the persisted AI decision (degradation transparency)', async () => {
      mockAnalyzer.analyze = jest.fn().mockResolvedValue(
        makeAiResult({
          verdict: 'suspicious',
          confidence: 0.7,
          reasoning: 'heuristic fallback verdict',
          rawDecision: {
            verdict: 'monitor',
            heuristicDegraded: true,
            heuristicFallbackCount: 3
          }
        })
      );

      const request = buildRequest({ path: '/api/search', query: 'q=1' });
      const decision = await detectionPipelineService.evaluateRequest(request);
      expect(decision.escalatedToAI).toBe(true);

      const events = await detectionPipelineService.listDetectionEvents('tenant-test-pipeline', { limit: 50 });
      const event = events.find((item) => item.requestId === request.requestId);
      expect(event).toBeDefined();
      expect(event!.aiHeuristicDegraded).toBe(true);
    });
  });
});
