# Submission Checklist

## Edit first

- Replace all placeholder author information in `author-metadata.tex`
- Re-run `.\package-submission.ps1`
- Open `upload-package\01_PDF\aetherguard_ieee_access.pdf`

## Confirm before upload

- Author names are correct in the title block
- Affiliations and e-mail addresses are correct
- Running header text is correct
- Corresponding author line is correct
- Three biography paragraphs are correct and in the right order
- ORCID values are ready for the journal submission form
- `experimental-results\owasp-web-eval.json` is present and matches the manuscript tables
- The manuscript text clearly states that `ModSecurity + CRS` is scaffolded but not executed in the current workspace
- The manuscript text clearly states that route-mode latencies are orchestration measurements under heuristic fallback, not full LLM latency

## Upload set

- `upload-package\01_PDF\aetherguard_ieee_access.pdf`
- `upload-package\02_SOURCE\*`
- `upload-package\03_EXTRAS\cover-letter.txt`
- `upload-package\03_EXTRAS\data-availability.txt` if needed
- `upload-package\03_EXTRAS\graphical-abstract.svg` if needed

## Evidence boundary reminder

- Do not add unsupported claims such as a completed live `ModSecurity + CRS` benchmark
- Do not add unsupported claims such as full local-model LLM latency from the current route-mode run
- Do not add unsupported claims such as `100,000+ QPS`
- Do not add unsupported claims such as `<10 ms local AI latency`
- Do not add unsupported claims such as real-board ESP32 validation
