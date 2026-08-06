# Submission metadata

## Journal

Journal of Cyber Security Technology

## Article type

Research Article

## Full title

Can Compact Language Models Reliably Support HTTP Security Decisions? A Leakage-Controlled Empirical Evaluation

## Short title

Reliability of Compact LMs for HTTP Security

## Abstract

Compact language models are increasingly considered for local cybersecurity analysis, yet their apparent performance can be distorted by label leakage, internal test sets, binary task simplification, and inconsistent inference pipelines. This paper reports a leakage-controlled empirical evaluation of a 4B-parameter QLoRA-adapted model for request-side HTTP security decision support. The study uses a frozen 413-sample authorized LAN challenge set excluded from training, prompt selection, threshold selection, and model selection. Eight systems are compared on identical model-visible inputs, including repository rules, a character n-gram classifier, untuned zero-shot and few-shot language-model baselines, LoRA and merged artifacts, and two GGUF serving paths. The adapted model reaches 0.4658 verdict macro-F1 versus 0.4175 for zero-shot Qwen3-4B; the paired difference is 0.0482 with a 95% bootstrap confidence interval of 0.0113–0.0835. Attack recall reaches 0.9072, but the model falsely labels 43 of 209 safe requests as attacks and identifies none of 107 insufficient-context cases as unknown. Message serialization changes 11 of 413 verdicts, while byte-identical prompts remove the observed cross-runtime verdict differences. The results show that compact models can provide attack-sensitive triage signals, but high false-positive cost and complete abstention failure make autonomous blocking unjustified. The study contributes a reproducible characterization of reliability limits, rather than a new learning architecture.

## Keywords

1. HTTP security
2. cyberattack detection
3. compact language models
4. empirical evaluation
5. false positives
6. abstention
7. reproducibility

## Subject classifications

- Cybersecurity
- Network and application security
- Threat detection and response
- Machine learning for cybersecurity
- Intrusion detection
- Security evaluation and testing

## Author

- Name: Zuyi Li
- ORCID: 0009-0003-3835-7726
- Role: Sole author and corresponding author
- Affiliation: Hebei Xiong'an Qiongyu Technology Co., Ltd.
- Email: 2251213429@qq.com
- Telephone: +86 152 2722 5280

## Funding

This research did not receive any specific grant from funding agencies in the public, commercial, or not-for-profit sectors.

## Competing interest

Zuyi Li is the founder of Hebei Xiong'an Qiongyu Technology Co., Ltd., the author's affiliation. The company may have a commercial interest in artificial-intelligence and cybersecurity technologies related to this work. This relationship is disclosed as a potential competing interest.

## Data availability

A de-identified reviewer package containing model-visible inputs, frozen labels, per-sample predictions, protocol files, aggregate metrics, statistical outputs, and evaluation scripts is prepared for supplementary submission. Raw LAN capture material and confidential human-review worksheets are withheld because they contain operationally sensitive information. A persistent archival release of the de-identified package is planned subject to final privacy and security review.

## Ethics statement

All challenge traffic was generated and collected in an authorized LAN environment. No autonomous production blocking was evaluated or claimed.

## Generative AI disclosure

During manuscript preparation, generative AI tools were used for organization, language drafting, and consistency checking. The author reviewed and verified the manuscript and takes responsibility for its content.

## Publishing preference

Subscription publication / non-open-access route. Do not select optional Open Select unless the author explicitly changes this decision.

## Prior-publication declaration

The manuscript is original, has not been published, and is not currently under consideration by another journal.

## Suggested reviewers

Do not enter reviewers without a conflict-of-interest and expertise check. Prefer researchers in empirical cybersecurity evaluation, network traffic analysis, HTTP/application security, or reliable language-model evaluation who have no recent collaboration, employment, supervisory, or commercial relationship with the author or company.
