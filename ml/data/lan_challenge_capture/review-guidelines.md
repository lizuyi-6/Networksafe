# Confidential Blind Human Review Protocol — VIguard LAN Challenge Set

## Current status

The paper-facing frozen reference labels have completed confidential blind human review.

- Review coverage: **413/413** model-visible challenge samples.
- Human-vs-frozen-reference disagreements: **0**.
- Final label changes required: **0**.
- Final-label SHA-256 before and after review:
  `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`.
- Public attestation:
  `ml/data/lan_challenge_capture/human-review/human-review-attestation.json`.

Reviewer identities, reviewer count, worksheets, and raw review material are retained in a restricted environment and are not committed to the public repository.

## Scope distinction

This document describes the review of the **paper-facing frozen reference labels** in:

```text
ml/data/lan_challenge_capture/adjudication/final-labels.jsonl
```

It does not retroactively rewrite the original collector-assigned fields or capture-level metadata in the full evidence bundle. Capture metadata may preserve its historical review status, while the final-label manifest records the completed post-evaluation human review.

Authoritative publication-time status is stored in:

```text
ml/data/lan_challenge_capture/adjudication/final-labels-manifest.json
ml/data/lan_challenge_capture/human-review/human-review-attestation.json
ml/reports/lan-challenge-evaluation/human-review-publication-supplement.json
```

## Blind-review conditions

The review was conducted outside the public repository in a restricted environment.
Before making their decisions, human reviewers did not see:

- annotator A labels;
- annotator B labels;
- the third-model adjudication decisions;
- AetherArgus predictions;
- AetherArgus evaluation metrics or error lists.

Reviewers assessed the same model-visible request-side inputs used by the evaluated systems. Human decisions were compared with the frozen AI-assisted reference labels only after the blind decisions were complete.

## Review outcome

The post-review comparison produced:

```text
reviewed samples:                    413
confirmed frozen reference labels:  413
human/reference disagreements:        0
final-label changes:                  0
```

Because `final-labels.jsonl` remained byte-identical, the existing model predictions, scoring outputs, confidence intervals, significance tests, tables, and figures remain applicable. No model rerun or rescoring was required.

## Confidentiality model

Human reviewers did not operate the public repository. The repository stores only an operator-confirmed, SHA-bound attestation of:

- review completion;
- complete sample coverage;
- blind-review constraints;
- zero disagreements;
- zero label changes;
- the unchanged final-label hash.

This design prevents reviewer identity, confidential worksheets, benchmark-sensitive notes, and operational information from being exposed through repository history.

## Labeling principles retained

The human review preserved the following task definitions:

- `safe`: the visible request does not provide sufficient evidence of an attack;
- `attack`: the visible request provides sufficient evidence of malicious or prohibited intent;
- `unknown`: material identity, role, ownership, tenant, or server-side semantics required for a reliable decision are absent from the model-visible input;
- unsuccessful exploitation does not automatically make a malicious attempt safe;
- security-related keywords alone do not automatically make a benign request an attack;
- no response-side evidence or collector ground truth may be used to justify the model-facing verdict.

## Validation

Run from the repository root:

```bash
node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js
```

The validators check the final-label SHA, attestation SHA, complete 413-sample coverage, blind-review declarations, zero disagreements, zero label changes, and consistency across manifests and reports.

## Publication terminology

Recommended:

> The reference labels were produced through dual-AI annotation and third-AI adjudication, then subsequently confirmed through a confidential blind human review conducted outside the public repository. The review covered all 413 samples and produced zero label changes.

Use the compact term:

> confidentially human-reviewed reference labels

Do not claim:

- publicly reproducible raw human annotations;
- independently auditable reviewer identities or worksheets;
- infallible or universally generalizable objective ground truth;
- representative natural production traffic.
