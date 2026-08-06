# JCST submission checklist

## Scientific positioning

- [ ] The manuscript is described as an empirical cybersecurity reliability study.
- [ ] No section claims a new learning architecture, new QLoRA method, or production-ready model.
- [ ] The abstract retains the 20.57% safe FPR and zero unknown recall.
- [ ] The conclusion rejects autonomous blocking.
- [ ] The closest 2026 JCST local-LLM traffic study is cited and the differences are explicit.
- [ ] Claims remain bounded to the frozen 413-sample authorized LAN challenge set.

## Manuscript files

- [ ] Build `main.tex` successfully with no unresolved references or citations.
- [ ] Build `title-page.tex` successfully.
- [ ] Visually inspect every page of the generated manuscript PDF.
- [ ] Confirm figures are legible and their captions match the evidence package.
- [ ] Confirm tables contain the frozen values and no prior-journal names remain.
- [ ] Confirm the manuscript and title page use the final identical title.
- [ ] Confirm the abstract entered in the submission form matches `submission-metadata.md`.

## Author identity

- [ ] Verify the preferred official English company name.
- [ ] Verify the complete postal address and postal code.
- [ ] Confirm correspondence email and telephone.
- [ ] Confirm ORCID `0009-0003-3835-7726` is connected to the submitting account.
- [ ] Keep author identity out of the anonymized manuscript when the portal requests anonymous review.

## Evidence and data

- [ ] Attach the de-identified reviewer evidence archive as supplementary material.
- [ ] Verify the archive contains model-visible inputs, frozen labels, predictions, protocols, metrics, statistics, and scripts.
- [ ] Run the archive privacy and secret scan immediately before upload.
- [ ] Confirm no raw credentials, cookies, session tokens, private keys, or operational identifiers are included.
- [ ] Confirm the input and frozen-label SHA-256 values match the manuscript.
- [ ] Do not claim that confidential worksheets or raw LAN captures are public.

## Declarations

- [ ] Paste the funding statement exactly.
- [ ] Paste the founder-related competing-interest statement exactly.
- [ ] Paste the ethics and authorization statement exactly.
- [ ] Paste the generative-AI disclosure exactly.
- [ ] Confirm the manuscript is not under review elsewhere.
- [ ] Confirm all author-contribution roles are accurate.

## Journal submission

- [ ] Re-read the current Journal of Cyber Security Technology instructions in the live portal.
- [ ] Select `Research Article`.
- [ ] Upload the manuscript, title page, cover letter, declarations, and supplementary archive.
- [ ] Enter keywords and classifications from `submission-metadata.md`.
- [ ] Add suggested reviewers only after expertise and conflict checks.
- [ ] Select the subscription / non-open-access publication route if prompted.
- [ ] Do not select optional Open Select/APC without a separate author decision.
- [ ] Inspect the portal-generated PDF and approve only after page-by-page verification.
- [ ] Save the final manuscript number and confirmation email in the private submission record.

## Final stop conditions

Do not submit when any of the following is true:

- unresolved LaTeX references or missing figures;
- abstract or title differs between files and portal fields;
- supplementary evidence contains secrets or operationally sensitive raw material;
- another journal still lists the manuscript as under consideration;
- the live instructions require a missing mandatory document;
- the generated PDF has clipped tables, hashes, captions, or author information in the anonymized file.
