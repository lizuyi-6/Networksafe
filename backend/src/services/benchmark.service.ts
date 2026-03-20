import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import os from 'os';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { artifactStoreService } from './artifact-store.service';
import { aiEndpointStoreService, AIEndpointRecord } from './ai-endpoint-store.service';
import {
  apiRateLimitEngineService,
  hashRateLimitFingerprint,
  ApiRateLimitEngineLatencyStats
} from './api-rate-limit-engine.service';
import { fastpathClientService } from './fastpath-client.service';
import { platformConfigService } from './platform-config.service';
import { postgresShadowStoreService } from './postgres-shadow-store.service';
import enhancedRateLimiter from '../security/enhanced-rate-limiter.service';
import { socketRateLimitService } from './socket-rate-limit.service';
import {
  httpTrafficBenchmarkFixtures,
  HttpTrafficBenchmarkFixture,
  httpTrafficEvaluatorService,
  normalizeThreatSignatures
} from './http-traffic-evaluator.service';

const execFileAsync = promisify(execFile);

export type BenchmarkScenario =
  | 'fastpath-direct'
  | 'api-rate-limit-integrated'
  | 'socket-rate-limit-integrated'
  | 'traffic-http-shadow'
  | 'agent-footprint'
  | 'local-ai-hotpath'
  | 'full-suite'
  | 'strong-claims-smoke';

export type BenchmarkProfile = 'dev-smoke' | 'claim-bench';

export interface BenchmarkRunRecord {
  id: string;
  tenantId: string;
  scenario: string;
  profile: BenchmarkProfile;
  qps: number | null;
  p95LatencyMs: number | null;
  agentCpuPct: number | null;
  agentMemoryMb: number | null;
  localAiLatencyMs: number | null;
  report: Record<string, any>;
  createdAt: string;
}

interface ProbeLoadProfile {
  warmupRequests: number;
  measuredRequests: number;
  concurrency: number;
}

interface LatencyBenchmarkResult {
  available: boolean;
  qps: number | null;
  p95LatencyMs: number | null;
  totalRequests: number;
  warmupRequests: number;
  concurrency: number;
  totalDurationMs: number;
  decisionEngine?: string;
  fallbackCount?: number;
  redisScriptLatencyMs?: ApiRateLimitEngineLatencyStats;
  targetQpsMultiplier?: number;
  error?: string;
}

interface LatencyComparisonResult {
  available: boolean;
  baselineQps: number | null;
  fastpathQps: number | null;
  qpsMultiplier: number | null;
  baselineP95LatencyMs: number | null;
  fastpathP95LatencyMs: number | null;
  p95LatencyReductionPct: number | null;
  qpsMultiplierTarget: number;
  p95LatencyReductionTargetPct: number;
  meetsPhase1Target: boolean;
  reason?: string;
}

interface ProcessFootprintResult {
  available: boolean;
  agentCpuPct: number | null;
  agentMemoryMb: number | null;
  backendCpuPct: number;
  backendMemoryMb: number;
  pid?: number;
  command?: string;
  error?: string;
}

interface LocalAiHotPathResult {
  available: boolean;
  endpointId?: string;
  endpointPurpose?: string;
  p95LatencyMs: number | null;
  sampleCount: number;
  mode?: string;
  error?: string;
}

interface TrafficHttpContractResult {
  available: boolean;
  totalFixtures: number;
  mismatches: number;
  criticalMisses: number;
  mismatchedFixtures: Array<{
    name: string;
    baselineVerdict: string;
    fastpathVerdict: string;
    baselineThreats: string[];
    fastpathThreats: string[];
  }>;
  error?: string;
}

interface TrafficHttpShadowBenchmarkResult {
  available: boolean;
  contract: TrafficHttpContractResult;
  baseline: LatencyBenchmarkResult;
  fastpath: LatencyBenchmarkResult;
  comparison: LatencyComparisonResult;
  meetsPhase2Target: boolean;
  zeroMismatch: boolean;
  zeroCriticalMisses: boolean;
  reason?: string;
}

const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  maxSockets: 512,
  maxFreeSockets: 64
});

const HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 512,
  maxFreeSockets: 64
});

const PHASE1_QPS_MULTIPLIER_TARGET = 2;
const PHASE1_P95_REDUCTION_TARGET_PCT = 30;
const API_RATE_LIMIT_QPS_MULTIPLIER_TARGET = 10;
const API_BENCHMARK_KEY_POOL_SIZE = 64;

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return Number(sorted[index].toFixed(2));
}

function normalizeScenario(input: string): BenchmarkScenario {
  switch (input) {
    case 'fastpath-direct':
    case 'api-rate-limit-integrated':
    case 'socket-rate-limit-integrated':
    case 'traffic-http-shadow':
    case 'agent-footprint':
    case 'local-ai-hotpath':
    case 'full-suite':
    case 'strong-claims-smoke':
      return input;
    default:
      return 'full-suite';
  }
}

