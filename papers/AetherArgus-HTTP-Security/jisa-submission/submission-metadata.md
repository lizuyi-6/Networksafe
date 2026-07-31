# JISA Submission Metadata

## Journal

Journal of Information Security and Applications (JISA)

## Article type

Research Article

## Title

AetherArgus: Leakage-Controlled and Reproducible Evaluation of a Compact Language Model for HTTP Security Classification

## Abstract

Large language models are increasingly proposed for application-layer security analysis, but internal test sets, label leakage, and inconsistent inference stacks can obscure actual performance. We present AetherArgus, a 4B-parameter QLoRA-adapted language model for structured HTTP request classification into safe, attack, or unknown, together with a leakage-controlled evaluation protocol. The model was trained on 14,314 records and evaluated on a frozen 413-sample authorized LAN challenge set that was excluded from training and tuning. Reference labels were produced by dual-model annotation and independent model adjudication, then confirmed after evaluation through a confidential blind human review with zero label changes. Eight systems were compared under a locked protocol. AetherArgus achieved 0.6150 accuracy and 0.4658 macro-F1, compared with 0.5230 and 0.4175 for zero-shot Qwen3-4B. The paired macro-F1 improvement was 0.0482 (95% confidence interval 0.0113–0.0835), and attack recall reached 0.9072. However, the safe false-positive rate remained 0.2057 and unknown recall was zero, precluding autonomous blocking. Q4_K_M quantization reduced storage from approximately 7.49 GiB to 2.33 GiB with a small observed macro-F1 reduction, while changing message structure altered 11 of 413 verdicts. These results show that compact task-adapted models can improve attack-oriented classification, but deployment claims require explicit false-positive, abstention, and inference-path analysis.

Abstract word count: 197.

## Keywords

1. HTTP security
2. Intrusion detection
3. Language models
4. QLoRA
5. Prompt injection
6. Abstention
7. Reproducibility

## Corresponding author

- Name: Zuyi Li
- Email: [REQUIRED]
- Phone: [REQUIRED BY SUBMISSION CHECKLIST]
- Full affiliation: [REQUIRED]
- Full postal address: [REQUIRED]
- ORCID: [ADD IF AVAILABLE]

## Author list

The complete author list, order, affiliations, and CRediT roles must be finalized before submission. JISA generally does not permit routine authorship changes after submission.

## Suggested subject areas

- Network and mobile security
- Security management and policies
- Artificial intelligence for information security
- Application-layer attack detection
- Adversarial and prompt-injection robustness

## Data statement for the submission form

The protocols, scripts, manifests, aggregate metrics, statistical outputs, and claim-to-evidence mappings are available to editors and reviewers through an associated private repository during peer review. A de-identified reproducibility package containing model-visible challenge inputs, reference labels, per-sample predictions, and evaluation scripts is intended for archival release in a persistent repository. Raw LAN capture material and confidential human-review worksheets are not publicly shared because they contain operationally sensitive information.

## Preprint

No preprint is currently declared in this package. If the manuscript is uploaded to a preprint server, disclose the DOI or URL in the submission system.

## Submission declarations

- The manuscript is not under consideration elsewhere.
- All qualifying authors must approve the final version.
- The final funding statement must be confirmed.
- The final competing-interest declaration must be selected and generated through Elsevier's declarations tool.
- Generative-AI assistance is disclosed in the manuscript.
