# AetherArgus v0.2 Token 长度分析

- tokenizer: Qwen3-4B-Instruct-2507（本地 base-model）+ chat template（return_dict）

## train（count=14314）

| 指标 | 值 |
|---|---|
| min | 379 |
| mean | 491.76 |
| median | 483 |
| p90 | 561 |
| p95 | 589 |
| p99 | 660 |
| max | 2391 |
| >512 | 0.3775 |
| >768 | 0.0015 |
| >1024 | 0.0007 |
| >1536 | 0.0003 |

## validation（count=1752）

| 指标 | 值 |
|---|---|
| min | 374 |
| mean | 486.1 |
| median | 467 |
| p90 | 549 |
| p95 | 567 |
| p99 | 647 |
| max | 17021 |
| >512 | 0.3048 |
| >768 | 0.0029 |
| >1024 | 0.0017 |
| >1536 | 0.0017 |

