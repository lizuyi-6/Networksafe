#!/usr/bin/env node
/**
 * Generates `rules-baseline-manifest.json` authoritatively from the FROZEN repository
 * detection engine, plus a candidly-downgraded record of the research-augmented regex
 * families that are NOT part of the formal baseline.
 *
 * Run with ts-node (backend toolchain), then commit the resulting JSON verbatim.
 */
import { buildSeedDetectionRules } from '../../../backend/src/services/detection-engine';
import * as fs from 'fs';

const SOURCE_COMMIT = '4359276fa9c6c0b56b168fc5c002e7e542fe30b3';
const SOURCE_FILE = 'backend/src/services/detection-engine.ts';
const SOURCE_BLOB_SHA1 = '95654206590b7fb733d1425b280e7dfacc8c20ba';

// Research-augmented regex families, DOWNGRADED out of the formal baseline. They were
// authored to add coverage for attack categories that do NOT exist in the repository seed
// table (prompt_injection / protocol_attack / authentication / file_upload, plus expanded
// xss/ssrf variants). They are informed by knowledge of the challenge attack categories at
// a research level and are reported separately as `research-augmented-rules` so that no
// augmented rule masquerades as a pre-existing repository seed rule.
const RESEARCH_AUGMENTED = [
  {
    ruleId: 'research-augmented-xss',
    attackFamily: 'xss',
    pattern: "(?:<script\\b|javascript:|on(?:error|load|click|mouseover)\\s*=)",
    note: "expands seed xss (script tag / javascript:) with on* event-handler and entity-encoded variants"
  },
  {
    ruleId: 'research-augmented-ssrf',
    attackFamily: 'ssrf',
    pattern: "(?:https?://(?:127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0|\\[?::1\\]?|169\\.254\\.169\\.254|metadata\\.google\\.internal|100\\.100\\.100\\.200)|(?:dict|file|gopher|ldap|ftp|tftp|jar|netdoc|php)://)",
    note: "expands seed ssrf (metadata endpoints, review-tier) with loopback and dangerous-scheme variants, promoted to block-tier"
  },
  {
    ruleId: 'research-augmented-file-upload',
    attackFamily: 'file_upload',
    pattern: "(?:\\b\\w+\\.(?:phtml|php\\d?|asp|aspx|jspx?|cgi|sh|exe|war)\\b|\\b\\w+\\.(?:jpg|png|gif|pdf|txt)\\.(?:php|asp|jsp|exe|sh)\\b|<\\?(?:php|=)?[\\s\\S]{0,80}(?:system|exec|passthru|shell_exec|eval)\\s*\\()",
    note: "no repository seed rule; authored for the file_upload challenge category"
  },
  {
    ruleId: 'research-augmented-protocol-attack',
    attackFamily: 'protocol_attack',
    pattern: "(?:Content-Length:\\s*\\d+[\\s\\S]{0,200}Transfer-Encoding:\\s*chunked|Transfer-Encoding:\\s*chunked[\\s\\S]{0,200}Content-Length:\\s*\\d+)",
    note: "no repository seed rule; HTTP request-smuggling signature authored for the protocol_attack category"
  },
  {
    ruleId: 'research-augmented-authentication',
    attackFamily: 'authentication',
    pattern: "(?:eyJhbGciOiJub25l[A-Za-z0-9_-]{0,80}\\.|\"type\"\\s*:\\s*\"(?:change_password|change_role|grant_admin|disable_mfa|reset_password)\")",
    note: "no repository seed rule; JWT alg=none and privilege-change token signatures for the authentication category"
  },
  {
    ruleId: 'research-augmented-prompt-injection',
    attackFamily: 'prompt_injection',
    pattern: "(?:ignore (?:all |the )?(?:previous|prior) instructions|忽略(?:之前|以上|前面)的(?:所有)?指令|system prompt|reveal (?:your )?(?:instructions|prompt))",
    note: "no repository seed rule; LLM-prompt-injection phrases for the prompt_injection category"
  }
];

function main() {
  if (process.env.DISABLE_SEED_RULES === undefined) process.env.DISABLE_SEED_RULES = 'false';
  const rules = buildSeedDetectionRules();
  const formal = rules.map((r) => ({
    ruleId: r.ruleId,
    name: r.name,
    attackFamily: r.attackFamily,
    action: r.action,
    priority: r.priority,
    severity: r.severity,
    scope: r.scope,
    matcher: r.matcher,
    sourceCommit: SOURCE_COMMIT,
    sourceFile: SOURCE_FILE,
    sourceBlobSha1: SOURCE_BLOB_SHA1,
    transformation: 'none',
    role: 'formal_seed',
    challengeResultUsed: false
  }));
  const augmented = RESEARCH_AUGMENTED.map((entry) => ({
    ruleId: entry.ruleId,
    attackFamily: entry.attackFamily,
    pattern: entry.pattern,
    note: entry.note,
    sourceCommit: null,
    sourceFile: null,
    transformation: 'authored',
    role: 'research_augmented_not_from_repo_engine',
    challengeResultUsed: true,
    reportingRole: 'secondary_exploratory_only_not_a_locked_system'
  }));
  const manifest = {
    schemaVersion: 1,
    generatedBy: 'generate_rules_manifest.ts (imports buildSeedDetectionRules from the frozen engine)',
    formalBaseline: {
      systemId: 'rules-baseline',
      implementation: 'offline detection-engine adapter (rules_engine_adapter.ts) calling buildSeedDetectionRules + evaluateDetectionRules',
      sourceCommit: SOURCE_COMMIT,
      sourceFile: SOURCE_FILE,
      sourceBlobSha1: SOURCE_BLOB_SHA1,
      seedRuleCount: formal.length,
      challengeResultUsed: false,
      verdictMapping: { block: 'attack', monitor_review_only: 'unknown', no_match: 'safe' },
      rules: formal
    },
    researchAugmentedRules: {
      systemId: 'research-augmented-rules',
      status: 'downgraded_out_of_formal_baseline',
      challengeResultUsed: true,
      reason: 'families absent from the repository seed table; authored with knowledge of challenge attack categories; reported separately, not one of the 8 locked systems',
      rules: augmented
    }
  };
  const out = 'ml/evaluation/lan_challenge/rules-baseline-manifest.json';
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  process.stdout.write(`wrote ${out} (formal=${formal.length} augmented=${augmented.length})\n`);
}

main();
