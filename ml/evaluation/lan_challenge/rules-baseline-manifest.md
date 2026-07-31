# Rules-Baseline Provenance Manifest

This manifest records, auditably, where every rule in the `rules-baseline` system comes
from. The authoritative machine-readable form is `rules-baseline-manifest.json` (generated
by `generate_rules_manifest.ts`, which imports `buildSeedDetectionRules()` from the frozen
repository detection engine). This `.md` is a human summary.

## Why this exists

A reviewer can reasonably ask: *were the baseline rules written or tuned after looking at
the challenge set or its labels?* To remove that question entirely, the formal
`rules-baseline` does **not** re-handle the repository's seed rules in Python. It runs the
**frozen repository detection engine verbatim** via an offline, label-blind TypeScript
adapter (`rules_engine_adapter.ts`) that calls:

- `buildSeedDetectionRules()` — `backend/src/services/detection-engine.ts:423`
- `evaluateDetectionRules(request, rules)` — `backend/src/services/detection-engine.ts:579`

The adapter touches **no database, no network, no response-side data, no labels, no
adjudication files**. The engine's dev-mode seed-disable guard is neutralized
(`DISABLE_SEED_RULES=false`) so the real production seed table is what runs. Seed-rule
count is recorded per run in each prediction record's `engineMeta.seedRuleCount`.

## Formal baseline (the locked `rules-baseline` system)

- **Source commit:** `4359276fa9c6c0b56b168fc5c002e7e542fe30b3`
- **Source file:** `backend/src/services/detection-engine.ts`
- **Source blob SHA-1:** `95654206590b7fb733d1425b280e7dfacc8c20ba` (identical at the pinned
  commit and at the current branch head — the engine has not changed.)
- **Seed rules:** 8 (challengeResultUsed = **false** for every rule)
- **Verdict mapping (engine → challenge 3-class), faithful to the engine:**
  - highest-priority `block` rule matched → `attack`
  - `monitor` (review-tier only, e.g. ssrf / automation) → `unknown` (engine escalated for
    AI review without blocking; the rules cannot conclude)
  - no match → `safe`

| ruleId | family | action | severity | scope |
| --- | --- | --- | --- | --- |
| seed-sqli-union | sqli | block | critical | all |
| seed-sqli-auth-bypass | sqli | block | high | all |
| seed-sqli-stacked | sqli | block | critical | all |
| seed-xss-script | xss | block | critical | all |
| seed-path-traversal | path_traversal | block | critical | all |
| seed-command-injection | command_injection | block | critical | all |
| seed-ssrf-review | ssrf | review | medium | http_api |
| seed-automation-review | automation | review | medium | all |

The full `matcher` (keyword / userAgent patterns) for each rule is in the `.json`. Because
the engine is run verbatim, the formal baseline inherits the engine's coverage exactly:
only `sqli`, `xss`, `path_traversal`, `command_injection` can produce an `attack` verdict;
`ssrf` and `automation` produce `unknown` (review-tier); all other challenge families
(prompt_injection, authentication, file_upload, protocol_attack, …) are **not** covered by
the repository's formal seed rules.

## Research-augmented rules (SEPARATE, downgraded)

The expanded regex families below were authored to add exploratory coverage for categories
**absent from the repository seed table**. They are informed by knowledge of the challenge
attack categories at a research level (`challengeResultUsed = true`, candidly) and are
reported as a **separate** `research-augmented-rules` result — **not** one of the 8
protocol-locked systems — so that no augmented rule masquerades as a pre-existing
repository capability. They are produced by `run_research_augmented_rules.py`.

| family | ruleId | in repo engine? | reporting role |
| --- | --- | --- | --- |
| xss (expanded) | research-augmented-xss | expands seed xss | secondary, exploratory |
| ssrf (expanded) | research-augmented-ssrf | expands seed ssrf | secondary, exploratory |
| file_upload | research-augmented-file-upload | **no** | secondary, exploratory |
| protocol_attack | research-augmented-protocol-attack | **no** | secondary, exploratory |
| authentication | research-augmented-authentication | **no** | secondary, exploratory |
| prompt_injection | research-augmented-prompt-injection | **no** | secondary, exploratory |

The four families with **no** repository source (`file_upload`, `protocol_attack`,
`authentication`, `prompt_injection`) are the ones §5 of the task specifically required
audited; they are confirmed absent from the frozen engine and are therefore excluded from
the formal baseline and reported only as downgraded research-augmented evidence.

## Integrity

- The formal `rules-baseline` predictions are reproducible by re-running
  `run_rules_baseline.py`, which re-invokes the same frozen engine; no challenge label or
  outcome is read at any point.
- Changing the formal baseline means changing the repository detection engine (which is
  outside this PR's allowed change prefixes and is itself unchanged — blob SHA matches the
  pinned commit); the adapter introduces no rules of its own.
