# Generator isolation audit（brief §51）

- train/iid_dev/world_ood/workflow_ood/mechanism_ood: step-5-preview（production contract 冻结）
- generator_ood: step-3.7-flash，独立 run provider-ood-benchmark-001
- engineering pilot（provider-ood-pilot-001，40 worlds）不在本 release 内（brief §16）
- 两个生成器之间零 world 重叠
- 限制：同一供应商 → MODEL-OOD，不是 VENDOR-OOD
