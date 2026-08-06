# Journal of Cyber Security Technology submission package

This directory reframes the existing AetherArgus study for the **Journal of Cyber Security Technology (JCST)** as a cybersecurity reliability and failure-analysis paper.

The manuscript does **not** claim a new learning architecture, a novel QLoRA algorithm, or production-ready autonomous blocking. Its scientific contribution is an evidence-controlled empirical characterization of compact language models used for HTTP security decision support.

## Target article

- Journal: Journal of Cyber Security Technology
- Article type: Research Article
- Publishing route: subscription / non-open-access unless the author later chooses otherwise
- Proposed title: `Can Compact Language Models Reliably Support HTTP Security Decisions? A Leakage-Controlled Empirical Evaluation`

## Files

- `main.tex` — anonymized manuscript entry point for review.
- `title-page.tex` — author identity, affiliation, correspondence, ORCID, and declarations.
- `sections/introduction.tex` — cybersecurity reliability framing.
- `sections/related-work.tex` — includes the closest 2026 JCST study and distinguishes the present work.
- `sections/discussion.tex` — failure-centered cybersecurity interpretation.
- `sections/conclusion.tex` — bounded empirical conclusion.
- `sections/jcst-addendum.bib` — JCST-specific recent reference.
- `cover-letter.md` — journal-specific cover letter.
- `submission-metadata.md` — title, abstract, keywords, classifications, and form text.
- `highlights.txt` — concise upload-ready highlights.
- `declarations.md` — authorship, funding, competing interest, data, ethics, and AI-use statements.
- `SUBMISSION-CHECKLIST.md` — final author and submission-system checks.

The method, dataset/protocol, experimental setup, and results are reused from the evidence-aligned parent manuscript because the underlying experiment and reported values are unchanged.

## Build

From this directory:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
latexmk -pdf -interaction=nonstopmode -halt-on-error title-page.tex
```

The manuscript uses a neutral initial-submission layout rather than presenting a publisher typeset imitation. The bibliography combines the shared evidence-aligned references with the JCST-specific addendum.

## Submission boundary

Before submission, the author must:

1. verify the current journal instructions in the submission portal;
2. upload the anonymized manuscript and separate title page if anonymous review is requested;
3. attach the de-identified reviewer evidence archive as supplementary material;
4. select the subscription route if no APC is intended;
5. confirm the official English company name and postal address;
6. approve the final generated PDF in the journal system.

Do not describe the paper as a novel model architecture or as evidence that the evaluated model is deployment-ready.