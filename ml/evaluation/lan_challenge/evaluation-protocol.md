# Frozen VIguard LAN challenge evaluation protocol

Locked at `2026-07-30T16:33:57Z` before any model or rule-baseline
prediction was generated for the 413-sample challenge set.

## Frozen inputs

- Parent commit: `4359276fa9c6c0b56b168fc5c002e7e542fe30b3` (PR #15 was open)
- Model input: `model-inputs.jsonl`, 413 rows, SHA-256
  `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- Reference labels: `final-labels.jsonl`, 413 rows, SHA-256
  `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- Reference distribution: safe=209, attack=97, unknown=107
- Alignment key: `sampleId`
- Locked system-prompt SHA-256:
  `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`
- Canonical protocol SHA-256:
  `fc3f2af2bdfa911c99cf143ec248ae51654297d40b949fa95f8b8866bf897276`

The challenge set is not used for training, few-shot selection, prompt
selection, threshold selection, hyperparameter tuning, checkpoint selection,
or model selection. Results cannot change this protocol.

## Systems

The primary comparison set is fixed to:

1. `rules-baseline`
2. `char-ngram-logreg`
3. `qwen3-4b-zero-shot`
4. `qwen3-4b-few-shot`
5. `aetherargus-v02-hf-lora`
6. `aetherargus-v02-merged-bf16`
7. `aetherargus-v02-gguf-q4-k-m`
8. `aetherargus-v02-ollama-f16`

Unavailable assets or runtimes are reported as `NOT_RUN`; another model's
predictions must never be copied or relabeled to fill a missing run.

## Locked inference contract

All generative systems use the byte-identical
`ml/evaluation/lan_challenge/system-prompt.txt`, a 2048-token context, at most
320 new tokens, temperature 0, top-p 1, disabled top-k where supported, and
seed 0. The only accepted output is one strict JSON object with the five
required fields enumerated in `evaluation-protocol.json`. JSON, schema, enum,
or completeness failures remain failures and use `unknown` only as the
fail-safe scoring verdict; they are never repaired to `safe`.

The v02 train and validation JSONL assets are referenced by the repository
manifest but are not committed or mounted in the protocol-lock environment.
Therefore no few-shot examples could be truthfully frozen. The empty manifest
records `NOT_AVAILABLE`; the few-shot system must be `NOT_RUN` unless the exact
pre-locked manifest can be supplied without looking at challenge outcomes.

## Leakage boundary

Inference reads only the model input, model/tokenizer/runtime configuration,
the locked prompt, and (where applicable) the frozen non-challenge few-shot
manifest. It cannot open labels, adjudication artifacts, response evidence,
collector labels, annotator files, or historical error lists. Scoring starts
only after a complete immutable prediction file exists and joins by
`sampleId`.

## Metrics and statistics

The primary verdict task is three-class safe/attack/unknown classification.
Attack detection is reported both as attack versus safe+unknown and as attack
versus safe with unknown references excluded. Safe FPR is strictly
`reference=safe, prediction=attack` divided by all reference-safe rows.
Attack-family metrics use only reference-attack rows.

Confidence intervals use 10,000 reference-verdict-stratified bootstrap samples
with seed 20260731. Paired correctness comparisons use McNemar tests, exact for
small discordant counts. Paired model deltas use the same stratified bootstrap;
families of model comparisons use Holm-Bonferroni correction.

## Subsets

The locked subsets are listed in `evaluation-protocol.json`. The optional
normal/attack-attempt/hard-negative/prompt-injection/unknown cohort set is
`NOT_AVAILABLE` because no independently verified sampleId mapping was
committed at lock time; it will not be guessed from sampleId ranges or results.

## Amendments

Only implementation bugs may be fixed after lock. Each fix must record the
bug, affected runs, before/after difference, and whether all affected models
were rerun. Model lists, prompts, thresholds, hyperparameters, subsets,
metrics, and statistical methods are immutable for this experiment.
