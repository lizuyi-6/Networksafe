/**
 * AetherGuard - AI endpoint configuration API
 *
 * Provides tenant-scoped endpoint persistence, routing-aware chat proxying,
 * and masked device sync output.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { assertOutboundUrlAllowedResolvedPinned, checkOutboundUrl, createPinnedDnsContext } from '../../security/outbound-url-guard';
import logger from '../../utils/logger';
import {
  PLATFORM_API_CONFIG,
  PLATFORM_MODELS,
  getModelsForTier,
  getPlatformChatPath,
  canUseModel,
  canUseCustomEndpoint,
  normalizePlan,
  getDefaultModel
} from '../../utils/model-access';
import { aiEndpointStoreService, AIEndpointPurpose, AIEndpointRecord, AIEndpointType } from '../../services/ai-endpoint-store.service';
import { platformConfigService } from '../../services/platform-config.service';
import {
  PlatformCloudInvocationError,
  PlatformChatMessage,
  invokePlatformCloudModel
} from '../../services/platform-cloud-provider.service';

const router = Router();

router.use(authenticate);

const ALLOWED_AI_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.lkeap.cloud.tencent.com'
];

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type UpstreamInvocationError = Error & {
  diagnostics?: {
    provider?: string;
    upstreamStatus?: number;
    upstreamPath?: string;
    requestId?: string;
  };
};

function extractDiagnostics(value: any): UpstreamInvocationError['diagnostics'] {
  if (value && typeof value === 'object' && 'diagnostics' in value) {
    return (value as UpstreamInvocationError).diagnostics;
  }
  return undefined;
}

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

function isPrivateHost(hostname: string): boolean {
  // SECURITY FIX (audit 2026-08, AG-B02): superseded by the shared outbound
  // URL guard for validation; kept only for the whitelist warning below.
  return hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('10.');
}

function validateAiUrl(url: string, options?: { allowPrivate?: boolean }): { valid: boolean; error?: string } {
  // SECURITY FIX (audit 2026-08, AG-B02): `type=ollama` allowPrivate used to
  // permit 169.254.169.254 (cloud metadata) — an admin-configurable SSRF into
  // instance credentials. The shared guard blocks metadata endpoints
  // UNCONDITIONALLY, even with allowPrivate (self-hosted LAN Ollama stays
  // allowed).
  const check = checkOutboundUrl(url, options);
  if (!check.allowed) {
    return { valid: false, error: check.reason };
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isWhitelisted = ALLOWED_AI_HOSTS.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
    if (!isWhitelisted && !isPrivateHost(hostname)) {
      logger.warn('AI endpoint URL not in whitelist', { url, hostname });
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'backend.invalid_url_format' };
  }
}

function maskEndpoint(endpoint: AIEndpointRecord) {
  return {
    ...endpoint,
    apiKey: endpoint.apiKey ? '******' : ''
  };
}

function redactText(content: string): string {
  return content
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._-]+\b/gi, '[redacted-token]');
}

function redactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    content: redactText(message.content)
  }));
}

function normalizeMessages(messages: any[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role === 'system' || message.role === 'assistant' ? message.role : 'user',
    content: String(message.content || '')
  }));
}

function normalizePurpose(value: any, fallback: AIEndpointPurpose = 'deep_analysis'): AIEndpointPurpose {
  return value === 'hot_path' || value === 'deep_analysis' ? value : fallback;
}

function localEndpointRequestUrl(endpoint: AIEndpointRecord): string {
  const base = endpoint.url.replace(/\/$/, '');
  if (base.endsWith('/api/chat') || base.endsWith('/api/generate') || base.endsWith('/v1/chat/completions')) {
    return base;
  }
  return `${base}/api/chat`;
}

async function invokeEndpoint(endpoint: AIEndpointRecord, messages: ChatMessage[]): Promise<{ content: string; latency: number; raw: any }> {
  // SECURITY FIX (R2-F002): resolve the endpoint hostname before invoking and
  // validate every resolved address (metadata endpoints always refused; the
  // literal-only save-time check could be bypassed by a DNS name whose A
  // record points at 169.254.169.254). Redirects are never followed below.
  // SECURITY (R2-F002 follow-up): the validated addresses are pinned into the
  // request agents so a DNS rebinding race (clean answer to the guard,
  // metadata answer to the connect) cannot split validation from connection.
  const resolved = await assertOutboundUrlAllowedResolvedPinned(endpoint.url, {
    allowPrivate: endpoint.type === 'ollama'
  });
  const pinned = createPinnedDnsContext(resolved);

  const startedAt = Date.now();

  try {
    if (endpoint.type === 'ollama') {
      const requestUrl = localEndpointRequestUrl(endpoint);
      const isGenerateEndpoint = requestUrl.endsWith('/api/generate');
      const response = await axios.post(
        requestUrl,
        isGenerateEndpoint
          ? {
              model: endpoint.modelName,
              prompt: messages.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
              stream: false
            }
          : {
              model: endpoint.modelName,
              messages,
              stream: false
            },
        {
          timeout: endpoint.timeout,
          maxRedirects: 0,
          lookup: pinned.lookup,
          httpAgent: pinned.httpAgent,
          httpsAgent: pinned.httpsAgent
        }
      );

      const content = response.data?.message?.content || response.data?.response || '';
      return {
        content,
        latency: Date.now() - startedAt,
        raw: response.data
      };
    }

    const response = await axios.post(
      endpoint.url,
      {
        model: endpoint.modelName,
        messages,
        stream: false
      },
      {
        timeout: endpoint.timeout,
        maxRedirects: 0,
        lookup: pinned.lookup,
        httpAgent: pinned.httpAgent,
        httpsAgent: pinned.httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {})
        }
      }
    );

    const content = response.data?.choices?.[0]?.message?.content || response.data?.content || response.data?.result || '';
    return {
      content,
      latency: Date.now() - startedAt,
      raw: response.data
    };
  } catch (error: any) {
    const requestUrl = endpoint.type === 'ollama' ? localEndpointRequestUrl(endpoint) : endpoint.url;
    const invocationError = new Error(
      error.response?.data?.error?.message
      || error.response?.data?.message
      || error.message
      || 'Endpoint invocation failed'
    ) as UpstreamInvocationError;
    invocationError.diagnostics = {
      provider: endpoint.type,
      upstreamStatus: error.response?.status,
      upstreamPath: (() => {
        try {
          return new URL(requestUrl).pathname;
        } catch {
          return requestUrl;
        }
      })(),
      requestId: error.response?.data?.request_id || error.response?.data?.requestId
    };
    throw invocationError;
  }
}

async function invokePlatformCloud(modelId: string, messages: ChatMessage[]) {
  return invokePlatformCloudModel(modelId, messages as PlatformChatMessage[], {
    maxTokens: PLATFORM_MODELS.find((model) => model.id === modelId)?.maxTokens || 2048,
    temperature: 0.7
  });
}

router.get('/models', (req: Request, res: Response) => {
  try {
    const userPlan = normalizePlan((req as any).user?.plan);
    const availableModels = getModelsForTier(userPlan);
    const defaultModel = getDefaultModel(userPlan);

    const allModelsWithAccess = PLATFORM_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      category: model.category,
      maxTokens: model.maxTokens,
      available: availableModels.some((availableModel) => availableModel.id === model.id),
      minTier: model.minTier,
      isDefault: model.id === defaultModel.id
    }));

    res.json({
      success: true,
      plan: userPlan,
      canCustomize: canUseCustomEndpoint(userPlan),
      models: allModelsWithAccess,
      defaultModelId: defaultModel.id
    });
  } catch (error: any) {
    logger.error('Failed to get models list', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.post('/chat', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const userPlan = normalizePlan(req.user?.plan);
    const { modelId, messages } = req.body || {};
    const purpose = normalizePurpose(req.body?.purpose, 'deep_analysis');

    if (!modelId || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'backend.invalid_chat_request',
        message: 'modelId and messages are required'
      });
    }

    if (!canUseModel(userPlan, modelId)) {
      return res.status(403).json({
        success: false,
        error: 'backend.model_access_denied',
        message: `Subscription plan ${userPlan} cannot use model ${modelId}`
      });
    }

    const config = await platformConfigService.getConfig(tenantId);
    const normalizedMessages = normalizeMessages(messages);
    const redactedMessages = config.aiRouting.redactionEnabled ? redactMessages(normalizedMessages) : normalizedMessages;
    const preferredLocalEndpointId = purpose === 'hot_path'
      ? (config.aiRouting.localHotPathEndpointId || config.aiRouting.localEndpointId)
      : (config.aiRouting.localEndpointId || config.aiRouting.localHotPathEndpointId);
    const selectedLocalEndpoint = preferredLocalEndpointId
      ? await aiEndpointStoreService.getEndpoint(tenantId, preferredLocalEndpointId)
      : await aiEndpointStoreService.getEndpoint(tenantId, 'default-laptop');
    const selectedCloudEndpoint = config.aiRouting.cloudEndpointId
      ? await aiEndpointStoreService.getEndpoint(tenantId, config.aiRouting.cloudEndpointId)
      : null;
    const fallbackHotPathEndpoint = purpose === 'hot_path'
      ? (await aiEndpointStoreService.listEnabledEndpoints(tenantId, 'hot_path'))[0] || null
      : null;
    const effectiveLocalEndpoint = fallbackHotPathEndpoint || selectedLocalEndpoint;

    if (config.privacyMode === 'strict' || purpose === 'hot_path') {
      config.aiRouting.mode = 'local_only';
      config.aiRouting.fallbackAllowed = false;
    }

    const runLocal = async () => {
      if (!effectiveLocalEndpoint || !effectiveLocalEndpoint.enabled) {
        throw new Error('Local endpoint not available');
      }
      return invokeEndpoint(effectiveLocalEndpoint, normalizedMessages);
    };

    const runCloud = async () => {
      if (selectedCloudEndpoint && selectedCloudEndpoint.enabled) {
        return invokeEndpoint(selectedCloudEndpoint, redactedMessages);
      }
      return invokePlatformCloud(modelId, redactedMessages);
    };

    switch (config.aiRouting.mode) {
      case 'local_only': {
        const response = await runLocal();
        return res.json({
          success: true,
          content: response.content,
          model: effectiveLocalEndpoint?.modelName || 'local',
          usage: null,
          latency: response.latency,
          route: 'local_only',
          purpose
        });
      }
      case 'local_preferred': {
        try {
          const response = await runLocal();
          return res.json({
            success: true,
            content: response.content,
            model: effectiveLocalEndpoint?.modelName || 'local',
            usage: null,
            latency: response.latency,
            route: 'local_preferred',
            purpose
          });
        } catch (localError: any) {
          if (!config.aiRouting.fallbackAllowed || config.privacyMode === 'strict') {
            throw localError;
          }

          const response = await runCloud();
          const diagnostics = extractDiagnostics(response);
          return res.json({
            success: true,
            content: response.content,
            model: selectedCloudEndpoint?.modelName || modelId,
            usage: 'usage' in response ? response.usage : null,
            latency: response.latency,
            route: 'local_preferred_fallback',
            purpose,
            provider: diagnostics?.provider || selectedCloudEndpoint?.type || PLATFORM_API_CONFIG.providerId,
            upstreamPath: diagnostics?.upstreamPath || getPlatformChatPath(),
            requestId: diagnostics?.requestId
          });
        }
      }
      case 'hybrid_verify': {
        const localResponse = await runLocal();
        const cloudResponse = await runCloud();
        const diagnostics = extractDiagnostics(cloudResponse);
        return res.json({
          success: true,
          content: `Local analysis:\n${localResponse.content}\n\nCloud verification:\n${cloudResponse.content}`,
          model: `${effectiveLocalEndpoint?.modelName || 'local'}+${selectedCloudEndpoint?.modelName || modelId}`,
          usage: 'usage' in cloudResponse ? cloudResponse.usage : null,
          latency: localResponse.latency + cloudResponse.latency,
          route: 'hybrid_verify',
          purpose,
          provider: diagnostics?.provider || selectedCloudEndpoint?.type || PLATFORM_API_CONFIG.providerId,
          upstreamPath: diagnostics?.upstreamPath || getPlatformChatPath(),
          requestId: diagnostics?.requestId
        });
      }
      case 'cloud_only':
      default: {
        const response = await runCloud();
        const diagnostics = extractDiagnostics(response);
        return res.json({
          success: true,
          content: response.content,
          model: selectedCloudEndpoint?.modelName || modelId,
          usage: 'usage' in response ? response.usage : null,
          latency: response.latency,
          route: 'cloud_only',
          purpose,
          provider: diagnostics?.provider || selectedCloudEndpoint?.type || PLATFORM_API_CONFIG.providerId,
          upstreamPath: diagnostics?.upstreamPath || getPlatformChatPath(),
          requestId: diagnostics?.requestId
        });
      }
    }
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
    const diagnostics = error instanceof PlatformCloudInvocationError
      ? error.diagnostics
      : error.diagnostics;
    logger.error('AI chat proxy error', {
      error: errMsg,
      status: diagnostics?.upstreamStatus || error.response?.status,
      provider: diagnostics?.provider,
      upstreamPath: diagnostics?.upstreamPath,
      requestId: diagnostics?.requestId
    });

    res.status(diagnostics?.upstreamStatus || error.response?.status || 500).json({
      success: false,
      error: 'backend.ai_chat_error',
      message: errMsg,
      provider: diagnostics?.provider || PLATFORM_API_CONFIG.providerId,
      upstreamStatus: diagnostics?.upstreamStatus || error.response?.status,
      upstreamPath: diagnostics?.upstreamPath || getPlatformChatPath(),
      requestId: diagnostics?.requestId
    });
  }
});

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const endpoints = await aiEndpointStoreService.listEndpoints(tenantOf(req));
    res.json({
      success: true,
      endpoints: endpoints.map(maskEndpoint)
    });
  } catch (error: any) {
    logger.error('Failed to get AI endpoints', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.post('/', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userPlan = normalizePlan(req.user?.plan);
    if (!canUseCustomEndpoint(userPlan)) {
      return res.status(403).json({
        success: false,
        error: 'backend.custom_endpoints_require_enterprise',
        message: 'Custom model endpoints require enterprise tier'
      });
    }

    const { name, url, modelName, apiKey, type, timeout, priority, purpose } = req.body || {};
    if (!url) {
      return res.status(400).json({ success: false, error: 'backend.url_is_required' });
    }

    const endpointType = normalizeType(type, 'custom');
    const urlValidation = validateAiUrl(url, { allowPrivate: endpointType === 'ollama' });
    if (!urlValidation.valid) {
      logger.warn('Blocked AI endpoint with invalid URL', { url, error: urlValidation.error });
      return res.status(400).json({
        success: false,
        error: `Invalid URL: ${urlValidation.error}`
      });
    }

    const endpoint = await aiEndpointStoreService.createEndpoint(
      tenantOf(req),
      req.user?.userId || 'unknown',
      {
        name,
        url,
        modelName,
        apiKey,
        timeout,
        priority,
        type: endpointType,
        purpose: normalizePurpose(purpose, endpointType === 'ollama' ? 'deep_analysis' : 'deep_analysis')
      }
    );

    logger.info('AI endpoint added', { id: endpoint.id, url });
    res.json({ success: true, endpoint: maskEndpoint(endpoint) });
  } catch (error: any) {
    logger.error('Failed to add AI endpoint', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.put('/:id', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await aiEndpointStoreService.getEndpoint(tenantOf(req), id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
    }

    if (req.body?.url) {
      const endpointType = normalizeType(req.body?.type || existing.type, existing.type);
      const urlValidation = validateAiUrl(req.body.url, { allowPrivate: endpointType === 'ollama' });
      if (!urlValidation.valid) {
        logger.warn('Blocked AI endpoint update with invalid URL', { url: req.body.url, error: urlValidation.error });
        return res.status(400).json({
          success: false,
          error: `Invalid URL: ${urlValidation.error}`
        });
      }
    }

    const endpoint = await aiEndpointStoreService.updateEndpoint(
      tenantOf(req),
      id,
      req.user?.userId || 'unknown',
      req.body || {}
    );

    logger.info('AI endpoint updated', { id });
    res.json({ success: true, endpoint: endpoint ? maskEndpoint(endpoint) : null });
  } catch (error: any) {
    logger.error('Failed to update AI endpoint', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.delete('/:id', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (id === 'default-laptop') {
      return res.status(400).json({ success: false, error: 'backend.cannot_delete_default_endpoint' });
    }

    const deleted = await aiEndpointStoreService.deleteEndpoint(tenantOf(req), id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
    }

    logger.info('AI endpoint deleted', { id });
    res.json({
      success: true,
      message: `Endpoint ${id} deleted`
    });
  } catch (error: any) {
    logger.error('Failed to delete AI endpoint', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.post('/:id/test', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const endpoint = await aiEndpointStoreService.getEndpoint(tenantId, req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
    }

    const startTime = Date.now();

    try {
      const messages: ChatMessage[] = [{ role: 'user', content: 'test connection' }];
      const response = await invokeEndpoint(endpoint, messages);
      const latency = Date.now() - startTime;

      await aiEndpointStoreService.updateEndpoint(tenantId, endpoint.id, req.user?.userId || 'unknown', {
        lastTest: {
          success: true,
          latency,
          timestamp: new Date().toISOString()
        }
      });

      res.json({
        success: true,
        latency,
        status: 200,
        preview: response.content.slice(0, 200)
      });
    } catch (fetchError: any) {
      const latency = Date.now() - startTime;

      await aiEndpointStoreService.updateEndpoint(tenantId, endpoint.id, req.user?.userId || 'unknown', {
        lastTest: {
          success: false,
          latency,
          timestamp: new Date().toISOString()
        }
      });

      res.json({
        success: false,
        latency,
        error: fetchError.message
      });
    }
  } catch (error: any) {
    logger.error('Failed to test AI endpoint', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

router.get('/sync-config', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const [enabledEndpoints, config] = await Promise.all([
      aiEndpointStoreService.listEnabledEndpoints(tenantId),
      platformConfigService.getConfig(tenantId)
    ]);

    res.json({
      success: true,
      endpoints: enabledEndpoints.map((endpoint) => ({
        url: endpoint.url,
        model: endpoint.modelName,
        purpose: endpoint.purpose,
        // SECURITY (audit 2026-08, AUD-07-5): GET must NEVER return the raw
        // API key. The previous `syncMaskApiKeys` config gate allowed the
        // plaintext key to be served to any authenticated caller when the
        // flag was off — masking is now unconditional (write-only secret).
        key: endpoint.apiKey ? `***${endpoint.apiKey.slice(-4)}` : ''
      })),
      deviceGateway: config.deviceGateway
    });
  } catch (error: any) {
    logger.error('Failed to get sync config', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.internal_server_error' });
  }
});

function normalizeType(value: any, fallback: AIEndpointType): AIEndpointType {
  return value === 'ollama' || value === 'openai' || value === 'custom' ? value : fallback;
}

export async function getEndpointList(tenantId = 'global'): Promise<AIEndpointRecord[]> {
  return aiEndpointStoreService.listEnabledEndpoints(tenantId);
}

export default router;
