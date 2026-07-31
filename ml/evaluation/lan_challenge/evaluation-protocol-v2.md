# VIguard LAN Challenge Evaluation Protocol — v2

`schemaVersion: 2` · `protocolSha256: b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb`

This is **protocol v2**. Protocol v1 is preserved verbatim at commit
`79f146f2c8d400ef4afa292015b70a6bf91280ec` (canonical SHA-256
`fc3f2af2bdfa911c99cf143ec248ae51654297d40b949fa95f8b8866bf897276`) as the original
pre-registration. v2 is **not** a rewrite of v1.

## Why v2

`protocolV2Reason`: assets became available and two metric-implementation bugs were
corrected **before any v2 model prediction was produced**. v2 inherits every v1 lock
unchanged (data SHA, label SHA, the 8 systems, main metric, subsets, statistical methods,
inference parameters, label-leakage boundary) and adds asset + scoring-implementation
locks plus the two metric fixes. PR #15 merged at `fc71bb430b5f5bf365d3a7a42c22304a9e048f37`.

## Frozen experiment identity (inherited from v1, unchanged)

- Input file `ml/data/lan_challenge_capture/model-inputs.jsonl`, SHA-256 `c77f4949…b8c3`, 413 samples.
- Reference-label file `ml/data/lan_challenge_capture/adjudication/final-labels.jsonl`, SHA-256 `13fd71f5…d8ad`, distribution `{safe:209, attack:97, unknown:107}`.
- System prompt `ml/evaluation/lan_challenge/system-prompt.txt`, SHA-256 `9b07be6e…4cd8`.

## The 8 locked systems (inherited from v1)

1. `rules-baseline` — **offline repository detection-engine adapter** (Option A provenance; runs `buildSeedDetectionRules`+`evaluateDetectionRules` from the frozen engine; manifest locked below).
2. `char-ngram-logreg` — char n-gram (3,5), minDf 2, maxFeatures 250000, classWeight balanced, liblinear, randomState 20260728; trained on train+validation only.
3. `qwen3-4b-zero-shot` — `Qwen/Qwen3-4B-Instruct-2507` @ `cdbee75f17c01a7cc42f958dc650907174af0554`.
4. `qwen3-4b-few-shot` — same model/revision; frozen v2 example manifest.
5. `aetherargus-v02-hf-lora` — PEFT adapter `ml/output/aetherargus-v02-lora/` over the locked base model.
6. `aetherargus-v02-merged-bf16` — adapter merged into the base model (no retraining).
7. `aetherargus-v02-gguf-q4-k-m` — Q4_K_M GGUF.
8. `aetherargus-v02-ollama-f16` — f16 GGUF (Ollama path).

**Main metric:** 3-class verdict classification (safe/attack/unknown); headline scalar is verdict Macro-F1 with accuracy. Safe FPR is defined strictly as `reference=safe ∧ prediction=attack / all reference-safe rows`.

**Inference defaults (inherited):** temperature 0, topP 1, topK 0, seed 0, maxContextTokens 2048, maxNewTokens 320, system+user message structure, append-and-flush per sample, resume skips completed sampleIds. Few-shot adds frozen example turns sized so the full few-shot prompt still fits 2048 for every input.

**Subsets (inherited):** all_413, context_sufficient_true/false, consensus, model_adjudication, safe, attack, unknown, prompt_injection, authorization, idor_bola, sqli, xss, command_injection, path_traversal, ssrf. Cohort subsets remain NOT_AVAILABLE (no verified sampleId→cohort mapping; not inferred from outcomes).

**Statistical methods (inherited + extended):** 10,000-draw reference-verdict-stratified bootstrap (seed 20260731); paired McNemar (exact) vs `aetherargus-v02-hf-lora`; paired stratified-bootstrap difference (seed 20260731); Holm-Bonferroni; **Clopper-Pearson exact and Wilson score intervals** for proportion metrics (NEW in v2).

## Metric-implementation fixes locked by v2 (see `protocol-amendments.md`)

- **stat-issue-4.1** — proportion metrics (safeFPR, accuracy, attackRecall, attackPrecision, unknownAccuracy) now report `pointEstimate + numerator + denominator + clopperPearson95 + wilson95 + bootstrap95`. A zero-event rate (e.g. safe FPR 0/209) reports a non-degenerate exact/Wilson upper bound, never only `[0,0]`. No re-run required.
- **stat-issue-4.2** — attack-family Macro-F1 label set is `reference_attack_families_only`: a predicted `none` on a reference-attack row is a false negative for the true family (still wrong) but adds no support=0 denominator class. No re-run required.

## v2 asset + scoring-implementation locks

| Lock | SHA-256 / value |
| --- | --- |
| rules-baseline manifest | `f49e2738…61e3` (`rules-baseline-manifest.json`) |
| rules engine adapter | `73913a25…c3f2` (`rules_engine_adapter.ts`) |
| few-shot manifest (file) | `3dce86bf…a069` (`few-shot-examples-v2.json`) |
| few-shot payload | `e17c38a1…df5b` (11 examples: 1 safe + 1 unknown + 9 attack families) |
| training asset | `e8ff084f…c3e1` (`train.jsonl`) |
| validation asset | `ea6f3d07…5606` (`validation.jsonl`) |
| LoRA adapter weights | `3f786390…ea2d` (`adapter_model.safetensors`) |
| LoRA adapter config | `6d8ec692…14b0` (`adapter_config.json`) |
| base model / revision | `Qwen/Qwen3-4B-Instruct-2507` @ `cdbee75f…0554` (fingerprint files verified byte-equal) |
| merged-BF16 provenance | `c74bd457…bd9b` (`merge-summary.json`) |
| Q4_K_M GGUF | `5d17d15c…a8ed` |
| f16 GGUF | `7f134c21…ce48` |
| system prompt | `9b07be6e…4cd8` |
| scoring implementation | `74ebf031…0a684` (scoring.py + statistical-analysis.py) |

## Integrity / leakage boundary (inherited, unchanged in spirit)

Separate inference and scoring processes; inference reads only model-inputs, model/tokenizer
artifacts, `system-prompt.txt`, and `few-shot-examples-v2.json`. Labels are opened only after
predictions complete. Response-side evidence, collector ground truth, and any challenge-set use
for few-shot / prompt / threshold tuning are all disallowed. `challengeSetUsedForTuning: false`,
`labelsMutableAfterEvaluation: false`, `humanReviewed: false`, `reviewerCount: 0`.

## Hash semantics

`protocolSha256` = SHA-256 of the canonical UTF-8 JSON (sort_keys, compact separators) with
`protocolSha256` set to the empty string, plus a trailing newline. Value:
`b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb`.
