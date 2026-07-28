import { createWriteStream, readFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { resolve } from 'path';
import * as readline from 'readline';
import {
  assessDetectionHeuristics,
  buildSeedDetectionRules,
  evaluateDetectionRules,
  inferAttackFamily,
  type DetectionAttackFamily,
  type DetectionRequest,
  type DetectionSeverity,
  type DetectionSignal
} from '../../backend/src/services/detection-engine';

interface DetectionInput {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  sourceContext: Record<string, unknown>;
  ruleSignals: Array<{
    ruleId: string;
    score: number;
    field: string;
    description: string;
  }>;
}

interface DetectionOutput {
  verdict: 'safe' | 'suspicious' | 'malicious' | 'unknown';
  confidence: number;
  attackFamily:
    | 'benign'
    | 'sqli'
    | 'xss'
    | 'command_injection'
    | 'path_traversal'
    | 'ssrf'
    | 'authentication'
    | 'automation'
    | 'api_abuse'
    | 'deserialization'
    | 'file_upload'
    | 'protocol_attack'
    | 'business_logic'
    | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  evidence: Array<{ field: string; value: unknown; reason: string }>;
  recommendedAction: 'allow' | 'monitor' | 'challenge' | 'block';
}

interface SftRecord {
  sampleId: string;
  messages: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

const REPOSITORY_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_INPUT_PATH = resolve(REPOSITORY_ROOT, 'ml', 'data', 'processed', 'test.jsonl');
const DEFAULT_OUTPUT_PATH = resolve(REPOSITORY_ROOT, 'ml', 'output', 'rules-predictions.jsonl');
const AI_ESCALATION_THRESHOLD = 0.55;

function parseArgument(flagName: string, fallbackValue: string): string {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex < 0 || flagIndex + 1 >= process.argv.length) {
    return fallbackValue;
  }
  return resolve(process.argv[flagIndex + 1]);
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findMessage(record: SftRecord, role: string): string {
  const matchingMessage = record.messages.find((message) => message.role === role);
  if (!matchingMessage) {
    throw new Error(`Sample ${record.sampleId} is missing ${role} message`);
  }
  return matchingMessage.content;
}

function normalizeSeverity(signals: DetectionSignal[], fallback: DetectionSeverity): DetectionSeverity {
  const severityRank: Record<DetectionSeverity, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
  };
  return signals.reduce<DetectionSeverity>((highestSeverity, signal) => (
    severityRank[signal.severity] > severityRank[highestSeverity] ? signal.severity : highestSeverity
  ), fallback);
}

function normalizeAttackFamily(
  attackFamily: DetectionAttackFamily,
  verdict: DetectionOutput['verdict']
): DetectionOutput['attackFamily'] {
  if (verdict === 'safe') {
    return 'benign';
  }
  return attackFamily;
}

function buildDetectionRequest(sampleId: string, input: DetectionInput): DetectionRequest {
  const normalizedHeaders = Object.entries(input.headers || {}).reduce<Record<string, string>>(
    (headers, [headerName, headerValue]) => {
      headers[headerName.toLowerCase()] = String(headerValue);
      return headers;
    },
    {}
  );
  const existingSignals: DetectionSignal[] = (input.ruleSignals || []).map((ruleSignal) => ({
    source: 'existing_signal',
    key: ruleSignal.ruleId,
    score: Math.max(0, Math.min(1, Number(ruleSignal.score) || 0)),
    severity: Number(ruleSignal.score) >= 0.8 ? 'high' : Number(ruleSignal.score) >= 0.5 ? 'medium' : 'low',
    description: ruleSignal.description,
    metadata: {
      field: ruleSignal.field
    }
  }));
  return {
    tenantId: 'ml-evaluation',
    channel: 'http_api',
    requestId: sampleId,
    timestamp: '2026-01-01T00:00:00.000Z',
    method: input.method,
    path: input.path,
    decodedPath: safelyDecode(input.path),
    query: input.query,
    decodedQuery: safelyDecode(input.query),
    parsedQuery: safelyDecode(input.query),
    headers: normalizedHeaders,
    body: input.body,
    normalizedBody: safelyDecode(input.body),
    parsedBody: input.body,
    userAgent: normalizedHeaders['user-agent'],
    rawPayload: [input.method, input.path, input.query, input.body].join('\n'),
    existingSignals,
    metadata: input.sourceContext
  };
}

function evaluateOneRecord(record: SftRecord): Record<string, unknown> {
  const detectionInput = JSON.parse(findMessage(record, 'user')) as DetectionInput;
  const expectedOutput = JSON.parse(findMessage(record, 'assistant')) as DetectionOutput;
  const detectionRequest = buildDetectionRequest(record.sampleId, detectionInput);
  const evaluationStartedAt = performance.now();
  const ruleEvaluation = evaluateDetectionRules(detectionRequest, buildSeedDetectionRules());
  const heuristicAssessment = assessDetectionHeuristics(detectionRequest);
  const combinedSignals = [...ruleEvaluation.signals, ...heuristicAssessment.signals];
  const riskScore = Math.max(ruleEvaluation.riskScore, heuristicAssessment.riskScore);
  const inferredAttackFamily = inferAttackFamily(detectionRequest, combinedSignals);

  let verdict: DetectionOutput['verdict'];
  let recommendedAction: DetectionOutput['recommendedAction'];
  if (ruleEvaluation.ruleVerdict === 'block') {
    verdict = 'malicious';
    recommendedAction = 'block';
  } else if (ruleEvaluation.ruleVerdict === 'monitor' || riskScore >= AI_ESCALATION_THRESHOLD) {
    verdict = 'suspicious';
    recommendedAction = 'monitor';
  } else {
    verdict = 'safe';
    recommendedAction = 'allow';
  }

  const severity = normalizeSeverity(combinedSignals, verdict === 'safe' ? 'low' : 'medium');
  const confidence = verdict === 'safe'
    ? Math.max(0.5, 1 - riskScore)
    : Math.max(0.5, Math.min(1, riskScore));
  const prediction: DetectionOutput = {
    verdict,
    confidence: Number(confidence.toFixed(4)),
    attackFamily: normalizeAttackFamily(inferredAttackFamily, verdict),
    severity,
    reasoning: combinedSignals.length > 0
      ? combinedSignals.slice(0, 3).map((signal) => signal.description).join('；')
      : '现有规则与 heuristic 未发现明确攻击特征',
    evidence: combinedSignals.slice(0, 4).map((signal) => ({
      field: signal.source,
      value: signal.key,
      reason: signal.description
    })),
    recommendedAction
  };
  const latencyMs = performance.now() - evaluationStartedAt;
  return {
    sampleId: record.sampleId,
    expected: expectedOutput,
    prediction,
    rawOutput: JSON.stringify(prediction),
    jsonSyntaxValid: true,
    schemaValid: true,
    validationErrors: [],
    latencyMs,
    metadata: record.metadata || {},
    inferenceMode: 'existing_rules_and_heuristics',
    modelInvoked: false,
    heuristicOnly: true,
    ruleEvidence: {
      threshold: AI_ESCALATION_THRESHOLD,
      matchedRuleIds: ruleEvaluation.matchedRuleIds,
      ruleVerdict: ruleEvaluation.ruleVerdict,
      ruleRiskScore: ruleEvaluation.riskScore,
      heuristicRiskScore: heuristicAssessment.riskScore,
      signalKeys: combinedSignals.map((signal) => signal.key)
    }
  };
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_SEED_RULES = 'false';
  const inputPath = parseArgument('--input', DEFAULT_INPUT_PATH);
  const outputPath = parseArgument('--output', DEFAULT_OUTPUT_PATH);
  const inputStream = readline.createInterface({
    input: require('fs').createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  const outputStream = createWriteStream(outputPath, { encoding: 'utf8', flags: 'w' });
  let processedRecords = 0;
  for await (const rawLine of inputStream) {
    if (!rawLine.trim()) {
      continue;
    }
    const record = JSON.parse(rawLine) as SftRecord;
    outputStream.write(`${JSON.stringify(evaluateOneRecord(record))}\n`);
    processedRecords += 1;
  }
  await new Promise<void>((resolveWrite, rejectWrite) => {
    outputStream.on('error', rejectWrite);
    outputStream.end(resolveWrite);
  });
  // Read once after closing to verify every generated line is valid JSON.
  const outputLines = readFileSync(outputPath, 'utf8').split(/\r?\n/).filter(Boolean);
  outputLines.forEach((outputLine) => JSON.parse(outputLine));
  if (outputLines.length !== processedRecords) {
    throw new Error(`Output count ${outputLines.length} does not match input count ${processedRecords}`);
  }
  console.log(JSON.stringify({ processedRecords, outputPath, heuristicOnly: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
