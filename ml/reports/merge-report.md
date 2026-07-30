# LoRA 合并报告

- 基座模型：`ml/output/base-model`
- Adapter：`/mnt/x/repos/Networksafe/ml/output/aetherargus-v02-lora`
- 合并模型：`/mnt/d/aetherargus-v02-merged`
- 合并设备：CPU
- 观测到的进程 RSS 峰值：14.61 GiB
- 固定样本重载 smoke test：20 条，完整执行成功
- smoke Schema 合法率：1.0000

脚本拒绝覆盖非空输出目录；合并权重使用 safetensors，并在释放 CPU 模型后以 4-bit GPU
方式重新加载固定测试样本。
