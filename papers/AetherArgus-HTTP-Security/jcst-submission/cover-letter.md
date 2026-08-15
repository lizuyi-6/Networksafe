6 August 2026

Editor-in-Chief
Journal of Cyber Security Technology

Dear Editor,

Please consider the enclosed Research Article:

**Can Compact Language Models Reliably Support HTTP Security Decisions? A Leakage-Controlled Empirical Evaluation**

The manuscript reports a reliability-oriented cybersecurity evaluation of a compact, locally deployable language model used for request-side HTTP security decision support. It does not claim a new learning architecture or a novel QLoRA algorithm. Its contribution is an evidence-controlled empirical characterization of the conditions under which task adaptation improves attack detection and the conditions under which the resulting model remains unsafe.

The study evaluates eight systems on the same frozen 413-sample authorized LAN challenge set. The challenge set was excluded from training, prompt selection, threshold selection, hyperparameter tuning, and model selection. Prediction and scoring are separated so that the inference process cannot access the frozen labels. The analysis reports paired bootstrap confidence intervals, McNemar tests, class-specific false-positive and abstention failures, structured-output validity, runtime and artifact trade-offs, and message-serialization sensitivity.

The main result is intentionally bounded. The adapted model improves verdict macro-F1 over zero-shot Qwen3-4B and reaches high attack recall, but it still falsely labels 43 of 209 safe requests as attacks and fails to identify all 107 insufficient-context cases as unknown. We therefore reject autonomous blocking and interpret the model only as a shadow-mode or second-stage triage signal.

The manuscript fits the Journal of Cyber Security Technology because it addresses threat detection, prevention, and response at the HTTP application layer and focuses on the technical reliability of an emerging cybersecurity analysis mechanism. The journal recently published “Evaluation of local LLMs for network traffic packet analysis” (doi:10.1080/23742917.2026.2671738), which similarly examines the practical limits of local language models in cyberattack detection. Our study complements that work through request-level HTTP analysis, a task-adapted compact model, a three-class safe/attack/unknown decision boundary, same-input comparisons with rules and conventional machine learning, and paired statistical testing under a frozen leakage-controlled protocol.

A de-identified supplementary package is prepared for peer review and contains model-visible inputs, frozen labels, per-sample predictions, protocol files, aggregate metrics, statistical outputs, and evaluation scripts. Raw LAN capture material and confidential human-review worksheets are withheld because they contain operationally sensitive information. All traffic was generated and collected in an authorized LAN environment.

The manuscript is original, has not been published, and is not under consideration by another journal. The author approves this submission and accepts responsibility for the work. No external funding supported the study. A founder-related competing interest and the use of generative AI during manuscript preparation are fully disclosed.

The author intends to use the journal’s subscription publication route rather than optional open access unless a separate decision is made after acceptance.

Thank you for your consideration.

Sincerely,

Zuyi Li
Founder, Hebei Xiong'an Qiongyu Technology Co., Ltd.
ORCID: 0009-0003-3835-7726
Email: 2251213429@qq.com
Telephone: +86 152 2722 5280
