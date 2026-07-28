# QLoRA 显存适配 Smoke Test

生成时间：`2026-07-28T00:22:24.174096+00:00`

4B smoke test 成功，配置为 max_length=768、LoRA r=8、alpha=16。

## 尝试记录

- `4b_initial`: exit=0, OOM=False, elapsed=462.6s, change=initial requested configuration

训练和验证 batch size 均为 1，梯度检查点已启用。训练期验证只计算 loss，未执行生成式
评估，因此“关闭训练过程中的生成式评估”从首轮即满足，不作为伪造的 OOM 调整步骤。
完整日志：`/mnt/x/repos/Networksafe/ml/logs/smoke-adaptation-20260728T001441Z.log`。
