# Publication Supplement: Confidential Blind Human Review

This supplement updates the publication-time interpretation of the frozen evaluation report without rewriting its historical evaluation-time state.

## What changed

After the AetherArgus frozen-set evaluation was completed, a confidential blind human review was conducted outside the public repository.

- Coverage: **413/413** samples.
- Human-vs-frozen-reference disagreements: **0**.
- Label changes: **0**.
- Final-label SHA-256 remained `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`.
- Model predictions, scoring, statistics, tables, and figures did not require rerunning.

Reviewers were blind to annotator A/B outputs, the third-model adjudication, AetherArgus predictions, and evaluation metrics before making their decisions. Reviewer identities, reviewer count, worksheets, and raw materials are retained in a restricted environment.

## Publication wording

Replace the historical evaluation-time statement:

> The reference labels were not human-verified ground truth.

with:

> The reference labels were generated through dual-AI annotation and third-AI adjudication, then subsequently confirmed through a confidential blind human review conducted outside the public repository. The review covered all 413 samples and produced zero label changes.

Use the term **confidentially human-reviewed reference labels**. Do not claim publicly reproducible raw human annotations, infallible objective ground truth, or natural production traffic.
