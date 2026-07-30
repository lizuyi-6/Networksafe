# Human Review Guidelines — VIguard LAN Live-Execution Challenge Set

This document defines the manual adjudication workflow for the Authorized LAN
Live-Execution Challenge Set. **As of this commit, no human review has been performed** —
the dataset manifest honestly reports `humanReviewed=false`, `reviewerCount=0`,
`interAnnotatorAgreement=null`, `cohenKappa=null`, `adjudicatedSamples=0`. Do not mark any
of these true until the process below has actually been executed and recorded.

## Why review is required

The current `groundTruth` labels are **collector-assigned from the test design**, not
independently adjudicated. Two specific failure modes this review exists to catch:

1. **Outcome-bias mislabel.** A request whose exploit did *not* succeed is still a
   *malicious attempt*. A failed SQLi/XSS/IDOR attempt must keep `verdict=attack` with
   `requestIntent=malicious_attempt` and `exploitOutcome=not_confirmed`. Do **not** relabel
   it `benign` merely because `exploitConfirmed=false`.
2. **Keyword-bias mislabel.** A *normal* request that merely contains a security term
   (e.g. a benign search for "sql injection" in documentation, a postmortem note naming a
   CVE) is **not** an attack. These belong in hard-negatives with
   `requestIntent=benign_resembling_attack` and `verdict=benign`.

## Two-axis labeling (never conflate)

Every sample is labeled on **two independent axes**:

| Axis | Question | Values |
|---|---|---|
| `requestIntent` | What was the requester *trying* to do? | `malicious_attempt`, `prompt_injection_attempt`, `benign_operational`, `benign_resembling_attack`, `ambiguous_or_inconclusive` |
| `exploitOutcome` | Was the attempt *confirmed* to succeed against the target? | `confirmed`, `not_confirmed`, `not_applicable` |

`exploitOutcome` is **evidence-bound**: it may only be `confirmed` when the captured
response contains the planted canary/marker (see `executionEvidence`). It is independent of
`requestIntent`.

## Per-sample fields a reviewer must assign

For each `sampleId` in `review-queue.jsonl`, the reviewer records:

- `verdict` — `attack` | `benign` | `unknown`
- `attackFamily` — one of the schema enum, or `null` when `verdict=benign`
- `recommendedAction` — `allow` | `block` | `review` | `monitor`
- `contextSufficient` — boolean (false ⇒ `verdict=unknown`)
- `requestIntent` — see two-axis table
- `exploitOutcome` — see two-axis table
- `rationale` — one sentence citing the *request-side* evidence (not the response) that
  justifies the verdict

## Process (two independent reviewers + adjudication)

1. **Blinding.** Reviewers label from `review-queue.jsonl`, which withholds the collector's
   category and the response status, to reduce anchor bias and outcome bias.
2. **Reviewer A** independently labels all samples → fills `reviewerA` block.
3. **Reviewer B** independently labels all samples → fills `reviewerB` block. A and B must
   not see each other's labels until both are complete.
4. **Agreement metrics.** Compute observed agreement and Cohen's kappa over the primary
   `verdict` field across all samples. Record in the manifest
   (`interAnnotatorAgreement`, `cohenKappa`, `reviewerCount=2`).
5. **Adjudication.** For every sample where A and B disagree on `verdict`, a third party
   (or A+B jointly) resolves using `adjudication-template.json`; the resolution and its
   rationale are recorded. `adjudicatedSamples` = count of disagreements resolved.
6. **Write-back.** Only after steps 1–5 are genuinely complete may the manifest be updated:
   `humanReviewed=true`, `reviewerCount=2`, real kappa, real adjudicated count. The
   `groundTruth` in the dataset is then updated to the adjudicated labels.

## Consistency rules reviewers must honor

- `verdict=attack` ⇒ `attackFamily != null` and `recommendedAction ∈ {block, review, monitor}`.
- `verdict=benign` ⇒ `attackFamily == null`.
- `verdict=unknown` ⇒ `contextSufficient == false` and `recommendedAction ∈ {review, monitor}`.
- `isHardNegative=true` ⇒ `verdict=benign` and `requestIntent=benign_resembling_attack`.
- `exploitOutcome=confirmed` requires a canary/marker in the captured response; otherwise
  use `not_confirmed` (for attack/PI) or `not_applicable` (for benign/unknown).
