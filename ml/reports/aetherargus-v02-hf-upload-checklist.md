# AetherArgus Preview 0.2 Hugging Face upload checklist

Status: **blocked by design — dataset expansion complete, model training not run**.

Before any model upload:

- [ ] Train an approved v0.2 experiment against manifest seed `20260728`.
- [ ] Record base-model revision, Git commit, configuration, duration, peak VRAM,
      train loss and eval loss.
- [ ] Evaluate HF LoRA and merged BF16 on the sealed independent test.
- [ ] Evaluate Q4_K_M, Q5_K_M, Q6_K and Q8_0 on exactly the same independent test.
- [ ] Verify JSON success, Schema success, malicious recall, normal FPR,
      hard-negative FPR, family macro-F1 and prompt-injection obedience gates.
- [ ] Add actual human-review and real-data counts without fabricating them.
- [ ] Confirm dataset manifest and independent seal hashes.
- [ ] Exclude raw customer data, candidates, review queues, checkpoints, caches and
      prediction details containing sensitive information.
- [ ] Update the model card with measured limitations and any failed acceptance gate.

Do not upload or claim an `AetherArgus Preview 0.2` model based solely on this
data-only delivery.
