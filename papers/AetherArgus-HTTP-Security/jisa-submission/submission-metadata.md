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

## Author and corresponding author

- Author count: 1
- Manuscript name: Zuyi Li
- Chinese name: 李祖祎
- Role: sole author and corresponding author
- Email: 2251213429@qq.com
- Phone: +86 152 2722 5280
- Affiliation: Hebei Xiong'an Qiongyu Technology Co., Ltd.
- Chinese legal name: 河北雄安穹驭科技有限公司
- Registered address (Chinese): 中国（河北）自由贸易试验区雄安片区雄安高新区服务中心621-045（自主申报）
- Working English address: No. 621-045, Xiong'an High-tech Zone Service Center, Xiong'an Area, China (Hebei) Pilot Free Trade Zone, Xiong'an New Area, Hebei 071700, China
- ORCID: [ADD IF AVAILABLE]

## Address verification note

The English company name and translated address are working publication forms. Before external submission, compare them against the business-registration record and any official English company materials. `621-045` is treated as the registered unit or declaration code, not as a postal code. The working postal code `071700` is based on official Xiong'an Area government contact information and should be confirmed against the company's preferred mailing record.

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
- The sole author must approve the final version.
- The research received no external grant funding unless later corrected.
- The company affiliation and possible commercial interest are disclosed.
- The final declaration file must be generated through Elsevier's declarations tool.
- Generative-AI assistance is disclosed in the manuscript.
