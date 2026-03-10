import http from 'http';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import { platformConfigService } from './platform-config.service';
import logger from '../utils/logger';
import {
  HttpTrafficEvaluateRequest,
  HttpTrafficEvaluateResponse,
  HttpTrafficThreat
} from './http-traffic-evaluator.service';

export interface FastpathCheckRequest {
  tenantId?: string;
  key: string;
  windowMs: number;
  limit: number;
  sourceIp?: string;
  sessionId?: string;
  headers?: Record<string, any>;
  protocol?: string;
}

export interface FastpathCheckResponse {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  resetAtMs: number;
  decisionSource: string;
  riskFlags: string[];
}

export interface FastpathRuntimeSettings {
  tenantId: string;
  enabled: boolean;
  baseUrl: string;
  transport: 'tcp' | 'unix';
  socketPath: string | null;
  timeoutMs: number;
  fallbackEnabled: boolean;
  trafficShadowEnabled: boolean;
  trafficShadowSampleRatePct: number;
  trafficMaxBodyBytes: number;
}

function normalizeTransport(value: unknown): FastpathRuntimeSettings['transport'] {
  return String(value || '').trim().toLowerCase() === 'unix' ? 'unix' : 'tcp';
}

class FastpathClientService {
  private readonly clients = new Map<string, AxiosInstance>();
  private readonly httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 512,
    maxFreeSockets: 64
  });
  private readonly httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 512,
    maxFreeSockets: 64
  });

  async getRuntimeSettings(tenantId = 'global'): Promise<FastpathRuntimeSettings> {
    const config = await platformConfigService.getConfig(tenantId);
    const baseUrl = String(process.env.FASTPATH_URL || config.fastpath.baseUrl || 'http://fastpath:8081').trim();
    const socketPath = String(process.env.FASTPATH_SOCKET_PATH || config.fastpath.socketPath || '').trim() || null;
    const requestedTransport = normalizeTransport(process.env.FASTPATH_TRANSPORT || config.fastpath.transport);
    const transport = requestedTransport === 'unix' && socketPath ? 'unix' : 'tcp';
    const timeoutMs = Number(process.env.FASTPATH_TIMEOUT_MS || config.fastpath.timeoutMs || 1500);

    return {
      tenantId,
      enabled: config.fastpath.enabled,
      baseUrl,
      transport,
      socketPath,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(timeoutMs, 100) : config.fastpath.timeoutMs,
      fallbackEnabled: config.fastpath.fallbackEnabled,
      trafficShadowEnabled: config.fastpath.trafficShadowEnabled,
      trafficShadowSampleRatePct: config.fastpath.trafficShadowSampleRatePct,
      trafficMaxBodyBytes: config.fastpath.trafficMaxBodyBytes
    };
  }

  async health(tenantId = 'global'): Promise<boolean> {
    const runtime = await this.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return false;
    }

    try {
      const client = this.getClient(runtime);
      const response = await client.get('/healthz');
      return response.status < 400;
    } catch {
      return false;
    }
  }

  async checkRate(input: FastpathCheckRequest): Promise<FastpathCheckResponse | null> {
    return this.check('/v1/rate/check', input);
  }

  async checkSocket(input: FastpathCheckRequest): Promise<FastpathCheckResponse | null> {
    return this.check('/v1/socket/check', input);
  }

  async flush(tenantId = 'global'): Promise<Record<string, any> | null> {
    const runtime = await this.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return null;
    }

    try {
      const response = await this.getClient(runtime).post('/v1/batch/flush', { tenantId });
      return response.data;
    } catch (error: any) {
      logger.warn('Fastpath flush unavailable', {
        tenantId,
        error: error?.message
      });
      return null;
    }
  }

  async evaluateHttpTraffic(input: HttpTrafficEvaluateRequest): Promise<HttpTrafficEvaluateResponse | null> {
    const tenantId = input.tenantId || 'global';
    const result = await this.postRaw(tenantId, '/v1/traffic/http/evaluate', input as unknown as Record<string, any>);
    if (!result) {
      return null;
    }

    if (result.status >= 400) {
      logger.warn('Fastpath HTTP traffic evaluation returned non-success status', {
        tenantId,
        requestId: input.requestId,
        status: result.status
      });
      return null;
    }

    const threats = Array.isArray(result.data?.threats)
      ? result.data.threats.map((threat: any): HttpTrafficThreat => ({
          type: String(threat?.type || 'unknown'),
          severity: ['low', 'medium', 'high', 'critical'].includes(String(threat?.severity || ''))
            ? threat.severity
            : 'medium',
          description: String(threat?.description || '')
        }))
      : [];

    return {
      protocol: 'http',
      verdict: result.data?.verdict === 'block' ? 'block' : 'allow',
      matchedRule: result.data?.matchedRule ? String(result.data.matchedRule) : null,
      threats,
      truncated: Boolean(result.data?.truncated ?? input.truncated),
      decisionSource: String(result.data?.decisionSource || 'rust-fastpath-traffic-http'),
      processingTimeMicros: Number(result.data?.processingTimeMicros || 0)
    };
  }

  async postRaw(
    tenantId: string,
    path: string,
    payload: Record<string, any>
  ): Promise<{ status: number; data: any } | null> {
    const runtime = await this.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return null;
    }

    try {
      const response = await this.getClient(runtime).post(path, payload);
      return {
        status: response.status,
        data: response.data
      };
    } catch (error: any) {
      if (!runtime.fallbackEnabled) {
        throw error;
      }
      logger.warn('Fastpath raw request unavailable', {
        tenantId,
        path,
        error: error?.message
      });
      return null;
    }
  }

  private async check(path: string, input: FastpathCheckRequest): Promise<FastpathCheckResponse | null> {
    const tenantId = input.tenantId || 'global';
    const runtime = await this.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return null;
    }

    try {
      const response = await this.getClient(runtime).post(path, {
        tenantId,
        key: input.key,
        windowMs: input.windowMs,
        limit: input.limit,
        sourceIp: input.sourceIp,
        sessionId: input.sessionId,
        headers: input.headers || {},
        protocol: input.protocol || 'http'
      });

      if (response.status >= 400) {
        throw new Error(`fastpath status ${response.status}`);
      }

      const resetAtMs = Number(response.data?.resetAtMs || 0) || (Date.now() + input.windowMs);
      const resetAt = String(response.data?.resetAt || new Date(resetAtMs).toISOString());

      return {
        allowed: Boolean(response.data?.allowed),
        remaining: Number(response.data?.remaining || 0),
        resetAt,
        resetAtMs,
        decisionSource: String(response.data?.decisionSource || 'fastpath'),
        riskFlags: Array.isArray(response.data?.riskFlags) ? response.data.riskFlags : []
      };
    } catch (error: any) {
      if (!runtime.fallbackEnabled) {
        throw error;
      }
      logger.warn('Fastpath unavailable, falling back to local limiter', {
        tenantId,
        path,
        error: error?.message
      });
      return null;
    }
  }

  private getClient(runtime: FastpathRuntimeSettings): AxiosInstance {
    const key = [
      runtime.transport,
      runtime.transport === 'unix' ? runtime.socketPath || 'missing-socket' : runtime.baseUrl,
      runtime.timeoutMs
    ].join('|');

    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const client = axios.create({
      baseURL: runtime.transport === 'unix' ? 'http://unix' : runtime.baseUrl,
      timeout: runtime.timeoutMs,
      socketPath: runtime.transport === 'unix' ? runtime.socketPath || undefined : undefined,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      validateStatus: () => true
    });

    this.clients.set(key, client);
    return client;
  }
}

export const fastpathClientService = new FastpathClientService();
