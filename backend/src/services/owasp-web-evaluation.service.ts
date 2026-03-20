import { readFile, access } from 'fs/promises';
import path from 'path';
import { MultiAgentDecisionSystem, TrafficRequest, ExperimentMode, SecurityDecision, AttackFamily } from '../ai-agents';
import { platformConfigService } from './platform-config.service';
import { initDatabase } from '../config/database';
import {
  HttpTrafficEvaluateRequest,
  httpTrafficEvaluatorService
} from './http-traffic-evaluator.service';

export interface OwaspSampleDescriptor {
  testName: string;
  category: string;
  attackFamily: AttackFamily;
  isAttack: boolean;
  cwe: string;
  method: 'GET' | 'POST';
  path: string;
  sourceKind: 'header' | 'parameter';
  sourceName: string;
  request: TrafficRequest;
}

export interface ClassificationMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
}

export interface SampleEvaluationOutcome {
  sampleId: string;
  label: 'attack' | 'benign';
  attackFamily: AttackFamily;
  predictedLabel: 'attack' | 'benign';
  verdict: SecurityDecision['verdict'];
  confidence: number;
  routeMode: string;
  proxyLatencyMs: number;
  roleAnalysisMs: number;
  debateLatencyMs: number;
  endToEndLatencyMs: number;
  debateTriggered: boolean;
  debateRounds: number;
  error?: string;
}

export interface BaselineEvaluationSummary {
  name: string;
  available: boolean;
  notes: string[];
  metrics?: ClassificationMetrics;
  outcomes: SampleEvaluationOutcome[];
  familyBreakdown: Record<string, ClassificationMetrics>;
}

export interface RouteModeSummary {
  routeMode: string;
  available: boolean;
  notes: string[];
  metrics?: ClassificationMetrics;
  avgEndToEndLatencyMs?: number;
  avgDebateLatencyMs?: number;
}

export interface SignificanceComparison {
  against: string;
  betterSamplePairs: number;
  worseSamplePairs: number;
  chiSquare: number;
  pValueApprox: number;
}

export interface OwaspWebEvaluationReport {
  generatedAt: string;
  dataset: {
    source: string;
    datasetRoot: string;
    totalRows: number;
    supportedRows: number;
    sampleCount: number;
    categories: Record<string, number>;
  };
  baselines: BaselineEvaluationSummary[];
  routeModes: RouteModeSummary[];
  significance: SignificanceComparison[];
  notes: string[];
}

export interface OwaspWebEvaluationOptions {
  datasetRoot?: string;
  tenantId?: string;
  maxSamplesPerFamily?: number;
  baselines?: Array<'modsecurity_crs' | 'single_agent' | 'multi_agent_no_debate' | 'multi_agent_with_debate'>;
  routeModes?: Array<'cloud_only' | 'local_preferred' | 'hybrid_verify'>;
  includeRouteModeSweep?: boolean;
}

interface RawBenchmarkRow {
  testName: string;
  category: string;
  isVulnerable: boolean;
  cwe: string;
}

interface InputDescriptor {
  sourceKind: 'header' | 'parameter';
  sourceName: string;
}

const CATEGORY_MAP: Record<string, AttackFamily> = {
  sqli: 'sqli',
  xss: 'xss',
  cmdi: 'command_injection',
  pathtraver: 'path_traversal'
};

const ATTACK_PAYLOADS: Record<AttackFamily, string> = {
  benign: 'normal-request',
  sqli: "admin' OR '1'='1",
  xss: '<script>alert(1)</script>',
  path_traversal: '../../../etc/passwd',
  command_injection: '127.0.0.1; cat /etc/passwd',
  ssrf: 'http://169.254.169.254/latest/meta-data/',
  automation: 'sqlmap/1.8',
  authentication: 'token-bypass',
  business_logic: 'price=-1',
  other: 'suspicious-input'
};

const BENIGN_PAYLOADS: Record<AttackFamily, string> = {
  benign: 'health-check',
  sqli: 'user123',
  xss: 'hello-world',
  path_traversal: 'images/logo.png',
  command_injection: '127.0.0.1',
  ssrf: 'https://example.com/metadata',
  automation: 'Mozilla/5.0',
  authentication: 'session-123',
  business_logic: 'qty=1',
  other: 'normal-value'
};

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function ensureBooleanLabel(outcome: SampleEvaluationOutcome): boolean {
  return outcome.predictedLabel === 'attack';
}

