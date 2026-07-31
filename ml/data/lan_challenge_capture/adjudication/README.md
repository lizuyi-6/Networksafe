# VIguard LAN Challenge Set — AI-Assisted Adjudication and Confidential Human Review

Third-model adjudication of two independent AI annotation sets for the 413-sample VIguard LAN challenge capture produced the frozen reference-label set before AetherArgus evaluation. A complete confidential blind human review was subsequently conducted outside the public repository and confirmed all 413 labels with zero changes.

## Identities

- **Annotator A:** GPT-5.6-SOL → `annotations/model-a-annotations.jsonl`
- **Annotator B:** Claude Opus 5 → `annotations/model-b-annotations.jsonl`
- **Adjudicator C:** GLM-5.2 (Zhipu AI), operator-confirmed
- **Human review:** identities, reviewer count, worksheets, and raw materials retained in a restricted environment

## Pipeline

```bash
cd <repo-root>
node ml/data/lan_challenge_capture/adjudication/compare-annotations.js
node ml/data/lan_challenge_capture/adjudication/apply-context-visibility-corrections.js
node ml/data/lan_challenge_capture/adjudication/build-outputs.js
node ml/data/lan_challenge_capture/adjudication/build-manifest.js
node ml/data/lan_challenge_capture/adjudication/build-report.js
node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js
```

The adjudicator decisions remain in `decisions/batch-0[1-8].jsonl`. The public human-review attestation is:

```text
ml/data/lan_challenge_capture/human-review/human-review-attestation.json
```

## Key invariants

- `final-labels.jsonl` contains exactly 413 rows: 160 strict consensus and 253 third-model adjudications.
- All rows remain `eligibleForTraining=false` and `split=external_challenge_test`.
- AI-side context-visibility audit covered 413/413 samples and corrected 68 labels before evaluation.
- Confidential blind human review covered 413/413 samples after evaluation.
- Human-vs-frozen-reference disagreement count: 0.
- Final label changes after human review: 0.
- Reviewer identities, reviewer count, worksheets, and raw materials are withheld for confidentiality.
- Final-label SHA-256 remains `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`.
- Cohen's kappa for the two AI annotation sets is Po=0.927361, Pe=0.461620, kappa=0.865078.
- `labelsFrozenAt` tracks label-byte changes; post-evaluation human-review metadata does not move that timestamp when label bytes remain unchanged.
- No AetherArgus predictions, model metrics, response-side fields, or collector ground truth were used for AI labeling or blind human review.

## Publication wording

Use:

> AI-assisted reference labels subsequently confirmed through confidential blind human review

or:

> confidentially human-reviewed reference labels

Do not claim publicly reproducible raw human annotations, infallible objective ground truth, or natural production traffic.
