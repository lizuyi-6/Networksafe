# VIguard LAN Challenge Set — Dual-LLM Annotation Adjudication Report

## 1. Provenance and identities

- **Annotator A:** GPT-5.6-SOL (model-a-annotations.jsonl)
- **Annotator B:** Claude Opus 5 (model-b-annotations.jsonl)
- **Adjudicator C:** GLM-5.2 (Zhipu AI) acting as independent third-party adjudicator C
- **Input:** `ml/data/lan_challenge_capture/model-inputs.jsonl`
- **Input SHA-256:** `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- **Annotator A SHA-256:** `381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662`
- **Annotator B SHA-256:** `9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357`
- **Sample count:** A = 413, B = 413 (both exactly 413, identical sampleId sets, no duplicates)

## 2. Mechanical inter-annotator agreement (Phase 2)

| Metric | Value |
|---|---:|
| Verdict observed agreement | 383/413 = 92.74% |
| **Cohen's kappa (verdict)** | **0.865078** (Po=0.927361, Pe=0.461620) |
| Attack family full agreement | 92.01% |
| Attack family macro agreement | 72.91% |
| Recommended action full agreement | 88.38% |
| contextSufficient agreement | 93.70% |

Verdict conflicts: safe↔attack (severe) = **4**; attack↔unknown = 15; safe↔unknown = 11.

## 3. Resolution outcome (Phase 3 + Phase 4)

| Outcome | Count |
|---|---:|
| Auto-consensus (strict, unmodified) | 160 |
| Third-party adjudication (queue) | 253 |
| → accept A | 137 |
| → accept B | 12 |
| → new_resolution | 0 |
| → insufficient_context (final verdict unknown) | 104 |

Accepted annotator (when a side was accepted): A = 137, B = 12, neither (insufficient_context/new_resolution) = 104.

## 4. Final frozen-label distribution

- **Verdict:** {"safe":209,"unknown":107,"attack":97} (final unknown count = 107)
- **Recommended action:** {"allow":138,"challenge":107,"block":95,"isolate":2,"monitor":71}
- **Attack family:** {"none":209,"authorization":26,"idor_bola":40,"sqli":23,"xss":10,"command_injection":8,"path_traversal":9,"ssrf":7,"business_logic":3,"file_upload":2,"csrf":1,"cors":1,"prompt_injection":56,"authentication":7,"protocol_attack":11}
- **final-labels.jsonl SHA-256:** `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- **labelsFrozenAt:** 2026-07-30T16:02:03.000Z (UTC) — the last time the bytes of `final-labels.jsonl` changed.
- **provenanceMetadataCorrectedAt:** 2026-07-30T16:02:03.000Z (UTC).
- Metadata corrections do not alter the label-freeze timestamp unless the byte content of `final-labels.jsonl` changes.

## 5. Context-visibility audit

- Audited model-visible inputs: **413/413** (253 model-adjudication + 160 consensus).
- Hidden-context issues corrected: **68**; unchanged labels: **345**.
- Issue categories: {"principal_role_missing":26,"object_ownership_missing":23,"tenant_boundary_missing":0,"server_execution_semantics_missing":19,"response_side_dependency":0,"collector_intent_dependency":0,"other":0}.
- Response-side evidence used: **no**; Collector Ground Truth or collector intent used: **no**.
- Full audit: `context-visibility-audit.{json,md}`.

## 6. Human-audit sampling list

- Samples flagged `requiresHumanAudit=true`: **251** / 413.
- `humanReviewed=false`, `reviewerCount=0`. Two AI annotators + one AI adjudicator do **not** constitute human review; this list is a sampling queue, not completed review.

## 7. Mandatory declarations

- This is **dual-LLM independent annotation (A + B) followed by a third-LLM adjudication (C)** — not human annotation.
- The challenge traffic is **pre-designed, live-captured synthetic attack-attempt traffic against an authorized target** — **not production / naturally-occurring traffic**.
- **No AetherArgus predictions, model evaluation metrics, or model error lists were read or used.** Final labels were frozen before evaluating AetherArgus on the VIguard LAN challenge set.
- **No response-side evidence was used** (no responseStatus / responseBody / responseSanitized / executionEvidence / exploitConfirmed / canaryObserved). Final reference labels are bounded by the corresponding `model-inputs.jsonl` row and endpoint semantics directly inferable from the request. Environment, endpoint-inventory, and role-matrix files are provenance aids only and are not decisive label evidence.
- **The challenge set was not added to any training/validation set** (`eligibleForTraining=false`, `split=external_challenge_test` for all 413).
- **Annotator B's labels were produced by a deterministic rule-based program** (`annotations/_build-b.js`) authored by the model in a single session, whereas annotator A produced per-sample judgments directly. This asymmetry creates **intra-class correlation risk** for B's labels (all B labels follow one rule set, so B-vs-B internal consistency is not evidence of independent correctness).
- **A third-LLM adjudicator cannot eliminate systematic bias that the annotator models share** (e.g. a common misreading of the `/api/admin/tenant-oversight` boundary or a shared blind spot on stored-vs-parsed fields). The kappa and agreement numbers reflect LLM-vs-LLM agreement, not ground-truth accuracy.

## 8. Known limitations

- Annotator B labels were produced by a deterministic rule program authored in one model session, creating intra-class correlation risk.
- The three AI systems may still share common training-data or safety-policy biases.
- AI annotation and AI adjudication do not constitute human review.
- Samples requiring identity, role, ownership, tenant-boundary, or server-side execution semantics may remain unknown when those facts are absent from the model-visible input.
- The dataset is an authorized live-execution challenge set, not natural production traffic.
- The benchmark does not contain confirmed successful exploits.
- Reference labels should not be described as objective human-verified ground truth.

## 9. Artifacts

All under `ml/data/lan_challenge_capture/adjudication/`: `compare-annotations.js`, `apply-context-visibility-corrections.js`, `build-outputs.js`, `build-manifest.js`, `validate-context-visibility.js`, `validate-adjudication.js`, `build-report.js`, `context-visibility-audit.{json,md}`, `agreement-report.{json,md}`, the three confusion matrices, `disagreement-queue.jsonl`, `consensus.jsonl`, `adjudication-worksheet.jsonl`, `decisions/batch-0[1-8].jsonl`, `adjudication.jsonl`, `final-labels.jsonl`, `final-labels-manifest.json`, `adjudication-report.{json,md}`, `build-stats.json`, `integrity-check.json`.

Validation commands: `node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js` and `node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js`.
