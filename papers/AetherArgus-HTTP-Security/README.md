# AetherArgus HTTP Security Manuscript

This directory contains the evidence-aligned manuscript:

> **AetherArgus: Leakage-Controlled Evaluation of a Compact Language Model for HTTP Security Classification**

## Scope

The paper is intentionally narrower than the legacy `papers/SCI-main` multi-agent architecture draft. It makes claims only about:

- the AetherArgus v0.2 QLoRA-adapted 4B model;
- request-side `safe / attack / unknown` HTTP classification;
- the frozen 413-sample VIguard-LAN challenge evaluation;
- eight primary systems and four inference-path diagnostics;
- bootstrap confidence intervals, McNemar tests, and Holm correction;
- confidential blind human confirmation of the frozen reference labels;
- quantization, serialization, false-positive, and abstention findings.

It does **not** claim production-safe autonomous blocking, natural production prevalence, publicly reproducible human worksheets, or universal superiority over WAF/IDS products.

## Evidence baseline

- Human-review merge commit: `825fb95fb87a08d14e15e59078c7cf88beb9c5e8`
- Frozen evaluation merge commit: `279282128f7bb1d11c2f4d49aa043a57a7b82fb5`
- Protocol v1 commit: `79f146f2c8d400ef4afa292015b70a6bf91280ec`
- Protocol v2 commit: `553c0a9317e8c21f616991e92149fc828d7e8902`
- Model-input SHA-256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- Final-label SHA-256: `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- Human-review attestation SHA-256: `2c273945369cf41d98fe02072518b01151e17e2d98a5642e657dc3be2b5b9cbd`

## Build

From this directory:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

The manuscript uses `IEEEtran`. The evidence figures are loaded from:

```text
../../ml/reports/lan-challenge-evaluation/figures/
```

If a figure is unavailable in an isolated source package, the document inserts an evidence-placeholder box rather than failing compilation.

## Core results locked into the manuscript

- AetherArgus HF-LoRA Macro-F1: `0.4658`
- Qwen3-4B zero-shot Macro-F1: `0.4175`
- Paired difference: `+0.0482`, 95% CI `[+0.0113,+0.0835]`
- AetherArgus attack recall: `0.9072`
- AetherArgus safe FPR: `43/209 = 0.2057`
- AetherArgus unknown recall: `0/107 = 0`
- Q4_K_M size: approximately `2.33 GiB`
- Merged BF16 size: approximately `7.49 GiB`
- Single-concatenated message structure changed `11/413` verdicts
- Byte-identical serialized prompts produced `413/413` matching tested verdicts between merged-BF16 Transformers and Ollama-f16

## Publication wording

Use:

> confidentially human-reviewed reference labels

Do not use:

> publicly reproducible human ground truth

The human review occurred after the frozen model evaluation and produced zero label changes. This timeline is stated explicitly in the manuscript.