function computeMetrics(outcomes: SampleEvaluationOutcome[]): ClassificationMetrics {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const outcome of outcomes) {
    const actualAttack = outcome.label === 'attack';
    const predictedAttack = ensureBooleanLabel(outcome);

    if (actualAttack && predictedAttack) {
      truePositive += 1;
    } else if (!actualAttack && !predictedAttack) {
      trueNegative += 1;
    } else if (!actualAttack && predictedAttack) {
      falsePositive += 1;
    } else {
      falseNegative += 1;
    }
  }

  const total = Math.max(outcomes.length, 1);
  const precision = truePositive / Math.max(truePositive + falsePositive, 1);
  const recall = truePositive / Math.max(truePositive + falseNegative, 1);
  const f1Score = (2 * precision * recall) / Math.max(precision + recall, 0.000001);

  return {
    accuracy: roundMetric((truePositive + trueNegative) / total),
    precision: roundMetric(precision),
    recall: roundMetric(recall),
    f1Score: roundMetric(f1Score),
    falsePositiveRate: roundMetric(falsePositive / Math.max(falsePositive + trueNegative, 1)),
    falseNegativeRate: roundMetric(falseNegative / Math.max(falseNegative + truePositive, 1)),
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative
  };
}

function familyMetrics(outcomes: SampleEvaluationOutcome[]): Record<string, ClassificationMetrics> {
  const grouped = outcomes.reduce<Record<string, SampleEvaluationOutcome[]>>((acc, outcome) => {
    if (!acc[outcome.attackFamily]) {
      acc[outcome.attackFamily] = [];
    }
    acc[outcome.attackFamily].push(outcome);
    return acc;
  }, {});

  return Object.entries(grouped).reduce<Record<string, ClassificationMetrics>>((acc, [family, rows]) => {
    acc[family] = computeMetrics(rows);
    return acc;
  }, {});
}

function erfcApprox(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(
    -z * z - 1.26551223 + t * (
      1.00002368 + t * (
        0.37409196 + t * (
          0.09678418 + t * (
            -0.18628806 + t * (
              0.27886807 + t * (
                -1.13520398 + t * (
                  1.48851587 + t * (
                    -0.82215223 + t * 0.17087277
                  )
                )
              )
            )
          )
        )
      )
    )
  );

  return x >= 0 ? r : 2 - r;
}

function mcnemar(reference: SampleEvaluationOutcome[], candidate: SampleEvaluationOutcome[]): SignificanceComparison {
  let betterSamplePairs = 0;
  let worseSamplePairs = 0;

  const byId = new Map(candidate.map((outcome) => [outcome.sampleId, outcome]));
  for (const baselineOutcome of reference) {
    const candidateOutcome = byId.get(baselineOutcome.sampleId);
    if (!candidateOutcome) {
      continue;
    }

    const referenceCorrect = baselineOutcome.label === baselineOutcome.predictedLabel;
    const candidateCorrect = candidateOutcome.label === candidateOutcome.predictedLabel;

    if (referenceCorrect && !candidateCorrect) {
      worseSamplePairs += 1;
    } else if (!referenceCorrect && candidateCorrect) {
      betterSamplePairs += 1;
    }
  }

  const discordant = betterSamplePairs + worseSamplePairs;
  const chiSquare = discordant === 0
    ? 0
    : Math.pow(Math.abs(betterSamplePairs - worseSamplePairs) - 1, 2) / discordant;
  const pValueApprox = erfcApprox(Math.sqrt(chiSquare / 2));

  return {
    against: '',
    betterSamplePairs,
    worseSamplePairs,
    chiSquare: roundMetric(chiSquare),
    pValueApprox: roundMetric(pValueApprox)
  };
}

export class OwaspWebEvaluationService {
  private resolveDefaultDatasetRoot(): string {
    return path.resolve(__dirname, '../../../.tmp/owasp-benchmark-plan');
  }

