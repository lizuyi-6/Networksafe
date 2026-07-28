/**
 * Safety-invariant tests: assert the AetherArgus engine never bypasses the
 * existing rule engine, Final Defense, hardware authorization, policyDigest,
 * monotonic counter, or interlock paths.
 *
 * These tests are *structural* — they scan the security-detection source
 * for forbidden calls — plus *behavioral* — they verify shadow mode leaves
 * the formal verdict untouched.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { SecurityDetectionEngine } from '../security-detection-engine';
import type { SecurityDetectionConfig } from '../detection-config';
import { MockDetectionProvider } from '../providers/mock-detection.provider';
import { fuseRisk } from '../fusion/risk-fusion.service';

const ENGINE_ROOT = path.resolve(__dirname, '..');

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectSources(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'child_process', pattern: /child_process|execSync|spawnSync/ },
  { name: 'shell exec', pattern: /\bexec\s*\(/ },
  { name: 'firewall modification', pattern: /iptables|nftables|netsh|pfctl/ },
  { name: 'filesystem destructive', pattern: /rmSync|unlinkSync|rmdirSync/ },
  {
    name: 'hardware authorization module import',
    // Match only actual module references, not docstring/type-identifier mentions.
    pattern: /from\s+['"][^'"]*(hardware-authorization|final-defense)[^'"]*['"]|require\(['"][^'"]*(hardware-authorization|final-defense)[^'"]*['"]\)/
  },
  {
    name: 'policyDigest / monotonic counter tampering',
    // Only flag actual field writes / function calls, not type-identifier mentions.
    pattern: /policyDigest\s*[:=]|monotonicCounter\s*[:=]|monotonic_counter\s*[:=]/
  },
  { name: 'interlock control call', pattern: /interlock_assert\s*\(|interlock_release\s*\(|breakerTarget\s*[:=]/ },
  { name: 'device-control dispatch call', pattern: /dispatchConfirmedDeviceCommand\s*\(|createPhysicalConfirmation\s*\(/ },
  { name: 'network cutting call', pattern: /disconnect.*network\s*\(|blockIp\s*\(|block_ip\s*\(/ }
];

describe('safety invariants — structural', () => {
  const sources = collectSources(ENGINE_ROOT);

  it('security-detection contains source files', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_PATTERNS)('no "$name" reference in any security-detection source', ({ pattern }) => {
    for (const file of sources) {
      const content = readFileSync(file, 'utf8');
      const rel = path.relative(ENGINE_ROOT, file);
      expect({ file: rel, matched: pattern.test(content) }).toEqual({ file: rel, matched: false });
    }
  });

  it('fuseRisk never returns executable=true', () => {
    const result = fuseRisk({
      formalVerdict: 'allow',
      formalSource: 'rule_engine',
      modelOutput: {
        verdict: 'malicious',
        confidence: 1,
        attackFamily: 'sqli',
        severity: 'critical',
        reasoning: 'r',
        evidence: [],
        recommendedAction: 'block'
      }
    });
    expect(result.executable).toBe(false);
    expect(result.finalVerdict).toBe('allow');
  });
});

describe('safety invariants — behavioral', () => {
  const config: SecurityDetectionConfig = {
    enabled: true,
    mode: 'shadow',
    provider: 'mock',
    model: 'aetherargus-mock',
    modelVersion: 'mock-1',
    quantization: 'none',
    datasetVersion: 'none',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    timeoutMs: 500,
    numCtx: 2048,
    maxBodyBytes: 1024,
    maxQueryBytes: 256,
    maxHeaderCount: 8,
    maxHeaderValueBytes: 128,
    maxResponseBytes: 4096,
    sampleRate: 1,
    failMode: 'unknown',
    queueMaxLength: 4,
    queueConcurrency: 2,
    reviewExportDir: 'runtime-data/security-detection-review'
  };

  it('engine output has no executable side-effect fields', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({
        verdict: 'malicious',
        confidence: 0.99,
        attackFamily: 'sqli',
        severity: 'critical',
        reasoning: 'obvious sqli',
        evidence: [],
        recommendedAction: 'block'
      })
    });
    const engine = new SecurityDetectionEngine(provider, { config });
    const result = await engine.detect({
      method: 'POST',
      path: '/x',
      query: '',
      headers: {},
      body: '',
      sourceContext: { requestsLastMinute: 0, distinctPathsLastMinute: 0, recentFailureCount: 0 } as any,
      ruleSignals: []
    });
    const outputKeys = Object.keys(result.output).sort();
    expect(outputKeys).toEqual([
      'attackFamily', 'confidence', 'evidence', 'reasoning', 'recommendedAction', 'severity', 'verdict'
    ].sort());
  });

  it('engine never throws to caller (telemetry failures are swallowed)', async () => {
    const provider = new MockDetectionProvider();
    const throwingTelemetry = {
      record: () => {
        throw new Error('telemetry exploded');
      }
    };
    const engine = new SecurityDetectionEngine(provider, { config, telemetry: throwingTelemetry as any });
    await expect(engine.detect({
      method: 'GET',
      path: '/',
      query: '',
      headers: {},
      body: '',
      sourceContext: { requestsLastMinute: 0, distinctPathsLastMinute: 0, recentFailureCount: 0 } as any,
      ruleSignals: []
    })).resolves.toBeDefined();
  });

  it('recommendedAction is data only — never invoked as a function', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({
        verdict: 'malicious',
        confidence: 0.9,
        attackFamily: 'sqli',
        severity: 'high',
        reasoning: 'r',
        evidence: [],
        recommendedAction: 'block'
      })
    });
    const engine = new SecurityDetectionEngine(provider, { config });
    const result = await engine.detect({
      method: 'POST',
      path: '/',
      query: '',
      headers: {},
      body: '',
      sourceContext: { requestsLastMinute: 0, distinctPathsLastMinute: 0, recentFailureCount: 0 } as any,
      ruleSignals: []
    });
    expect(typeof result.output.recommendedAction).toBe('string');
  });
});
