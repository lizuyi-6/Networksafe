import { randomUUID } from 'crypto';
import { Request } from 'express';
import logger from '../utils/logger';
import { fastpathClientService } from './fastpath-client.service';
import {
  hashTrafficSampleKey,
  HttpTrafficEvaluateRequest,
  httpTrafficEvaluatorService,
  normalizeThreatSignatures
} from './http-traffic-evaluator.service';
import { platformConfigService } from './platform-config.service';
import { sanitizeIncomingRequest, sanitizeDetectionText, type SafeIncomingRequest } from '../security/detection-secret-boundary';

interface PendingSnapshot {
  tenantId: string;
  requestId: string;
  method: string;
  url: string;
  httpVersion: string;
  headers: Record<string, string>;
  rawBody: Buffer;
  sourceIp: string;
  contentType: string;
}

interface ShadowTask {
  tenantId: string;
  request: HttpTrafficEvaluateRequest;
}

interface FastpathShadowWorkerConfig {
  concurrency: number;
  maxQueueSize: number;
}

const DEFAULT_WORKER_CONFIG: FastpathShadowWorkerConfig = {
  concurrency: 2,
  maxQueueSize: 512
};

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join(', ');
  }
  return String(value ?? '');
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.entries(headers || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key) {
      return acc;
    }
    acc[key.toLowerCase()] = normalizeHeaderValue(value);
    return acc;
  }, {});
}

function normalizeHttpVersion(version: string): string {
  const trimmed = String(version || '').trim();
  if (!trimmed) {
    return 'HTTP/1.1';
  }
  if (/^HTTP\//i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return `HTTP/${trimmed}`;
}

function isTextualContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') ||
    normalized.includes('application/x-www-form-urlencoded') ||
    normalized.startsWith('text/')
  );
}