  private mapCategory(category: string): AttackFamily | null {
    return CATEGORY_MAP[category] || null;
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private parseCsv(content: string): RawBenchmarkRow[] {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [testName, category, vulnerable, cwe] = line.split(',');
        return {
          testName,
          category,
          isVulnerable: vulnerable === 'true',
          cwe
        };
      });
  }

  private extractInputDescriptor(source: string): InputDescriptor | null {
    const headerMatch = source.match(/request\.getHeaders?\("([^"]+)"\)/);
    if (headerMatch) {
      return {
        sourceKind: 'header',
        sourceName: headerMatch[1]
      };
    }

    const parameterMatch = source.match(/request\.getParameter(?:Values)?\("([^"]+)"\)/);
    if (parameterMatch) {
      return {
        sourceKind: 'parameter',
        sourceName: parameterMatch[1]
      };
    }

    return null;
  }

  private extractServletPath(source: string): string | null {
    const servletMatch = source.match(/@WebServlet\(value = "([^"]+)"\)/);
    return servletMatch?.[1] || null;
  }

  private buildTrafficRequest(
    row: RawBenchmarkRow,
    attackFamily: AttackFamily,
    servletPath: string,
    input: InputDescriptor
  ): TrafficRequest {
    const payload = row.isVulnerable ? ATTACK_PAYLOADS[attackFamily] : BENIGN_PAYLOADS[attackFamily];
    const headers: Record<string, string> = {
      host: 'benchmark.local',
      'user-agent': 'AetherGuard-OWASP-Eval/1.0'
    };
    const queryParams: Record<string, string> = {};

    if (input.sourceKind === 'header') {
      headers[input.sourceName] = payload;
    } else {
      queryParams[input.sourceName] = payload;
    }

    const queryString = Object.keys(queryParams).length > 0
      ? `?${new URLSearchParams(queryParams).toString()}`
      : '';

    return {
      id: row.testName,
      timestamp: new Date(),
      sourceIP: row.isVulnerable ? '198.51.100.24' : '203.0.113.10',
      method: 'POST',
      path: `${servletPath}${queryString}`,
      headers,
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      body: input.sourceKind === 'parameter' ? JSON.stringify({ [input.sourceName]: payload }) : undefined,
      userAgent: 'AetherGuard-OWASP-Eval/1.0'
    };
  }

  async loadSamples(datasetRoot?: string, maxSamplesPerFamily?: number): Promise<{
    rows: number;
    supportedRows: number;
    samples: OwaspSampleDescriptor[];
    categories: Record<string, number>;
    datasetRoot: string;
  }> {
    const resolvedRoot = datasetRoot || this.resolveDefaultDatasetRoot();
    const csvPath = path.join(resolvedRoot, 'expectedresults-1.2.csv');
    const csv = await readFile(csvPath, 'utf8');
    const rows = this.parseCsv(csv);
    const samples: OwaspSampleDescriptor[] = [];
    const categories: Record<string, number> = {};
    const familyCounts: Record<string, { attack: number; benign: number }> = {};

    for (const row of rows) {
      const attackFamily = this.mapCategory(row.category);
      if (!attackFamily) {
        continue;
      }

      const sourcePath = path.join(
        resolvedRoot,
        'src',
        'main',
        'java',
        'org',
        'owasp',
        'benchmark',
        'testcode',
        `${row.testName}.java`
      );

      if (!(await this.fileExists(sourcePath))) {
        continue;
      }

      const source = await readFile(sourcePath, 'utf8');
      const servletPath = this.extractServletPath(source);
      const input = this.extractInputDescriptor(source);

      if (!servletPath || !input) {
        continue;
      }

      const labelKey = row.isVulnerable ? 'attack' : 'benign';
      const currentCount = familyCounts[attackFamily]?.[labelKey] || 0;

      if (maxSamplesPerFamily != null && currentCount >= maxSamplesPerFamily) {
        continue;
      }

      const request = this.buildTrafficRequest(row, attackFamily, servletPath, input);
      samples.push({
        testName: row.testName,
        category: row.category,
        attackFamily,
        isAttack: row.isVulnerable,
        cwe: row.cwe,
        method: request.method as 'GET' | 'POST',
        path: request.path,
        sourceKind: input.sourceKind,
        sourceName: input.sourceName,
        request
      });
      familyCounts[attackFamily] = familyCounts[attackFamily] || { attack: 0, benign: 0 };
      familyCounts[attackFamily][labelKey] += 1;
      categories[attackFamily] = (categories[attackFamily] || 0) + 1;
    }

    return {
      rows: rows.length,
      supportedRows: samples.length,
      samples,
      categories,
      datasetRoot: resolvedRoot
    };
  }

  private toHttpRequest(sample: OwaspSampleDescriptor, tenantId: string): HttpTrafficEvaluateRequest {
    return {
      tenantId,
      requestId: sample.testName,
      method: sample.request.method,
      url: sample.request.path,
      httpVersion: 'HTTP/1.1',
      headers: sample.request.headers,
      bodyBase64: Buffer.from(sample.request.body || '', 'utf8').toString('base64'),
      sourceIp: sample.request.sourceIP,
      truncated: false
    };
  }

  private async withRouteMode<T>(tenantId: string, routeMode: 'cloud_only' | 'local_preferred' | 'hybrid_verify', fn: () => Promise<T>): Promise<T> {
    await initDatabase();
    platformConfigService.prepare();
    const current = await platformConfigService.getConfig(tenantId);
    const nextConfig = {
      ...current,
      aiRouting: {
        ...current.aiRouting,
        mode: routeMode
      }
    };

    await platformConfigService.saveConfig(tenantId, nextConfig, 'owasp-web-eval');
    try {
      return await fn();
    } finally {
      await platformConfigService.saveConfig(tenantId, current, 'owasp-web-eval-restore');
    }
  }

  private async runAIBaseline(
    baselineName: string,
    mode: ExperimentMode,
    samples: OwaspSampleDescriptor[],
    tenantId: string,
    routeMode: 'cloud_only' | 'local_preferred' | 'hybrid_verify'
  ): Promise<BaselineEvaluationSummary> {
    return this.withRouteMode(tenantId, routeMode, async () => {
      const system = new MultiAgentDecisionSystem({
        experimentMode: mode,
        heuristicOnly: true,
        useIsolatedBus: true,
        timeouts: {
          analysis: 500,
          debate: 500,
          toolExecution: 500,
          modelResponse: 500
        }
      });
      const notes: string[] = [`route_mode=${routeMode}`];
      const outcomes: SampleEvaluationOutcome[] = [];

      try {
        await system.initialize();

        for (const sample of samples) {
          const proxyResult = httpTrafficEvaluatorService.evaluateBaseline(this.toHttpRequest(sample, tenantId));

          try {
            const decision = await system.analyze(sample.request, {
              history: [],
              relatedRequests: []
            });

            outcomes.push({
              sampleId: sample.testName,
              label: sample.isAttack ? 'attack' : 'benign',
              attackFamily: sample.attackFamily,
              predictedLabel: decision.verdict === 'allow' ? 'benign' : 'attack',
              verdict: decision.verdict,
              confidence: decision.confidence,
              routeMode: decision.routeMode || routeMode,
              proxyLatencyMs: roundMetric(proxyResult.processingTimeMicros / 1000),
              roleAnalysisMs: roundMetric(decision.stageLatencies?.roleAnalysisMs || 0),
              debateLatencyMs: roundMetric(decision.stageLatencies?.debateMs || 0),
              endToEndLatencyMs: roundMetric(decision.stageLatencies?.endToEndMs || decision.processingTime),
              debateTriggered: Boolean(decision.debateSession?.triggerMetrics?.triggered),
              debateRounds: decision.debateSession?.rounds.length || 0
            });
          } catch (error: any) {
            outcomes.push({
              sampleId: sample.testName,
              label: sample.isAttack ? 'attack' : 'benign',
              attackFamily: sample.attackFamily,
              predictedLabel: 'benign',
              verdict: 'challenge',
              confidence: 0,
              routeMode,
              proxyLatencyMs: roundMetric(proxyResult.processingTimeMicros / 1000),
              roleAnalysisMs: 0,
              debateLatencyMs: 0,
              endToEndLatencyMs: 0,
              debateTriggered: false,
              debateRounds: 0,
              error: error?.message || 'analysis_failed'
            });
          }
        }
      } finally {
        await system.shutdown().catch(() => undefined);
      }

      return {
        name: baselineName,
        available: outcomes.some((outcome) => !outcome.error),
        notes,
        metrics: outcomes.some((outcome) => !outcome.error) ? computeMetrics(outcomes) : undefined,
        outcomes,
        familyBreakdown: familyMetrics(outcomes)
      };
    });
  }

  private async runModSecurityBaseline(
    samples: OwaspSampleDescriptor[]
  ): Promise<BaselineEvaluationSummary> {
    const baselineUrl = process.env.MODSECURITY_BASELINE_URL;
    if (!baselineUrl) {
      return {
        name: 'modsecurity_crs',
        available: false,
        notes: ['MODSECURITY_BASELINE_URL not configured; baseline runner scaffolded but unavailable in current environment'],
        outcomes: [],
        familyBreakdown: {}
      };
    }

    const outcomes: SampleEvaluationOutcome[] = [];
    for (const sample of samples) {
      outcomes.push({
        sampleId: sample.testName,
        label: sample.isAttack ? 'attack' : 'benign',
        attackFamily: sample.attackFamily,
        predictedLabel: 'benign',
        verdict: 'allow',
        confidence: 0,
        routeMode: 'external',
        proxyLatencyMs: 0,
        roleAnalysisMs: 0,
        debateLatencyMs: 0,
        endToEndLatencyMs: 0,
        debateTriggered: false,
        debateRounds: 0,
        error: 'External ModSecurity runner integration is configured but not executed in this workspace'
      });
    }

    return {
      name: 'modsecurity_crs',
      available: false,
      notes: ['External ModSecurity integration requires a reachable runner endpoint'],
      outcomes,
      familyBreakdown: {}
    };
  }

  async evaluate(options: OwaspWebEvaluationOptions = {}): Promise<OwaspWebEvaluationReport> {
    const tenantId = options.tenantId || 'global';
    const dataset = await this.loadSamples(options.datasetRoot, options.maxSamplesPerFamily ?? 40);
    const notes = [
      'Samples are derived from OWASP Benchmark v1.2 expectedresults metadata and testcase sources.',
      'Sample selection is balanced per attack family and label whenever matching rows exist in the dataset.',
      'Current workspace does not have Docker daemon or Java runtime, so external ModSecurity/benchmark app execution is scaffolded but not run.'
    ];
    const selectedBaselines = options.baselines || [
      'modsecurity_crs',
      'single_agent',
      'multi_agent_no_debate',
      'multi_agent_with_debate'
    ];
    const baselines: BaselineEvaluationSummary[] = [];

    for (const baseline of selectedBaselines) {
      switch (baseline) {
        case 'modsecurity_crs':
          baselines.push(await this.runModSecurityBaseline(dataset.samples));
          break;
        case 'single_agent':
          baselines.push(await this.runAIBaseline('single_agent', 'single_agent', dataset.samples, tenantId, 'cloud_only'));
          break;
        case 'multi_agent_no_debate':
          baselines.push(await this.runAIBaseline('multi_agent_no_debate', 'multi_agent_no_debate', dataset.samples, tenantId, 'cloud_only'));
          break;
        case 'multi_agent_with_debate':
          baselines.push(await this.runAIBaseline('multi_agent_with_debate', 'multi_agent_with_debate', dataset.samples, tenantId, 'cloud_only'));
          break;
      }
    }

    const routeSweepModes = options.routeModes || ['cloud_only', 'local_preferred', 'hybrid_verify'];
    const fullSystemRouteModes = options.includeRouteModeSweep === false
      ? []
      : await Promise.all(routeSweepModes.map((routeMode) => (
          this.runAIBaseline(`route_${routeMode}`, 'multi_agent_with_debate', dataset.samples, tenantId, routeMode)
        )));

    const routeModes: RouteModeSummary[] = fullSystemRouteModes.map((summary) => ({
      routeMode: summary.name.replace('route_', ''),
      available: summary.available,
      notes: summary.notes,
      metrics: summary.metrics,
      avgEndToEndLatencyMs: summary.outcomes.length > 0
        ? roundMetric(summary.outcomes.reduce((sum, outcome) => sum + outcome.endToEndLatencyMs, 0) / summary.outcomes.length)
        : undefined,
      avgDebateLatencyMs: summary.outcomes.length > 0
        ? roundMetric(summary.outcomes.reduce((sum, outcome) => sum + outcome.debateLatencyMs, 0) / summary.outcomes.length)
        : undefined
    }));

    const reference = baselines.find((baseline) => baseline.name === 'multi_agent_with_debate');
    const significance = baselines
      .filter((baseline) => baseline.name !== 'multi_agent_with_debate' && baseline.available && reference?.available)
      .map((baseline) => ({
        ...mcnemar(baseline.outcomes, reference!.outcomes),
        against: baseline.name
      }));

    return {
      generatedAt: new Date().toISOString(),
      dataset: {
        source: 'OWASP Benchmark v1.2 derived HTTP corpus',
        datasetRoot: dataset.datasetRoot,
        totalRows: dataset.rows,
        supportedRows: dataset.supportedRows,
        sampleCount: dataset.samples.length,
        categories: dataset.categories
      },
      baselines,
      routeModes,
      significance,
      notes
    };
  }
}

export const owaspWebEvaluationService = new OwaspWebEvaluationService();
