# AetherArgus v0.2 QLoRA 显存适配 Smoke Test

生成时间：`2026-07-29T01:49:29.867102+00:00`

4B smoke test 成功，配置为 max_length=1024、LoRA r=16、alpha=32。

## 尝试记录

- `4b_config_as_locked`: exit=0, OOM=False, elapsed=661.9s, change=initial locked v0.2 configuration from --config

首轮尝试直接使用 `--config`（`ml/configs/qwen3-4b-qlora-v02.yaml`）中的锁定值，仅在真实 CUDA OOM 时按
max_length / LoRA rank / alpha 顺序降级。训练和验证 batch size 均为
1/1，梯度检查点
启用。训练期验证只计算 loss，未执行生成式评估。
完整日志：`/mnt/x/repos/Networksafe/ml/logs/smoke-adaptation-v02-20260729T013827Z.log`。
