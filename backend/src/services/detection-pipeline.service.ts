import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';
import {
  platformConfigService,
  type AIRoutingMode,
  type DetectionPipelineSettings,
  isSeverityAtLeast,
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
  severityToBlockDurationSeconds
} from './detection-engine';

type CandidateStatus = 'pending' | 'approved' | 'rejected';

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
  aiResult?: DetectionAIResult;
  learningVerificationAiResult?: DetectionAIResult;
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
  avgProcessingTimeMs: number;
  localAICount: number;
  cloudAICount: number;
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
  aiVerdict?: string | null;
  aiConfidence?: number | null;
  aiRouteMode?: string | null;
  aiModel?: string | null;
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
  analysisPurpose?: 'primary' | 'deep_analysis' | 'learning_verification';
  routeModeOverride?: AIRoutingMode;
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
  return {
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
  };
}

class DetectionPipelineService {
  private prepared = false;
  private aiAnalyzer: DetectionAIAnalyzer | null = null;

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

      CREATE INDEX IF NOT EXISTS idx_sec_detection_rules_tenant ON sec_detection_rules(tenant_id, scope, enabled, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_sec_rule_candidates_tenant ON sec_rule_candidates(tenant_id, status, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_rule_candidates_key ON sec_rule_candidates(tenant_id, channel, attack_family, matcher_fingerprint);
      CREATE INDEX IF NOT EXISTS idx_sec_detection_events_tenant ON sec_detection_events(tenant_id, created_at DESC);
    `);

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
  }

  async getSettings(tenantId: string): Promise<DetectionPipelineSettings> {
    const config = await platformConfigService.getConfig(tenantId);
    return config.detectionPipeline;
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

  async evaluateRequest(request: DetectionRequest, options: EvaluateOptions = {}): Promise<DetectionDecision> {
    this.assertPrepared();
    const startedAt = Date.now();
    const settings = await this.getSettings(request.tenantId);
    const rules = await this.listRules(request.tenantId);
    const ruleEvaluation = evaluateDetectionRules(request, rules);
    const heuristicAssessment = assessDetectionHeuristics(request);
    const combinedSignals = [...ruleEvaluation.signals, ...heuristicAssessment.signals];
    const baseRiskScore = Math.max(ruleEvaluation.riskScore, heuristicAssessment.riskScore);
    let escalatedToAI = false;
    let queuedForAsyncReview = false;
    let aiResult: DetectionAIResult | undefined;
    let learningVerificationAiResult: DetectionAIResult | undefined;
    let candidateId: string | null = null;
    let decisionSource = ruleEvaluation.highestPriorityRule
      ? `${ruleEvaluation.highestPriorityRule.source}:${ruleEvaluation.highestPriorityRule.action}`
      : 'heuristic_only';
    let verdict: DetectionVerdict = ruleEvaluation.ruleVerdict || (baseRiskScore >= settings.aiEscalationThreshold ? 'monitor' : 'allow');
    let attackFamily = normalizeAttackFamily(
      ruleEvaluation.highestPriorityRule?.attackFamily || inferAttackFamily(request, combinedSignals)
    );

    const channelEnabled =
      (request.channel === 'http_api' && settings.enableHttpApi) ||
      (request.channel === 'packet' && settings.enablePacketInterceptor) ||
      (request.channel === 'agent' && settings.enableAgentAsyncReview);

    const shouldEscalate =
      settings.ruleFirstEnabled &&
      channelEnabled &&
      (options.forceAiReview || ruleEvaluation.shouldEscalate || baseRiskScore >= settings.aiEscalationThreshold) &&
      verdict !== 'block' &&
      settings.aiEscalationMode === 'high_risk_allowed_only';

    if (shouldEscalate) {
      if (request.channel === 'agent' && !options.forceAiReview) {
        queuedForAsyncReview = true;
        decisionSource = `${decisionSource}+async_agent_review`;
      } else if (this.aiAnalyzer) {
        escalatedToAI = true;
        const primaryAiRawResult = await this.aiAnalyzer.analyze(request, {
          analysisPurpose: 'primary'
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

        const shouldVerifyLearning = this.shouldRunLearningVerification(
          request,
          settings,
          aiResult,
          primaryConfidencePresent,
          Boolean(candidateId)
        );

        if (shouldVerifyLearning) {
          try {
            const learningRawResult = await this.aiAnalyzer.analyze(request, {
              analysisPurpose: 'learning_verification',
              routeModeOverride: settings.learningCloudVerificationMode
            });
            learningVerificationAiResult = normalizeAIResult(learningRawResult, attackFamily);
            attackFamily = normalizeAttackFamily(learningVerificationAiResult.attackFamily, attackFamily);

            const learningCandidate = await this.createCandidateFromAI(
              request,
              settings,
              attackFamily,
              learningVerificationAiResult,
              {
                request: serializeRequestSnapshot(request),
                ai: this.serializeAIResult(learningVerificationAiResult),
                primaryAi: this.serializeAIResult(aiResult),
                learningVerificationAi: this.serializeAIResult(learningVerificationAiResult)
              }
            );

            if (learningCandidate) {
              candidateId = learningCandidate.candidateId;
            }
          } catch (error: any) {
            logger.warn('Detection learning verification failed', {
              requestId: request.requestId,
              channel: request.channel,
              error: error?.message
            });
          }
        }
      } else {
        decisionSource = `${decisionSource}+ai_unavailable`;
      }
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
      aiVerdict: aiResult?.verdict,
      aiConfidence: aiResult?.confidence,
      decisionSource,
      signals: combinedSignals,
      attackFamily,
      candidateId,
      processingTimeMs: Date.now() - startedAt,
      ruleMatches: ruleEvaluation.matchedRules.map((item) => item.rule),
      aiResult,
      learningVerificationAiResult
    };

    if (!options.skipPersistence) {
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

    for (const row of eventRows) {
      for (const ruleId of parseJson<string[]>(row.matched_rule_ids_json, [])) {
        topRuleCounts.set(ruleId, (topRuleCounts.get(ruleId) || 0) + 1);
      }
    }

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
      avgProcessingTimeMs,
      localAICount: routeModeCounts.local,
      cloudAICount: routeModeCounts.cloud,
      topRules
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
        aiVerdict: decision.aiVerdict,
        aiConfidence: decision.aiConfidence,
        primaryAi: this.serializeAIResult(decision.aiResult),
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
    return {
      detectionEventId: String(row.detection_event_id || ''),
      tenantId: String(row.tenant_id || PLATFORM_TENANT_ID),
      requestId: String(row.request_id || ''),
      channel: normalizeChannel(row.channel),
      verdict: row.verdict === 'block' ? 'block' : row.verdict === 'monitor' ? 'monitor' : 'allow',
      matchedRuleIds: parseJson<string[]>(row.matched_rule_ids_json, []),
      riskScore: Number(row.risk_score || 0),
      escalatedToAI: normalizeBoolean(row.escalated_to_ai),
      aiVerdict: row.ai_verdict ? String(row.ai_verdict) : null,
      aiConfidence: row.ai_confidence === null || row.ai_confidence === undefined ? null : Number(row.ai_confidence),
      aiRouteMode: row.ai_route_mode ? String(row.ai_route_mode) : null,
      aiModel: row.ai_model ? String(row.ai_model) : null,
      attackFamily: normalizeAttackFamily(row.attack_family),
      candidateId: row.candidate_id ? String(row.candidate_id) : null,
      decisionSource: String(row.decision_source || ''),
      processingTimeMs: Number(row.processing_time_ms || 0),
      requestSnapshot: parseJson<Record<string, any>>(row.request_snapshot_json, {}),
      responseSnapshot: parseJson<Record<string, any>>(row.response_snapshot_json, {}),
      createdAt: String(row.created_at || '')
    };
  }
}

export const detectionPipelineService = new DetectionPipelineService();
