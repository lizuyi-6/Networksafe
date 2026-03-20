# IEEE Access Submission Bundle

Start here if you are using this package for the first time:

- `00-START-HERE-zh-CN.md`: Chinese quick-start guide
- `author-metadata.tex`: the only file most users need to edit
- `package-submission.ps1`: rebuilds the PDF and creates a clean `upload-package` folder

## Recommended workflow

From this directory:

```powershell
.\package-submission.ps1
```

This command rebuilds the paper, creates `upload-package`, and also produces `ieee-access-upload-package.zip`.

## What each main file is for

- `aetherguard_ieee_access.tex`: main manuscript body
- `author-metadata.tex`: names, affiliations, e-mail addresses, ORCID placeholders, and biographies
- `references.bib`: curated bibliography used by the manuscript
- `cover-letter.txt`: editor cover letter draft
- `data-availability.txt`: standalone data and code availability statement
- `experimental-results/owasp-web-eval.json`: OWASP-derived experimental report used by the manuscript
- `submission-checklist.md`: final pre-upload checklist
- `graphical-abstract.svg`: optional graphical abstract draft
- `build-paper.ps1`: low-level build script

## Notes

- The manuscript now uses an OWASP-derived experimental report plus repository-verifiable platform evidence from the current workspace.
- The source tree includes the official IEEE Access template assets so the build remains self-contained.
- The manuscript intentionally avoids unsupported claims such as a completed live `ModSecurity + CRS` comparison, full-LLM local-model latency, `100,000+ QPS`, `<10 ms local AI latency`, `<2% CPU`, `<50 MB memory`, and real-board ESP32 validation.

## Official Preparation Links

- `IEEE Access` submission guidelines: <https://ieeeaccess.ieee.org/guide-for-authors/submission-guidelines/>
- `IEEE Access` preparing your article: <https://ieeeaccess.ieee.org/authors/preparing-your-article/>
