# VIguard LAN Challenge Set — Dual-LLM Adjudication

Third-party adjudication of the two independent LLM annotation sets for the VIguard LAN
challenge capture (`model-inputs.jsonl`, 413 samples), producing a frozen ground-truth label
set **before** AetherArgus is evaluated on this set.

## Identities
- **Annotator A:** GPT-5.6-SOL → `annotations/model-a-annotations.jsonl`
- **Annotator B:** Claude Opus 5 → `annotations/model-b-annotations.jsonl`
- **Adjudicator C:** GLM-5.2 (Zhipu AI) — operator-confirmed identity (the harness session label differs; the exact build cannot be self-verified from inside the session, per the same limitation annotator B documented).

## Pipeline (run in order; each script is hermetic — no LLM API, no network)
```bash
cd <repo-root>
node ml/data/lan_challenge_capture/adjudication/compare-annotations.js   # Phase 1+2: integrity, metrics, queue, consensus
node ml/data/lan_challenge_capture/adjudication/build-outputs.js         # Phase 4+5: adjudication.jsonl + final-labels.jsonl (413)
node ml/data/lan_challenge_capture/adjudication/build-manifest.js        # Phase 5: final-labels-manifest.json (SHA + counts)
node ml/data/lan_challenge_capture/adjudication/build-report.js          # Phase 6: adjudication-report.{md,json}
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js # Phase 6: 15-check validator (exit 0 = pass)
```
The adjudicator's per-sample decisions live in `decisions/batch-0[1-8].jsonl` and are joined
to the queue by `build-outputs.js`; they are the auditable record of adjudicator C.

## Key invariants
- `final-labels.jsonl` = exactly 413 rows = 160 strict-consensus + 253 adjudicated.
- All rows `eligibleForTraining=false`, `split=external_challenge_test`.
- `humanReviewed=false`, `reviewerCount=0` (two AI annotators + one AI adjudicator ≠ human review).
- `requiresHumanAudit=true` on 251/413 rows — a **sampling queue**, not completed review.
- Final labels were frozen before AetherArgus evaluation. No AetherArgus predictions, collector
  ground truth, or response-side fields were read or used. See `adjudication-report.md`.
