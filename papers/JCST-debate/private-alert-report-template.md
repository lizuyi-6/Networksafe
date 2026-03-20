# Private Labeled-Alert Reporting Template

This template matches the second evidence layer described in the manuscript.
Do not replace public-layer numbers with private data until every metric below
can be traced to a reproducible artifact.

## Dataset Summary

- Dataset name:
- Total labeled alerts:
- Distinct protected applications:
- Time span covered:
- Label space:
- Collection path or export source:
- Annotation owner:
- Annotation guidelines location:

## Split Policy

- Timestamp available: yes / no
- If yes: early 70% / middle 10% / late 20%
- If no: fixed-seed stratified 80/20
- Threshold calibration set:
- Final test slice:
- Random seed if used:

## Baselines

Report all three baselines with the same labels and preprocessing.

| Baseline | Accuracy | Precision | Recall | F1 | False positives | False negatives | Debate trigger ratio | Average debate rounds | Mean orchestration latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `single_agent` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `multi_agent_no_debate` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `multi_agent_with_debate` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Required Error Analysis

- At least 10 representative false positives before debate:
- At least 10 representative false positives after debate:
- Benign requests most often escalated incorrectly:
- Attack families most affected by debate:
- Cases where debate hurt precision or recall:

## Role-Specialization Ablation

| Setting | Accuracy | Precision | Recall | F1 | False positives | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Full debate with role specialization | TBD | TBD | TBD | TBD | TBD | TBD |
| Debate without role specialization | TBD | TBD | TBD | TBD | TBD | TBD |
| No debate | TBD | TBD | TBD | TBD | TBD | TBD |

## Artifact Traceability

- Raw result file:
- Summary markdown:
- Evaluation script:
- Commit hash:
- Reviewer / verifier:
