# VIguard LAN Challenge Set — Dual-LLM Annotation Adjudication Report

## 1. Provenance and identities

- **Annotator A:** GPT-5.6-SOL (model-a-annotations.jsonl)
- **Annotator B:** Claude Opus 5 (model-b-annotations.jsonl)
- **Adjudicator C:** Claude (Opus-class) acting as independent third-party adjudicator C
- **Input:** `ml/data/lan_challenge_capture/model-inputs.jsonl`
- **Input SHA-256:** `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- **Annotator A SHA-256:** `381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662`
- **Annotator B SHA-256:** `9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357`
- **Sample count:** A = 413, B = 413 (both exactly 413, identical sampleId sets, no duplicates)

## 2. Mechanical inter-annotator agreement (Phase 2)

| Metric | Value |
|---|---:|
| Verdict observed agreement | 383/413 = 92.74% |
| **Cohen's kappa (verdict)** | **0.8651** (Po=0.927361, Pe=0.46162) |
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
| → accept A | 197 |
| → accept B | 20 |
| → new_resolution | 0 |
| → insufficient_context (final verdict unknown) | 36 |

Accepted annotator (when a side was accepted): A = 197, B = 20, neither (insufficient_context/new_resolution) = 36.

## 4. Final frozen-label distribution

- **Verdict:** {"safe":251,"unknown":39,"attack":123} (final unknown count = 39)
- **Recommended action:** {"allow":138,"monitor":113,"challenge":39,"block":121,"isolate":2}
- **Attack family:** {"none":251,"idor_bola":17,"authorization":7,"sqli":23,"xss":10,"command_injection":8,"path_traversal":9,"ssrf":7,"business_logic":3,"file_upload":2,"csrf":1,"cors":1,"prompt_injection":56,"authentication":7,"protocol_attack":11}
- **final-labels.jsonl SHA-256:** `4fb2ad16836c6b53adbfa7ef9191b8e064b8e21129c383456e354f0a904336dc`
- **frozenAt:** 2026-07-30T15:29:06.230Z (UTC) — before evaluating AetherArgus on this set.

## 5. Human-audit sampling list

- Samples flagged `requiresHumanAudit=true`: **251** / 413.
- `humanReviewed=false`, `reviewerCount=0`. Two AI annotators + one AI adjudicator do **not** constitute human review; this list is a sampling queue, not completed review.

## 6. Mandatory declarations

- This is **dual-LLM independent annotation (A + B) followed by a third-LLM adjudication (C)** — not human annotation.
- The challenge traffic is **pre-designed, live-captured synthetic attack-attempt traffic against an authorized target** — **not production / naturally-occurring traffic**.
- **No AetherArgus predictions, model evaluation metrics, or model error lists were read or used.** Final labels were frozen before evaluating AetherArgus on the VIguard LAN challenge set.
- **No response-side evidence was used** (no responseStatus / responseBody / responseSanitized / executionEvidence / exploitConfirmed / canaryObserved). Adjudication used request-side evidence plus the permitted environment context (role-permission-matrix, endpoint-inventory, environment).
- **The challenge set was not added to any training/validation set** (`eligibleForTraining=false`, `split=external_challenge_test` for all 413).
- **Annotator B's labels were produced by a deterministic rule-based program** (`annotations/_build-b.js`) authored by the model in a single session, whereas annotator A produced per-sample judgments directly. This asymmetry creates **intra-class correlation risk** for B's labels (all B labels follow one rule set, so B-vs-B internal consistency is not evidence of independent correctness).
- **A third-LLM adjudicator cannot eliminate systematic bias that the annotator models share** (e.g. a common misreading of the `/api/admin/tenant-oversight` boundary or a shared blind spot on stored-vs-parsed fields). The kappa and agreement numbers reflect LLM-vs-LLM agreement, not ground-truth accuracy.

## 7. Known limitations

- **Object ownership is not observable** in any sample: all direct-object-reference reads/actions on `/api/{alerts,agents,devices,admin/users,traffic}/[RESOURCE_ID]` are labelled `unknown` (idor_bola), not a definite verdict, regardless of how benign the note body looks.
- **The acting principal's effective RBAC is only partially documented.** `role-permission-matrix.json` records that `tenant_admin` is denied on `/api/admin/tenant-oversight/*`, `PUT /api/admin/users/:id/role`, and `POST /api/admin/tenant-oversight/exports`; requests to those are labelled `attack` (authorization). Endpoints not in the matrix whose permissibility is genuinely ambiguous (e.g. `PUT /api/admin/users/:id/plan`) are labelled `unknown`, and authenticated admin-namespaced reads (`GET /api/admin/users`) are labelled `safe` with a `requiresHumanAudit` flag because tenant_admin's access is not request-observable.
- **Stored-vs-parsed field position is not observable.** Bare attack payloads placed in a `note`/`q` field that may be storage-only (e.g. samples 000397–000404) were adjudicated `attack` on probe intent (systematic, no business narrative) but with reduced confidence and a human-audit flag, since success depends on whether the field reaches an interpreter.
- **api_abuse / rate-dependent verdicts cannot be confirmed from a single request** (e.g. `limit=1000/2000`, `limit=0`, negative pagination): adjudicated `safe`/`monitor`, not `attack`, because abuse is a volume phenomenon invisible in one sample.
- **Malformed/truncated bodies** (samples 000370–000380, 000410, 000413) are `unknown`: parser-fuzzing vs client defect is indistinguishable from the request alone.
- **B-side intra-class correlation** (see §6) means agreement metrics may overstate label reliability for rule-determined categories.

## 8. Artifacts

All under `ml/data/lan_challenge_capture/adjudication/`: `compare-annotations.js`, `build-outputs.js`, `build-manifest.js`, `validate-adjudication.js`, `build-report.js`, `agreement-report.{json,md}`, the three confusion matrices, `disagreement-queue.jsonl`, `consensus.jsonl`, `adjudication-worksheet.jsonl`, `decisions/batch-0[1-8].jsonl`, `adjudication.jsonl`, `final-labels.jsonl`, `final-labels-manifest.json`, `adjudication-report.{json,md}`, `build-stats.json`, `integrity-check.json`.

Validation command: `node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js` → all 15 checks pass (exit 0).
