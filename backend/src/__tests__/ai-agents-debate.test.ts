import { DebateProtocol } from '../ai-agents/debate/debate-protocol';
import { MessageBus } from '../ai-agents/core/message-bus';
import { buildDebateTriggerMetrics } from '../ai-agents/core/scoring';
import { AnalysisResult, TrafficRequest, ModelResponse } from '../ai-agents/core/types';
import { createMultiAgentSystem } from '../ai-agents';

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
    expect(session.finalVerdict?.aggregatedDistribution?.malicious).toBeGreaterThan(0.5);
  });

  test('debate rounds call the model and carry its output — agents genuinely discuss, not canned templates', async () => {
    const calls: string[] = [];
    const sampling: Array<{ temperature?: number; maxTokens?: number }> = [];
    messageBus.setModelRequestHandler(async (req): Promise<ModelResponse> => {
      calls.push(req.prompt);
      sampling.push({ temperature: req.temperature, maxTokens: req.maxTokens });
      return {
        id: req.id,
        content: `${req.context.role} argues from the model: round artifact ${calls.length}`,
        model: 'test-model',
        tier: 'cloud',
        latency: 1,
        tokensUsed: 0,
        sanitized: false
      };
    });

    const results = [
      createResult('socrates', 'malicious', 0.9, { safe: 0.05, suspicious: 0.15, malicious: 0.8 }),
      createResult('plato', 'safe', 0.8, { safe: 0.8, suspicious: 0.12, malicious: 0.08 }),
      createResult('aristotle', 'suspicious', 0.7, { safe: 0.2, suspicious: 0.55, malicious: 0.25 })
    ];
    const triggerMetrics = buildDebateTriggerMetrics(results, 0.05, 0.05);
    const session = await debateProtocol.initiateDebate(request.id, results, request, triggerMetrics);

    // Every executed round actually invoked the model.
    expect(session.rounds.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThanOrEqual(session.rounds.length);
    // The agents argued using the model's real output, not the deterministic fallback.
    expect(session.rounds.every((r) => r.argument.includes('argues from the model'))).toBe(true);
    // From round 2 on, later speakers saw earlier arguments in context — real response.
    if (session.rounds.length > 1) {
      expect(calls.some((p) => p.includes('PREVIOUS ARGUMENTS'))).toBe(true);
    }
    // The L5 (deep) thinking depth drove the model's sampling budget — depth is real,
    // not cosmetic.
    expect(sampling[0]?.temperature).toBe(0.4);
    expect(sampling[0]?.maxTokens).toBe(2000);
  });

  test('layer cascade activates deeper layers only when their activation conditions hold', () => {
    // White-box: the cascade is what makes the seven layers differentiated teams
    // (distinct thinking depth + activation triggers), not a flat always-on pipeline.
    const sys: any = createMultiAgentSystem();
    const orch: any = sys.orchestrator;

    const safeResults = [
      createResult('socrates', 'safe', 0.9, { safe: 0.9, suspicious: 0.07, malicious: 0.03 }),
      createResult('plato', 'safe', 0.9, { safe: 0.9, suspicious: 0.07, malicious: 0.03 }),
      createResult('aristotle', 'safe', 0.9, { safe: 0.9, suspicious: 0.07, malicious: 0.03 })
    ];
    const benign = orch.evaluateLayerCascade({
      results: safeResults,
      primaryConfidence: 0.9,
      threatType: 'benign',
      debateTriggered: false,
      escalationReached: false,
      forceDebate: false
    });
    expect(benign).toEqual(expect.arrayContaining([1, 2, 7]));
    expect(benign).not.toContain(5); // no disagreement → no debate layer
    expect(benign).not.toContain(6); // no escalation → no deliberative cloud layer

    const conflictResults = [
      createResult('socrates', 'malicious', 0.9, { safe: 0.05, suspicious: 0.15, malicious: 0.8 }),
      createResult('plato', 'safe', 0.8, { safe: 0.8, suspicious: 0.12, malicious: 0.08 }),
      createResult('aristotle', 'suspicious', 0.7, { safe: 0.2, suspicious: 0.55, malicious: 0.25 })
    ];
    const engaged = orch.evaluateLayerCascade({
      results: conflictResults,
      primaryConfidence: 0.6,
      threatType: 'sqli',
      debateTriggered: true,
      escalationReached: true,
      forceDebate: false
    });
    expect(engaged).toContain(3); // high risk → scene traversal engages
    expect(engaged).toContain(5); // disagreement → debate engages
    expect(engaged).toContain(6); // escalation → deliberative cloud engages
  });

  test('heterogeneous routing: fast triage role targets the local tier, verify roles stay cloud', () => {
    // Socrates (fast triage) is configured on the local base model; Plato /
    // Aristotle / arbitrator stay on cloud. This is what makes the debate a real
    // local-vs-cloud disagreement rather than one model arguing with itself.
    const sys: any = createMultiAgentSystem();
    const orch: any = sys.orchestrator;
    const configs = orch.createAgentConfigs();

    const socratesTier = configs.socrates.modelConfig.provider === 'ollama' ? 'local' : 'cloud';
    const platoTier = configs.plato.modelConfig.provider === 'ollama' ? 'local' : 'cloud';
    const aristotleTier = configs.aristotle.modelConfig.provider === 'ollama' ? 'local' : 'cloud';

    expect(socratesTier).toBe('local');
    expect(platoTier).toBe('cloud');
    expect(aristotleTier).toBe('cloud');
  });
});
