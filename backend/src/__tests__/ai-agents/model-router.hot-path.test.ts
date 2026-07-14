import { ModelRouter } from '../../ai-agents/models/model-router';
import { cloneDefaultConfig, platformConfigService } from '../../services/platform-config.service';
import type { ModelRequest } from '../../ai-agents/core/types';

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: { log: jest.fn().mockResolvedValue(undefined) }
}));

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

  it('uses the tenant preferred model for non-hot cloud routing', () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.preferredModelId = 'glm-5';

    const decision = router.makeRoutingDecision(
      buildRequest({ analysisPurpose: 'learning_verification' }),
      config
    );

    expect(decision.tier).toBe('cloud');
    expect(decision.model).toBe('glm-5');
  });

  it('keeps an explicit stage model override above the tenant preference', () => {
    const router = new ModelRouter({
      stageModelOverrides: { learning_verification: 'stage-verifier-model' }
    });
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.preferredModelId = 'glm-5';

    const decision = router.makeRoutingDecision(
      buildRequest({ analysisPurpose: 'learning_verification' }),
      config
    );

    expect(decision.model).toBe('stage-verifier-model');
  });

  it('falls back to the configured cloud default for an invalid tenant preference', () => {
    const router = new ModelRouter({
      cloudModel: {
        provider: 'custom',
        model: 'catalog-default-model',
        apiKey: '',
        baseURL: 'https://models.example.test'
      }
    });
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.preferredModelId = 'not-a-catalog-model';

    const decision = router.makeRoutingDecision(
      buildRequest({ analysisPurpose: 'learning_verification' }),
      config
    );

    expect(decision.model).toBe('catalog-default-model');
  });

  it('does not pass an invalid persisted preference to the cloud client', async () => {
    const router = new ModelRouter({
      cloudModel: {
        provider: 'custom',
        model: 'catalog-default-model',
        apiKey: '',
        baseURL: 'https://models.example.test'
      }
    });
    const generateCompletion = jest.fn().mockResolvedValue('default model response');
    (router as any).cloudClient = { generateCompletion };
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.preferredModelId = 'not-a-catalog-model';
    const configSpy = jest.spyOn(platformConfigService, 'getConfig').mockResolvedValue(config);

    try {
      const response = await router.route(buildRequest({ analysisPurpose: 'learning_verification' }));

      expect(generateCompletion).toHaveBeenCalledWith(
        'Classify this request quickly.',
        'catalog-default-model',
        undefined
      );
      expect(response.model).toBe('catalog-default-model');
    } finally {
      configSpy.mockRestore();
    }
  });

  it('passes the persisted tenant preference to the cloud client', async () => {
    const router = new ModelRouter();
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.preferredModelId = 'glm-5';
    const generateCompletion = jest.fn().mockResolvedValue('preferred model response');
    (router as any).cloudClient = { generateCompletion };
    const configSpy = jest.spyOn(platformConfigService, 'getConfig').mockResolvedValue(config);

    try {
      const response = await router.route(buildRequest({ analysisPurpose: 'learning_verification' }));

      expect(generateCompletion).toHaveBeenCalledWith(
        'Classify this request quickly.',
        'glm-5',
        undefined
      );
      expect(response.model).toBe('glm-5');
    } finally {
      configSpy.mockRestore();
    }
  });

  it('loads and applies model preferences independently for each tenant', async () => {
    const router = new ModelRouter();
    const generateCompletion = jest.fn().mockResolvedValue('tenant-specific response');
    (router as any).cloudClient = { generateCompletion };
    const configSpy = jest.spyOn(platformConfigService, 'getConfig').mockImplementation(async (tenantId) => {
      const config = cloneDefaultConfig();
      config.aiRouting.mode = 'cloud_only';
      config.aiRouting.preferredModelId = tenantId === 'tenant-a' ? 'glm-5' : 'hunyuan-t1';
      return config;
    });

    try {
      const tenantAResponse = await router.route(buildRequest({
        id: 'tenant-a-request',
        context: { tenantId: 'tenant-a' },
        analysisPurpose: 'learning_verification'
      }));
      const tenantBResponse = await router.route(buildRequest({
        id: 'tenant-b-request',
        context: { tenantId: 'tenant-b' },
        analysisPurpose: 'learning_verification'
      }));

      expect(configSpy).toHaveBeenNthCalledWith(1, 'tenant-a');
      expect(configSpy).toHaveBeenNthCalledWith(2, 'tenant-b');
      expect(tenantAResponse.model).toBe('glm-5');
      expect(tenantBResponse.model).toBe('hunyuan-t1');
      expect(generateCompletion.mock.calls.map((call) => call[1])).toEqual(['glm-5', 'hunyuan-t1']);
    } finally {
      configSpy.mockRestore();
    }
  });

  it('does not fall back to cloud when primary hot-path local execution fails', async () => {
    const router = new ModelRouter();
    const generateCompletion = jest.fn().mockResolvedValue('must not be called');
    (router as any).localEngine = {
      analyzeProblem: jest.fn().mockRejectedValue(new Error('local execution failed'))
    };
    (router as any).cloudClient = { generateCompletion };
    const config = cloneDefaultConfig();
    config.aiRouting.mode = 'cloud_only';
    config.aiRouting.fallbackAllowed = true;
    config.aiRouting.preferredModelId = 'glm-5';
    const configSpy = jest.spyOn(platformConfigService, 'getConfig').mockResolvedValue(config);

    try {
      await expect(router.route(buildRequest({ analysisPurpose: 'primary' })))
        .rejects.toThrow('local execution failed');
      expect(generateCompletion).not.toHaveBeenCalled();
    } finally {
      configSpy.mockRestore();
    }
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
