import { ModelRouter } from '../../ai-agents/models/model-router';
import { cloneDefaultConfig } from '../../services/platform-config.service';
import type { ModelRequest } from '../../ai-agents/core/types';

function buildRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    id: 'model-router-hot-path-1',
    prompt: 'Classify this request quickly.',
    context: { tenantId: 'tenant-router' },
    tier: 'cloud',
    priority: 'high',
    timeout: 1000,
    sanitizationLevel: 'basic',
    ...overrides
  };
}

describe('ModelRouter hot-path routing', () => {
  it('forces primary hot-path analysis to local even when global routing is cloud_only', () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.fallbackAllowed = true;

    const decision = router.makeRoutingDecision(
      buildRequest({ analysisPurpose: 'primary', routeModeOverride: 'cloud_only' }),
      config
    );

    expect(decision.tier).toBe('local');
    expect(decision.reason).toContain('hot path');
  });

  it('keeps cloud routing available for async learning verification', () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';

    const decision = router.makeRoutingDecision(
      buildRequest({ analysisPurpose: 'learning_verification' }),
      config
    );

    expect(decision.tier).toBe('cloud');
  });

  it('does not force a local-tier agent to local when an explicit cloud_only override is set', () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';

    const decision = router.makeRoutingDecision(
      // Non-hot, non-learning purpose so the per-agent local tier would normally
      // be honoured — but the explicit cloud_only override must win.
      buildRequest({ tier: 'local', analysisPurpose: 'deep_analysis', routeModeOverride: 'cloud_only' }),
      config
    );

    expect(decision.tier).toBe('cloud');
  });

  it('does not force a local-tier agent to local under hybrid_verify (keeps the cloud half)', () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'hybrid_verify';

    const decision = router.makeRoutingDecision(
      buildRequest({ tier: 'local', analysisPurpose: 'deep_analysis' }),
      config
    );

    expect(decision.tier).toBe('hybrid');
  });
});
