import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import { ANONYMOUS_TENANT_ID, PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';
import { jobQueueService } from './job-queue.service';
import {
  platformConfigService,
  type AIRoutingMode,
  type DetectionPipelineSettings,
  isSeverityAtLeast,
  normalizeSecurityClassificationLevel,
  type SecurityClassificationLevel,
  type SeverityLevel
} from './platform-config.service';
import { securityOperationsService } from './security-operations.service';
import {
  assessDetectionHeuristics,
  buildDetectionCandidateSuggestion,
  buildSeedDetectionRules,
  DetectionAttackFamily,
  DetectionChannel,
  DetectionRequest,
  DetectionRuleMatcher,
  DetectionRuleRecord,
  DetectionSeverity,
  DetectionSignal,
  DetectionVerdict,
  evaluateDetectionRules,
  inferAttackFamily,
  severityToBlockDurationSeconds,
  collectInvalidMatcherPatterns,
  matcherDeclaresCriteria
} from './detection-engine';
import { sanitizeDetectionRequestForAnalysis, sanitizeDetectionRequestSnapshot } from '../security/detection-secret-boundary';

type CandidateStatus = 'pending' | 'approved' | 'rejected';
type DetectionAsyncReviewStatus = 'queued' | 'running' | 'completed' | 'failed';
type BlockingDiscussionStatus = 'not_required' | 'completed' | 'failed' | 'timeout' | 'unavailable';

interface DetectionAsyncReviewRecord {
  reviewId: string;
  tenantId: string;
  requestId: string;
  channel: DetectionChannel;
  status: DetectionAsyncReviewStatus;
  reason: string;
  requestSnapshot: DetectionRequest;
  primaryAi?: DetectionAIResult | null;
  finalAi?: DetectionAIResult | null;
  candidateId?: string | null;
  error?: string | null;
  latencyMs?: number | null;
  debateTriggered: boolean;
  enqueuedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface DetectionAsyncReviewStats {
  queueDepth: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  completionRate: number;
  debateCompletionRate: number;
  disagreements: number;
  disagreementRate: number;
  avgLatencyMs: number;
}

export interface DetectionAIResult {
  verdict: 'safe' | 'suspicious' | 'malicious';
  confidence: number;
  reasoning: string;
  attackFamily?: DetectionAttackFamily;
  routeMode?: string;
  model?: string | null;
  decisionId?: string;
  rawDecision?: Record<string, any>;
}

export interface BlockingDiscussionResult {
  required: boolean;
  allowed: boolean;
  status: BlockingDiscussionStatus;
  latencyMs: number;
  debateTriggered: boolean;
  failClosed: boolean;
  reason?: string;
  aiResult?: DetectionAIResult;
}

export interface DetectionDecision {
  verdict: DetectionVerdict;
  matchedRuleIds: string[];
  riskScore: number;
  escalatedToAI: boolean;
  queuedForAsyncReview: boolean;
  aiVerdict?: DetectionAIResult['verdict'];
  aiConfidence?: number;
  decisionSource: string;
  signals: DetectionSignal[];
  attackFamily: DetectionAttackFamily;
  candidateId?: string | null;
  processingTimeMs: number;
  ruleMatches: DetectionRuleRecord[];
  primaryAiResult?: DetectionAIResult;
  aiResult?: DetectionAIResult;
  learningVerificationAiResult?: DetectionAIResult;
  classificationLevel?: SecurityClassificationLevel;
  blockingDiscussion?: boolean;
  discussionStatus?: BlockingDiscussionStatus;
  discussionLatencyMs?: number;
  discussionDebateTriggered?: boolean;
  discussionFailClosed?: boolean;
}

export interface DetectionRuleCandidateRecord {
  candidateId: string;
  tenantId: string;
  channel: DetectionChannel;
  attackFamily: DetectionAttackFamily;
  name: string;
  severity: DetectionSeverity;
  matcher: DetectionRuleMatcher;
  matcherFingerprint: string;
  reasoning: string;
  status: CandidateStatus;
  sampleCount: number;
  aiConfidence: number;
  latestEvidence: Record<string, any>;
  approvedRuleId?: string | null;
  reviewReason?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export interface DetectionRuleSummary {
  totalRules: number;
  activeRules: number;
  pendingCandidates: number;
  approvedCandidates: number;
  rejectedCandidates: number;
  ruleHitRate: number;
  aiEscalationRate: number;
  localModelHitRate: number;
  avgProcessingTimeMs: number;
  localAICount: number;
  cloudAICount: number;
  asyncReviewQueueDepth: number;
  asyncReviewRunning: number;
  asyncReviewCompleted: number;
  asyncReviewFailed: number;
  debateCompletionRate: number;
  avgAsyncReviewLatencyMs: number;
  classificationLevel: SecurityClassificationLevel;
  blockingDiscussionCount: number;
  blockingDiscussionFailClosed: number;
  avgBlockingDiscussionLatencyMs: number;
  topRules: Array<{ ruleId: string; name: string; severity: DetectionSeverity; hitCount: number; source: string }>;
}

export interface DetectionEventRecord {
  detectionEventId: string;
  tenantId: string;
  requestId: string;
  channel: DetectionChannel;
  verdict: DetectionVerdict;
  matchedRuleIds: string[];
  riskScore: number;
  escalatedToAI: boolean;
  queuedForAsyncReview: boolean;
  classificationLevel?: SecurityClassificationLevel;
  blockingDiscussion?: boolean;
  discussionStatus?: BlockingDiscussionStatus;
  discussionLatencyMs?: number;
  aiVerdict?: string | null;
  aiConfidence?: number | null;
  aiRouteMode?: string | null;
  aiModel?: string | null;
  /** True when the AI verdict came entirely from heuristic fallbacks (no model call). */
  aiHeuristicDegraded?: boolean;
  attackFamily: DetectionAttackFamily;
  candidateId?: string | null;
  decisionSource: string;
  processingTimeMs: number;
  requestSnapshot: Record<string, any>;
  responseSnapshot: Record<string, any>;
  createdAt: string;
}

export interface DetectionEventFilters {
  channel?: DetectionChannel;
  verdict?: DetectionVerdict;
  escalatedToAI?: boolean;
  candidateId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ManualRuleCandidateInput {
  tenantId: string;
  channel: DetectionChannel;
  attackFamily: DetectionAttackFamily;
  severity: DetectionSeverity;
  reasoning: string;
  aiConfidence: number;
  request: DetectionRequest;
  evidence?: Record<string, any>;
}

interface DetectionAIAnalyzer {
  analyze(
    request: DetectionRequest,
    options?: DetectionAIAnalyzeOptions
  ): Promise<DetectionAIResult>;
}

interface EvaluateOptions {
  forceAiReview?: boolean;
  skipPersistence?: boolean;
}

interface DetectionAIAnalyzeOptions {
  analysisPurpose?: 'primary' | 'deep_analysis' | 'learning_verification' | 'blocking_review';
  routeModeOverride?: AIRoutingMode;
  forceDebate?: boolean;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function hasUsableConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeAIConfidence(value: unknown): number {
  return hasUsableConfidence(value) ? clampConfidence(value) : 0;
}

function normalizeSeverity(value: unknown, fallback: DetectionSeverity = 'medium'): DetectionSeverity {
  const normalized = String(value || fallback).toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return fallback;
}

function normalizeAttackFamily(value: unknown, fallback: DetectionAttackFamily = 'other'): DetectionAttackFamily {
  const normalized = String(value || fallback).toLowerCase();
  if (
    normalized === 'benign' ||
    normalized === 'sqli' ||
    normalized === 'xss' ||
    normalized === 'path_traversal' ||
    normalized === 'command_injection' ||
    normalized === 'ssrf' ||
    normalized === 'automation' ||
    normalized === 'other'
  ) {
    return normalized;
  }
  return fallback;
}

function shouldPreserveSpecificAttackFamily(
  normalizedAttackFamily: DetectionAttackFamily,
  fallbackAttackFamily: DetectionAttackFamily
): boolean {
  const fallbackIsSpecific = fallbackAttackFamily !== 'benign' && fallbackAttackFamily !== 'other';
  const normalizedIsGeneric = normalizedAttackFamily === 'benign' || normalizedAttackFamily === 'other';
  return fallbackIsSpecific && normalizedIsGeneric;
}

function normalizeAIResult(aiResult: DetectionAIResult, fallbackAttackFamily: DetectionAttackFamily): DetectionAIResult {
  const normalizedAttackFamily = normalizeAttackFamily(aiResult.attackFamily, fallbackAttackFamily);
  return {
    ...aiResult,
    confidence: normalizeAIConfidence(aiResult.confidence),
    attackFamily: shouldPreserveSpecificAttackFamily(normalizedAttackFamily, fallbackAttackFamily)
      ? fallbackAttackFamily
      : normalizedAttackFamily
  };
}

function normalizeChannel(value: unknown, fallback: DetectionChannel = 'http_api'): DetectionChannel {
  const normalized = String(value || fallback).toLowerCase();
  if (normalized === 'http_api' || normalized === 'packet' || normalized === 'agent') {
    return normalized;
  }
  return fallback;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function aiVerdictToDecision(aiResult: DetectionAIResult): DetectionVerdict {
  if (aiResult.verdict === 'malicious' && aiResult.confidence >= 0.6) {
    return 'block';
  }
  if (aiResult.verdict === 'suspicious') {
    return 'monitor';
  }
  return 'allow';
}

function aiVerdictToSeverity(aiResult: DetectionAIResult): DetectionSeverity {
  if (aiResult.verdict === 'malicious' && aiResult.confidence >= 0.9) {
    return 'critical';
  }
  if (aiResult.verdict === 'malicious') {
    return 'high';
  }
  return 'medium';
}

function serializeRequestSnapshot(request: DetectionRequest): Record<string, any> {
  return sanitizeDetectionRequestSnapshot({
    tenantId: request.tenantId,
    channel: request.channel,
    requestId: request.requestId,
    timestamp: request.timestamp,
    sourceIp: request.sourceIp,
    method: request.method,
    path: request.path,
    decodedPath: request.decodedPath,
    query: request.query,
    decodedQuery: request.decodedQuery,
    parsedQuery: request.parsedQuery,
    userAgent: request.userAgent,
    headers: request.headers || {},
    body: request.body || '',
    normalizedBody: request.normalizedBody || '',
    parsedBody: request.parsedBody || '',
    evidence: request.evidence || '',
    rawPayload: request.rawPayload || '',
    protocol: request.protocol,
    metadata: request.metadata || {}
  });
}

class DetectionPipelineService {
  private prepared = false;
  private aiAnalyzer: DetectionAIAnalyzer | null = null;
  private asyncReviewTimer: NodeJS.Timeout | null = null;
  private asyncReviewDrainScheduled = false;
  private asyncReviewInFlight = new Set<string>();

  prepare(): void {
    if (this.prepared) {
      return;
    }

    const db = this.getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sec_detection_rules (
        rule_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        rule_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        scope TEXT NOT NULL,
        action TEXT NOT NULL,
        priority INTEGER NOT NULL,
        severity TEXT NOT NULL,
        matcher_json TEXT NOT NULL,
        matcher_fingerprint TEXT NOT NULL,
        source TEXT NOT NULL,
        source_candidate_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sec_rule_candidates (
        candidate_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        attack_family TEXT NOT NULL,
        name TEXT NOT NULL,
        severity TEXT NOT NULL,
        matcher_json TEXT NOT NULL,
        matcher_fingerprint TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        status TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 1,
        ai_confidence REAL NOT NULL DEFAULT 0,
        latest_evidence_json TEXT,
        approved_rule_id TEXT,
        review_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by TEXT
      );

      CREATE TABLE IF NOT EXISTS sec_detection_events (
        detection_event_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        verdict TEXT NOT NULL,
        matched_rule_ids_json TEXT NOT NULL,
        risk_score REAL NOT NULL DEFAULT 0,
        escalated_to_ai INTEGER NOT NULL DEFAULT 0,
        ai_verdict TEXT,
        ai_confidence REAL,
        ai_route_mode TEXT,
        ai_model TEXT,
        attack_family TEXT NOT NULL,
        candidate_id TEXT,
        decision_source TEXT NOT NULL,
        processing_time_ms INTEGER NOT NULL DEFAULT 0,
        request_snapshot_json TEXT NOT NULL,
        response_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sec_detection_async_reviews (
        review_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_snapshot_json TEXT NOT NULL,
        primary_ai_json TEXT,
        final_ai_json TEXT,
        candidate_id TEXT,
        error TEXT,
        latency_ms INTEGER,
        debate_triggered INTEGER NOT NULL DEFAULT 0,
        disagreement INTEGER NOT NULL DEFAULT 0,
        disagreement_json TEXT,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sec_detection_rules_tenant ON sec_detection_rules(tenant_id, scope, enabled, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_sec_rule_candidates_tenant ON sec_rule_candidates(tenant_id, status, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_rule_candidates_key ON sec_rule_candidates(tenant_id, channel, attack_family, matcher_fingerprint);
      CREATE INDEX IF NOT EXISTS idx_sec_detection_events_tenant ON sec_detection_events(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sec_detection_async_reviews_tenant ON sec_detection_async_reviews(tenant_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sec_detection_async_reviews_status ON sec_detection_async_reviews(status, enqueued_at ASC);
    `);

    // Additive migration: track primary-vs-verification disagreement for the
    // learning loop. Idempotent — only adds columns missing on older DBs.
    const reviewCols = db.prepare(`PRAGMA table_info(sec_detection_async_reviews)`).all() as any[];
    const reviewColNames = new Set(reviewCols.map((c) => c.name));
    if (!reviewColNames.has('disagreement')) {
      db.exec(`ALTER TABLE sec_detection_async_reviews ADD COLUMN disagreement INTEGER NOT NULL DEFAULT 0`);
    }
    if (!reviewColNames.has('disagreement_json')) {
      db.exec(`ALTER TABLE sec_detection_async_reviews ADD COLUMN disagreement_json TEXT`);
    }

    this.prepared = true;
  }

  private assertPrepared(): void {
    if (this.prepared) {
      return;
    }

    if (process.env.NODE_ENV === 'test') {
      this.prepare();
      return;
    }

    throw new Error('Detection pipeline storage not initialized. Call detectionPipelineService.prepare() during bootstrap.');
  }

  private getDb(): any {
    return getDatabase().getDb();
  }

  setAiAnalyzer(analyzer: DetectionAIAnalyzer | null): void {
    this.aiAnalyzer = analyzer;
    if (analyzer) {
      this.scheduleAsyncReviewDrain();
    }
  }

  startAsyncReviewWorker(intervalMs = 3000): void {
    if (this.asyncReviewTimer) {
      return;
    }
    this.asyncReviewTimer = setInterval(() => {
      this.scheduleAsyncReviewDrain();
    }, Math.max(500, intervalMs));
    this.asyncReviewTimer.unref?.();
    this.scheduleAsyncReviewDrain();
  }

  stopAsyncReviewWorker(): void {
    if (this.asyncReviewTimer) {
      clearInterval(this.asyncReviewTimer);
      this.asyncReviewTimer = null;
    }
  }

  async drainAsyncReviewQueueForTests(limit = 50): Promise<void> {
    await this.drainAsyncReviewQueue(limit);
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutReason: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutReason)), Math.max(1000, timeoutMs));
          timer.unref?.();
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async getSettings(tenantId: string): Promise<DetectionPipelineSettings> {
    const config = await platformConfigService.getConfig(tenantId);
    return config.detectionPipeline;
  }

  private buildBlockingDiscussionRequest(
    request: DetectionRequest,
    attackFamily: DetectionAttackFamily,
    context: Record<string, any>
  ): DetectionRequest {
    const evidenceEnvelope = {
      ...(typeof request.evidence === 'string' ? { evidence: request.evidence } : {}),
      aetherguardBlockingDiscussion: context
    };

    const evidenceJson = JSON.stringify(evidenceEnvelope);
    return {
      ...request,
      analysisPurpose: 'blocking_review',
      metadata: {
        ...(request.metadata || {}),
        aetherguardBlockingDiscussion: context
      },
      evidence: evidenceJson,
      body: request.body || evidenceJson,
      normalizedBody: request.normalizedBody || evidenceJson,
      parsedBody: request.parsedBody || evidenceJson,
      rawPayload: request.rawPayload || evidenceJson,
      existingSignals: [
        ...(request.existingSignals || []),
        {
          source: 'existing_signal',
          key: `classification:${context.classificationLevel || 'standard'}`,
          score: context.baseRiskScore || 0,
          severity: context.baseRiskScore >= 0.9 ? 'critical' : context.baseRiskScore >= 0.75 ? 'high' : 'medium',
          description: `Blocking review for ${context.classificationLevel || 'standard'} classification`,
          metadata: {
            attackFamily,
            classificationLevel: context.classificationLevel,
            ruleMatched: context.ruleMatched,
            decisionSource: context.decisionSource,
            reason: context.reason
          }
        }
      ]
    };
  }

  async runBlockingReview(input: {
    request: DetectionRequest;
    settings?: DetectionPipelineSettings;
    attackFamily?: DetectionAttackFamily;
    classificationLevel?: SecurityClassificationLevel;
    decisionSource?: string;
    ruleMatched?: boolean;
    baseRiskScore?: number;
    reason: string;
    forceDebate?: boolean;
    routeModeOverride?: AIRoutingMode;
  }): Promise<BlockingDiscussionResult> {
    const settings = input.settings || await this.getSettings(input.request.tenantId);
    return this.runBlockingDiscussion({
      request: input.request,
      settings,
      attackFamily: input.attackFamily || inferAttackFamily(input.request),
      classificationLevel: input.classificationLevel || settings.classificationLevel || 'standard',
      decisionSource: input.decisionSource || 'blocking_review',
      ruleMatched: Boolean(input.ruleMatched),
      baseRiskScore: Number(input.baseRiskScore || 0),
      reason: input.reason,
      forceDebate: input.forceDebate,
      routeModeOverride: input.routeModeOverride || 'local_only'
    });
  }

  private async runBlockingDiscussion(input: {
    request: DetectionRequest;
    settings: DetectionPipelineSettings;
    attackFamily: DetectionAttackFamily;
    classificationLevel: SecurityClassificationLevel;
    decisionSource: string;
    ruleMatched: boolean;
    baseRiskScore: number;
    reason: string;
    forceDebate?: boolean;
    routeModeOverride?: AIRoutingMode;
  }): Promise<BlockingDiscussionResult> {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, Number(input.settings.blockingDiscussionTimeoutMs || 30000));

    if (!this.aiAnalyzer) {
      return {
        required: true,
        allowed: false,
        status: 'unavailable',
        latencyMs: Date.now() - startedAt,
        debateTriggered: false,
        failClosed: true,
        reason: 'ai_analyzer_unavailable'
      };
    }

    try {
      const analyzeRequest = this.buildBlockingDiscussionRequest(input.request, input.attackFamily, {
        classificationLevel: input.classificationLevel,
        decisionSource: input.decisionSource,
        ruleMatched: input.ruleMatched,
        baseRiskScore: input.baseRiskScore,
        reason: input.reason
      });
      const rawResult = await this.withTimeout(
        this.aiAnalyzer.analyze(analyzeRequest, {
          analysisPurpose: 'blocking_review',
          routeModeOverride: input.routeModeOverride || 'local_only',
          forceDebate: Boolean(input.forceDebate)
        }),
        timeoutMs,
        'blocking_discussion_timeout'
      );
      const aiResult = normalizeAIResult(rawResult, input.attackFamily);
      const decision = aiVerdictToDecision(aiResult);
      const rawDecision = aiResult.rawDecision || {};
      const debateTriggered = Boolean(
        rawDecision.debateTriggered ||
        rawDecision.debateSession ||
        (Array.isArray(rawDecision.layersActivated) && rawDecision.layersActivated.includes(5)) ||
        Number(rawDecision.stageLatencies?.debateMs || 0) > 0
      );

      return {
        required: true,
        allowed: decision !== 'block',
        status: 'completed',
        latencyMs: Date.now() - startedAt,
        debateTriggered,
        failClosed: false,
        reason: aiResult.reasoning,
        aiResult
      };
    } catch (error: any) {
      const timeout = String(error?.message || '').includes('blocking_discussion_timeout');
      return {
        required: true,
        allowed: false,
        status: timeout ? 'timeout' : 'failed',
        latencyMs: Date.now() - startedAt,
        debateTriggered: false,
        failClosed: true,
        reason: error?.message || 'blocking_discussion_failed'
      };
    }
  }

  async listRules(tenantId: string): Promise<DetectionRuleRecord[]> {
    this.assertPrepared();
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT *
      FROM sec_detection_rules
      WHERE tenant_id = ? AND enabled = 1
      ORDER BY priority DESC, updated_at DESC
    `).all(tenantId) as any[];

    const dynamicRules = rows.map((row) => this.mapRule(row));
    return [...buildSeedDetectionRules(), ...dynamicRules];
  }

  async listDynamicRules(tenantId: string, channel?: DetectionChannel): Promise<DetectionRuleRecord[]> {
    const rules = await this.listRules(tenantId);
    return rules.filter((rule) => rule.source !== 'seed').filter((rule) => !channel || rule.scope === 'all' || rule.scope === channel);
  }

  async listRuleCandidates(tenantId: string, status?: CandidateStatus): Promise<DetectionRuleCandidateRecord[]> {
    this.assertPrepared();
    const db = this.getDb();
    const params = [tenantId];
    let sql = `
      SELECT *
      FROM sec_rule_candidates
      WHERE tenant_id = ?
    `;
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY updated_at DESC';

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapCandidate(row));
  }

  async getRuleCandidateById(tenantId: string, candidateId: string): Promise<DetectionRuleCandidateRecord | null> {
    this.assertPrepared();
    const db = this.getDb();
    const row = db.prepare(`
      SELECT *
      FROM sec_rule_candidates
      WHERE tenant_id = ? AND candidate_id = ?
      LIMIT 1
    `).get(tenantId, candidateId) as any;
    return row ? this.mapCandidate(row) : null;
  }

  async createManualRuleCandidate(input: ManualRuleCandidateInput): Promise<DetectionRuleCandidateRecord | null> {
    this.assertPrepared();
    return this.createOrMergeRuleCandidate(
      {
        ...input.request,
        tenantId: input.tenantId,
        channel: input.channel
      },
      input.attackFamily,
      input.severity,
      input.reasoning,
      clampConfidence(input.aiConfidence),
      input.evidence || {
        request: serializeRequestSnapshot(input.request),
        ai: {
          verdict: 'malicious',
          confidence: clampConfidence(input.aiConfidence),
          reasoning: input.reasoning,
          routeMode: 'manual',
          model: 'manual-backfill'
        }
      }
    );
  }

  async approveRuleCandidate(tenantId: string, candidateId: string, actorId: string, reviewReason?: string): Promise<DetectionRuleCandidateRecord | null> {
    this.assertPrepared();
    const db = this.getDb();
    const candidate = await this.getRuleCandidateById(tenantId, candidateId);
    if (!candidate) {
      return null;
    }

    // Second line of defense (the runtime already treats a bad pattern as
    // inert): refuse to promote a candidate whose matcher contains a malformed
    // regex into an enabled block rule, so the operator gets a clear error
    // instead of a silently non-functional rule.
    const invalidPatterns = collectInvalidMatcherPatterns(candidate.matcher);
    if (invalidPatterns.length > 0) {
      const error = new Error('backend.rule_candidate_invalid_regex') as Error & { code?: string; invalidPatterns?: string[] };
      error.code = 'backend.rule_candidate_invalid_regex';
      error.invalidPatterns = invalidPatterns;
      throw error;
    }

    // A matcher with no criteria is inert at runtime (matches nothing); refuse
    // to promote it into an enabled block rule so the operator is not misled
    // into thinking an empty rule protects anything.
    if (!matcherDeclaresCriteria(candidate.matcher)) {
      const error = new Error('backend.rule_candidate_empty_matcher') as Error & { code?: string };
      error.code = 'backend.rule_candidate_empty_matcher';
      throw error;
    }

    const now = new Date().toISOString();
    const ruleId = candidate.approvedRuleId || randomUUID();
    const ruleKey = `${tenantId}:${candidate.channel}:${candidate.attackFamily}:${candidate.matcherFingerprint}:block`;
    db.run(`
      INSERT INTO sec_detection_rules (
        rule_id, tenant_id, rule_key, name, description, scope, action, priority, severity,
        matcher_json, matcher_fingerprint, source, source_candidate_id, enabled, version,
        metadata_json, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'block', ?, ?, ?, ?, 'candidate', ?, 1, 1, ?, ?, ?, ?)
      ON CONFLICT(rule_key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        severity = excluded.severity,
        matcher_json = excluded.matcher_json,
        matcher_fingerprint = excluded.matcher_fingerprint,
        source_candidate_id = excluded.source_candidate_id,
        enabled = excluded.enabled,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `, [
      ruleId,
      tenantId,
      ruleKey,
      candidate.name,
      candidate.reasoning,
      candidate.channel,
      candidate.severity === 'critical' ? 900 : 820,
      candidate.severity,
      JSON.stringify(candidate.matcher),
      candidate.matcherFingerprint,
      candidateId,
      JSON.stringify({
        attackFamily: candidate.attackFamily,
        approvedFromCandidate: true,
        learningMode: 'malicious_review_queue'
      }),
      actorId,
      candidate.createdAt,
      now
    ]);

    db.run(`
      UPDATE sec_rule_candidates
      SET status = 'approved',
          approved_rule_id = ?,
          review_reason = ?,
          reviewed_at = ?,
          reviewed_by = ?,
          updated_at = ?
      WHERE tenant_id = ? AND candidate_id = ?
    `, [
      ruleId,
      reviewReason || candidate.reviewReason || 'approved',
      now,
      actorId,
      now,
      tenantId,
      candidateId
    ]);

    this.syncCandidateFinding({
      ...candidate,
      status: 'approved',
      approvedRuleId: ruleId,
      reviewReason: reviewReason || candidate.reviewReason || 'approved',
      reviewedAt: now,
      reviewedBy: actorId,
      updatedAt: now
    });

    return this.getRuleCandidateById(tenantId, candidateId);
  }

  async rejectRuleCandidate(tenantId: string, candidateId: string, actorId: string, reviewReason?: string): Promise<DetectionRuleCandidateRecord | null> {
    this.assertPrepared();
    const db = this.getDb();
    const now = new Date().toISOString();
    const candidate = await this.getRuleCandidateById(tenantId, candidateId);
    if (!candidate) {
      return null;
    }

    db.run(`
      UPDATE sec_rule_candidates
      SET status = 'rejected',
          review_reason = ?,
          reviewed_at = ?,
          reviewed_by = ?,
          updated_at = ?
      WHERE tenant_id = ? AND candidate_id = ?
    `, [
      reviewReason || 'rejected',
      now,
      actorId,
      now,
      tenantId,
      candidateId
    ]);

    this.syncCandidateFinding({
      ...candidate,
      status: 'rejected',
      reviewReason: reviewReason || 'rejected',
      reviewedAt: now,
      reviewedBy: actorId,
      updatedAt: now
    });

    return this.getRuleCandidateById(tenantId, candidateId);
  }

  private shouldRunLearningVerification(
    request: DetectionRequest,
    settings: DetectionPipelineSettings,
    primaryAiResult: DetectionAIResult,
    primaryConfidencePresent: boolean,
    candidateCreated: boolean
  ): boolean {
    if (candidateCreated) {
      return false;
    }
    if (!settings.learningCloudVerificationEnabled) {
      return false;
    }
    if (settings.learningMode !== 'malicious_review_queue') {
      return false;
    }
    if (!settings.learningCloudVerificationChannels.includes(request.channel)) {
      return false;
    }
    if (primaryAiResult.verdict === 'suspicious' && settings.learningCloudVerificationOnSuspicious) {
      return true;
    }
    if (!primaryConfidencePresent && settings.learningCloudVerificationOnMissingConfidence) {
      return true;
    }
    return primaryAiResult.verdict === 'malicious'
      && primaryAiResult.confidence < settings.candidateMinConfidence;
  }

  private async createCandidateFromAI(
    request: DetectionRequest,
    settings: DetectionPipelineSettings,
    attackFamily: DetectionAttackFamily,
    aiResult: DetectionAIResult,
    latestEvidence: Record<string, any>
  ): Promise<DetectionRuleCandidateRecord | null> {
    if (settings.learningMode !== 'malicious_review_queue') {
      return null;
    }
    if (aiResult.verdict !== 'malicious') {
      return null;
    }
    if (aiResult.confidence < settings.candidateMinConfidence) {
      return null;
    }

    return this.createOrMergeRuleCandidate(
      request,
      attackFamily,
      aiVerdictToSeverity(aiResult),
      aiResult.reasoning,
      aiResult.confidence,
      latestEvidence
    );
  }

  /**
   * Create a rule candidate from a blocked request (no AI call).
   * Uses heuristic analysis and rule metadata to build a candidate suggestion.
   */
  private async createCandidateFromBlock(
    request: DetectionRequest,
    settings: DetectionPipelineSettings,
    attackFamily: DetectionAttackFamily,
    matchedRules: DetectionRuleRecord[],
    heuristicSignals: DetectionSignal[]
  ): Promise<DetectionRuleCandidateRecord | null> {
    if (!settings.learningFromBlockedEnabled) {
      return null;
    }
    if (settings.learningMode !== 'malicious_review_queue') {
      return null;
    }
    // Skip generic families that produce noisy matchers
    if (attackFamily === 'benign' || attackFamily === 'other') {
      return null;
    }

    const blockRule = matchedRules.find(rule => rule.action === 'block');
    const severity: DetectionSeverity = (blockRule?.severity as DetectionSeverity) || 'medium';

    if (!isSeverityAtLeast(severity, settings.learningFromBlockedMinSeverity)) {
      return null;
    }

    // Map severity to confidence (no AI, heuristic-based)
    const confidenceMap: Record<DetectionSeverity, number> = {
      critical: 0.95,
      high: 0.85,
      medium: 0.65,
      low: 0.45
    };
    const confidence = confidenceMap[severity];

    // Build reasoning from rule matches + heuristic signals
    const ruleNames = matchedRules
      .map(rule => `${rule.name} (${rule.severity})`)
      .join(', ');
    const heuristicReasoning = heuristicSignals
      .slice(0, 3)
      .map(signal => signal.description)
      .filter(Boolean)
      .join('; ');
    const reasoning = heuristicReasoning
      ? `Seed rule block: ${ruleNames}. Heuristics: ${heuristicReasoning}`
      : `Seed rule block: ${ruleNames}`;

    const evidence = {
      source: 'seed_rule_block',
      matchedRuleIds: matchedRules.map(rule => rule.ruleId),
      heuristics: heuristicSignals.slice(0, 5).map(signal => ({
        source: signal.source,
        key: signal.key,
        score: signal.score,
        description: signal.description
      }))
    };

    try {
      return await this.createOrMergeRuleCandidate(
        request,
        attackFamily,
        severity,
        reasoning,
        confidence,
        evidence
      );
    } catch (error: any) {
      logger.warn('Failed to create candidate from blocked request', {
        requestId: request.requestId,
        channel: request.channel,
        attackFamily,
        error: error?.message
      });
      return null;
    }
  }

  private serializeAIResult(aiResult?: DetectionAIResult | null): Record<string, any> | null {
    if (!aiResult) {
      return null;
    }

    return aiResult.rawDecision || {
      verdict: aiResult.verdict,
      confidence: aiResult.confidence,
      reasoning: aiResult.reasoning,
      attackFamily: aiResult.attackFamily,
      routeMode: aiResult.routeMode,
      model: aiResult.model,
      decisionId: aiResult.decisionId
    };
  }

  private shouldQueueAsyncReview(input: {
    request: DetectionRequest;
    settings: DetectionPipelineSettings;
    ruleEscalation: boolean;
    baseRiskScore: number;
    primaryAi?: DetectionAIResult | null;
    primaryConfidencePresent?: boolean;
    candidateCreated?: boolean;
  }): boolean {
    const { settings, request, ruleEscalation, baseRiskScore, primaryAi, primaryConfidencePresent, candidateCreated } = input;

    if (!settings.asyncReviewEnabled || settings.learningMode !== 'malicious_review_queue') {
      return false;
    }
    if (request.channel === 'agent' && !settings.enableAgentAsyncReview) {
      return false;
    }
    if (!settings.learningCloudVerificationChannels.includes(request.channel)) {
      return false;
    }
    if (candidateCreated) {
      return false;
    }
    if (ruleEscalation) {
      return true;
    }
    if (!primaryAi) {
      return baseRiskScore >= settings.aiEscalationThreshold;
    }
    if (primaryAi.verdict === 'suspicious' && settings.learningCloudVerificationOnSuspicious) {
      return true;
    }
    if (!primaryConfidencePresent && settings.learningCloudVerificationOnMissingConfidence) {
      return true;
    }
    if (primaryAi.verdict === 'malicious' && primaryAi.confidence < settings.candidateMinConfidence) {
      return true;
    }
    return baseRiskScore >= Math.max(0.75, settings.aiEscalationThreshold);
  }

  private shouldRunBlockingDiscussion(input: {
    request: DetectionRequest;
    settings: DetectionPipelineSettings;
    baseRiskScore: number;
    primaryAi?: DetectionAIResult | null;
    primaryConfidencePresent?: boolean;
  }): boolean {
    if ((input.settings.classificationLevel || 'standard') !== 'elevated') {
      return false;
    }
    if (!input.primaryAi) {
      return input.baseRiskScore >= Math.max(0.75, input.settings.aiEscalationThreshold);
    }
    if (input.primaryAi.verdict === 'suspicious') {
      return true;
    }
    if (!input.primaryConfidencePresent) {
      return true;
    }
    if (input.primaryAi.verdict === 'malicious' && input.primaryAi.confidence < input.settings.candidateMinConfidence) {
      return true;
    }
    return input.baseRiskScore >= Math.max(0.75, input.settings.aiEscalationThreshold);
  }

  private async enqueueAsyncReview(
    request: DetectionRequest,
    reason: string,
    primaryAi?: DetectionAIResult | null,
    candidateId?: string | null
  ): Promise<string | null> {
    this.assertPrepared();
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    const db = this.getDb();
    const primaryAiJson = primaryAi ? JSON.stringify(this.serializeAIResult(primaryAi)) : null;

    db.run(`
      INSERT INTO sec_detection_async_reviews (
        review_id, tenant_id, request_id, channel, status, reason, request_snapshot_json,
        primary_ai_json, candidate_id, enqueued_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `, [
      reviewId,
      request.tenantId,
      request.requestId,
      request.channel,
      reason,
      JSON.stringify(serializeRequestSnapshot(request)),
      primaryAiJson,
      candidateId || null,
      now,
      now
    ]);

    await jobQueueService.enqueue('detection-async-reviews', reviewId);
    this.scheduleAsyncReviewDrain();
    return reviewId;
  }

  private scheduleAsyncReviewDrain(): void {
    if (process.env.NODE_ENV === 'test' && !this.asyncReviewTimer) {
      return;
    }
    if (this.asyncReviewDrainScheduled) {
      return;
    }
    this.asyncReviewDrainScheduled = true;
    setImmediate(() => {
      this.asyncReviewDrainScheduled = false;
      void this.drainAsyncReviewQueue().catch((error: any) => {
        logger.warn('Detection async review drain failed', {
          error: error?.message || String(error)
        });
      });
    });
  }

  private async listQueuedAsyncReviewIds(limit: number): Promise<string[]> {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT review_id
      FROM sec_detection_async_reviews
      WHERE status = 'queued'
      ORDER BY enqueued_at ASC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map((row) => String(row.review_id || '')).filter(Boolean);
  }

  private mapAsyncReview(row: any): DetectionAsyncReviewRecord {
    return {
      reviewId: String(row.review_id || ''),
      tenantId: String(row.tenant_id || PLATFORM_TENANT_ID),
      requestId: String(row.request_id || ''),
      channel: normalizeChannel(row.channel),
      status: row.status === 'running' ? 'running' : row.status === 'completed' ? 'completed' : row.status === 'failed' ? 'failed' : 'queued',
      reason: String(row.reason || ''),
      requestSnapshot: parseJson<DetectionRequest>(row.request_snapshot_json, {} as DetectionRequest),
      primaryAi: row.primary_ai_json ? parseJson<DetectionAIResult | null>(row.primary_ai_json, null) : null,
      finalAi: row.final_ai_json ? parseJson<DetectionAIResult | null>(row.final_ai_json, null) : null,
      candidateId: row.candidate_id ? String(row.candidate_id) : null,
      error: row.error ? String(row.error) : null,
      latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
      debateTriggered: normalizeBoolean(row.debate_triggered),
      enqueuedAt: String(row.enqueued_at || ''),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      updatedAt: String(row.updated_at || '')
    };
  }

  private async loadAsyncReview(reviewId: string): Promise<DetectionAsyncReviewRecord | null> {
    const db = this.getDb();
    const row = db.prepare(`
      SELECT *
      FROM sec_detection_async_reviews
      WHERE review_id = ?
      LIMIT 1
    `).get(reviewId) as any;
    return row ? this.mapAsyncReview(row) : null;
  }

  private async drainAsyncReviewQueue(limit = 5): Promise<void> {
    this.assertPrepared();
    if (!this.aiAnalyzer) {
      return;
    }

    const safeLimit = Math.max(1, Math.min(limit, 25));
    let reviewIds = await jobQueueService.drain('detection-async-reviews', safeLimit);
    if (reviewIds.length === 0) {
      reviewIds = await this.listQueuedAsyncReviewIds(safeLimit);
    }

    const runnableIds = reviewIds.filter((reviewId) => reviewId && !this.asyncReviewInFlight.has(reviewId));
    await Promise.all(runnableIds.map((reviewId) => this.processAsyncReview(reviewId)));
  }

  private async processAsyncReview(reviewId: string): Promise<void> {
    this.asyncReviewInFlight.add(reviewId);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const db = this.getDb();

    try {
      const review = await this.loadAsyncReview(reviewId);
      if (!review || review.status === 'completed' || review.status === 'failed') {
        return;
      }

      db.run(`
        UPDATE sec_detection_async_reviews
        SET status = 'running',
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE review_id = ? AND status IN ('queued', 'running')
      `, [startedAt, startedAt, reviewId]);

      const request = {
        ...review.requestSnapshot,
        tenantId: review.tenantId,
        channel: review.channel,
        requestId: review.requestId
      };
      const settings = await this.getSettings(review.tenantId);
      const fallbackAttackFamily = normalizeAttackFamily(
        review.primaryAi?.attackFamily || inferAttackFamily(request)
      );
      const rawResult = await this.aiAnalyzer!.analyze(request, {
        analysisPurpose: 'learning_verification',
        routeModeOverride: settings.learningCloudVerificationMode
      });
      const finalAi = normalizeAIResult(rawResult, fallbackAttackFamily);
      const candidate = await this.createCandidateFromAI(
        request,
        settings,
        finalAi.attackFamily || fallbackAttackFamily,
        finalAi,
        {
          request: serializeRequestSnapshot(request),
          ai: this.serializeAIResult(finalAi),
          primaryAi: this.serializeAIResult(review.primaryAi),
          learningVerificationAi: this.serializeAIResult(finalAi),
          asyncReview: {
            reviewId,
            reason: review.reason
          }
        }
      );
      const completedAt = new Date().toISOString();
      const latencyMs = Date.now() - startedMs;
      const rawDecision = finalAi.rawDecision || {};
      const debateTriggered = Boolean(
        rawDecision.debateTriggered ||
        rawDecision.debateSession ||
        (Array.isArray(rawDecision.layersActivated) && rawDecision.layersActivated.includes(5)) ||
        Number(rawDecision.stageLatencies?.debateMs || 0) > 0
      );

      // Learning-loop signal: did the hot-path verdict (primaryAi) disagree with
      // the authoritative cloud re-review (finalAi)? Verdict mismatch, or a large
      // confidence gap, marks the record as a candidate training pair. This is the
      // "eyes" of the student/teacher loop — capture now, train weights later.
      const primaryAi = review.primaryAi;
      const primaryVerdict = primaryAi?.verdict;
      const verifiedVerdict = finalAi.verdict;
      const primaryConfidence = Number(primaryAi?.confidence ?? 0);
      const verifiedConfidence = Number(finalAi.confidence ?? 0);
      const confidenceGap = Math.abs(primaryConfidence - verifiedConfidence);
      const verdictDisagree = Boolean(primaryVerdict) && primaryVerdict !== verifiedVerdict;
      const DISAGREEMENT_CONFIDENCE_GAP = 0.3;
      const disagree = verdictDisagree || confidenceGap >= DISAGREEMENT_CONFIDENCE_GAP;
      const disagreement = {
        disagree,
        verdictDisagree,
        confidenceGap: Number(confidenceGap.toFixed(4)),
        primaryVerdict: primaryVerdict || null,
        verifiedVerdict,
        primaryConfidence: Number(primaryConfidence.toFixed(4)),
        verifiedConfidence: Number(verifiedConfidence.toFixed(4)),
        flippedTo: verdictDisagree ? verifiedVerdict : null
      };

      db.run(`
        UPDATE sec_detection_async_reviews
        SET status = 'completed',
            final_ai_json = ?,
            candidate_id = ?,
            latency_ms = ?,
            debate_triggered = ?,
            disagreement = ?,
            disagreement_json = ?,
            completed_at = ?,
            updated_at = ?
        WHERE review_id = ?
      `, [
        JSON.stringify(this.serializeAIResult(finalAi)),
        candidate?.candidateId || review.candidateId || null,
        latencyMs,
        debateTriggered ? 1 : 0,
        disagree ? 1 : 0,
        JSON.stringify(disagreement),
        completedAt,
        completedAt,
        reviewId
      ]);
    } catch (error: any) {
      const failedAt = new Date().toISOString();
      db.run(`
        UPDATE sec_detection_async_reviews
        SET status = 'failed',
            error = ?,
            completed_at = ?,
            updated_at = ?
        WHERE review_id = ?
      `, [
        error?.message || String(error),
        failedAt,
        failedAt,
        reviewId
      ]);
      logger.warn('Detection async review failed', {
        reviewId,
        error: error?.message || String(error)
      });
    } finally {
      this.asyncReviewInFlight.delete(reviewId);
    }
  }

  async evaluateRequest(request: DetectionRequest, options: EvaluateOptions = {}): Promise<DetectionDecision> {
    this.assertPrepared();
    // The detector must never pass raw request material to an AI provider or
    // persist it through an evidence/candidate path. Keep the tenant and
    // deterministic control fields, but replace all request content with the
    // shared boundary representation before any rule/AI work begins.
    request = sanitizeDetectionRequestForAnalysis(request) as DetectionRequest;
    const startedAt = Date.now();
    const anonymousRuleOnly = request.tenantId === ANONYMOUS_TENANT_ID;
    const forceAiReview = options.forceAiReview === true && !anonymousRuleOnly;
    const skipPersistence = options.skipPersistence === true || anonymousRuleOnly;
    const settings = await this.getSettings(request.tenantId);
    const rules = await this.listRules(request.tenantId);
    const ruleEvaluation = evaluateDetectionRules(request, rules);
    const heuristicAssessment = assessDetectionHeuristics(request);
    const combinedSignals = [...ruleEvaluation.signals, ...heuristicAssessment.signals];
    const baseRiskScore = Math.max(ruleEvaluation.riskScore, heuristicAssessment.riskScore);
    const classificationLevel = settings.classificationLevel || 'standard';
    const maximumClassification = classificationLevel === 'maximum';
    let escalatedToAI = false;
    let queuedForAsyncReview = false;
    let aiResult: DetectionAIResult | undefined;
    let primaryAiResult: DetectionAIResult | undefined;
    let learningVerificationAiResult: DetectionAIResult | undefined;
    let blockingDiscussion: BlockingDiscussionResult | undefined;
    let candidateId: string | null = null;
    let decisionSource = ruleEvaluation.highestPriorityRule
      ? `${ruleEvaluation.highestPriorityRule.source}:${ruleEvaluation.highestPriorityRule.action}`
      : 'heuristic_only';
    // Decision spine design (AI-primary with rule guardrail + fail-closed):
    //  - Rules are the deterministic BLOCK guardrail: a rule malicious verdict is
    //    adopted first and the AI layer cannot override it (0%-FPR + fail-closed).
    //  - When the AI analyzer runs, its verdict BECOMES the primary decision via
    //    aiVerdictToDecision(), with a 0.6 confidence gate so a low-confidence AI
    //    "malicious" degrades to allow rather than blocking benign traffic.
    //  - When the AI analyzer is unavailable, maximum/elevated high-risk requests
    //    fail closed to block; this default verdict is the rule-only fallback.
    let verdict: DetectionVerdict = ruleEvaluation.ruleVerdict || (baseRiskScore >= settings.aiEscalationThreshold ? 'monitor' : 'allow');
    let attackFamily = normalizeAttackFamily(
      ruleEvaluation.highestPriorityRule?.attackFamily || inferAttackFamily(request, combinedSignals)
    );

    const hotPathChannelEnabled =
      (request.channel === 'http_api' && settings.enableHttpApi) ||
      (request.channel === 'packet' && settings.enablePacketInterceptor) ||
      request.channel === 'agent';

    const ruleMatched = ruleEvaluation.matchedRules.length > 0;
    const hotPathRuleOnly = anonymousRuleOnly || (!maximumClassification && ruleMatched && !forceAiReview && verdict !== 'block');
    const shouldRunHotPathLocalModel = !anonymousRuleOnly
      && (
        maximumClassification
        || (
          !ruleMatched
          && verdict !== 'block'
          && hotPathChannelEnabled
          && baseRiskScore >= settings.aiEscalationThreshold
        )
      );

    if (maximumClassification && !this.aiAnalyzer) {
      const blockingFailure: DetectionDecision = {
        verdict: 'block',
        matchedRuleIds: ruleEvaluation.matchedRuleIds,
        riskScore: Number(baseRiskScore.toFixed(4)),
        escalatedToAI: false,
        queuedForAsyncReview: false,
        classificationLevel,
        blockingDiscussion: false,
        discussionStatus: 'unavailable',
        discussionLatencyMs: 0,
        discussionDebateTriggered: false,
        discussionFailClosed: true,
        aiVerdict: undefined,
        aiConfidence: undefined,
        decisionSource: 'security_classification:maximum_fail_closed',
        signals: combinedSignals,
        attackFamily,
        candidateId: null,
        processingTimeMs: Date.now() - startedAt,
        ruleMatches: ruleEvaluation.matchedRules.map((item) => item.rule),
        primaryAiResult: undefined,
        aiResult: undefined,
        learningVerificationAiResult: undefined
      };
      if (!skipPersistence) {
        this.recordDetectionEvent(request, blockingFailure);
      }
      return blockingFailure;
    }

    if (!this.aiAnalyzer && classificationLevel === 'elevated' && baseRiskScore >= settings.aiEscalationThreshold) {
      const blockingFailure: DetectionDecision = {
        verdict: 'block',
        matchedRuleIds: ruleEvaluation.matchedRuleIds,
        riskScore: Number(baseRiskScore.toFixed(4)),
        escalatedToAI: false,
        queuedForAsyncReview: false,
        classificationLevel,
        blockingDiscussion: false,
        discussionStatus: 'unavailable',
        discussionLatencyMs: 0,
        discussionDebateTriggered: false,
        discussionFailClosed: true,
        aiVerdict: undefined,
        aiConfidence: undefined,
        decisionSource: 'security_classification:elevated_fail_closed',
        signals: combinedSignals,
        attackFamily,
        candidateId: null,
        processingTimeMs: Date.now() - startedAt,
        ruleMatches: ruleEvaluation.matchedRules.map((item) => item.rule),
        primaryAiResult: undefined,
        aiResult: undefined,
        learningVerificationAiResult: undefined
      };
      if (!skipPersistence) {
        this.recordDetectionEvent(request, blockingFailure);
      }
      return blockingFailure;
    }

    if (hotPathRuleOnly) {
      decisionSource = `${decisionSource}+rule_only`;
    } else if (shouldRunHotPathLocalModel && this.aiAnalyzer) {
      escalatedToAI = true;
      const primaryAiRawResult = await this.aiAnalyzer.analyze(request, {
        analysisPurpose: forceAiReview ? 'learning_verification' : 'primary',
        routeModeOverride: maximumClassification
          ? 'local_only'
          : forceAiReview
            ? settings.learningCloudVerificationMode
            : 'local_only',
        ...(maximumClassification ? { forceDebate: true } : {})
      });
      const primaryConfidencePresent = hasUsableConfidence(primaryAiRawResult.confidence);
      primaryAiResult = normalizeAIResult(primaryAiRawResult, attackFamily);
      aiResult = primaryAiResult;
      attackFamily = aiResult.attackFamily || attackFamily;
      verdict = aiVerdictToDecision(aiResult);
      decisionSource = maximumClassification ? `ai:${aiResult.verdict}` : `ai:${aiResult.verdict}`;
      combinedSignals.push({
        source: 'ai',
        key: `ai-${aiResult.verdict}`,
        score: clampConfidence(aiResult.confidence),
        severity: aiVerdictToSeverity(aiResult),
        description: aiResult.reasoning,
        metadata: {
          routeMode: aiResult.routeMode,
          model: aiResult.model
        }
      });

      if (!maximumClassification) {
        const primaryEvidence = {
          request: serializeRequestSnapshot(request),
          ai: this.serializeAIResult(primaryAiResult),
          primaryAi: this.serializeAIResult(primaryAiResult)
        };

        const primaryCandidate = await this.createCandidateFromAI(
          request,
          settings,
          attackFamily,
          primaryAiResult,
          primaryEvidence
        );
        candidateId = primaryCandidate?.candidateId || null;
      }

      if (maximumClassification) {
        blockingDiscussion = await this.runBlockingDiscussion({
          request,
          settings,
          attackFamily,
          classificationLevel,
          decisionSource,
          ruleMatched,
          baseRiskScore,
          reason: 'maximum_classification_blocking_review',
          forceDebate: true,
          routeModeOverride: 'local_only'
        });
        learningVerificationAiResult = blockingDiscussion.aiResult || undefined;
        if (blockingDiscussion.status !== 'completed' || !blockingDiscussion.aiResult) {
          verdict = 'block';
          decisionSource = 'security_classification:maximum_fail_closed';
        } else {
          aiResult = blockingDiscussion.aiResult;
          attackFamily = aiResult.attackFamily || attackFamily;
          verdict = aiVerdictToDecision(aiResult);
          decisionSource = `security_classification:maximum:${aiResult.verdict}`;
          combinedSignals.push({
            source: 'ai',
            key: `blocking-${aiResult.verdict}`,
            score: clampConfidence(aiResult.confidence),
            severity: aiVerdictToSeverity(aiResult),
            description: aiResult.reasoning,
            metadata: {
              routeMode: aiResult.routeMode,
              model: aiResult.model,
              blockingDiscussion: true
            }
          });
          const blockingCandidate = await this.createCandidateFromAI(
            request,
            settings,
            attackFamily,
            aiResult,
            {
              request: serializeRequestSnapshot(request),
              ai: this.serializeAIResult(aiResult),
              primaryAi: this.serializeAIResult(primaryAiResult),
              blockingDiscussion: {
                status: blockingDiscussion.status,
                latencyMs: blockingDiscussion.latencyMs,
                debateTriggered: blockingDiscussion.debateTriggered,
                reason: blockingDiscussion.reason
              }
            }
          );
          candidateId = blockingCandidate?.candidateId || candidateId;
        }
      } else if (!forceAiReview && this.shouldRunBlockingDiscussion({
        request,
        settings,
        baseRiskScore,
        primaryAi: primaryAiResult,
        primaryConfidencePresent
      })) {
        blockingDiscussion = await this.runBlockingDiscussion({
          request,
          settings,
          attackFamily,
          classificationLevel,
          decisionSource,
          ruleMatched,
          baseRiskScore,
          reason: 'elevated_classification_blocking_review',
          forceDebate: true,
          routeModeOverride: 'local_only'
        });
        learningVerificationAiResult = blockingDiscussion.aiResult || undefined;
        if (blockingDiscussion.status !== 'completed' || !blockingDiscussion.aiResult) {
          verdict = 'block';
          decisionSource = 'security_classification:elevated_fail_closed';
        } else {
          aiResult = blockingDiscussion.aiResult;
          attackFamily = aiResult.attackFamily || attackFamily;
          verdict = aiVerdictToDecision(aiResult);
          decisionSource = `security_classification:elevated:${aiResult.verdict}`;
          combinedSignals.push({
            source: 'ai',
            key: `blocking-${aiResult.verdict}`,
            score: clampConfidence(aiResult.confidence),
            severity: aiVerdictToSeverity(aiResult),
            description: aiResult.reasoning,
            metadata: {
              routeMode: aiResult.routeMode,
              model: aiResult.model,
              blockingDiscussion: true
            }
          });
          const blockingCandidate = await this.createCandidateFromAI(
            request,
            settings,
            attackFamily,
            aiResult,
            {
              request: serializeRequestSnapshot(request),
              ai: this.serializeAIResult(aiResult),
              primaryAi: this.serializeAIResult(primaryAiResult),
              blockingDiscussion: {
                status: blockingDiscussion.status,
                latencyMs: blockingDiscussion.latencyMs,
                debateTriggered: blockingDiscussion.debateTriggered,
                reason: blockingDiscussion.reason
              }
            }
          );
          candidateId = blockingCandidate?.candidateId || candidateId;
        }
      } else if (!forceAiReview && this.shouldQueueAsyncReview({
        request,
        settings,
        ruleEscalation: false,
        baseRiskScore,
        primaryAi: primaryAiResult,
        primaryConfidencePresent,
        candidateCreated: Boolean(candidateId)
      })) {
        const reviewId = await this.enqueueAsyncReview(
          request,
          primaryAiResult.verdict === 'suspicious' ? 'local_model_suspicious' : 'local_model_low_confidence',
          primaryAiResult,
          candidateId
        );
        queuedForAsyncReview = Boolean(reviewId);
        if (reviewId) {
          decisionSource = `${decisionSource}+async_review_queued`;
        }
      }
    } else if (verdict !== 'block' && !ruleMatched && !forceAiReview) {
      decisionSource = `${decisionSource}+local_ai_unavailable`;
    } else if (forceAiReview && this.aiAnalyzer && verdict !== 'block') {
      escalatedToAI = true;
      const primaryAiRawResult = await this.aiAnalyzer.analyze(request, {
        analysisPurpose: 'learning_verification',
        routeModeOverride: settings.learningCloudVerificationMode
      });
      const primaryConfidencePresent = hasUsableConfidence(primaryAiRawResult.confidence);
      aiResult = normalizeAIResult(primaryAiRawResult, attackFamily);
      attackFamily = aiResult.attackFamily || attackFamily;
      verdict = aiVerdictToDecision(aiResult);
      decisionSource = `ai:${aiResult.verdict}`;
      combinedSignals.push({
        source: 'ai',
        key: `ai-${aiResult.verdict}`,
        score: clampConfidence(aiResult.confidence),
        severity: aiVerdictToSeverity(aiResult),
        description: aiResult.reasoning,
        metadata: {
          routeMode: aiResult.routeMode,
          model: aiResult.model
        }
      });

      const primaryEvidence = {
        request: serializeRequestSnapshot(request),
        ai: this.serializeAIResult(aiResult),
        primaryAi: this.serializeAIResult(aiResult)
      };

      const primaryCandidate = await this.createCandidateFromAI(
        request,
        settings,
        attackFamily,
        aiResult,
        primaryEvidence
      );
      candidateId = primaryCandidate?.candidateId || null;

      if (this.shouldQueueAsyncReview({
        request,
        settings,
        ruleEscalation: false,
        baseRiskScore,
        primaryAi: aiResult,
        primaryConfidencePresent,
        candidateCreated: Boolean(candidateId)
      })) {
        const reviewId = await this.enqueueAsyncReview(
          request,
          aiResult.verdict === 'suspicious' ? 'local_model_suspicious' : 'local_model_low_confidence',
          aiResult,
          candidateId
        );
        queuedForAsyncReview = Boolean(reviewId);
        if (reviewId) {
          decisionSource = `${decisionSource}+async_review_queued`;
        }
      }
    } else if (verdict !== 'block' && !forceAiReview) {
      // Rule-only or heuristic-only path. No blocking AI work here.
    }

    // --- Learning from blocked requests (seed-rule blocks, no AI) ---
    if (verdict === 'block' && !candidateId && settings.learningFromBlockedEnabled) {
      try {
        const blockedCandidate = await this.createCandidateFromBlock(
          request,
          settings,
          attackFamily,
          ruleEvaluation.matchedRules.map(item => item.rule),
          heuristicAssessment.signals
        );
        if (blockedCandidate) {
          candidateId = blockedCandidate.candidateId;
        }
      } catch (error: any) {
        logger.warn('Blocked-request learning failed', {
          requestId: request.requestId,
          channel: request.channel,
          error: error?.message
        });
      }
    }

    const decision: DetectionDecision = {
      verdict,
      matchedRuleIds: ruleEvaluation.matchedRuleIds,
      riskScore: Number(baseRiskScore.toFixed(4)),
      escalatedToAI,
      queuedForAsyncReview,
      classificationLevel,
      blockingDiscussion: Boolean(blockingDiscussion),
      discussionStatus: blockingDiscussion?.status || 'not_required',
      discussionLatencyMs: blockingDiscussion?.latencyMs ?? 0,
      discussionDebateTriggered: blockingDiscussion?.debateTriggered || false,
      discussionFailClosed: blockingDiscussion?.failClosed || false,
      aiVerdict: aiResult?.verdict,
      aiConfidence: aiResult?.confidence,
      decisionSource,
      signals: combinedSignals,
      attackFamily,
      candidateId,
      processingTimeMs: Date.now() - startedAt,
      ruleMatches: ruleEvaluation.matchedRules.map((item) => item.rule),
      primaryAiResult: primaryAiResult,
      aiResult,
      learningVerificationAiResult
    };

    if (!skipPersistence) {
      this.recordDetectionEvent(request, decision);
    }

    return decision;
  }

  async reviewAgentSample(request: DetectionRequest): Promise<DetectionDecision> {
    return this.evaluateRequest({ ...request, channel: 'agent' }, { forceAiReview: true });
  }

  async recordBlockedThreat(request: DetectionRequest, matchedRuleIds: string[], severity: DetectionSeverity, description: string): Promise<void> {
    let candidateId: string | null = null;
    const attackFamily = inferAttackFamily(request);

    // --- Learning from agent-reported blocks ---
    try {
      const settings = await this.getSettings(request.tenantId);
      if (settings.learningFromBlockedEnabled && attackFamily !== 'benign' && attackFamily !== 'other') {
        const heuristicSignals: DetectionSignal[] = [{
          source: 'existing_signal',
          key: matchedRuleIds[0] || 'agent-threat',
          score: severity === 'critical' ? 1 : severity === 'high' ? 0.9 : 0.6,
          severity,
          description
        }];
        const candidate = await this.createCandidateFromBlock(
          request,
          settings,
          attackFamily,
          [],  // no rule records available from agent reports
          heuristicSignals
        );
        if (candidate) {
          candidateId = candidate.candidateId;
        }
      }
    } catch (error: any) {
      logger.warn('Agent blocked-threat learning failed', {
        requestId: request.requestId,
        error: error?.message
      });
    }

    const decision: DetectionDecision = {
      verdict: 'block',
      matchedRuleIds,
      riskScore: severity === 'critical' ? 1 : severity === 'high' ? 0.9 : 0.6,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      decisionSource: 'agent:block',
      signals: [{
        source: 'existing_signal',
        key: matchedRuleIds[0] || 'agent-threat',
        score: severity === 'critical' ? 1 : 0.9,
        severity,
        description
      }],
      attackFamily,
      candidateId,
      processingTimeMs: 0,
      ruleMatches: []
    };
    this.recordDetectionEvent(request, decision);
  }

  async getSummary(tenantId: string): Promise<DetectionRuleSummary> {
    this.assertPrepared();
    const settings = await this.getSettings(tenantId);
    const rules = await this.listRules(tenantId);
    const candidates = await this.listRuleCandidates(tenantId);
    const db = this.getDb();
    const eventRows = db.prepare(`
      SELECT *
      FROM sec_detection_events
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 1000
    `).all(tenantId) as any[];
    const asyncReviewRows = db.prepare(`
      SELECT status, final_ai_json, latency_ms, debate_triggered
      FROM sec_detection_async_reviews
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
      LIMIT 1000
    `).all(tenantId) as any[];
    const asyncReviewStats = await this.getAsyncReviewStats(tenantId);
    const responseSnapshots = eventRows.map((row) => parseJson<Record<string, any>>(row.response_snapshot_json, {}));

    const totalEvents = eventRows.length;
    const aiEvents = eventRows.filter((row) => normalizeBoolean(row.escalated_to_ai)).length;
    const ruleHitEvents = eventRows.filter((row) => parseJson<string[]>(row.matched_rule_ids_json, []).length > 0).length;
    const avgProcessingTimeMs = totalEvents > 0
      ? Number((eventRows.reduce((sum, row) => sum + Number(row.processing_time_ms || 0), 0) / totalEvents).toFixed(2))
      : 0;

    const topRuleCounts = new Map<string, number>();
    const routeModeCounts = eventRows.reduce((acc, row) => {
      const routeMode = String(row.ai_route_mode || '');
      if (routeMode.includes('local')) {
        acc.local += 1;
      } else if (routeMode.includes('cloud') || routeMode.includes('hybrid')) {
        acc.cloud += 1;
      }
      return acc;
    }, { local: 0, cloud: 0 });
    for (const row of asyncReviewRows) {
      const finalAi = parseJson<Record<string, any> | null>(row.final_ai_json, null);
      const routeMode = String(finalAi?.routeMode || '');
      if (routeMode.includes('local')) {
        routeModeCounts.local += 1;
      } else if (routeMode.includes('cloud') || routeMode.includes('hybrid')) {
        routeModeCounts.cloud += 1;
      }
    }

    for (const row of eventRows) {
      for (const ruleId of parseJson<string[]>(row.matched_rule_ids_json, [])) {
        topRuleCounts.set(ruleId, (topRuleCounts.get(ruleId) || 0) + 1);
      }
    }
    const blockingDiscussionCount = responseSnapshots.filter((snapshot) => Boolean(snapshot.blockingDiscussion)).length;
    const blockingDiscussionFailClosed = responseSnapshots.filter((snapshot) => normalizeBoolean(snapshot.discussionFailClosed)).length;
    const blockingDiscussionLatencySamples = responseSnapshots
      .map((snapshot) => Number(snapshot.discussionLatencyMs || 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    const ruleIndex = rules.reduce<Record<string, DetectionRuleRecord>>((acc, rule) => {
      acc[rule.ruleId] = rule;
      return acc;
    }, {});

    const topRules = Array.from(topRuleCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([ruleId, hitCount]) => ({
        ruleId,
        name: ruleIndex[ruleId]?.name || ruleId,
        severity: ruleIndex[ruleId]?.severity || 'medium',
        hitCount,
        source: ruleIndex[ruleId]?.source || 'event'
      }));

    return {
      totalRules: rules.length,
      activeRules: rules.filter((rule) => rule.enabled).length,
      pendingCandidates: candidates.filter((candidate) => candidate.status === 'pending').length,
      approvedCandidates: candidates.filter((candidate) => candidate.status === 'approved').length,
      rejectedCandidates: candidates.filter((candidate) => candidate.status === 'rejected').length,
      ruleHitRate: totalEvents > 0 ? Number((ruleHitEvents / totalEvents).toFixed(4)) : 0,
      aiEscalationRate: totalEvents > 0 ? Number((aiEvents / totalEvents).toFixed(4)) : 0,
      localModelHitRate: totalEvents > 0 ? Number((routeModeCounts.local / totalEvents).toFixed(4)) : 0,
      avgProcessingTimeMs,
      localAICount: routeModeCounts.local,
      cloudAICount: routeModeCounts.cloud,
      asyncReviewQueueDepth: asyncReviewStats.queueDepth,
      asyncReviewRunning: asyncReviewStats.running,
      asyncReviewCompleted: asyncReviewStats.completed,
      asyncReviewFailed: asyncReviewStats.failed,
      debateCompletionRate: asyncReviewStats.debateCompletionRate,
      avgAsyncReviewLatencyMs: asyncReviewStats.avgLatencyMs,
      classificationLevel: settings.classificationLevel,
      blockingDiscussionCount,
      blockingDiscussionFailClosed,
      avgBlockingDiscussionLatencyMs: blockingDiscussionLatencySamples.length > 0
        ? Number((blockingDiscussionLatencySamples.reduce((sum, value) => sum + value, 0) / blockingDiscussionLatencySamples.length).toFixed(2))
        : 0,
      topRules
    };
  }

  /**
   * Health of the AI decision layer. When the multi-agent analyzer is not wired,
   * the pipeline runs in explicit fail-closed degraded mode: rules remain the
   * deterministic block guardrail, non-block verdicts fall back to risk-based
   * monitor/allow, and elevated-risk requests are blocked rather than silently
   * passed. This surfaces that state so operators and the /cognition view can see
   * the AI layer is degraded rather than assuming it is active.
   */
  getAiLayerHealth(): { available: boolean; degraded: boolean; prepared: boolean; mode: string; message: string } {
    const prepared = this.prepared;
    const available = prepared && this.aiAnalyzer !== null;
    return {
      available,
      degraded: prepared && !available,
      prepared,
      mode: available ? 'multi-agent' : 'fail-closed-degraded',
      message: available
        ? 'Multi-agent analyzer is wired and active.'
        : (prepared
          ? 'AI analyzer unavailable — pipeline is in fail-closed degraded mode (rules guardrail only).'
          : 'Detection pipeline storage not prepared.')
    };
  }

  async getAsyncReviewStats(tenantId: string): Promise<DetectionAsyncReviewStats> {
    this.assertPrepared();
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT status, latency_ms, debate_triggered, disagreement
      FROM sec_detection_async_reviews
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
      LIMIT 1000
    `).all(tenantId) as any[];

    const counts = rows.reduce((acc, row) => {
      const status = row.status === 'running'
        ? 'running'
        : row.status === 'completed'
          ? 'completed'
          : row.status === 'failed'
            ? 'failed'
            : 'queued';
      acc[status] += 1;
      return acc;
    }, { queued: 0, running: 0, completed: 0, failed: 0 } as Record<DetectionAsyncReviewStatus, number>);
    const terminal = counts.completed + counts.failed;
    const completedRows = rows.filter((row) => row.status === 'completed');
    const latencies = completedRows
      .map((row) => Number(row.latency_ms || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const debateCompleted = completedRows.filter((row) => normalizeBoolean(row.debate_triggered)).length;
    const disagreementCompleted = completedRows.filter((row) => normalizeBoolean(row.disagreement)).length;

    return {
      queueDepth: counts.queued + counts.running,
      queued: counts.queued,
      running: counts.running,
      completed: counts.completed,
      failed: counts.failed,
      completionRate: terminal > 0 ? Number((counts.completed / terminal).toFixed(4)) : 0,
      debateCompletionRate: completedRows.length > 0 ? Number((debateCompleted / completedRows.length).toFixed(4)) : 0,
      disagreements: disagreementCompleted,
      disagreementRate: completedRows.length > 0 ? Number((disagreementCompleted / completedRows.length).toFixed(4)) : 0,
      avgLatencyMs: latencies.length > 0
        ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2))
        : 0
    };
  }

  async listDetectionEvents(tenantId: string, filters: DetectionEventFilters = {}): Promise<DetectionEventRecord[]> {
    this.assertPrepared();
    const db = this.getDb();
    const params: any[] = [tenantId];
    const conditions = ['tenant_id = ?'];

    if (filters.channel) {
      conditions.push('channel = ?');
      params.push(filters.channel);
    }
    if (filters.verdict) {
      conditions.push('verdict = ?');
      params.push(filters.verdict);
    }
    if (typeof filters.escalatedToAI === 'boolean') {
      conditions.push('escalated_to_ai = ?');
      params.push(filters.escalatedToAI ? 1 : 0);
    }
    if (filters.candidateId) {
      conditions.push('candidate_id = ?');
      params.push(filters.candidateId);
    }
    if (filters.from) {
      conditions.push('created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push('created_at <= ?');
      params.push(filters.to);
    }

    const limit = Math.max(1, Math.min(Number(filters.limit || 50), 500));
    params.push(limit);

    const rows = db.prepare(`
      SELECT *
      FROM sec_detection_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params) as any[];

    return rows.map((row) => this.mapEvent(row));
  }

  private async createOrMergeRuleCandidate(
    request: DetectionRequest,
    attackFamily: DetectionAttackFamily,
    severity: DetectionSeverity,
    reasoning: string,
    aiConfidence: number,
    latestEvidence: Record<string, any>
  ): Promise<DetectionRuleCandidateRecord | null> {
    this.assertPrepared();
    const db = this.getDb();
    const suggestion = buildDetectionCandidateSuggestion(request, attackFamily, severity, reasoning);
    const existing = db.prepare(`
      SELECT *
      FROM sec_rule_candidates
      WHERE tenant_id = ? AND channel = ? AND attack_family = ? AND matcher_fingerprint = ?
      LIMIT 1
    `).get(request.tenantId, request.channel, attackFamily, suggestion.matcherFingerprint) as any;

    const now = new Date().toISOString();
    if (existing) {
      if (String(existing.status) === 'rejected') {
        return this.mapCandidate(existing);
      }

      db.run(`
        UPDATE sec_rule_candidates
        SET sample_count = sample_count + 1,
            ai_confidence = ?,
            latest_evidence_json = ?,
            updated_at = ?
        WHERE candidate_id = ?
      `, [
        Math.max(Number(existing.ai_confidence || 0), aiConfidence),
        JSON.stringify(latestEvidence),
        now,
        existing.candidate_id
      ]);

      const merged = await this.getRuleCandidateById(request.tenantId, existing.candidate_id);
      if (merged) {
        this.syncCandidateFinding(merged);
      }
      return merged;
    }

    const candidateId = randomUUID();
    db.run(`
      INSERT INTO sec_rule_candidates (
        candidate_id, tenant_id, channel, attack_family, name, severity, matcher_json,
        matcher_fingerprint, reasoning, status, sample_count, ai_confidence,
        latest_evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?)
    `, [
      candidateId,
      request.tenantId,
      request.channel,
      attackFamily,
      suggestion.name,
      severity,
      JSON.stringify(suggestion.matcher),
      suggestion.matcherFingerprint,
      reasoning,
      aiConfidence,
      JSON.stringify(latestEvidence),
      now,
      now
    ]);

    const created = await this.getRuleCandidateById(request.tenantId, candidateId);
    if (created) {
      this.syncCandidateFinding(created);
    }
    return created;
  }

  private recordDetectionEvent(request: DetectionRequest, decision: DetectionDecision): void {
    this.assertPrepared();
    const db = this.getDb();
    const detectionEventId = randomUUID();
    const createdAt = new Date().toISOString();
    db.run(`
      INSERT INTO sec_detection_events (
        detection_event_id, tenant_id, request_id, channel, verdict, matched_rule_ids_json,
        risk_score, escalated_to_ai, ai_verdict, ai_confidence, ai_route_mode, ai_model,
        attack_family, candidate_id, decision_source, processing_time_ms, request_snapshot_json,
        response_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      detectionEventId,
      request.tenantId,
      request.requestId,
      request.channel,
      decision.verdict,
      JSON.stringify(decision.matchedRuleIds),
      decision.riskScore,
      decision.escalatedToAI ? 1 : 0,
      decision.aiVerdict || null,
      decision.aiConfidence ?? null,
      decision.aiResult?.routeMode || null,
      decision.aiResult?.model || null,
      decision.attackFamily,
      decision.candidateId || null,
      decision.decisionSource,
      decision.processingTimeMs,
      JSON.stringify(serializeRequestSnapshot(request)),
      JSON.stringify({
        verdict: decision.verdict,
        decisionSource: decision.decisionSource,
        riskScore: decision.riskScore,
        queuedForAsyncReview: decision.queuedForAsyncReview,
        classificationLevel: decision.classificationLevel,
        blockingDiscussion: decision.blockingDiscussion,
        discussionStatus: decision.discussionStatus,
        discussionLatencyMs: decision.discussionLatencyMs,
        discussionDebateTriggered: decision.discussionDebateTriggered,
        discussionFailClosed: decision.discussionFailClosed,
        aiVerdict: decision.aiVerdict,
        aiConfidence: decision.aiConfidence,
        primaryAi: this.serializeAIResult(decision.primaryAiResult),
        finalAi: this.serializeAIResult(decision.aiResult),
        learningVerificationAi: this.serializeAIResult(decision.learningVerificationAiResult),
        candidateId: decision.candidateId,
        matchedRuleIds: decision.matchedRuleIds
      }),
      createdAt
    ]);
  }

  private syncCandidateFinding(candidate: DetectionRuleCandidateRecord): void {
    try {
      securityOperationsService.syncSignalFinding({
        tenantId: candidate.tenantId,
        active: candidate.status === 'pending',
        sourceType: 'rule-candidate',
        sourceRef: candidate.candidateId,
        target: candidate.name,
        category: `rule-candidate:${candidate.attackFamily}`,
        severity: candidate.severity,
        title: `AI learned rule candidate: ${candidate.name}`,
        description: candidate.status === 'pending'
          ? `AI proposed a new ${candidate.attackFamily} rule candidate from ${candidate.channel} traffic.`
          : `Rule candidate ${candidate.name} was ${candidate.status}.`,
        evidence: {
          candidateId: candidate.candidateId,
          channel: candidate.channel,
          attackFamily: candidate.attackFamily,
          aiConfidence: candidate.aiConfidence,
          sampleCount: candidate.sampleCount,
          matcher: candidate.matcher,
          latestEvidence: candidate.latestEvidence
        },
        remediation: {
          title: 'Review rule candidate before activation',
          owner: 'security-engineering',
          suggestedSteps: [
            'Validate the matcher against production-safe traffic samples.',
            'Approve only if the rule is specific enough to avoid false positives.'
          ]
        },
        fingerprint: `rule-candidate:${candidate.candidateId}`,
        createAlert: true,
        alertType: 'security'
      });
    } catch (error: any) {
      logger.warn('Failed to sync candidate finding', {
        candidateId: candidate.candidateId,
        error: error?.message
      });
    }
  }

  private mapRule(row: any): DetectionRuleRecord {
    return {
      ruleId: String(row.rule_id || ''),
      tenantId: String(row.tenant_id || 'global'),
      name: String(row.name || ''),
      description: row.description ? String(row.description) : undefined,
      scope: row.scope === 'all' ? 'all' : normalizeChannel(row.scope),
      action: row.action === 'allow' ? 'allow' : row.action === 'review' ? 'review' : 'block',
      priority: Number(row.priority || 0),
      severity: normalizeSeverity(row.severity),
      matcher: parseJson<DetectionRuleMatcher>(row.matcher_json, {}),
      source: row.source === 'seed' ? 'seed' : row.source === 'candidate' ? 'candidate' : 'dynamic',
      enabled: normalizeBoolean(row.enabled),
      attackFamily: normalizeAttackFamily(row.metadata_json ? parseJson<any>(row.metadata_json, {}).attackFamily : undefined),
      version: Number(row.version || 1),
      metadata: parseJson<Record<string, any>>(row.metadata_json, {})
    };
  }

  private mapCandidate(row: any): DetectionRuleCandidateRecord {
    return {
      candidateId: String(row.candidate_id || ''),
      tenantId: String(row.tenant_id || 'global'),
      channel: normalizeChannel(row.channel),
      attackFamily: normalizeAttackFamily(row.attack_family),
      name: String(row.name || ''),
      severity: normalizeSeverity(row.severity),
      matcher: parseJson<DetectionRuleMatcher>(row.matcher_json, {}),
      matcherFingerprint: String(row.matcher_fingerprint || ''),
      reasoning: String(row.reasoning || ''),
      status: row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'rejected' : 'pending',
      sampleCount: Number(row.sample_count || 0),
      aiConfidence: Number(row.ai_confidence || 0),
      latestEvidence: parseJson<Record<string, any>>(row.latest_evidence_json, {}),
      approvedRuleId: row.approved_rule_id ? String(row.approved_rule_id) : null,
      reviewReason: row.review_reason ? String(row.review_reason) : null,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null
    };
  }

  private mapEvent(row: any): DetectionEventRecord {
    const responseSnapshot = parseJson<Record<string, any>>(row.response_snapshot_json, {});
    return {
      detectionEventId: String(row.detection_event_id || ''),
      tenantId: String(row.tenant_id || PLATFORM_TENANT_ID),
      requestId: String(row.request_id || ''),
      channel: normalizeChannel(row.channel),
      verdict: row.verdict === 'block' ? 'block' : row.verdict === 'monitor' ? 'monitor' : 'allow',
      matchedRuleIds: parseJson<string[]>(row.matched_rule_ids_json, []),
      riskScore: Number(row.risk_score || 0),
      escalatedToAI: normalizeBoolean(row.escalated_to_ai),
      queuedForAsyncReview: normalizeBoolean(responseSnapshot.queuedForAsyncReview),
      classificationLevel: responseSnapshot.classificationLevel ? normalizeSecurityClassificationLevel(responseSnapshot.classificationLevel) : undefined,
      blockingDiscussion: normalizeBoolean(responseSnapshot.blockingDiscussion),
      discussionStatus: responseSnapshot.discussionStatus ? String(responseSnapshot.discussionStatus) as BlockingDiscussionStatus : undefined,
      discussionLatencyMs: responseSnapshot.discussionLatencyMs === null || responseSnapshot.discussionLatencyMs === undefined ? undefined : Number(responseSnapshot.discussionLatencyMs),
      aiVerdict: row.ai_verdict ? String(row.ai_verdict) : null,
      aiConfidence: row.ai_confidence === null || row.ai_confidence === undefined ? null : Number(row.ai_confidence),
      aiRouteMode: row.ai_route_mode ? String(row.ai_route_mode) : null,
      aiModel: row.ai_model ? String(row.ai_model) : null,
      aiHeuristicDegraded: responseSnapshot.finalAi?.heuristicDegraded === true,
      attackFamily: normalizeAttackFamily(row.attack_family),
      candidateId: row.candidate_id ? String(row.candidate_id) : null,
      decisionSource: String(row.decision_source || ''),
      processingTimeMs: Number(row.processing_time_ms || 0),
      requestSnapshot: parseJson<Record<string, any>>(row.request_snapshot_json, {}),
      responseSnapshot,
      createdAt: String(row.created_at || '')
    };
  }
}

export const detectionPipelineService = new DetectionPipelineService();
