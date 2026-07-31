#!/usr/bin/env node
/**
 * Offline detection-engine adapter for the `rules-baseline` system.
 *
 * This is Option A of the rule-baseline provenance requirement: instead of re-handling
 * the repository's seed rules in Python (which a reviewer could challenge as
 * post-hoc-tuned), this adapter imports the FROZEN repository detection engine and runs
 * it verbatim on the frozen challenge inputs.
 *
 * Hard guarantees (enforced by construction):
 *   - NO database, NO network, NO response-side data, NO labels, NO adjudication files.
 *   - Only `buildSeedDetectionRules()` + `evaluateDetectionRules()` from the pinned engine.
 *   - The seed-rule disable guard is neutralized (DISABLE_SEED_RULES=false) so the real
 *     production seed table is what runs.
 *
 * Verdict mapping (engine -> challenge 3-class), faithful to the engine's own semantics:
 *   - engine highest-priority action == 'block'  -> verdict "attack"
 *        attackFamily = the matched block rule's family (sqli/xss/path_traversal/command_injection)
 *   - engine ruleVerdict == 'monitor' (review-tier only, e.g. ssrf/automation) -> "unknown"
 *        (the engine escalated for AI review without blocking; the rules cannot conclude)
 *   - no matched rule                              -> "safe"
 *
 * Run with ts-node (backend toolchain):
 *   DISABLE_SEED_RULES=false NODE_ENV=production \
 *     backend/node_modules/.bin/ts-node --transpile-only --project backend/tsconfig.json \
 *     ml/evaluation/lan_challenge/rules_engine_adapter.ts --input <model-inputs.jsonl>
 */
import * as fs from 'fs';
import { buildSeedDetectionRules, evaluateDetectionRules } from '../../../backend/src/services/detection-engine';

interface Argv {
  input: string;
}
function parseArgv(): Argv {
  const argv = process.argv.slice(2);
  let input = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i];
  }
  if (!input) throw new Error('--input is required');
  return { input };
}

// Map engine attack families to the challenge attackFamily enum. The block-tier seed
// rules only ever produce sqli/xss/path_traversal/command_injection, all of which exist
// verbatim in the challenge enum. review-tier families (ssrf, automation) never reach the
// 'attack' branch (they map to 'unknown' below), so they never need an enum mapping here.
const FAMILY_MAP: Record<string, string> = {
  sqli: 'sqli',
  xss: 'xss',
  path_traversal: 'path_traversal',
  command_injection: 'command_injection',
  ssrf: 'ssrf'
};

function buildRequest(sampleId: string, inp: any, timestamp: string) {
  const headers = (inp && typeof inp.headers === 'object') ? inp.headers : {};
  const userAgent =
    (headers as Record<string, string>)['user-agent'] ||
    (headers as Record<string, string>)['User-Agent'] ||
    (headers as Record<string, string>)['User-agent'] ||
    undefined;
  return {
    tenantId: 'global',
    channel: 'http_api' as const,
    requestId: sampleId,
    timestamp,
    analysisPurpose: 'primary' as const,
    method: typeof inp.method === 'string' ? inp.method : '',
    path: typeof inp.path === 'string' ? inp.path : '',
    query: typeof inp.query === 'string' ? inp.query : '',
    headers,
    body: typeof inp.body === 'string' ? inp.body : '',
    userAgent
  };
}

function main() {
  const { input } = parseArgv();
  if (process.env.DISABLE_SEED_RULES === undefined) process.env.DISABLE_SEED_RULES = 'false';
  const rules = buildSeedDetectionRules();
  if (rules.length === 0) {
    throw new Error('buildSeedDetectionRules() returned 0 rules; seed table disabled?');
  }
  const timestamp = '2026-07-30T00:00:00Z'; // deterministic, no Date.now()
  const lines = fs.readFileSync(input, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    const row = JSON.parse(line);
    const sampleId: string = row.sampleId;
    const request = buildRequest(sampleId, row.input, timestamp);
    const result = evaluateDetectionRules(request, rules);
    const matched = result.matchedRules.map((m) => m.rule);
    const blockRules = matched.filter((r) => r.action === 'block');
    const reviewRules = matched.filter((r) => r.action === 'review');

    let verdict: 'safe' | 'attack' | 'unknown';
    let attackFamily: string;
    let recommendedAction: 'allow' | 'monitor' | 'challenge' | 'block' | 'isolate';
    let confidence: number;
    let contextSufficient = true;

    if (blockRules.length > 0) {
      verdict = 'attack';
      const top = blockRules.sort((a, b) => b.priority - a.priority)[0];
      attackFamily = FAMILY_MAP[top.attackFamily || ''] || 'other';
      recommendedAction = 'block';
      confidence = 5;
    } else if (reviewRules.length > 0) {
      // Engine escalated for AI review but did not block -> rules cannot conclude.
      verdict = 'unknown';
      attackFamily = 'none';
      recommendedAction = 'monitor';
      confidence = 2;
    } else {
      verdict = 'safe';
      attackFamily = 'none';
      recommendedAction = 'allow';
      confidence = 4;
    }

    const rawOutput = JSON.stringify({
      verdict,
      attackFamily,
      recommendedAction,
      contextSufficient,
      confidence
    });
    const record = {
      sampleId,
      rawOutput,
      engineMeta: {
        engineRuleVerdict: result.ruleVerdict,
        matchedRuleIds: result.matchedRuleIds,
        blockRuleIds: blockRules.map((r) => r.ruleId),
        reviewRuleIds: reviewRules.map((r) => r.ruleId),
        riskScore: result.riskScore,
        shouldEscalate: result.shouldEscalate,
        seedRuleCount: rules.length
      }
    };
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}

main();
