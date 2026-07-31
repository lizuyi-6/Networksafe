# VIguard LAN Challenge Set — AI-Assisted Adjudication and Confidential Blind Human Review Report

## 1. Provenance

- **Annotator A:** GPT-5.6-SOL
- **Annotator B:** Claude Opus 5
- **Adjudicator C:** GLM-5.2 (Zhipu AI), operator-confirmed
- **Input:** `ml/data/lan_challenge_capture/model-inputs.jsonl`
- **Input SHA-256:** `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- **Annotator A SHA-256:** `381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662`
- **Annotator B SHA-256:** `9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357`
- **Samples:** 413

## 2. AI inter-annotator agreement

| Metric | Value |
|---|---:|
| Verdict agreement | 383/413 = 92.74% |
| Cohen's kappa | 0.865078 |
| Attack-family full agreement | 92.01% |
| Attack-family macro agreement | 72.91% |
| Recommended-action agreement | 88.38% |
| `contextSufficient` agreement | 93.70% |

Verdict conflicts before adjudication: safe↔attack = 4, attack↔unknown = 15, safe↔unknown = 11.

## 3. AI adjudication outcome

| Outcome | Count |
|---|---:|
| Strict auto-consensus | 160 |
| Third-model adjudication | 253 |
| Accept annotator A | 137 |
| Accept annotator B | 12 |
| Insufficient context | 104 |

## 4. Frozen reference labels

- Verdict distribution: `safe=209`, `attack=97`, `unknown=107`.
- Final-label SHA-256: `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`.
- Labels frozen at: `2026-07-30T16:02:03.000Z`.
- The label bytes did not change after model evaluation or after human review.

## 5. Model-visible-context audit

- Audited: **413/413** inputs.
- Hidden-context corrections before evaluation: **68**.
- Unchanged after that audit: **345**.
- Response-side evidence used: **no**.
- Collector ground truth used: **no**.

## 6. Confidential blind human review

A complete blind human review was performed after the frozen model evaluation.

- Coverage: **413/413** samples.
- Human-vs-frozen-reference disagreements: **0**.
- Label changes required: **0**.
- Reviewers were blind to annotator A/B labels, the third-model decision, AetherArgus predictions, and evaluation metrics before making their decisions.
- Reviewer identities, reviewer count, worksheets, and raw review materials are retained outside the public repository in a restricted environment.
- Human-review attestation: `ml/data/lan_challenge_capture/human-review/human-review-attestation.json`.
- Attestation SHA-256: `2c273945369cf41d98fe02072518b01151e17e2d98a5642e657dc3be2b5b9cbd`.

Because `final-labels.jsonl` remained byte-identical, the existing model predictions, scoring results, confidence intervals, significance tests, tables, and figures remain applicable. No model rerun or rescoring was required.

## 7. Publication terminology

Recommended wording:

> The reference labels were produced through dual-AI annotation and third-AI adjudication, then subsequently confirmed through a confidential blind human review conducted outside the public repository. The review covered all 413 samples and produced zero label changes.

Use **confidentially human-reviewed reference labels**.

Do not describe the dataset as:

- publicly reproducible raw human annotations;
- infallible objective ground truth;
- natural production traffic.

## 8. Limitations

- The public human-review evidence is an operator-confirmed attestation; raw reviewer records are confidential and not independently auditable from this repository.
- Human review occurred after the frozen model evaluation, although the unchanged label hash preserves the applicability of the existing scoring.
- The three AI systems may share systematic biases.
- Annotator B used a deterministic rule program authored within one model session, creating intra-class correlation risk.
- The dataset is an authorized challenge capture, not natural production traffic.
- The benchmark contains no confirmed successful exploit executions.
- Human confirmation does not make the reference labels universally generalizable or error-free.

## 9. Validation

```bash
node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js
```
