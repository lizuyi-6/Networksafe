# JISA Submission Package

This directory adapts the evidence-aligned AetherArgus manuscript for the Journal of Information Security and Applications.

## Files

- `main.tex` — Elsevier `elsarticle` manuscript entry point.
- `sections/introduction.tex` — JISA-specific introduction without IEEE front matter.
- `highlights.txt` — five upload-ready highlights, each no more than 85 characters.
- `cover-letter.md` — journal-specific cover letter with contact placeholders.
- `submission-metadata.md` — title, 197-word abstract, keywords, subject areas, and form text.
- `declarations.md` — CRediT, funding, competing-interest, AI-use, and data statements.
- `figure-captions.txt` — standalone figure captions.
- `SUBMISSION-CHECKLIST.md` — final technical, ethical, and submission-system checks.

The JISA manuscript reuses the evidence-aligned method, data, experiment, result, discussion, and conclusion sections from the parent manuscript directory.

## Build

From this directory:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

The build requires the Elsevier `elsarticle` class and the `elsarticle-harv` bibliography style. Evidence figures are resolved from the repository's frozen evaluation directory.

## Not yet safe to submit

The package intentionally retains visible blockers rather than inventing author metadata. Before submission, complete:

1. final author list and order;
2. full institutional affiliations;
3. corresponding-author email, phone, and postal address;
4. accurate funding statement;
5. accurate competing-interest declaration;
6. reviewer or public access to the reproducibility package;
7. final human scientific and language review.

Do not remove the generative-AI declaration. The manuscript received substantive AI assistance in organization and drafting, so disclosure is required.

## Recommended submission model

JISA supports both subscription publication and optional open access. Select the subscription route if no article-processing-charge funding is available, subject to the options shown by the submission and acceptance systems.
