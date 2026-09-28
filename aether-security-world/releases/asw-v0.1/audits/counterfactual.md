# Counterfactual audit

逐变体的 truth 一致性由 Oracle 在 (world, action, evidence_view) 上重算，
并经 `tests/integration/test_phase2b_episodes.py` 钉死。

- critical intervention: 世界级 **502/502 = 100%**
  （逐轴 573/584，
  11 个 mixed-base：base 为 attack/insufficient_evidence
  时个别 critical 轴单独翻转不了，真正被违反的是另一条不变量）
- irrelevant perturbation: **1017/1017**
- evidence masked: **2388/2388**（world_truth 不变）
- base labels: {"attack": 400, "insufficient_evidence": 69, "safe": 145}
