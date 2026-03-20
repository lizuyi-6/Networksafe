import { DebateProtocol } from '../ai-agents/debate/debate-protocol';
import { MessageBus } from '../ai-agents/core/message-bus';
import { buildDebateTriggerMetrics } from '../ai-agents/core/scoring';
import { AnalysisResult, TrafficRequest } from '../ai-agents/core/types';

function createResult(
  role: AnalysisResult['role'],
  verdict: AnalysisResult['verdict'],
  confidence: number,
  classScores: AnalysisResult['classScores']
): AnalysisResult {
  return {
    agentId: `${role}-1`,
    role,
    verdict,
    confidence,
    reasoning: `${role}:${verdict}`,
    evidence: [],
    classScores
  } as AnalysisResult;
}

describe('AI debate orchestration', () => {
  let messageBus: MessageBus;
  let debateProtocol: DebateProtocol;
  let request: TrafficRequest;

  beforeEach(() => {
    messageBus = new MessageBus();
    debateProtocol = new DebateProtocol(messageBus);
    request = {
      id: 'debate-test-request',
      timestamp: new Date(),
      sourceIP: '203.0.113.10',
      method: 'POST',
      path: '/login',
      headers: {
        host: 'example.test'
      }
    };
  });

  afterEach(() => {
    messageBus.shutdown();
  });

  test('triggers debate when dominant labels disagree even without safe/malicious polarity', () => {
    const results = [
      createResult('socrates', 'suspicious', 0.74, { safe: 0.18, suspicious: 0.62, malicious: 0.2 }),
      createResult('plato', 'safe', 0.82, { safe: 0.82, suspicious: 0.12, malicious: 0.06 }),
      createResult('aristotle', 'safe', 0.74, { safe: 0.74, suspicious: 0.18, malicious: 0.08 })
    ];

    const metrics = buildDebateTriggerMetrics(results, 0.3, 0.3);

    expect(metrics.triggered).toBe(true);
    expect(metrics.labelConflict).toBe(true);
    expect(metrics.reasons).toContain('label_conflict');
  });

  test('arbitration de-escalates an isolated aggressive vote after debate', async () => {
    const results = [
      createResult('socrates', 'suspicious', 0.74, { safe: 0.18, suspicious: 0.62, malicious: 0.2 }),
      createResult('plato', 'safe', 0.82, { safe: 0.82, suspicious: 0.12, malicious: 0.06 }),
      createResult('aristotle', 'safe', 0.74, { safe: 0.74, suspicious: 0.18, malicious: 0.08 })
    ];

    const triggerMetrics = buildDebateTriggerMetrics(results, 0.05, 0.05);
    const session = await debateProtocol.initiateDebate(request.id, results, request, triggerMetrics);

    expect(session.finalVerdict?.decision).toBe('safe');
    expect(session.consensusReached).toBe(true);
    expect(session.aggregateDistribution?.safe).toBeGreaterThan(session.aggregateDistribution?.malicious || 0);
  });

  test('arbitration preserves malicious outcome when multiple agents agree', async () => {
    const results = [
      createResult('socrates', 'malicious', 0.9, { safe: 0.04, suspicious: 0.16, malicious: 0.8 }),
      createResult('plato', 'malicious', 0.88, { safe: 0.06, suspicious: 0.12, malicious: 0.82 }),
      createResult('aristotle', 'suspicious', 0.7, { safe: 0.22, suspicious: 0.56, malicious: 0.22 })
    ];

    const triggerMetrics = buildDebateTriggerMetrics(results, 0.05, 0.05);
    const session = await debateProtocol.initiateDebate(request.id, results, request, triggerMetrics);

    expect(session.finalVerdict?.decision).toBe('malicious');
    expect(session.finalVerdict?.aggregatedDistribution.malicious).toBeGreaterThan(0.5);
  });
});