function normalizeProfile(input?: string): BenchmarkProfile {
  return input === 'claim-bench' ? 'claim-bench' : 'dev-smoke';
}

function benchmarkLoad(profile: BenchmarkProfile): ProbeLoadProfile {
  if (profile === 'claim-bench') {
    return {
      warmupRequests: 1000,
      measuredRequests: 20000,
      concurrency: 256
    };
  }

  return {
    warmupRequests: 100,
    measuredRequests: 2000,
    concurrency: 50
  };
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

class BenchmarkService {
  prepare(): void {
    platformConfigService.prepare();
  }

  private assertPrepared(): void {
    if (process.env.NODE_ENV === 'test') {
      this.prepare();
    }
  }

  async runScenario(
    tenantId: string,
    scenarioInput = 'full-suite',
    profileInput = 'dev-smoke'
  ): Promise<BenchmarkRunRecord> {
    this.assertPrepared();
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const scenario = normalizeScenario(scenarioInput);
    const profile = normalizeProfile(profileInput);
    const targets = this.resolveTargets(scenario);
    const config = await platformConfigService.getConfig(tenantId);

    const reportBody: Record<string, any> = {
      benchmarkId: id,
      tenantId,
      scenario,
      profile,
      createdAt,
      thresholds: {
        apiIntegratedQpsMultiplier: API_RATE_LIMIT_QPS_MULTIPLIER_TARGET,
        phase1QpsMultiplier: PHASE1_QPS_MULTIPLIER_TARGET,
        phase1P95ReductionPct: PHASE1_P95_REDUCTION_TARGET_PCT
      },
      environment: {
        platform: process.platform,
        release: os.release(),
        cpuCount: os.cpus().length,
        fastpath: config.fastpath,
        aiRouting: config.aiRouting
      },
      results: {}
    };

    if (targets.has('fastpath-direct')) {
      reportBody.results.fastpathDirect = await this.runFastpathDirectProbe(tenantId, profile);
    }
    if (targets.has('api-rate-limit-integrated')) {
      reportBody.results.apiIntegrated = await this.runApiIntegratedProbe(tenantId, profile);
      reportBody.results.apiIntegratedBaseline = await this.runApiIntegratedBaselineProbe(profile);
      reportBody.results.apiIntegratedComparison = this.compareLatencyResults(
        reportBody.results.apiIntegrated,
        reportBody.results.apiIntegratedBaseline,
        {
          qpsMultiplierTarget: API_RATE_LIMIT_QPS_MULTIPLIER_TARGET,
          passMode: 'qps-only'
        }
      );
    }
    if (targets.has('socket-rate-limit-integrated')) {
      reportBody.results.socketIntegrated = await this.runSocketIntegratedProbe(tenantId, profile);
      reportBody.results.socketIntegratedBaseline = await this.runSocketIntegratedBaselineProbe(profile);
      reportBody.results.socketIntegratedComparison = this.compareLatencyResults(
        reportBody.results.socketIntegrated,
        reportBody.results.socketIntegratedBaseline
      );
    }
    if (targets.has('traffic-http-shadow')) {
      reportBody.results.trafficHttpShadow = await this.runTrafficHttpShadowProbe(tenantId, profile);
    }
    if (targets.has('agent-footprint')) {
      reportBody.results.agentFootprint = await this.runAgentFootprintProbe();
    }
    if (targets.has('local-ai-hotpath')) {
      reportBody.results.localAiHotPath = await this.runLocalAiHotPathProbe(tenantId, profile);
    }

    reportBody.pass = {
      apiIntegratedPhase1: Boolean(reportBody.results.apiIntegratedComparison?.meetsPhase1Target),
      socketIntegratedPhase1: Boolean(reportBody.results.socketIntegratedComparison?.meetsPhase1Target),
      trafficHttpShadowPhase2Candidate: Boolean(reportBody.results.trafficHttpShadow?.meetsPhase2Target),
      phase1Overall:
        (reportBody.results.apiIntegratedComparison == null || reportBody.results.apiIntegratedComparison.meetsPhase1Target) &&
        (reportBody.results.socketIntegratedComparison == null || reportBody.results.socketIntegratedComparison.meetsPhase1Target) &&
        (reportBody.results.trafficHttpShadow == null || reportBody.results.trafficHttpShadow.meetsPhase2Target)
    };

    const artifact = await artifactStoreService.writeJson('benchmarks', id, reportBody);
    const primaryMetrics = this.selectPrimaryMetrics(scenario, reportBody.results);
    const row = {
      id,
      tenant_id: tenantId,
      scenario,
      qps: primaryMetrics.qps,
      p95_latency_ms: primaryMetrics.p95LatencyMs,
      agent_cpu_pct: reportBody.results.agentFootprint?.agentCpuPct ?? null,
      agent_memory_mb: reportBody.results.agentFootprint?.agentMemoryMb ?? null,
      local_ai_latency_ms: reportBody.results.localAiHotPath?.p95LatencyMs ?? null,
      metadata_json: JSON.stringify({
        ...reportBody,
        artifactRef: artifact.artifactRef,
        artifactLocation: artifact.location
      }),
      created_at: createdAt
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO benchmark_runs (
          id, tenant_id, scenario, qps, p95_latency_ms, agent_cpu_pct, agent_memory_mb, local_ai_latency_ms, metadata_json, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        row.id,
        row.tenant_id,
        row.scenario,
        row.qps,
        row.p95_latency_ms,
        row.agent_cpu_pct,
        row.agent_memory_mb,
        row.local_ai_latency_ms,
        row.metadata_json,
        row.created_at
      ]);
    }

    getDatabase().prepare(`
      INSERT INTO benchmark_runs (
        id, tenant_id, scenario, qps, p95_latency_ms, agent_cpu_pct, agent_memory_mb, local_ai_latency_ms, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.scenario,
      row.qps,
      row.p95_latency_ms,
      row.agent_cpu_pct,
      row.agent_memory_mb,
      row.local_ai_latency_ms,
      row.metadata_json,
      row.created_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('benchmark_runs', row);
    }

    return this.mapRow(row);
  }

  async listHistory(tenantId: string, limit = 20): Promise<BenchmarkRunRecord[]> {
    this.assertPrepared();
    const rows = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT *
          FROM benchmark_runs
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `, [tenantId, limit])
      : getDatabase().prepare(`
          SELECT *
          FROM benchmark_runs
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];

    return rows.map((row) => this.mapRow(row));
  }

  async getRun(tenantId: string, id: string): Promise<BenchmarkRunRecord | null> {
    this.assertPrepared();
    const row = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT *
          FROM benchmark_runs
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1
        `, [tenantId, id])
      : getDatabase().prepare(`
          SELECT *
          FROM benchmark_runs
          WHERE tenant_id = ? AND id = ?
          LIMIT 1
        `).get(tenantId, id) as any;
    return row ? this.mapRow(row) : null;
  }

  private resolveTargets(scenario: BenchmarkScenario): Set<Exclude<BenchmarkScenario, 'strong-claims-smoke'>> {
    if (scenario === 'full-suite' || scenario === 'strong-claims-smoke') {
      return new Set([
        'fastpath-direct',
        'api-rate-limit-integrated',
        'socket-rate-limit-integrated',
        'traffic-http-shadow',
        'agent-footprint',
        'local-ai-hotpath'
      ]);
    }

    return new Set([scenario]);
  }

  private async runFastpathDirectProbe(tenantId: string, profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    const runtime = await fastpathClientService.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return this.unavailableLatencyProbe('fastpath_disabled');
    }

    try {
      const client = this.createFastpathClient(runtime);
      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), (index) =>
        client.post('/v1/rate/check', this.buildFastpathPayload(tenantId, `warmup:fastpath:${index}`))
      );

      return this.runTimedProbe(load, async (index) => {
        const response = await client.post('/v1/rate/check', this.buildFastpathPayload(tenantId, `direct:${index}`));
        if (response.status >= 400) {
          throw new Error(`fastpath status ${response.status}`);
        }
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'fastpath_direct_probe_failed');
    }
  }

  private async runApiIntegratedProbe(tenantId: string, profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    try {
      const load = benchmarkLoad(profile);
      apiRateLimitEngineService.resetMetrics();
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), (index) =>
        this.checkApiRateLimitEngine(tenantId, this.selectApiBenchmarkSlot('warmup:api', index))
      );
      apiRateLimitEngineService.resetMetrics();

      const result = await this.runTimedProbe(load, async (index) => {
        await this.checkApiRateLimitEngine(tenantId, this.selectApiBenchmarkSlot('api', index));
      });
      const metrics = apiRateLimitEngineService.snapshotMetrics();

      return {
        ...result,
        decisionEngine: metrics.decisionEngine,
        fallbackCount: metrics.fallbackCount,
        redisScriptLatencyMs: metrics.redisScriptLatencyMs,
        targetQpsMultiplier: API_RATE_LIMIT_QPS_MULTIPLIER_TARGET
      };
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'api_integrated_probe_failed');
    }
  }

  private async runApiIntegratedBaselineProbe(profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    try {
      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), (index) =>
        this.checkLegacyApiRateLimit(this.selectApiBenchmarkSlot('warmup:api-baseline', index))
      );

      return this.runTimedProbe(load, async (index) => {
        await this.checkLegacyApiRateLimit(this.selectApiBenchmarkSlot('api-baseline', index));
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'api_integrated_baseline_probe_failed');
    }
  }

  private async runSocketIntegratedProbe(tenantId: string, profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    try {
      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), (index) =>
        socketRateLimitService.check({
          tenantId,
          key: `warmup:socket:${index}`,
          windowMs: 60000,
          limit: 1000000,
          sourceIp: '127.0.0.1',
          sessionId: `socket-warmup-${index}`,
          protocol: 'benchmark-socket'
        })
      );

      return this.runTimedProbe(load, async (index) => {
        await socketRateLimitService.check({
          tenantId,
          key: `socket:${index}`,
          windowMs: 60000,
          limit: 1000000,
          sourceIp: '127.0.0.1',
          sessionId: `socket-${index}`,
          protocol: 'benchmark-socket'
        });
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'socket_integrated_probe_failed');
    }
  }

  private async runSocketIntegratedBaselineProbe(profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    try {
      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), (index) =>
        socketRateLimitService.check({
          key: `warmup:socket-baseline:${index}`,
          windowMs: 60000,
          limit: 1000000,
          sourceIp: '127.0.0.1',
          sessionId: `socket-baseline-warmup-${index}`,
          protocol: 'benchmark-socket',
          preferFastpath: false
        }).then(() => undefined)
      );

      return this.runTimedProbe(load, async (index) => {
        await socketRateLimitService.check({
          key: `socket-baseline:${index}`,
          windowMs: 60000,
          limit: 1000000,
          sourceIp: '127.0.0.1',
          sessionId: `socket-baseline-${index}`,
          protocol: 'benchmark-socket',
          preferFastpath: false
        });
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'socket_integrated_baseline_probe_failed');
    }
  }

  private async runTrafficHttpShadowProbe(
    tenantId: string,
    profile: BenchmarkProfile
  ): Promise<TrafficHttpShadowBenchmarkResult> {
    const contract = await this.runTrafficHttpContractProbe(tenantId);
    const baseline = await this.runTrafficHttpBaselineProbe(profile);
    const fastpath = await this.runTrafficHttpFastpathProbe(tenantId, profile);
    const comparison = this.compareLatencyResults(fastpath, baseline);
    const meetsPhase2Target =
      contract.available &&
      contract.mismatches === 0 &&
      contract.criticalMisses === 0 &&
      comparison.meetsPhase1Target;

    return {
      available: contract.available && baseline.available && fastpath.available,
      contract,
      baseline,
      fastpath,
      comparison,
      meetsPhase2Target,
      zeroMismatch: contract.mismatches === 0,
      zeroCriticalMisses: contract.criticalMisses === 0,
      reason: meetsPhase2Target ? undefined : contract.error || comparison.reason || 'phase2_target_not_met'
    };
  }

  private async runAgentFootprintProbe(): Promise<ProcessFootprintResult> {
    const backend = await this.measureCurrentProcessFootprint();
    const agent = await this.findAgentProcessFootprint();
    return {
      available: agent.available,
      agentCpuPct: agent.agentCpuPct,
      agentMemoryMb: agent.agentMemoryMb,
      backendCpuPct: backend.cpuPct,
      backendMemoryMb: backend.memoryMb,
      pid: agent.pid,
      command: agent.command,
      error: agent.error
    };
  }

  private async runLocalAiHotPathProbe(tenantId: string, profile: BenchmarkProfile): Promise<LocalAiHotPathResult> {
    const config = await platformConfigService.getConfig(tenantId);
    const endpoint = await this.resolveLocalHotPathEndpoint(tenantId, config.aiRouting.localHotPathEndpointId || config.aiRouting.localEndpointId || undefined);
    if (!endpoint) {
      return {
        available: false,
        p95LatencyMs: null,
        sampleCount: 0,
        mode: config.aiRouting.mode,
        error: 'hot_path_endpoint_not_configured'
      };
    }

    const sampleCount = profile === 'claim-bench' ? 20 : 5;
    const latencies: number[] = [];
    try {
      for (let index = 0; index < sampleCount; index += 1) {
        const startedAt = nowMs();
        await this.invokeHotPathEndpoint(endpoint);
        latencies.push(nowMs() - startedAt);
      }
    } catch (error: any) {
      return {
        available: false,
        endpointId: endpoint.id,
        endpointPurpose: endpoint.purpose,
        p95LatencyMs: null,
        sampleCount: latencies.length,
        mode: config.aiRouting.mode,
        error: error?.message || 'local_ai_hot_path_probe_failed'
      };
    }

    return {
      available: true,
      endpointId: endpoint.id,
      endpointPurpose: endpoint.purpose,
      p95LatencyMs: percentile(latencies, 0.95),
      sampleCount,
      mode: config.aiRouting.mode
    };
  }

  private async runTrafficHttpContractProbe(tenantId: string): Promise<TrafficHttpContractResult> {
    const runtime = await fastpathClientService.getRuntimeSettings(tenantId);
    if (!runtime.enabled) {
      return {
        available: false,
        totalFixtures: httpTrafficBenchmarkFixtures.length,
        mismatches: httpTrafficBenchmarkFixtures.length,
        criticalMisses: httpTrafficBenchmarkFixtures.filter((fixture) => fixture.expectsCriticalBlock).length,
        mismatchedFixtures: [],
        error: 'fastpath_disabled'
      };
    }

    const mismatchedFixtures: TrafficHttpContractResult['mismatchedFixtures'] = [];
    let criticalMisses = 0;

    for (const fixture of httpTrafficBenchmarkFixtures) {
      const baseline = httpTrafficEvaluatorService.evaluateBaseline({
        ...fixture.request,
        tenantId
      });
      const fastpath = await fastpathClientService.evaluateHttpTraffic({
        ...fixture.request,
        tenantId
      });

      if (!fastpath) {
        return {
          available: false,
          totalFixtures: httpTrafficBenchmarkFixtures.length,
          mismatches: httpTrafficBenchmarkFixtures.length,
          criticalMisses: httpTrafficBenchmarkFixtures.filter((item) => item.expectsCriticalBlock).length,
          mismatchedFixtures,
          error: 'fastpath_unavailable'
        };
      }

      const baselineThreats = normalizeThreatSignatures(baseline.threats);
      const fastpathThreats = normalizeThreatSignatures(fastpath.threats);
      const mismatch =
        baseline.verdict !== fastpath.verdict ||
        baseline.matchedRule !== fastpath.matchedRule ||
        baselineThreats.join('|') !== fastpathThreats.join('|');

      if (fixture.expectsCriticalBlock && fastpath.verdict !== 'block') {
        criticalMisses += 1;
      }

      if (mismatch) {
        mismatchedFixtures.push({
          name: fixture.name,
          baselineVerdict: baseline.verdict,
          fastpathVerdict: fastpath.verdict,
          baselineThreats,
          fastpathThreats
        });
      }
    }

    return {
      available: true,
      totalFixtures: httpTrafficBenchmarkFixtures.length,
      mismatches: mismatchedFixtures.length,
      criticalMisses,
      mismatchedFixtures
    };
  }

  private async resolveLocalHotPathEndpoint(tenantId: string, preferredId?: string): Promise<AIEndpointRecord | null> {
    if (preferredId) {
      const endpoint = await aiEndpointStoreService.getEndpoint(tenantId, preferredId);
      if (endpoint?.enabled) {
        return endpoint;
      }
    }

    const hotPathEndpoints = await aiEndpointStoreService.listEnabledEndpoints(tenantId, 'hot_path');
    return hotPathEndpoints[0] || null;
  }

  private fixtureAt(index: number): HttpTrafficBenchmarkFixture {
    return httpTrafficBenchmarkFixtures[index % httpTrafficBenchmarkFixtures.length];
  }

  private async runTrafficHttpBaselineProbe(profile: BenchmarkProfile): Promise<LatencyBenchmarkResult> {
    try {
      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), async (index) => {
        httpTrafficEvaluatorService.evaluateBaseline(this.fixtureAt(index).request);
      });

      return this.runTimedProbe(load, async (index) => {
        httpTrafficEvaluatorService.evaluateBaseline(this.fixtureAt(index).request);
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'traffic_http_baseline_probe_failed');
    }
  }

  private async runTrafficHttpFastpathProbe(
    tenantId: string,
    profile: BenchmarkProfile
  ): Promise<LatencyBenchmarkResult> {
    try {
      const runtime = await fastpathClientService.getRuntimeSettings(tenantId);
      if (!runtime.enabled) {
        return this.unavailableLatencyProbe('fastpath_disabled');
      }

      const load = benchmarkLoad(profile);
      await this.runWarmup(load.warmupRequests, Math.min(load.concurrency, 32), async (index) => {
        const response = await fastpathClientService.evaluateHttpTraffic({
          ...this.fixtureAt(index).request,
          tenantId
        });
        if (!response) {
          throw new Error('fastpath_unavailable');
        }
      });

      return this.runTimedProbe(load, async (index) => {
        const response = await fastpathClientService.evaluateHttpTraffic({
          ...this.fixtureAt(index).request,
          tenantId
        });
        if (!response) {
          throw new Error('fastpath_unavailable');
        }
      });
    } catch (error: any) {
      return this.unavailableLatencyProbe(error?.message || 'traffic_http_fastpath_probe_failed');
    }
  }

  private async invokeHotPathEndpoint(endpoint: AIEndpointRecord): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.apiKey) {
      headers.Authorization = `Bearer ${endpoint.apiKey}`;
    }

    if (endpoint.type === 'ollama') {
      const base = endpoint.url.replace(/\/$/, '');
      const url = base.endsWith('/api/generate') ? base : `${base}/api/generate`;
      const response = await axios.post(url, {
        model: endpoint.modelName,
        prompt: 'Classify: normal traffic. Answer with one token.',
        stream: false
      }, {
        timeout: endpoint.timeout,
        httpAgent: HTTP_AGENT,
        httpsAgent: HTTPS_AGENT,
        validateStatus: () => true
      });

      if (response.status >= 400) {
        throw new Error(`hot path endpoint status ${response.status}`);
      }
      return;
    }

    const response = await axios.post(endpoint.url, {
      model: endpoint.modelName,
      messages: [{ role: 'user', content: 'Return OK.' }],
      max_tokens: 1,
      stream: false
    }, {
      timeout: endpoint.timeout,
      headers,
      httpAgent: HTTP_AGENT,
      httpsAgent: HTTPS_AGENT,
      validateStatus: () => true
    });

    if (response.status >= 400) {
      throw new Error(`hot path endpoint status ${response.status}`);
    }
  }

  private buildFastpathPayload(tenantId: string, key: string): Record<string, any> {
    return {
      tenantId,
      key,
      windowMs: 60000,
      limit: 1000000,
      sourceIp: '127.0.0.1',
      sessionId: `bench:${key}`,
      headers: {},
      protocol: 'benchmark-direct'
    };
  }

  private createFastpathClient(runtime: Awaited<ReturnType<typeof fastpathClientService.getRuntimeSettings>>): AxiosInstance {
    return axios.create({
      baseURL: runtime.transport === 'unix' ? 'http://unix' : runtime.baseUrl,
      socketPath: runtime.transport === 'unix' ? runtime.socketPath || undefined : undefined,
      timeout: runtime.timeoutMs,
      httpAgent: HTTP_AGENT,
      httpsAgent: HTTPS_AGENT,
      validateStatus: () => true
    });
  }

  private async runWarmup(totalRequests: number, concurrency: number, task: (index: number) => Promise<any>): Promise<void> {
    for (let offset = 0; offset < totalRequests; offset += concurrency) {
      const batchSize = Math.min(concurrency, totalRequests - offset);
      await Promise.all(Array.from({ length: batchSize }, (_, index) => task(offset + index)));
    }
  }

  private async runTimedProbe(load: ProbeLoadProfile, task: (index: number) => Promise<void>): Promise<LatencyBenchmarkResult> {
    const latencies: number[] = [];
    const startedAt = nowMs();

    for (let offset = 0; offset < load.measuredRequests; offset += load.concurrency) {
      const batchSize = Math.min(load.concurrency, load.measuredRequests - offset);
      await Promise.all(Array.from({ length: batchSize }, async (_, index) => {
        const requestStart = nowMs();
        await task(offset + index);
        latencies.push(nowMs() - requestStart);
      }));
    }

    const totalDurationMs = Math.max(nowMs() - startedAt, 1);
    return {
      available: true,
      qps: Number(((load.measuredRequests / totalDurationMs) * 1000).toFixed(2)),
      p95LatencyMs: percentile(latencies, 0.95),
      totalRequests: load.measuredRequests,
      warmupRequests: load.warmupRequests,
      concurrency: load.concurrency,
      totalDurationMs: Number(totalDurationMs.toFixed(2))
    };
  }

  private compareLatencyResults(
    fastpath: LatencyBenchmarkResult | undefined,
    baseline: LatencyBenchmarkResult | undefined,
    options: {
      qpsMultiplierTarget?: number;
      p95LatencyReductionTargetPct?: number;
      passMode?: 'qps-or-latency' | 'qps-only';
    } = {}
  ): LatencyComparisonResult {
    const qpsMultiplierTarget = options.qpsMultiplierTarget ?? PHASE1_QPS_MULTIPLIER_TARGET;
    const p95LatencyReductionTargetPct =
      options.p95LatencyReductionTargetPct ?? PHASE1_P95_REDUCTION_TARGET_PCT;
    const passMode = options.passMode ?? 'qps-or-latency';

    if (!fastpath?.available) {
      return {
        available: false,
        baselineQps: baseline?.qps ?? null,
        fastpathQps: fastpath?.qps ?? null,
        qpsMultiplier: null,
        baselineP95LatencyMs: baseline?.p95LatencyMs ?? null,
        fastpathP95LatencyMs: fastpath?.p95LatencyMs ?? null,
        p95LatencyReductionPct: null,
        qpsMultiplierTarget,
        p95LatencyReductionTargetPct,
        meetsPhase1Target: false,
        reason: fastpath?.error || 'fastpath_unavailable'
      };
    }

    if (!baseline?.available) {
      return {
        available: false,
        baselineQps: baseline?.qps ?? null,
        fastpathQps: fastpath.qps,
        qpsMultiplier: null,
        baselineP95LatencyMs: baseline?.p95LatencyMs ?? null,
        fastpathP95LatencyMs: fastpath.p95LatencyMs,
        p95LatencyReductionPct: null,
        qpsMultiplierTarget,
        p95LatencyReductionTargetPct,
        meetsPhase1Target: false,
        reason: baseline?.error || 'baseline_unavailable'
      };
    }

    const qpsMultiplier =
      baseline.qps && fastpath.qps
        ? Number((fastpath.qps / Math.max(baseline.qps, 0.01)).toFixed(2))
        : null;
    const p95LatencyReductionPct =
      baseline.p95LatencyMs && fastpath.p95LatencyMs
        ? Number((((baseline.p95LatencyMs - fastpath.p95LatencyMs) / baseline.p95LatencyMs) * 100).toFixed(2))
        : null;
    const meetsPhase1Target = passMode === 'qps-only'
      ? qpsMultiplier != null && qpsMultiplier >= qpsMultiplierTarget
      : (qpsMultiplier != null && qpsMultiplier >= qpsMultiplierTarget) ||
        (p95LatencyReductionPct != null && p95LatencyReductionPct >= p95LatencyReductionTargetPct);

    return {
      available: true,
      baselineQps: baseline.qps,
      fastpathQps: fastpath.qps,
      qpsMultiplier,
      baselineP95LatencyMs: baseline.p95LatencyMs,
      fastpathP95LatencyMs: fastpath.p95LatencyMs,
      p95LatencyReductionPct,
      qpsMultiplierTarget,
      p95LatencyReductionTargetPct,
      meetsPhase1Target,
      reason: meetsPhase1Target ? undefined : 'phase1_target_not_met'
    };
  }

  private unavailableLatencyProbe(error: string): LatencyBenchmarkResult {
    return {
      available: false,
      qps: null,
      p95LatencyMs: null,
      totalRequests: 0,
      warmupRequests: 0,
      concurrency: 0,
      totalDurationMs: 0,
      error
    };
  }

  private async measureCurrentProcessFootprint(): Promise<{ cpuPct: number; memoryMb: number }> {
    const cpuStart = process.cpuUsage();
    const startedAt = process.hrtime.bigint();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cpuEnd = process.cpuUsage(cpuStart);
    const elapsedMicros = Number(process.hrtime.bigint() - startedAt) / 1000;
    const cpuPct = elapsedMicros > 0
      ? Number((((cpuEnd.user + cpuEnd.system) / elapsedMicros) / Math.max(os.cpus().length, 1) * 100).toFixed(2))
      : 0;
    const memoryMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
    return { cpuPct, memoryMb };
  }

  private async findAgentProcessFootprint(): Promise<{
    available: boolean;
    agentCpuPct: number | null;
    agentMemoryMb: number | null;
    pid?: number;
    command?: string;
    error?: string;
  }> {
    const explicitPid = Number(process.env.BENCHMARK_AGENT_PID || 0);
    const processPattern = new RegExp(process.env.BENCHMARK_AGENT_PROCESS_PATTERN || 'aetherguard-agent|AetherGuard-agent', 'i');

    try {
      const { stdout } = await execFileAsync('sh', ['-lc', 'ps -o pid= -o rss= -o comm= -o args=']);
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
        if (!match) {
          continue;
        }

        const pid = Number(match[1]);
        const rssKb = Number(match[2]);
        const command = `${match[3]} ${match[4]}`.trim();

        if ((explicitPid > 0 && pid === explicitPid) || processPattern.test(command)) {
          const cpuPct = await this.measureLinuxProcessCpu(pid);
          return {
            available: true,
            agentCpuPct: cpuPct,
            agentMemoryMb: Number((rssKb / 1024).toFixed(2)),
            pid,
            command
          };
        }
      }

      return {
        available: false,
        agentCpuPct: null,
        agentMemoryMb: null,
        error: explicitPid > 0 ? `agent_pid_${explicitPid}_not_found` : 'agent_process_not_found'
      };
    } catch (error: any) {
      return {
        available: false,
        agentCpuPct: null,
        agentMemoryMb: null,
        error: error?.message || 'agent_process_probe_failed'
      };
    }
  }

  private async measureLinuxProcessCpu(pid: number, sampleMs = 250): Promise<number | null> {
    if (process.platform !== 'linux') {
      return null;
    }

    const firstProcess = await this.readProcessJiffies(pid);
    const firstSystem = await this.readSystemJiffies();
    if (firstProcess == null || firstSystem == null) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, sampleMs));

    const secondProcess = await this.readProcessJiffies(pid);
    const secondSystem = await this.readSystemJiffies();
    if (secondProcess == null || secondSystem == null || secondSystem <= firstSystem) {
      return null;
    }

    const processDelta = secondProcess - firstProcess;
    const systemDelta = secondSystem - firstSystem;
    return Number(((processDelta / systemDelta) * 100).toFixed(2));
  }

  private async readProcessJiffies(pid: number): Promise<number | null> {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.trim().split(/\s+/);
      const utime = Number(fields[13] || 0);
      const stime = Number(fields[14] || 0);
      return utime + stime;
    } catch {
      return null;
    }
  }

  private async readSystemJiffies(): Promise<number | null> {
    try {
      const stat = await readFile('/proc/stat', 'utf8');
      const cpuLine = stat.split(/\r?\n/).find((line) => line.startsWith('cpu '));
      if (!cpuLine) {
        return null;
      }
      return cpuLine
        .trim()
        .split(/\s+/)
        .slice(1)
        .reduce((sum, value) => sum + Number(value || 0), 0);
    } catch {
      return null;
    }
  }

  private async checkApiRateLimitEngine(tenantId: string, key: string): Promise<void> {
    const result = await apiRateLimitEngineService.check({
      identifier: `tenant:${tenantId}:${key}`,
      ip: '127.0.0.1',
      endpoint: 'POST:/api/benchmark',
      maxRequests: 1000000,
      windowMs: 60000,
      fingerprint: hashRateLimitFingerprint(`tenant:${tenantId}:${key}|127.0.0.1|benchmark-api`),
      sessionId: `bench:${key}`,
      protocol: 'benchmark-api'
    });

    if (!result) {
      throw new Error('api_rate_limit_engine_unavailable');
    }
  }

  private async checkLegacyApiRateLimit(key: string): Promise<void> {
    const spoofingCheck = await enhancedRateLimiter.detectIPSpoofing({
      identifier: key,
      ip: '127.0.0.1'
    });

    if (spoofingCheck.suspicious) {
      throw new Error(spoofingCheck.reason || 'legacy_api_rate_limit_blocked');
    }

    await enhancedRateLimiter.checkRateLimit({
      identifier: key,
      ip: '127.0.0.1',
      endpoint: 'benchmark-api',
      config: {
        maxRequests: 1000000,
        windowMs: 60000
      }
    });
  }

  private selectApiBenchmarkSlot(prefix: string, index: number): string {
    return `${prefix}:slot:${index % API_BENCHMARK_KEY_POOL_SIZE}`;
  }

  private selectPrimaryMetrics(
    scenario: BenchmarkScenario,
    results: Record<string, any>
  ): { qps: number | null; p95LatencyMs: number | null } {
    switch (scenario) {
      case 'api-rate-limit-integrated':
        return {
          qps: results.apiIntegrated?.qps ?? null,
          p95LatencyMs: results.apiIntegrated?.p95LatencyMs ?? null
        };
      case 'socket-rate-limit-integrated':
        return {
          qps: results.socketIntegrated?.qps ?? null,
          p95LatencyMs: results.socketIntegrated?.p95LatencyMs ?? null
        };
      case 'traffic-http-shadow':
        return {
          qps: results.trafficHttpShadow?.fastpath?.qps ?? null,
          p95LatencyMs: results.trafficHttpShadow?.fastpath?.p95LatencyMs ?? null
        };
      case 'fastpath-direct':
        return {
          qps: results.fastpathDirect?.qps ?? null,
          p95LatencyMs: results.fastpathDirect?.p95LatencyMs ?? null
        };
      default:
        return {
          qps: results.fastpathDirect?.qps ?? results.apiIntegrated?.qps ?? null,
          p95LatencyMs: results.fastpathDirect?.p95LatencyMs ?? results.apiIntegrated?.p95LatencyMs ?? null
        };
    }
  }

  private mapRow(row: any): BenchmarkRunRecord {
    const report = (() => {
      try {
        return JSON.parse(row.report_json || row.metadata_json || '{}');
      } catch {
        return {};
      }
    })();

    return {
      id: row.id,
      tenantId: row.tenant_id,
      scenario: row.scenario,
      profile: normalizeProfile(report.profile),
      qps: row.qps == null ? null : Number(row.qps),
      p95LatencyMs: row.p95_latency_ms == null ? null : Number(row.p95_latency_ms),
      agentCpuPct: row.agent_cpu_pct == null ? null : Number(row.agent_cpu_pct),
      agentMemoryMb: row.agent_memory_mb == null ? null : Number(row.agent_memory_mb),
      localAiLatencyMs: row.local_ai_latency_ms == null ? null : Number(row.local_ai_latency_ms),
      report,
      createdAt: row.created_at
    };
  }
}

export const benchmarkService = new BenchmarkService();