function isSkippedRequest(req: Request, contentType: string): boolean {
  if (req.method === 'OPTIONS') {
    return true;
  }

  const path = req.path || req.originalUrl || '';
  if (path === '/health' || path === '/api/health') {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return normalized.startsWith('multipart/') || normalized.includes('application/octet-stream');
}

function resolveSourceIp(req: Request): string {
  return String(
    req.ip ||
    req.socket?.remoteAddress ||
    (req.connection as any)?.remoteAddress ||
    ''
  ).trim();
}

function fallbackBodyBytes(req: Request): Buffer {
  if (Buffer.isBuffer((req as any).rawBody)) {
    return Buffer.from((req as any).rawBody);
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }

  return Buffer.alloc(0);
}

function buildSnapshot(req: Request): PendingSnapshot | null {
  const safe = sanitizeIncomingRequest(req);
  const contentType = safe.contentType;
  if (isSkippedRequest(req, contentType)) {
    return null;
  }

  const rawBody = isTextualContentType(contentType)
    ? Buffer.from(safe.body, 'utf8')
    : Buffer.alloc(0);
  const requestId = safe.headers['x-request-id'] || String(req.headers['x-request-id'] || randomUUID());
  const tenantId = String((req as any).user?.tenantId || 'global');

  return {
    tenantId,
    requestId,
    method: req.method,
    url: safe.url,
    httpVersion: normalizeHttpVersion(req.httpVersion),
    headers: safe.headers,
    rawBody,
    sourceIp: safe.sourceIp,
    contentType
  };
}

class FastpathTrafficShadowService {
  private readonly queue: ShadowTask[] = [];
  private readonly workerConfig: FastpathShadowWorkerConfig = { ...DEFAULT_WORKER_CONFIG };
  private activeWorkers = 0;
  private pendingSubmissions = 0;
  private idleResolvers: Array<() => void> = [];

  submitFromRequest(req: Request): void {
    const snapshot = buildSnapshot(req);
    if (!snapshot) {
      return;
    }

    this.pendingSubmissions += 1;
    void this.maybeQueueSnapshot(snapshot).finally(() => {
      this.pendingSubmissions = Math.max(0, this.pendingSubmissions - 1);
      this.resolveIdle();
    });
  }

  resetForTests(): void {
    this.queue.length = 0;
    this.activeWorkers = 0;
    this.pendingSubmissions = 0;
    this.workerConfig.concurrency = DEFAULT_WORKER_CONFIG.concurrency;
    this.workerConfig.maxQueueSize = DEFAULT_WORKER_CONFIG.maxQueueSize;
    this.resolveIdle();
  }

  setWorkerConfigForTests(config: Partial<FastpathShadowWorkerConfig>): void {
    if (typeof config.concurrency === 'number') {
      this.workerConfig.concurrency = Math.max(0, Math.floor(config.concurrency));
    }
    if (typeof config.maxQueueSize === 'number') {
      this.workerConfig.maxQueueSize = Math.max(1, Math.floor(config.maxQueueSize));
    }
  }

  async awaitIdleForTests(): Promise<void> {
    if (this.queue.length === 0 && this.activeWorkers === 0 && this.pendingSubmissions === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private async maybeQueueSnapshot(snapshot: PendingSnapshot): Promise<void> {
    try {
      const config = await platformConfigService.getConfig(snapshot.tenantId);
      if (!config.fastpath.enabled || !config.fastpath.trafficShadowEnabled) {
        return;
      }

      const sampleRatePct = Math.max(0, Math.min(100, Number(config.fastpath.trafficShadowSampleRatePct || 0)));
      if (sampleRatePct <= 0) {
        return;
      }

      const sampleBucket = hashTrafficSampleKey({
        tenantId: snapshot.tenantId,
        requestId: snapshot.requestId,
        method: snapshot.method,
        url: snapshot.url
      });
      if (sampleBucket >= sampleRatePct) {
        return;
      }

      const maxBodyBytes = Math.max(0, Number(config.fastpath.trafficMaxBodyBytes || 65536));
      const rawBody = snapshot.rawBody.subarray(0, maxBodyBytes);
      const truncated = snapshot.rawBody.length > rawBody.length;

      this.enqueue({
        tenantId: snapshot.tenantId,
        request: {
          tenantId: snapshot.tenantId,
          requestId: snapshot.requestId,
          method: snapshot.method,
          url: snapshot.url,
          httpVersion: snapshot.httpVersion,
          headers: snapshot.headers,
          bodyBase64: rawBody.toString('base64'),
          sourceIp: snapshot.sourceIp,
          truncated
        }
      });
    } catch (error: any) {
      logger.warn('fastpath_traffic_shadow_error', {
        tenantId: snapshot.tenantId,
        requestId: snapshot.requestId,
        url: snapshot.url,
        error: error?.message || 'shadow_config_error'
      });
    }
  }

  private enqueue(task: ShadowTask): void {
    if (this.queue.length >= this.workerConfig.maxQueueSize) {
      logger.warn('fastpath_traffic_shadow_dropped', {
        tenantId: task.tenantId,
        requestId: task.request.requestId,
        url: task.request.url,
        queueDepth: this.queue.length,
        maxQueueSize: this.workerConfig.maxQueueSize
      });
      return;
    }

    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    while (this.activeWorkers < this.workerConfig.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }

      this.activeWorkers += 1;
      void this.processTask(task).finally(() => {
        this.activeWorkers = Math.max(0, this.activeWorkers - 1);
        this.drain();
        this.resolveIdle();
      });
    }

    this.resolveIdle();
  }

  private async processTask(task: ShadowTask): Promise<void> {
    const baseline = httpTrafficEvaluatorService.evaluateBaseline(task.request);
    const fastpath = await fastpathClientService.evaluateHttpTraffic(task.request);

    if (!fastpath) {
      logger.warn('fastpath_traffic_shadow_error', {
        tenantId: task.tenantId,
        requestId: task.request.requestId,
        url: task.request.url,
        error: 'fastpath_unavailable'
      });
      return;
    }

    const baselineThreats = normalizeThreatSignatures(baseline.threats);
    const fastpathThreats = normalizeThreatSignatures(fastpath.threats);
    const mismatch =
      baseline.verdict !== fastpath.verdict ||
      baselineThreats.join('|') !== fastpathThreats.join('|');

    if (mismatch) {
      logger.warn('fastpath_traffic_shadow_mismatch', {
        tenantId: task.tenantId,
        requestId: task.request.requestId,
        url: task.request.url,
        baselineVerdict: baseline.verdict,
        fastpathVerdict: fastpath.verdict,
        baselineMatchedRule: baseline.matchedRule,
        fastpathMatchedRule: fastpath.matchedRule,
        baselineThreats,
        fastpathThreats,
        truncated: task.request.truncated
      });
    }
  }

  private resolveIdle(): void {
    if (this.queue.length > 0 || this.activeWorkers > 0 || this.pendingSubmissions > 0) {
      return;
    }

    while (this.idleResolvers.length > 0) {
      const resolve = this.idleResolvers.shift();
      resolve?.();
    }
  }
}

export const fastpathTrafficShadowService = new FastpathTrafficShadowService();
