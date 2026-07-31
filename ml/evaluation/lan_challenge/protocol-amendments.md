# Protocol Amendments — VIguard LAN Challenge Evaluation

This file records metric-implementation defects found and corrected while preparing
protocol v2. Both corrections were applied to the scoring/statistics code **before any
protocol-v2 model prediction was produced**. Neither required re-running model inference
(rules-baseline predictions on the frozen 413 inputs are unchanged): only the
metric computation changed, so the existing rules-baseline prediction file was re-scored
in place.

The protocol v1 commit (`79f146f2c8d400ef4afa292015b70a6bf91280ec`) is preserved verbatim;
these amendments are inherited by `evaluation-protocol-v2.json` and do not rewrite history.

## Amendment 1 — `stat-issue-4.1`: zero-event proportion intervals

| Field | Value |
| --- | --- |
| **Bug** | Safe FPR (and other proportion metrics) reported only the stratified-bootstrap percentile interval. For a zero-event rate the bootstrap resample is degenerate and yields `[0.0, 0.0]`, which is not a valid upper-bound statement about the population proportion. |
| **Affected metric** | `safeFPR`, `verdictAccuracy`, `attackRecall`, `attackPrecision`, `unknownAccuracy` (all proportion metrics). Headline case: rules-baseline `safeFPR = 0/209`. |
| **Fix** | Added deterministic `clopper_pearson_interval` (exact binomial, via the beta distribution) and `wilson_interval` (Wilson score) helpers in `scoring.py`, exposed through a unified `proportion_block(pointEstimate, numerator, denominator, clopperPearson95, wilson95, bootstrap95)` object attached to each proportion metric. `statistical-analysis.py` fills `bootstrap95` from the existing 10,000-draw stratified resamples and emits a per-model `proportionIntervals` block. Paper tables preferentially display the exact/Wilson interval; bootstrap remains the unified resampling result. |
| **Files changed** | `ml/evaluation/lan_challenge/scoring.py` (helpers + `proportions` block + augmented `safeFPR`), `ml/evaluation/lan_challenge/statistical-analysis.py` (`proportion_counts`, `bootstrap_model` now returns `proportionIntervals`). |
| **Before (rules-baseline safeFPR)** | `bootstrap95 = [0.0, 0.0]` (degenerate). |
| **After (rules-baseline safeFPR)** | `clopperPearson95 = [0.0, 0.01750]`, `wilson95 = [0.0, 0.01805]`, `bootstrap95 = [0.0, 0.0]` retained. |
| **Re-run inference required?** | **No.** Pure metric-implementation change; predictions unchanged. |

The integrity boundary "the rules baseline 0/209 result does **not** prove the population
FPR is zero" is now expressed numerically: the 95% upper bounds (≈1.75–1.81%) are reported
alongside the point estimate.

## Amendment 2 — `stat-issue-4.2`: attack-family Macro-F1 label set

| Field | Value |
| --- | --- |
| **Bug** | The family Macro-F1 label set was `sorted(set(reference_families) | set(predicted_families))` computed over reference-attack rows. Because a model/rule may predict `attackFamily = "none"` on a reference-attack row, `"none"` entered the label set as a reference class with support 0. Its per-class F1 is then 0, which is averaged into the macro denominator, artificially depressing Macro-F1. The same construction appeared in both the point scorer and the stratified-bootstrap mirror. |
| **Affected metric** | `attackFamily.macroF1` (point) and its 95% bootstrap CI; `attackFamilyMacroF1` in the statistics output. |
| **Fix** | Label set is now `sorted(set(reference_families))` — only families actually present among reference-attack rows. A predicted `"none"` (or any predicted-only family) is still scored as **wrong**: by the sklearn definition it is a false negative for the true reference family (reducing that family's recall), but it no longer contributes a support=0 reference class to the macro denominator. The bootstrap mirror was rewritten as `macro_f1_over_reference_labels`, whose per-label tp/reference-support/predicted-support formula reproduces sklearn exactly (verified: 0.58333 vs 0.58333 on a hand-checked fixture including a `none` prediction; the old union formula gave 0.38889 on the same fixture, a 0.19444 artificial depression). Transparency fields `predictedOnlyFamilies`, `predictedNoneOnAttackCount`, and `labelSetPolicy` are added so the `none` predictions remain auditable. |
| **Files changed** | `ml/evaluation/lan_challenge/scoring.py` (`family_labels` + transparency fields), `ml/evaluation/lan_challenge/statistical-analysis.py` (`macro_f1_over_reference_labels`, `metric_vector` family branch). |
| **Before (rules-baseline family Macro-F1)** | `0.242254` (label set incorrectly included `"none"`). |
| **After (rules-baseline family Macro-F1)** | `0.269171` (label set = 9 reference families: `command_injection, cors, csrf, file_upload, path_traversal, prompt_injection, sqli, ssrf, xss`; `predictedNoneOnAttackCount = 71` counted as false negatives). |
| **Re-run inference required?** | **No.** Pure metric-implementation change; predictions unchanged. |

All systems are scored under the same corrected label-set policy (`reference_attack_families_only`),
so cross-model family Macro-F1 comparison is apples-to-apples.

## Cross-checks run

- Verdict accuracy (0.56900) and verdict Macro-F1 (0.35893) on rules-baseline are **unchanged**
  by both amendments — only family Macro-F1 and proportion intervals moved.
- `load_references` still enforces label SHA `13fd71f5…` and distribution
  `{safe:209, attack:97, unknown:107}`; `load_predictions` still rejects any parse-failure
  repaired to `safe`. Neither integrity control was weakened.
