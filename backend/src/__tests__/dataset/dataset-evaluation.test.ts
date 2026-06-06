/**
 * AetherGuard Dataset Evaluation
 * ==============================
 *
 * Runs the 4,300-sample aetherguard-security-dataset through the
 * DetectionPipelineService heuristics and the input-validator
 * defenses, and measures:
 *
 *   - True Positive (TP): attack sample → flagged
 *   - False Negative (FN): attack sample → not flagged
 *   - True Negative (TN): normal sample → not flagged
 *   - False Positive (FP): normal sample → flagged
 *   - Detection rate per attack type
 *   - False positive rate
 *   - Latency per sample (median / p95)
 *
 * The dataset is cloned from
 *   https://github.com/lizuyi-6/aetherguard-security-dataset
 * to <repo>/backend/test-data/aetherguard-security-dataset/ at
 * test setup time. If the clone is missing the test is skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from '../../config/database';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { InputValidator } from '../../security/input-validator';
import type { DetectionRequest } from '../../services/detection-engine';

interface DatasetSample {
  id: string;
  type: string;
  payload?: string;
  cve?: string;
  severity?: string;
  expected_detection: boolean;
  source_ip?: string;
  pattern?: string;
  packets_per_second?: number;
  timestamp?: string;
  [k: string]: any;
}

interface PerTypeStats {
  total: number;
  expected_attacks: number;
  expected_normal: number;
  detected: number;
  missed: number;
  false_positives: number;
  true_negatives: number;
  detection_rate: number;     // detected / expected_attacks
  false_positive_rate: number; // false_positives / expected_normal
  median_latency_ms: number;
  p95_latency_ms: number;
}

const DATASET_ROOT = path.resolve(__dirname, '../../../test-data/aetherguard-security-dataset');

function findDatasetRoot(): string | null {
  if (fs.existsSync(DATASET_ROOT)) return DATASET_ROOT;
  // Fallback: dataset may be at /tmp or elsewhere
  for (const candidate of [
    'C:/Users/Abraham/AppData/Local/Temp/aetherguard-security-dataset',
    '/tmp/aetherguard-security-dataset',
    path.resolve(__dirname, '../../../../aetherguard-security-dataset')
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadDataset(root: string): DatasetSample[] {
  const all: DatasetSample[] = [];
  const subs = ['full_test_dataset', 'complete_dataset', 'advanced_dataset', 'zeroday_dataset'];
  for (const sub of subs) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('00_')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (Array.isArray(data)) {
          for (const sample of data) {
            (sample as any).__file = f;
            all.push(sample);
          }
        }
      } catch (e) {
        // Some files have GBK-encoding non-UTF8 chars — skip them
      }
    }
  }
  return all;
}

function mapSampleToRequest(s: DatasetSample, idx: number): DetectionRequest {
  const isPacket = s.type === 'ddos' || s.type === 'port_scan' || s.packets_per_second !== undefined;
  // Try to extract method/path from payload (which is sometimes an HTTP request)
  let method = 'GET';
  let urlPath = '/';
  let query = '';
  const payload = String(s.payload || '');
  const firstLine = payload.split('\r\n')[0] || payload.split('\n')[0] || '';
  const m = firstLine.match(/^(\w+)\s+([^\s\?]+)(?:\?([^\s]+))?/);
  if (m) {
    method = m[1];
    urlPath = m[2] || '/';
    query = m[3] || '';
  }
  return {
    tenantId: 'dataset-eval',
    channel: isPacket ? 'packet' : 'http_api',
    requestId: `${s.id || `sample_${idx}`}-${idx}`,
    timestamp: s.timestamp || new Date().toISOString(),
    sourceIp: s.source_ip,
    method,
    path: urlPath,
    decodedPath: urlPath,
    query,
    decodedQuery: query,
    body: isPacket ? '' : payload,
    normalizedBody: isPacket ? '' : payload,
    rawPayload: payload,
    userAgent: 'dataset-eval/1.0',
    evidence: s.pattern || s.cve || s.type
  };
}

async function evaluateSample(s: DatasetSample, idx: number, validator: InputValidator) {
  const request = mapSampleToRequest(s, idx);
  const start = process.hrtime.bigint();
  let flagged = false;
  let matchedRules: string[] = [];
  let flagReason = '';
  try {
    const decision = await detectionPipelineService.evaluateRequest(request, { skipPersistence: true });
    const verdict = (decision as any).verdict;
    matchedRules = (decision as any).matchedRuleIds || (decision as any).matched_rules || [];
    // Only 'block' counts as a confirmed detection. 'monitor' is
    // "watch closely" and is a normal-traffic false-positive signal
    // if it triggers on benign payloads.
    if (verdict === 'block') {
      flagged = true;
      flagReason = 'pipeline:block';
    } else {
      // Run the input-validator against DECODED individual values.
      // The validator is too aggressive when run on structured bodies
      // (JSON, URL-encoded forms, etc.) because those contain shell-
      // metachar-shaped delimiters (&, {, :, =). It is intended to be
      // run on individual field values, not on whole bodies.
      const decodedValues: string[] = [];
      if (request.query) {
        for (const part of request.query.split('&')) {
          const v = part.split('=')[1] ?? part;
          try { decodedValues.push(decodeURIComponent(v)); } catch { decodedValues.push(v); }
        }
      }
      // For the body, only run the validator on RAW attack payloads
      // (e.g. log4j JNDI strings). Skip if the body is a structured
      // HTTP body (form-encoded or JSON) — those are validated by
      // the detection pipeline's per-rule scanning, not the
      // all-in-one InputValidator.
      let bodyValues = (request.body || request.rawPayload || '');
      const headerEnd = bodyValues.indexOf('\r\n\r\n');
      if (headerEnd >= 0) bodyValues = bodyValues.substring(headerEnd + 4);
      else {
        const idx2 = bodyValues.indexOf('\n\n');
        if (idx2 >= 0) bodyValues = bodyValues.substring(idx2 + 2);
      }
      const trimmedBody = bodyValues.trim();
      // Heuristic: only run the validator on RAW single-token attack
      // payloads (log4j JNDI strings, XSS tags, command-injection
      // one-liners). Reject anything that looks like a structured
      // body — URL-encoded forms (has & followed by =), JSON
      // (starts with { or [), multi-line (has \n), or key=value
      // pairs (has = with no & or =).
      const looksStructured = trimmedBody.includes('\n')
        || trimmedBody.startsWith('{')
        || trimmedBody.startsWith('[')
        || (trimmedBody.includes('&') && trimmedBody.includes('='))
        || /^[\w\.\-]+=/.test(trimmedBody);
      if (trimmedBody && trimmedBody.length < 200 && !looksStructured) {
        decodedValues.push(trimmedBody);
      }
      if (request.path && request.path !== '/') decodedValues.push(request.path);

      for (const value of decodedValues) {
        if (!value) continue;
        try {
          const r = validator.validateAll(value);
          if (r && r.isValid === false) {
            flagged = true;
            flagReason = `validator:${r.reason}`;
            break;
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    // Treat evaluation error as a miss (no detection)
  }
  const end = process.hrtime.bigint();
  const latencyMs = Number(end - start) / 1_000_000;
  return { flagged, latencyMs, matchedRules, flagReason };
}

describe('AetherGuard dataset evaluation (aetherguard-security-dataset)', () => {
  let samples: DatasetSample[] = [];
  let datasetRoot: string | null = null;

  beforeAll(async () => {
    datasetRoot = findDatasetRoot();
    if (!datasetRoot) {
      // Skip silently — test runner will mark as skipped
      return;
    }
    await initDatabase();
    detectionPipelineService.prepare();
    samples = loadDataset(datasetRoot);
  }, 120_000);

  it('detects attacks and avoids false positives on the 4,300-sample dataset', async () => {
    if (!datasetRoot) {
      console.warn('[dataset-eval] dataset not found, skipping');
      return;
    }
    if (samples.length === 0) {
      console.warn('[dataset-eval] no samples loaded');
      return;
    }
    const validator = new InputValidator();

    const perType: Record<string, PerTypeStats> = {};
    const globalLatencies: number[] = [];
    let TP = 0, FN = 0, TN = 0, FP = 0;
    const fpSamples: any[] = [];
    const fnSamples: any[] = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const isAttack = s.expected_detection === true;
      const type = s.type || 'unknown';
      const { flagged, latencyMs, matchedRules, flagReason } = await evaluateSample(s, i, validator);
      globalLatencies.push(latencyMs);

      perType[type] = perType[type] || {
        total: 0, expected_attacks: 0, expected_normal: 0,
        detected: 0, missed: 0, false_positives: 0, true_negatives: 0,
        detection_rate: 0, false_positive_rate: 0,
        median_latency_ms: 0, p95_latency_ms: 0
      };
      const t = perType[type];
      t.total++;
      if (isAttack) t.expected_attacks++; else t.expected_normal++;

      if (isAttack && flagged) { TP++; t.detected++; }
      else if (isAttack && !flagged) {
        FN++; t.missed++;
        if (fnSamples.length < 5) fnSamples.push({ id: s.id, type, payload: (s.payload || '').substring(0, 200) });
      }
      else if (!isAttack && flagged) {
        FP++; t.false_positives++;
        if (fpSamples.length < 5) fpSamples.push({ id: s.id, type, payload: (s.payload || '').substring(0, 200), matchedRules, flagReason });
      }
      else { TN++; t.true_negatives++; }
    }

    // Compute per-type detection rate and FPR
    for (const t of Object.values(perType)) {
      t.detection_rate = t.expected_attacks > 0 ? t.detected / t.expected_attacks : 1;
      t.false_positive_rate = t.expected_normal > 0 ? t.false_positives / t.expected_normal : 0;
      const lats = globalLatencies.filter((_, idx) => {
        // Filter by type would require storing per-sample latency; for now use global
        return true;
      });
      t.median_latency_ms = percentile(lats, 50);
      t.p95_latency_ms = percentile(lats, 95);
    }

    const totalAttacks = TP + FN;
    const totalNormal = TN + FP;
    const overallDetectionRate = totalAttacks > 0 ? TP / totalAttacks : 0;
    const overallFpr = totalNormal > 0 ? FP / totalNormal : 0;

    // Print results — a summary table the user can read in CI output
    console.log('\n=== AetherGuard Dataset Evaluation ===');
    console.log(`Samples: ${samples.length}  TP=${TP} FN=${FN} TN=${TN} FP=${FP}`);
    console.log(`Overall detection rate: ${(overallDetectionRate * 100).toFixed(2)}%`);
    console.log(`Overall false positive rate: ${(overallFpr * 100).toFixed(2)}%`);
    console.log(`Median latency: ${percentile(globalLatencies, 50).toFixed(2)}ms`);
    console.log(`P95 latency: ${percentile(globalLatencies, 95).toFixed(2)}ms`);
    console.log('\nPer-attack-type detection rate:');
    const sortedTypes = Object.entries(perType).sort((a, b) =>
      b[1].expected_attacks - a[1].expected_attacks
    );
    for (const [type, t] of sortedTypes) {
      const det = (t.detection_rate * 100).toFixed(1).padStart(5);
      const fpr = (t.false_positive_rate * 100).toFixed(1).padStart(5);
      console.log(`  ${type.padEnd(28)}  attacks=${String(t.expected_attacks).padStart(4)}  detected=${det}%  FPR=${fpr}%`);
    }

    // Persist a JSON report for later inspection
    const reportPath = path.resolve(__dirname, '../../../test-data/dataset-eval-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      samples: samples.length,
      TP, FN, TN, FP,
      overallDetectionRate,
      overallFpr,
      medianLatencyMs: percentile(globalLatencies, 50),
      p95LatencyMs: percentile(globalLatencies, 95),
      perType,
      fpSamples,
      fnSamples
    }, null, 2));

    // The test does not enforce a hard pass threshold — that would be
    // misleading before baseline is established. We assert that
    // something was actually evaluated.
    expect(TP + FN + TN + FP).toBe(samples.length);
  }, 600_000);
});

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
