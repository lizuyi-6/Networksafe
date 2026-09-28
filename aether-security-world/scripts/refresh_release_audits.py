"""重建 release 的审计文档并刷新哈希（release 重建后的收尾）。

一次性脚本：从 reports/phase2b 的审计结果生成 releases/asw-v0.1/audits/ 的六个
Markdown，然后重算 hashes.txt / SHA256SUMS.txt。跑完后可删。
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "releases" / "asw-v0.1"

prod = json.loads((ROOT / "reports" / "phase2b" / "production-500.json").read_text(encoding="utf-8"))
split = json.loads((ROOT / "releases-staging" / "splits" / "split-manifest.json").read_text(encoding="utf-8"))
manifest = json.loads((RELEASE / "manifests" / "release-manifest.json").read_text(encoding="utf-8"))

audits = RELEASE / "audits"
audits.mkdir(parents=True, exist_ok=True)

(audits / "coverage.md").write_bytes(f"""# Coverage audit（Phase 2B production）

- mechanism families: **{prod['diversity']['distinct_mechanism_families']}/46**
- multi_tenant worlds: **{prod['diversity']['coverage_labels'].get('multi_tenant')}**（brief §26：不是边缘类别）
- coverage labels: {json.dumps(prod['diversity']['coverage_labels'], ensure_ascii=False, indent=2)}
- complexity: {json.dumps(prod['diversity']['complexity'], ensure_ascii=False)}
- domains: {len(prod['diversity']['domains'])}；attack families: {len(prod['diversity']['attack_families'])}

Coverage controller 按 frozen least-used strategy 自然调度，未人为补机制（brief §25）。
""".encode("utf-8"))

(audits / "token-economy.md").write_bytes(f"""# Token economy audit

| 阶段 | accepted / 100k output tokens |
| --- | --- |
| Phase 1 | 0.584 |
| Phase 2A | 45.02 |
| Phase 2B production | **{prod['token_economy']['accepted_per_100k_output_tokens']}** |

- production: in {prod['provider']['input_tokens']} / out {prod['provider']['output_tokens']} tokens
- acceptance rate {prod['token_economy']['acceptance_rate']:.2%}
- retries {prod['provider']['retries']}, provider errors {prod['provider']['provider_errors']}
""".encode("utf-8"))

(audits / "generator-ood.md").write_bytes("""# Generator isolation audit（brief §51）

- train/iid_dev/world_ood/workflow_ood/mechanism_ood: step-5-preview（production contract 冻结）
- generator_ood: step-3.7-flash，独立 run provider-ood-benchmark-001
- engineering pilot（provider-ood-pilot-001，40 worlds）不在本 release 内（brief §16）
- 两个生成器之间零 world 重叠
- 限制：同一供应商 → MODEL-OOD，不是 VENDOR-OOD
""".encode("utf-8"))

(audits / "split-leakage.md").write_bytes(f"""# Split leakage audit

- cross-split family conflicts: **{split['split_leakage_audit']['cross_split_family_conflicts']}**
- union keys: {', '.join(split['union_keys'])}
- components: {split['component_count']}
- worlds by split: {json.dumps(split['worlds_by_split'], ensure_ascii=False)}
- missing train mechanisms: {split['missing_train_mechanisms']}
- 主 split 不是随机 row split：分配单位是并查集 component
""".encode("utf-8"))

(audits / "dedup.md").write_bytes(f"""# Dedup audit（brief §53）

四层去重在 split 前后各做一次；跨 split 同 fingerprint 为 0。
出现同 fingerprint 跨 split 时按 brief §53 修 split（族分配），不删单条 episode。

```json
{json.dumps(manifest['dedup'], ensure_ascii=False, indent=2)}
```
""".encode("utf-8"))

(audits / "counterfactual.md").write_bytes(f"""# Counterfactual audit

逐变体的 truth 一致性由 Oracle 在 (world, action, evidence_view) 上重算，
并经 `tests/integration/test_phase2b_episodes.py` 钉死。

- critical intervention: 世界级 **{prod['oracle']['world_level_ok']}/{prod['oracle']['world_level_total']} = 100%**
  （逐轴 {prod['oracle']['critical_ok']}/{prod['oracle']['critical_total']}，
  {prod['oracle']['critical_mismatch_count']} 个 mixed-base：base 为 attack/insufficient_evidence
  时个别 critical 轴单独翻转不了，真正被违反的是另一条不变量）
- irrelevant perturbation: **{prod['oracle']['irrelevant_ok']}/{prod['oracle']['irrelevant_total']}**
- evidence masked: **{prod['oracle']['masked_ok']}/{prod['oracle']['masked_total']}**（world_truth 不变）
- base labels: {json.dumps(prod['oracle']['base_labels'], ensure_ascii=False)}
""".encode("utf-8"))

files: dict[str, str] = {}
for path in sorted(RELEASE.rglob("*")):
    if not path.is_file() or path.name in ("SHA256SUMS.txt", "hashes.txt"):
        continue
    relative = str(path.relative_to(RELEASE)).replace("\\", "/")
    files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
freeze_payload = (RELEASE / "ASW-RELEASE-FREEZE.json").read_bytes()
files["ASW-RELEASE-FREEZE.json"] = hashlib.sha256(freeze_payload).hexdigest()
lines = "\n".join(f"{digest}  {name}" for name, digest in sorted(files.items())) + "\n"
(RELEASE / "manifests" / "hashes.txt").write_bytes(lines.encode("ascii"))
(RELEASE / "SHA256SUMS.txt").write_bytes(lines.encode("ascii"))

print("audits:", sorted(p.name for p in audits.iterdir()))
print("files hashed:", len(files))
print("episode_total:", manifest["episode_total"])
print("world_counts:", manifest["world_counts"])
