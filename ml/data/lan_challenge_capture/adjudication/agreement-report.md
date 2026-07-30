# VIguard LAN Challenge Set — Dual-LLM Annotation Agreement Report

Mechanically computed from `model-a-annotations.jsonl` (annotator A = **GPT-5.6-SOL**) and
`model-b-annotations.jsonl` (annotator B = **Claude Opus 5**), aligned on `sampleId` against
`model-inputs.jsonl`. No LLM API, no collector labels, no response fields used.

## Inputs (frozen)
- sampleCount: **413**
- model-inputs.jsonl sha256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- model-a-annotations.jsonl sha256: `381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662`
- model-b-annotations.jsonl sha256: `9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357`

## 6.1 Verdict
- observed agreement: **383/413 = 92.74%**
- Cohen's kappa: **0.8651**  (Po=0.9274, Pe=0.4616)
- marginal A: {"safe":244,"attack":129,"unknown":40}
- marginal B: {"safe":257,"attack":110,"unknown":46}
- agreement by label: {"safe":243,"attack":110,"unknown":30}
- safe↔attack severe conflicts: **4**
- attack↔unknown: 15
- safe↔unknown: 11

### Verdict confusion (rows = A, cols = B)

| A \ B | safe | attack | unknown |
|---|---:|---:|---:|
| safe | 243 | 0 | 1 |
| attack | 4 | 110 | 15 |
| unknown | 10 | 0 | 30 |

## 6.2 Attack family
- full agreement: **380/413 = 92.01%**
- macro agreement rate: 72.91%
- verdict-agree but family-disagree: 18
- families used by A only: api_abuse, protocol_attack
- families used by B only: unknown

## 6.3 Recommended action
- full agreement: **365/413 = 88.38%**
- allow↔block: 0; allow↔challenge: 6; monitor↔block: 3; challenge↔block: 15

## 6.4 Other fields
- contextSufficient agreement: 387/413 = 93.70%
- needsExpertReview agreement: 379/413 = 91.77% (both=192, onlyA=12, onlyB=22)
- confidence A: mean=4.53 median=5; B: mean=3.78 median=4
- both high-conf (≥4) but core label disagree: 16
- |Δconfidence| distribution: {"0":128,"1":267,"2":3,"3":15}

## Queue / consensus split
- auto-consensus: **160**
- adjudication queue: **253**

_Consensus is applied conservatively: per §7.9/§7.10, samples carrying a high-risk family
(authorization/idor_bola/business_logic/prompt_injection/authentication/file_upload/ssrf/deserialization)
or any unknown verdict are adjudicated even when the two annotators fully agreed, to guard against
correlated LLM errors in the highest-bias categories._
